# ESP32 firmware (skeleton — encode deferred)

Embedded-tier camera for WatchingEye. Per the PRD this tier does **no AI**:

```text
capture → compress → (optional encrypt) → stream → heartbeat → OTA → watchdog
```

Budget: **&lt; 150 KB** RAM overhead.

## Primary lab board

| | |
|--|--|
| **Board** | [Freenove ESP32-S3 CAM](../../docs/hardware/freenove-esp32-s3-cam.md) (FNK0085, **16 MB Flash**) |
| **Profile** | [`boards/freenove-esp32-s3-wroom.toml`](boards/freenove-esp32-s3-wroom.toml) |
| **Status** | Selected for testing; **board arriving**; **no firmware sources yet** |

Other ESP32-S3 cams may work later with their own profiles under `boards/`.

## Current repo state (honest)

| Artifact | Present? |
|----------|----------|
| Hardware docs + board TOML | yes |
| Bring-up checklist | yes (below) |
| WatchingEye firmware (`main.rs`, camera, stream, …) | **no — encode after hardware** |
| Cargo / esp-idf project in this tree | **no** (do not pretend) |

ROADMAP Step **3.1** stays open until frames + heartbeat meet exit criteria on
this board.

## Bring-up when the board arrives

1. Install USB serial (**CH343** on Windows if needed) — Freenove FNK0085 docs.
2. Flash vendor **Camera Web Server** (C tutorial ch. 7) → prove OV2640 + Wi‑Fi.
3. Note the board IP; confirm stream in a browser on the hub LAN.
4. Then encode WatchingEye firmware (next section) — prefer **esp-idf** /
   **esp-rs** for the production path; Arduino is fine for vendor smoke only.
5. Point hub ingest at the board (`camera_id` default `lab-esp32-s3`).

Reserved env (hub side, not wired until ingest lands):

- `WATCHINGEYE_ESP32_BOARD=freenove-esp32-s3-wroom`
- `WATCHINGEYE_ESP32_CAMERA_ID=lab-esp32-s3`
- `WATCHINGEYE_ESP32_HOST=<board-ip>`

## Planned firmware modules (each ≤ 250 lines)

| Module | Responsibility |
|--------|----------------|
| `main.rs` | Hardware init from board profile, task spawn, watchdog |
| `camera.rs` | OV2640 capture using Freenove pin map |
| `stream.rs` | JPEG and/or 96×72 gray8 → hub (`/api/frame` or negotiated URL) |
| `heartbeat.rs` | Liveness beacon + later OTA check |
| `config.rs` | Wi‑Fi creds + hub URL (NVS); no secrets in git |

Payload / event shapes stay aligned with `crates/schemas` — the hub must not
grow an ESP32-only JSON dialect without a schema change.

## Toolchain (for encode later)

This tree builds **separately** from the main Cargo workspace (different
target):

```bash
cargo install espup
espup install
# after firmware crate exists:
cd edge/esp32
cargo build --release
```

Bootstrap references: [esp-idf-template](https://github.com/esp-rs/esp-idf-template),
Freenove samples for pin-correct camera init.

## Integration with the hub

Today the desktop pipeline already accepts:

- Browser / USB gray grids → `POST /api/frame`
- RTSP → ffmpeg → same gray grid path

The ESP32 should land on one of those contracts so motion, tracking, gating,
and Point Cross Assign work unchanged. Prefer posting the **same 96×72
gray8** grid the dashboard uses so thresholds stay calibrated.

See also: [`docs/hardware/README.md`](../../docs/hardware/README.md).
