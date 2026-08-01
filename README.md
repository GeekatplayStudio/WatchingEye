# WatchingEye — Sentinel AI / Edge Vision Agentic System

A deterministic, explainable, modular edge-vision AI platform. Detects people,
animals, vehicles, and arbitrary objects from inexpensive cameras (ESP32 →
Raspberry Pi → server GPU) while enforcing strict validation, guardrails, and
zero-black-box observability.

**Core principle: Never trust an LLM.** Every AI output passes schema
validation, a rule engine, business validation, confidence checks, and human
policy before any action executes.

## Repository Layout

```
crates/                  Rust workspace — the deterministic core
  schemas/               Shared types: ObjectClass, Detection, AgentDecision, Provenance
  events/                Event engine (Detected, ZoneEntered, ...)
  guardrails/            LLM output validation (schema → range → confidence → policy → safety)
  rules/                 Deterministic rule engine (IF person AND zone AND time THEN notify)
  camera/                Camera sources behind one trait, plus Reolink + ONVIF + LAN discovery
  motion/                Background-model motion detection + blob extraction (the fast path)
  tracker/               IoU association, TriggerGate, object timelines
  identity/              Deterministic re-identification — weighted attributes, never a model
  actuator/               Pan/tilt servo control: limits, rate limiting, deadband, failsafe
  spatial/               Motion heading/speed + monocular distance estimation
  detector/              Detector trait (target interface; see ADR 0004 for current status)
services/
  vision-engine/         Rust binary (axum): desktop pipeline, servo aim, identity registry
  edge-node/             Rust binary (tiny_http, 309 KB): same chain for Pi-class devices
  agent-orchestrator/    LangGraph Super Agent (TS): VLM classification, YOLO detection, zod guardrails
apps/
  gateway/               Fastify gateway: WebSocket event stream, settings API, Postgres store
  dashboard/             Next.js 15 + Tailwind + shadcn-style UI: live console, tuning, docs
packages/
  mcp-server/            Read-only MCP server (cameras, events, settings)
edge/
  esp32/                 ESP32 capture/stream tier (no AI) — Freenove S3 CAM lab board; firmware encode pending
docs/
  PRD.md                 Merged product requirements document
  adr/                   Architecture Decision Records
  architecture/          Diagrams and overviews
  hardware/              Lab device inventory (Freenove ESP32-S3 CAM, …)
```

## Getting Started — one click

**Windows:** double-click `Start-WatchingEye.bat`
**macOS / Linux:** `./start.sh`

That single step installs anything missing (Rust, Node, Ollama, AI models),
builds the Rust core, starts all four services, and opens the dashboard. It
is safe to re-run — finished work is detected and skipped.

