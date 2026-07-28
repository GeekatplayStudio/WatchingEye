# ESP32 Firmware (skeleton)

Embedded-tier firmware for ESP32-S3 camera boards (e.g. Heltec / XIAO ESP32S3
Sense). Per the PRD, this tier does **no AI** — only:

capture → compress → encrypt → stream → heartbeat → OTA → watchdog

Budget: < 150 KB RAM overhead.

## Toolchain

This crate builds separately from the main workspace (different target):

```bash
cargo install espup
espup install
cd edge/esp32
cargo build --release
```

Uses `esp-hal` / `esp-idf` bindings; start from
https://github.com/esp-rs/esp-idf-template when bootstrapping the real
firmware. The MCP-compliant trigger payload format lives in
`crates/schemas` — keep this firmware's JSON output in sync with it.

## Planned modules (each < 250 lines)

| Module | Responsibility |
|--------|----------------|
| `main.rs` | Hardware init, task spawn, watchdog |
| `camera.rs` | OV2640/OV5640 frame capture |
| `stream.rs` | JPEG compression + WiFi transport to the hub |
| `heartbeat.rs` | Liveness beacon + OTA check |
