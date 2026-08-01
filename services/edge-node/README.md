# edge-node

Slim, wire-compatible pipeline binary for Raspberry Pi-class devices.
Same gray-frame JSON contract as `vision-engine`; no VLM / YOLO / gateway logic.

## Build

```bash
# Host (size profile)
cargo build -p edge-node --profile edge

# Raspberry Pi 64-bit (aarch64) — gated in CI as job `edge-node-pi`
rustup target add aarch64-unknown-linux-gnu
# Debian/Ubuntu linker:
sudo apt install gcc-aarch64-linux-gnu
cargo build -p edge-node --profile edge --target aarch64-unknown-linux-gnu
# → target/aarch64-unknown-linux-gnu/edge/edge-node
```

Linker config: [`.cargo/config.toml`](../../.cargo/config.toml).

## Honest status

| Item | Status |
|------|--------|
| Binary + wire-compatible API | ✅ |
| CI cross-compile (`aarch64-unknown-linux-gnu`) | ✅ |
| Offline SQLite cache + sync-on-reconnect | open (ROADMAP 3.2) |
| Live smoke on physical Pi hardware | not claimed by CI |
