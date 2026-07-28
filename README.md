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
  camera/                Camera source abstraction (RTSP, USB, file, ...) behind one trait
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
  esp32/                 Firmware skeleton — capture/stream only; see roadmap for no_std status
docs/
  PRD.md                 Merged product requirements document
  adr/                   Architecture Decision Records
  architecture/          Diagrams and overviews
```

## Getting Started — one click

**Windows:** double-click `Start-WatchingEye.bat`
**macOS / Linux:** `./start.sh`

That single step installs anything missing (Rust, Node, Ollama, AI models),
builds the Rust core, starts all four services, and opens the dashboard. It
is safe to re-run — finished work is detected and skipped.

Then open **[Console](http://localhost:3000/cameras)**, click *Scan*, and
connect your webcam to watch the pipeline track live.

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

## Two applications, one workspace

| App | Target | Contents | Binary |
|---|---|---|---|
| **Desktop hub** | PC / Mac / server | Full pipeline, YOLO, VLM, identity, dashboard | 1.04 MB engine + Node services |
| **Edge node** | Raspberry Pi-class | Same deterministic chain, servo output, wire-compatible API | **309 KB**, no async runtime |

```bash
cargo build -p edge-node --profile edge          # size-first build
# Raspberry Pi cross-compile:
rustup target add aarch64-unknown-linux-gnu
cargo build -p edge-node --profile edge --target aarch64-unknown-linux-gnu
```

Hot path: 13 µs/frame at 96×72 on desktop (~500 µs projected on a Pi Zero 2,
leaving 30 fps with room to spare). ESP32 remains capture/stream only until
the `no_std` port lands — see the roadmap, honestly marked.

## What works today

| Capability | Status |
|---|---|
| Webcam scan, connect, live capture | ✅ browser-native permission prompt |
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
- 168 Rust tests + 65 orchestrator + 17 gateway, all passing; every public
  item documented with rustdoc/JSDoc
- `clippy::pedantic` with `-D warnings`, `rustfmt`; ESLint + Prettier + TS strict
- All AI decisions logged with evidence, confidence, model + prompt versions
- Release builds use fat LTO + single codegen unit + stripped symbols; see
  `docs/architecture/overview.md` for the two-app (desktop/edge) split