Then open **[Console](http://localhost:3000/cameras)**, click *Scan*, and
connect your webcam to watch the pipeline track live. To use IP cameras or an
NVR instead, see [Network cameras](#network-cameras-reolink--onvif) below.

**To stop everything:** double-click `Stop-WatchingEye.bat` (Windows) or run
`./scripts/stop.sh`. It stops only processes listening on this project's
ports, leaving unrelated work alone.

If the engine's port is busy it moves to the next free one (8090–8099) rather
than refusing to start, and records where it landed in `.runtime/engine.port`.
Restart the dashboard afterwards so its proxy picks up the new port.

<details>
<summary>Running the pieces by hand</summary>

```bash
cargo run -p vision-engine                      # detection core, :8090
cd services/agent-orchestrator && npm run dev   # recognition,    :8085
cd apps/gateway && npm run dev                  # API gateway,    :8080
cd apps/dashboard && npm run dev                # dashboard,      :3000
docker compose up -d                            # optional Postgres history
```

Setup only, without starting: `.\scripts\install.ps1` or `./scripts/install.sh`
(add `-SkipModels` / `SKIP_MODELS=1` to skip the ~6 GB of AI models).
</details>

The installer also downloads all AI models (skip with `-SkipModels` /
`SKIP_MODELS=1`, or run [scripts/install-models](scripts/install-models.sh)
separately later):

| Model | Purpose | Where |
|-------|---------|-------|
| `qwen2.5vl:7b` | Vision-language scene analysis | Ollama |
| `llama3.2:3b` | Structured reasoning LLM | Ollama |
| `yolo11n.onnx` | Real-time object detection | `models/vision/` |
| `ggml-base.en.bin` | Whisper voice recognition | `models/voice/` |

The orchestrator resolves its vision model once at startup and reports the
result at `/health`. Pin one with `VLM_MODEL` and it is always honoured, even
if absent — silently substituting a different model would change what the
system decides without anyone asking. With nothing pinned it detects an
installed vision model. If none is installed, classification refuses every
event and says exactly which `ollama pull` fixes it, rather than failing
per-frame with a transport error. Startup also checks the ollama daemon is
actually running, which is the usual cause of "everything is refused".

## Network cameras (Reolink / ONVIF)

Open **[Discover](http://localhost:3000/discover)** in the dashboard: it
detects your subnets, sweeps for cameras, and connects to an ONVIF device
with credentials you type there. Passwords go from the engine straight to the
device — never stored, never in a URL, never logged.

Discovery **never registers a camera on its own** — adding a source to the
decision path stays an explicit action, so a scan cannot quietly adopt an
unvetted device.

The same thing from a terminal:

```bash
# 1. Find candidates. Every hit is then asked directly whether it speaks
#    ONVIF, so an open port becomes a confirmed camera or nothing.
curl -X POST localhost:8090/api/cameras/scan \
     -H 'Content-Type: application/json' -d '{"cidr":"192.168.1.0/24"}'

# 2. Confirm one host. Needs no credentials — GetSystemDateAndTime is
#    unauthenticated by specification, and also reports the device clock.
curl -X POST localhost:8090/api/cameras/onvif/confirm \
     -H 'Content-Type: application/json' -d '{"host":"192.168.1.50"}'

# 3. Enumerate cameras and RTSP URLs (credentials required).
curl -X POST localhost:8090/api/cameras/onvif/inventory \
     -H 'Content-Type: application/json' \
     -d '{"service_url":"http://192.168.1.50:8000/onvif/device_service",
          "user":"USER","password":"PASS"}'

# Reolink firmware with the JSON CGI API also has a native path:
curl -X POST localhost:8090/api/cameras/reolink/probe \
     -H 'Content-Type: application/json' \
     -d '{"host":"192.168.1.50","user":"USER","password":"PASS"}'
```

**Which protocol do I need?** Reolink hardware is split. Newer firmware
answers the JSON API at `/cgi-bin/api.cgi`; older Baichuan-era devices
(recognisable by `BC_IP_PORT = 9000` in their web root) do not, and only
speak ONVIF — often on **port 8000**, not 80. Try `onvif/confirm` first: it
costs nothing and needs no password.

Notes that save an afternoon:

- **PoE cameras behind an NVR will not appear in a LAN scan.** The recorder
  puts them on its own private subnet; you reach them through the NVR by
  channel, which is what the channel and profile enumeration is for.
- **An NVR may need ONVIF switched on** — typically *Settings → Network →
  Advanced → ONVIF*, sometimes with its own separate user account.
- **A drifted device clock rejects correct credentials.** ONVIF signs a
  timestamp, so the device's own reported time is used to sign requests.
- Sweeps are bounded: a range wider than 4096 addresses is refused rather
  than quietly started, and `/24`–`/22` home networks take a few seconds.

Credentials are passed per request and never written to disk or logged.

## Building a release

`Start-WatchingEye.bat` / `./start.sh` run everything from source with
watchers. For a compiled build:

```
Build-WatchingEye.bat              # Windows: cargo --release + tsc + next build
./scripts/build.sh                 # macOS / Linux
Start-WatchingEye-Release.bat      # run the built artifacts (no watchers)
./scripts/start-release.sh         # same, add BUILD=1 to build first
```

The build reports every failing component rather than stopping at the first,
and the release launcher verifies artifacts exist instead of half-starting.
`-SkipRust` / `-SkipNode` (or `SKIP_RUST=1` / `SKIP_NODE=1`) build one half.

The dashboard builds into `.next-prod`, not `.next`. Both `next build` and
`next dev` default to `.next`, so building while a dev server is running
replaces the chunks it has already loaded and breaks it with `Cannot find
module './NNN.js'`. Keeping them apart means a release build and a dev
server can run at the same time. If you build by hand, do the same:

```bash
cd apps/dashboard && NEXT_DIST_DIR=.next-prod npx next build
```

## Two applications, one workspace

| App | Target | Contents | Binary |
|---|---|---|---|
| **Desktop hub** | PC / Mac / server | Full pipeline, YOLO, VLM, identity, dashboard | 1.04 MB engine + Node services |
| **Edge node** | Raspberry Pi-class | Same deterministic chain, servo output, wire-compatible API | **309 KB**, no async runtime |

```bash
cargo build -p edge-node --profile edge          # size-first build
# Raspberry Pi cross-compile (CI job `edge-node-pi` runs this on every push):
rustup target add aarch64-unknown-linux-gnu
# Debian/Ubuntu: sudo apt install gcc-aarch64-linux-gnu
cargo build -p edge-node --profile edge --target aarch64-unknown-linux-gnu
```

Hot path: 13 µs/frame at 96×72 on desktop (~500 µs projected on a Pi Zero 2,
leaving 30 fps with room to spare). ESP32 remains capture/stream only until
the `no_std` port lands — see the roadmap, honestly marked.

## What works today

| Capability | Status |
|---|---|
| Webcam scan, connect, live capture | ✅ browser-native permission prompt |
| Network camera discovery (port sweep + ONVIF confirm) | ✅ Rust, verified against real NVR hardware |
| Discover page: scan, connect, copy RTSP URLs | ✅ subnet auto-detected from the interface netmask |
| ONVIF device info, profiles, RTSP URLs | ✅ handshake verified against real hardware; success path needs your credentials |
| Reolink JSON API (login, NVR channels, snapshot, RTSP) | ✅ for firmware exposing `/cgi-bin/api.cgi` |
| Point Cross Assign — click a subject, the aim follows it | ✅ Rust, locks to the track, not the coordinate |
| Motion detection (background model, ghost-trail free) | ✅ Rust |
| Region extraction + object tracking with stable IDs | ✅ Rust |
| Trigger gate (opens once per object, not per frame) | ✅ Rust |
| Per-frame reasoning trace shown in the UI | ✅ |
| Guardrails: schema, range, evidence, policy, injection screening | ✅ Rust + TS, both enforced |
| Object **recognition** via local VLM on gated events | ✅ Ollama qwen2.5vl, 5–11 s per object |
| **Stationary-object labelling** (YOLO11 via ONNX, ~0.5 s/pass) | ✅ with distance estimate + class filter |
| Motion direction (8-point heading + speed) per track | ✅ Rust, verified in all directions |
| Depth map | ⚠️ needs a depth model; distance is size-based estimate for now |
| Voice STT/TTS bindings | ⚠️ contracts + tests done, audio not attached |

There is **no demo or synthetic event source**. An empty feed means nothing
happened. Recognition refuses more often than it answers by design: a model
reporting 80% certainty is below the floor and is discarded, not shown.

The dashboard never claims more than this — see the in-app
[docs](http://localhost:3000/docs) for the same list with reasoning.

## Roadmap

Development follows hard-gated steps with explicit exit criteria — see
[ROADMAP.md](ROADMAP.md). Phases 0–2 (foundation, single-camera detection,
Super Agent + guardrails) are done; current work is Phase A (animatronics
control: aim/servo core and two-app optimization are done, device transport
and the logic designer are next).

## Engineering Standards

- Max 500 lines per file (preferred ≤ 250); functions ≤ ~75 lines
- No `unwrap()`/`expect()` in production code paths (test modules are
  explicitly exempted — see CLAUDE.md)
- 246 Rust tests + 86 orchestrator + 18 gateway, all passing; every public
  item documented with rustdoc/JSDoc
- `clippy::pedantic` with `-D warnings`, `rustfmt`; ESLint + Prettier + TS strict
- All AI decisions logged with evidence, confidence, model + prompt versions
- Release builds use fat LTO + single codegen unit + stripped symbols; see
  `docs/architecture/overview.md` for the two-app (desktop/edge) split
