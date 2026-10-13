# Android AI agent

This directory contains the Python visual agent for the Android dashboard. Its .env and .venv are intentionally ignored by Git. Configure OPENAI_API_KEY in android-agent/.env, never commit the key. The dashboard starts the agent when its Node server starts. Select an authorized Android serial from the dashboard.

First-time setup on Windows: `py -3 -m venv android-agent\.venv` then `android-agent\.venv\Scripts\python.exe -m pip install -r android-agent\requirements.txt`.

The Android SDK platform tools (adb) must be installed on the host; connect and authorize devices before issuing commands. Only use the dashboard on trusted networks behind authentication if externally reachable.
