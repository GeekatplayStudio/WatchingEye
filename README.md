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
crates/            Rust workspace — the deterministic core
  schemas/         Serde types + JSON Schema validation (single source of truth)
  events/          Event engine (Detected, ZoneEntered, ...)
  guardrails/      LLM output validation pipeline (schema → rules → policy)
  rules/           Deterministic rule engine (IF person AND zone AND time THEN notify)
  camera/          Camera source abstraction (ESP32, RTSP, USB, file, ...)
  detector/        Object-detector abstraction (YOLO, Florence, ... behind one trait)
  tracker/         Object tracking, UUIDs, timelines, object memory
services/
  vision-engine/   Rust binary: capture → detect → validate → track → agent → actions
  agent-orchestrator/  LangGraph Super Agent DAG (TS) with zod guardrails
apps/
  gateway/         Fastify gateway: WebSocket event stream, settings API, Postgres store
  dashboard/       Next.js 15 + Tailwind + shadcn-style UI: live monitor, tuning, pipeline
packages/
  mcp-server/      Read-only MCP server (cameras, events, settings)
edge/
  esp32/           no_std-oriented firmware skeleton (capture, compress, stream only)
docs/
  PRD.md           Merged product requirements document
  adr/             Architecture Decision Records
  architecture/    Diagrams and overviews
```

## Getting Started — one click

**Windows:** double-click `Start-WatchingEye.bat`
**macOS / Linux:** `./start.sh`

That single step installs anything missing (Rust, Node, Ollama, AI models),
builds the Rust core, starts all three services, and opens the dashboard. It
is safe to re-run — finished work is detected and skipped.

Then open **[Cameras](http://localhost:3000/cameras)**, click *Scan for
cameras*, and connect your webcam to watch the pipeline track live.

<details>
<summary>Running the pieces by hand</summary>

```bash
cargo run -p vision-engine        # detection core   :8090
cd apps/gateway && npm run dev    # API gateway      :8080
cd apps/dashboard && npm run dev  # dashboard        :3000
docker compose up -d              # optional Postgres history
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
| Per-frame YOLO detection | ⚠️ model downloaded, inference backend not wired |
| Voice STT/TTS bindings | ⚠️ contracts + tests done, audio not attached |

There is **no demo or synthetic event source**. An empty feed means nothing
happened. Recognition refuses more often than it answers by design: a model
reporting 80% certainty is below the floor and is discarded, not shown.

The dashboard never claims more than this — see the in-app
[docs](http://localhost:3000/docs) for the same list with reasoning.

## Roadmap

Development follows hard-gated steps with explicit exit criteria — see
[ROADMAP.md](ROADMAP.md). Current position: Phase 0, Step 0.2.

## Engineering Standards

- Max 500 lines per file (preferred ≤ 250)
- No `unwrap()` in production code paths
- 100% test coverage target; every public item documented
- `clippy::pedantic`, `rustfmt`, `cargo deny`; ESLint + Prettier + TS strict
- All AI decisions logged with evidence, confidence, model + prompt versions
