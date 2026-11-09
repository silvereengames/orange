import os
import time
import asyncio
import colorsys
import threading
import dataset
from dotenv import load_dotenv
from flask import Flask, render_template, jsonify, request
from kasa import Discover, Credentials

# Load environment variables from a .env file if present
load_dotenv()

# Initialize Flask app serving static assets from the root directory
# Place index.html inside the "templates/" folder and static assets in "assets/"
app = Flask(__name__, static_url_path='')

# Database URL used by dataset (SQLite backend supporting dictionary/NoSQL-like operations)
DB_URL = os.environ.get("DATABASE_URL", "sqlite:///devices.db")
db_lock = threading.Lock()

# Optional Tapo / TP-Link Cloud Credentials (Required by newer Tapo firmware for local control)
TAPO_USERNAME = os.environ.get("TAPO_USERNAME", "")
TAPO_PASSWORD = os.environ.get("TAPO_PASSWORD", "")

# Interval in seconds for background network discovery
SCAN_INTERVAL_SECONDS = int(os.environ.get("SCAN_INTERVAL", 30))


def get_credentials():
    """Returns Kasa Credentials object if Tapo credentials are provided."""
    if TAPO_USERNAME and TAPO_PASSWORD:
        return Credentials(TAPO_USERNAME, TAPO_PASSWORD)
    return None


