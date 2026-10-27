# Device Control Center landing page

This is a **public informational page only**, not a remote-control gateway. It deliberately does not expose the existing ws-scrcpy server, ADB, or USB devices. Windows installer packaging, authentication, pairing, relay and streaming require further implementation and security testing.

Render build command: `cd render-site && npm install --omit=dev`

Render start command: `cd render-site && npm start`

Health endpoint: `/healthz`.
