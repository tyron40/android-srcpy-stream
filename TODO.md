# Multi-device action mirroring TODO

- [x] Disable/bypass AI chat agent UI and runtime wiring (keep code, inactive)
- [x] Add backend POST /mirror-action endpoint
- [x] Add backend screen-size cache from `adb shell wm size`
- [x] Add coordinate scaling master->target per action
- [x] Add backend replay execution for tap/swipe/long-press/key/text/nav
- [x] Add per-target replay status response payload
- [x] Add frontend master selector UI
- [x] Add frontend target checkboxes UI
- [x] Add mirror-mode toggle UI
- [ ] Add action/replay logs UI (master, targets, action, status)
- [ ] Capture master-only pointer/touch/drag events with debounce + dedupe
- [ ] Capture keyboard/text/nav actions where available
- [ ] Send captured actions to POST /mirror-action
- [ ] Ensure no replay to master and no breakage of manual single-device control
- [ ] Build and run critical-path tests
- [x] Run backend curl tests for mirror-action (tap/swipe/error cases)
