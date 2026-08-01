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

## Offline cache (ROADMAP 3.2)

| Env | Default | Purpose |
|-----|---------|---------|
| `EDGE_CACHE_DB` | `data/edge-cache.sqlite` | Pending gate-open rows |
| `EDGE_HUB_URL` | *(unset)* | Hub base; when set, drain to `{url}/api/edge/sync` |
| `EDGE_NODE_ID` | `edge-1` | Prefix for idempotent event ids |
| `EDGE_PORT` | `8090` | Listen port |

- Gate-open **metadata only** (track id, bbox, motion, seen frames) — no JPEG, no AI.
- Soft-fail when the hub is down; rows stay until ACK.
- `GET /health` → `{ pending }`; `POST /api/sync` forces a flush attempt.

## Honest status

| Item | Status |
|------|--------|
| Binary + wire-compatible API | ✅ |
| CI cross-compile (`aarch64-unknown-linux-gnu`) | ✅ |
| Offline SQLite cache + sync-on-reconnect | ✅ (metadata; not live-Pi smoke) |
| Live smoke on physical Pi hardware | not claimed by CI |