def hex_to_hsv(hex_str):
    """
    Converts a hex color string (e.g. '#ff5500') to an HSV tuple
    compatible with python-kasa: (hue [0-360], saturation [0-100], value [0-100]).
    """
    hex_str = hex_str.lstrip('#')
    if len(hex_str) != 6:
        return (0, 0, 100)
    r, g, b = tuple(int(hex_str[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    return int(round(h * 360)), int(round(s * 100)), int(round(v * 100))


def hsv_to_hex(h, s, v):
    """Converts python-kasa HSV values back into a standard '#rrggbb' hex string."""
    r, g, b = colorsys.hsv_to_rgb((h or 0) / 360.0, (s or 0) / 100.0, (v or 100) / 100.0)
    return '#{:02x}{:02x}{:02x}'.format(int(round(r * 255)), int(round(g * 255)), int(round(b * 255)))


def extract_light_feature(dev):
    """
    Retrieves the light controller from a python-kasa Device instance,
    supporting both python-kasa >= 0.6 (Module.Light) and older versions.
    """
    if hasattr(dev, "modules") and "Light" in dev.modules:
        return dev.modules["Light"]
    return dev


def check_supports_color(dev):
    """Checks if the discovered Kasa/Tapo device supports RGB/HSV color control."""
    light = extract_light_feature(dev)
    if hasattr(light, "is_color"):
        return bool(light.is_color)
    return False


def get_device_color_hex(dev):
    """Extracts the current HSV color from a device and formats it as a hex string."""
    try:
        if check_supports_color(dev):
            light = extract_light_feature(dev)
            if hasattr(light, "hsv") and light.hsv:
                h, s, v = light.hsv
                return hsv_to_hex(h, s, v)
    except Exception:
        pass
    return "#ffffff"


async def async_discover_and_sync():
    """
    Scans the local network using python-kasa, updates every found device,
    and upserts the device details and current states into the dataset database.
    """
    creds = get_credentials()
    discovered = await Discover.discover(credentials=creds)

    records_to_save = []
    for ip, dev in discovered.items():
        try:
            await dev.update()
            device_id = str(dev.device_id or dev.mac or ip)
            records_to_save.append({
                "device_id": device_id,
                "ip": ip,
                "alias": dev.alias or f"Tapo Device ({ip})",
                "model": dev.model,
                "is_on": bool(dev.is_on),
                "supports_color": check_supports_color(dev),
                "color_hex": get_device_color_hex(dev),
                "online": True,
                "last_seen": int(time.time())
            })
        except Exception as err:
            print(f"[Discovery] Failed updating device at {ip}: {err}")

    # Persist all discovered states in the dataset database
    with db_lock:
        with dataset.connect(DB_URL) as db:
            table = db["devices"]
            # Clean up any legacy sample entries lacking a valid device_id
            table.delete(device_id=None)
            for rec in records_to_save:
                table.upsert(rec, ["device_id"])


async def async_control_device(ip, action, color_hex=None):
    """
    Connects directly to a single Tapo/Kasa device by IP and performs the requested action.
    Returns a dictionary of updated state attributes.
    """
    creds = get_credentials()
    dev = await Discover.discover_single(ip, credentials=creds)
    await dev.update()

    try:
        if action == "on":
            await dev.turn_on()
        elif action == "off":
            await dev.turn_off()
        elif action == "color" and color_hex:
            h, s, v = hex_to_hsv(color_hex)
            light = extract_light_feature(dev)
            if hasattr(light, "set_hsv"):
                await light.set_hsv(h, s, v)
            if not dev.is_on:
                await dev.turn_on()

        await dev.update()
        return {
            "is_on": bool(dev.is_on),
            "supports_color": check_supports_color(dev),
            "color_hex": color_hex if (action == "color" and color_hex) else get_device_color_hex(dev),
            "online": True,
            "last_seen": int(time.time())
        }
    finally:
        if hasattr(dev, "disconnect"):
            await dev.disconnect()


def background_scanner_worker():
    """Background daemon thread that periodically scans the network for new or updated devices."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    while True:
        try:
            loop.run_until_complete(async_discover_and_sync())
        except Exception as err:
            print(f"[Background Scanner] Error during network scan: {err}")
        time.sleep(SCAN_INTERVAL_SECONDS)


# ==================== FLASK ROUTES ====================

@app.route("/")
def home():
    """Renders the main dashboard template."""
    return render_template("index.html")


@app.route("/api/devices", methods=["GET"])
def list_devices():
    """Returns all saved devices and their persisted states from the dataset database."""
    with db_lock:
        with dataset.connect(DB_URL) as db:
            devices = list(db["devices"].find(order_by=["alias"]))
    return jsonify(devices)


@app.route("/api/scan", methods=["POST"])
def manual_scan():
    """Triggers an immediate network scan on demand."""
    try:
        asyncio.run(async_discover_and_sync())
        return jsonify({"status": "ok"})
    except Exception as err:
        return jsonify({"status": "error", "message": str(err)}), 500


@app.route("/api/devices/<device_id>/<action>", methods=["POST"])
def device_action(device_id, action):
    """
    Turns a specific device on/off or changes its color, then saves
    the updated state in the dataset database.
    """
    if action not in ("on", "off", "color"):
        return jsonify({"error": "Invalid action"}), 400

    with db_lock:
        with dataset.connect(DB_URL) as db:
            device = db["devices"].find_one(device_id=device_id)

    if not device:
        return jsonify({"error": "Device not found in database"}), 404

    payload = request.get_json(silent=True) or {}
    color_hex = payload.get("color")

    try:
        updated_fields = asyncio.run(
            async_control_device(device["ip"], action, color_hex=color_hex)
        )
        updated_fields["device_id"] = device_id

        with db_lock:
            with dataset.connect(DB_URL) as db:
                db["devices"].upsert(updated_fields, ["device_id"])
                latest_record = db["devices"].find_one(device_id=device_id)

        return jsonify(latest_record)
    except Exception as err:
        return jsonify({"error": str(err)}), 500


@app.route("/api/room/<action>", methods=["POST"])
def room_action(action):
    """Turns all discovered devices on or off and persists their states."""
    if action not in ("on", "off"):
        return jsonify({"error": "Invalid room action"}), 400

    with db_lock:
        with dataset.connect(DB_URL) as db:
            devices = list(db["devices"].all())

    async def toggle_all():
        tasks = [
            async_control_device(dev["ip"], action)
            for dev in devices if dev.get("ip")
        ]
        return await asyncio.gather(*tasks, return_exceptions=True)

    results = asyncio.run(toggle_all())

    with db_lock:
        with dataset.connect(DB_URL) as db:
            table = db["devices"]
            for dev, res in zip(devices, results):
                if isinstance(res, dict):
                    res["device_id"] = dev["device_id"]
                    table.upsert(res, ["device_id"])

    return jsonify({"status": "ok"})


if __name__ == "__main__":
    # Start the background network scanner only once (avoids duplicate threads with Flask reloader)
    if os.environ.get("WERKZEUG_RUN_MAIN") == "true" or not app.debug:
        scanner_thread = threading.Thread(target=background_scanner_worker, daemon=True)
        scanner_thread.start()

    app.run(debug=True)