#!/usr/bin/env bash
set -e

echo "Creating Python virtual environment in .venv..."
python3 -m venv .venv

echo "Activating .venv..."
source .venv/bin/activate

echo "Upgrading pip and installing dependencies from requirements.txt..."
pip install --upgrade pip
pip install -r requirements.txt