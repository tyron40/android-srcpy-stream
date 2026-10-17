# iPhone mirror and pointer-control integration

This repository already contains an iOS device tracker, MJPEG/QVHack stream clients, a WebDriverAgent proxy, and click/swipe coordinate conversion. Do not replace these with Android ADB commands: iOS has a different security and input model.

## Supported modes

1. **WDA touch mode (existing):** the browser sends clicks/swipes through `WdaProxyClient` and `WDARunner`. This requires a compatible, signed WebDriverAgent already installed on the iPhone, with developer setup as required by iOS. On Windows, starting `xcodebuild` is not supported; `usePrebuiltWDA` alone does not guarantee a working session.
2. **AssistiveTouch pointer mode (proposed):** the iPhone pairs with an explicitly authorized Bluetooth HID mouse or a Windows BLE HID peripheral. A host-side adapter must advertise HID mouse functionality, pair on the iPhone, and send relative pointer/button reports. An ordinary Windows Bluetooth adapter does **not** necessarily support BLE peripheral/HID emulation. Browser mouse events cannot directly become iOS touches without that bridge. Verify hardware and driver support before enabling this mode.
3. **View-only:** mirror the screen without input when neither input backend is ready. This is the safe default.

## Implementation sequence

- Preserve Android scrcpy and all existing routes.
- Add per-device input capability state (`view-only`, `wda`, `assistive-touch`) and surface pairing/session errors in the UI.
- Detect an authorized and connected BLE HID bridge, or allow a documented external USB/Bluetooth HID adapter. Never claim an iPhone is controllable based only on screen stream availability.
- In WDA mode reuse `SimpleInteractionHandler` -> `WdaProxyClient` -> `WDARunner` for clicks, swipes and keys. Fix WDA lifecycle and test against a real device.
- In pointer mode map window-relative mouse movement to HID relative movement, click to button down/up, and drag to press/move/release. Pointer position is device-side state; recalibrate after connection/rotation. Gestures beyond basic mouse semantics require explicit accessibility support.
- Require local user pairing and an explicit enable-control action for every iPhone; disable input on disconnect.
- Test iPhone lock state, orientation, scrolling, multiple iPhones, reconnection, latency and Windows 10/11 device discovery.

## Acceptance criteria

- Multiple Android and iOS streams coexist.
- An iPhone can be watched in view-only mode without implying remote tap support.
- Input-enabled iPhone reports the verified input backend in the UI.
- Click and drag only send commands after pairing/session establishment; disconnected devices fail clearly.
- Android control remains unchanged.

## Limitations

AssistiveTouch **supports mouse input on the phone** but does not expose a generic Windows remote-control API. Bluetooth HID emulation requires supported peripherals/hardware and explicit pairing. WDA setup may still require macOS/Xcode to build/sign/install the agent. No code path should imply otherwise.

## Relevant code

- `src/server/appl-device/services/ControlCenter.ts`
- `src/server/appl-device/services/WDARunner.ts`
- `src/app/applDevice/client/StreamClient.ts`
- `src/app/applDevice/client/WdaProxyClient.ts`
- `src/app/interactionHandler/SimpleInteractionHandler.ts`
