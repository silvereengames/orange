/**
 * Orange-Webdash Frontend Controller
 * Handles fetching devices from the dataset DB, rendering rows matching
 * Bootstrap Studio structure, and controlling Tapo/Kasa devices.
 */

document.addEventListener('DOMContentLoaded', () => {
    const tableBody = document.getElementById('device-table-body');
    const allOnBtn = document.getElementById('all-lights-on');
    const allOffBtn = document.getElementById('all-lights-off');
    const colorPickerInput = document.getElementById('color-picker-input');
    const saveColorBtn = document.getElementById('save-color-btn');

    // Tracks which device's "Change Color" modal is currently open
    let activeColorDeviceId = null;

    /**
     * Fetches the current device list from the backend database and updates the table.
     */
    async function loadDevices() {
        try {
            const response = await fetch('/api/devices');
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            const devices = await response.json();
            renderDeviceTable(devices);
        } catch (error) {
            console.error('Error fetching devices:', error);
        }
    }

    /**
     * Renders the device rows into the table body while keeping exact Bootstrap Studio classes.
     * @param {Array} devices - List of device objects from the database.
     */
    function renderDeviceTable(devices) {
        if (!tableBody) return;

        if (!devices || devices.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="2">Scanning network for Tapo / Kasa devices...</td>
                </tr>
            `;
            return;
        }

        tableBody.innerHTML = '';

        devices.forEach((device) => {
            const tr = document.createElement('tr');

            // Device Name Column (displays alias and current state)
            const tdName = document.createElement('td');
            const stateLabel = device.is_on ? ' (On)' : ' (Off)';
            tdName.textContent = (device.alias || device.ip) + stateLabel;

            // Actions Column
            const tdActions = document.createElement('td');

            // Turn On Button
            const btnOn = document.createElement('button');
            btnOn.className = 'btn btn-primary ms-2 me-2';
            btnOn.type = 'button';
            btnOn.textContent = 'Turn On';
            btnOn.disabled = Boolean(device.is_on);
            btnOn.addEventListener('click', () => {
                controlSingleDevice(device.device_id, 'on');
            });

            // Turn Off Button
            const btnOff = document.createElement('button');
            btnOff.className = 'btn btn-primary ms-2 me-2';
            btnOff.type = 'button';
            btnOff.textContent = 'Turn Off';
            btnOff.disabled = !device.is_on;
            btnOff.addEventListener('click', () => {
                controlSingleDevice(device.device_id, 'off');
            });

            // Change Color Button (triggers #modal-1 just like the template)
            const btnColor = document.createElement('button');
            btnColor.className = 'btn btn-primary ms-2 me-2';
            btnColor.type = 'button';
            btnColor.textContent = 'Change Color';
            btnColor.setAttribute('data-bs-target', '#modal-1');
            btnColor.setAttribute('data-bs-toggle', 'modal');
            if (!device.supports_color) {
                btnColor.disabled = true;
            }
            btnColor.addEventListener('click', () => {
                activeColorDeviceId = device.device_id;
                if (colorPickerInput && device.color_hex) {
                    colorPickerInput.value = device.color_hex;
                }
            });

            tdActions.appendChild(btnOn);
            tdActions.appendChild(btnOff);
            tdActions.appendChild(btnColor);

            tr.appendChild(tdName);
            tr.appendChild(tdActions);
            tableBody.appendChild(tr);
        });
    }

    /**
     * Sends a command to turn a specific device on, off, or change its color.
     * @param {string} deviceId - Unique identifier of the device.
     * @param {string} action - 'on', 'off', or 'color'.
     * @param {Object} extraData - Optional payload data (e.g. hex color).
     */
    async function controlSingleDevice(deviceId, action, extraData = {}) {
        try {
            const response = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/${action}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(extraData)
            });

            if (!response.ok) {
                console.error(`Failed to execute ${action} on device ${deviceId}`);
            }
            await loadDevices();
        } catch (error) {
            console.error(`Error controlling device ${deviceId}:`, error);
        }
    }

    /**
     * Sends a room-wide command to turn all discovered devices on or off.
     * @param {string} action - 'on' or 'off'.
     */
    async function controlAllDevices(action) {
        try {
            const response = await fetch(`/api/room/${action}`, {
                method: 'POST'
            });

            if (!response.ok) {
                console.error(`Failed to turn all lights ${action}`);
            }
            await loadDevices();
        } catch (error) {
            console.error(`Error executing room control (${action}):`, error);
        }
    }

    // Bind Room Control Buttons
    if (allOnBtn) {
        allOnBtn.addEventListener('click', () => controlAllDevices('on'));
    }

    if (allOffBtn) {
        allOffBtn.addEventListener('click', () => controlAllDevices('off'));
    }

    // Bind Modal Color Save Button
    if (saveColorBtn) {
        saveColorBtn.addEventListener('click', () => {
            if (activeColorDeviceId && colorPickerInput) {
                controlSingleDevice(activeColorDeviceId, 'color', {
                    color: colorPickerInput.value
                });
            }
        });
    }

    // Initial load and periodic UI refresh (every 5 seconds) to reflect background scans
    loadDevices();
    setInterval(loadDevices, 5000);
});