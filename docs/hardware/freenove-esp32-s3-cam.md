# Freenove ESP32-S3 CAM — WatchingEye test board

**SKU / kit:** Freenove ESP32-S3 WROOM CAM board (**FNK0085**), **16 MB Flash**
variant  
**Role:** primary embedded camera for Step **3.1** / **A.3** bring-up  
**Status:** selected for lab testing — **hardware pending**; firmware **not
encoded yet** (docs + board profile only)

Vendor tutorial / samples:
[docs.freenove.com FNK0085](https://docs.freenove.com/projects/fnk0085/en/latest/)  
Sample zip:
[Freenove_ESP32_S3_WROOM_Board](https://github.com/Freenove/Freenove_ESP32_S3_WROOM_Board)

Companion tree in-repo: [`edge/esp32/`](../../edge/esp32/).

---

## Why this board

| Need (PRD / ROADMAP) | Freenove ESP32-S3 CAM |
|----------------------|------------------------|
| ESP32-**S3** class MCU | Dual-core 32-bit up to **240 MHz** |
| Onboard camera | OV2640 module (kit camera) |
| Wi-Fi to hub | 2.4 GHz station / AP |
| Enough flash for OTA later | **16 MB** Flash (+ **8 MB** PSRAM on WROOM) |
| Easy lab flash | Native USB (CH343 UART path in Freenove docs) — no external FTDI |
| No on-device AI | Fits “capture/stream only” rule |

Other ESP32-S3 cams (XIAO, Heltec, AI-Thinker-style) remain compatible in
principle; **pin maps differ** — always load the matching board profile under
`edge/esp32/boards/`.

---

## Fit in the WatchingEye system

```text
Freenove ESP32-S3 CAM                 Desktop hub (today)
─────────────────────                 ───────────────────
OV2640 → JPEG / gray samples    ──Wi‑Fi──►  vision-engine :8090
heartbeat / later OTA                     │  /api/frame  (gray grid)
     ✗ no VLM / YOLO / LLM                │  or RTSP/MJPEG ingest path
                                          ▼
                                    gateway → orchestrator → dashboard
```

Honest integration stages (encode when the board arrives):

1. **Smoke (vendor sketch)** — Freenove *Camera Web Server* / *Video Web
   Server* on LAN; prove USB flash + Wi‑Fi + OV2640.
2. **Hub ingest (thin)** — hub pulls MJPEG/JPEG or the board POSTs the same
   96×72 gray grid the browser already sends to `/api/frame` (engine cannot
   tell camera types apart).
3. **WatchingEye firmware** — capture → compress → stream → heartbeat;
   optional encrypt/OTA/watchdog per PRD; RAM overhead budget **&lt; 150 KB**.
4. **Transport / A.3** — shared `transport` crate path for commands + deadman
   (separate from frame ingest).

Until stage 3 ships, do **not** mark ROADMAP 3.1 ✅.

---

## Board facts (lab checklist)

| Item | Value |
|------|--------|
| Module | ESP32-S3-WROOM |
| Flash (this kit) | **16 MB** — set flash size accordingly in Arduino / idf |
| PSRAM | **8 MB** OPI PSRAM (enable in board menu) |
| Radio | Wi‑Fi + Bluetooth 5 (LE) |
| Camera | OV2640 on FPC |
| Storage | microSD slot (kit includes card) |
| Debug / flash | USB; install **CH343** driver on Windows if the COM port is missing |
| Vendor codes | C (Arduino) and MicroPython tutorials |

### Camera GPIOs (Freenove S3 WROOM — do not reuse while cam is active)

From Freenove *Notes for GPIO → Cam Pin* (verify against the kit PDF if a
revision differs):

| CAM signal | GPIO |
|------------|------|
| SIOD | 4 |
| SIOC | 5 |
| VSYNC | 6 |
| HREF | 7 |
| Y9 | 16 |
| XCLK | 15 |
| Y8 | 17 |
| Y7 | 18 |
| PCLK | 13 |
| Y6 | 12 |
| Y2 | 11 |
| Y5 | 10 |
| Y3 | 9 |
| Y4 | 8 |

Machine-readable profile: [`edge/esp32/boards/freenove-esp32-s3-wroom.toml`](../../edge/esp32/boards/freenove-esp32-s3-wroom.toml).

---

## Dev machine prep (before / when the board arrives)

Windows (this lab) and macOS/Linux:

1. Install [CH343](https://docs.freenove.com/projects/fnk0085/en/latest/) USB
   serial driver if Device Manager does not show a COM port.
2. Pick **one** toolchain for smoke tests (vendor path is fine first):
   - **Arduino IDE** + esp32 board pack → board **ESP32S3 Dev Module**,
     Flash **16 MB**, PSRAM **OPI PSRAM**, upload via USB; or
   - **ESP-IDF** / **esp-rs** (`espup`) for the eventual WatchingEye
     firmware under `edge/esp32` (separate from the main Cargo workspace).
3. Download Freenove sample zip; flash *Camera Web Server*; join the same
   LAN as the hub; open the board’s stream URL in a browser.
4. Only after smoke works: implement WatchingEye stream protocol (see
   [`edge/esp32/README.md`](../../edge/esp32/README.md)).

Optional env names reserved for later hub config (not wired yet):

| Variable | Intended use |
|----------|----------------|
| `WATCHINGEYE_ESP32_BOARD` | Board id, default `freenove-esp32-s3-wroom` |
| `WATCHINGEYE_ESP32_CAMERA_ID` | Stable `camera_id` in the engine (e.g. `lab-esp32-s3`) |
| `WATCHINGEYE_ESP32_HOST` | Board IP once on Wi‑Fi |

---

## Out of scope on this MCU

- VLM / YOLO / DINOv2 / CLIP / any ONNX runtime  
- Guardrails or rule evaluation  
- Storing identity gallery  

All of that stays on the hub (`vision-engine` + `agent-orchestrator`).
