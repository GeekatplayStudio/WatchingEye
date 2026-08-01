# Test hardware

Physical devices used to exercise WatchingEye outside the desktop webcam /
synthetic pumps. Firmware and drivers live under `edge/` when they exist;
this folder is the **operator-facing** inventory and bring-up notes.

| Device | Role | Status |
|--------|------|--------|
| [Freenove ESP32-S3 CAM (16 MB)](freenove-esp32-s3-cam.md) | Embedded capture / stream test board (no on-device AI) | **Selected** — board arriving; firmware encode deferred |
| Raspberry Pi (any class that runs `edge-node`) | Edge pipeline binary | Binary exists; Pi CI gate still open |
| USB webcam / RTSP NVR | Desktop hub cameras | Live today (`vision-engine`) |

PRD rule for the ESP32 tier: **capture → compress → (optional encrypt) →
stream → heartbeat → OTA → watchdog**. No models on the microcontroller.
