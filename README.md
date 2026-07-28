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

## Getting Started

One-command setup (installs Rust if missing, installs Node deps, builds, tests):

```bash
# Windows
.\scripts\install.ps1

# Linux / macOS / Raspberry Pi
./scripts/install.sh
```

Then start everything (engine + gateway :8080 + dashboard :5173):

```bash
# Windows
.\scripts\run.ps1            # or: run.ps1 engine|gateway|dashboard|test

# Linux / macOS
./scripts/run.sh             # or: run.sh engine|gateway|dashboard|test
```

The installer also downloads all AI models (skip with `-SkipModels` /
`SKIP_MODELS=1`, or run [scripts/install-models](scripts/install-models.sh)
separately later):

| Model | Purpose | Where |
|-------|---------|-------|
| `qwen2.5vl:7b` | Vision-language scene analysis | Ollama |
| `llama3.2:3b` | Structured reasoning LLM | Ollama |
| `yolo11n.onnx` | Real-time object detection | `models/vision/` |
| `ggml-base.en.bin` | Whisper voice recognition | `models/voice/` |

## Roadmap

Development follows hard-gated steps with explicit exit criteria — see
[ROADMAP.md](ROADMAP.md). Current position: Phase 0, Step 0.2.

## Engineering Standards

- Max 500 lines per file (preferred ≤ 250)
- No `unwrap()` in production code paths
- 100% test coverage target; every public item documented
- `clippy::pedantic`, `rustfmt`, `cargo deny`; ESLint + Prettier + TS strict
- All AI decisions logged with evidence, confidence, model + prompt versions
