# PRD — WatchingEye (Sentinel AI / Edge Vision Agentic System)

Merged from the two source PRDs ("EVAS" and "Sentinel AI"). Where they
conflicted, the stricter or more concrete requirement wins.

## Vision

A production-quality reference architecture for trustworthy AI: a
deterministic, explainable, modular edge-vision platform that detects people,
animals, vehicles, and arbitrary objects from inexpensive cameras, with strict
safety, validation, reproducibility, and observability. Educational reference
implementation + production starter kit.

## Non-Negotiable Principles

1. **Never trust an LLM.** All model output is data, validated before use.
2. **Zero black box.** Every decision records why, how, evidence, source,
   confidence, timestamp, model version, prompt version, inputs, outputs.
3. **Deterministic execution.** Orchestration graphs have no cycles, no
   autonomous loops, no arbitrary routing. Structured JSON only — no free-form
   text between components.
4. **The Super Agent never runs continuously.** It runs only after a fully
   validated event (confidence + temporal + motion + tracking gates passed).

## Technology Stack

- **Core:** Rust (Tokio, Axum, Serde, Tracing, SQLx, ONNX Runtime / Candle,
  OpenCV bindings, Rayon, DashMap).
- **Agent layer:** Rig (Rust) for structured agent execution; LangGraph-style
  deterministic orchestration (transitions predeclared, validated). MCP for
  every subsystem boundary (Camera MCP, Vision MCP, Alert MCP, Timeline MCP…).
- **LLM/VLM:** Ollama-first (local, private), with an abstraction layer for
  OpenAI-compatible APIs, Anthropic, Gemini, vLLM, LM Studio.
- **Vision models:** YOLO (nano→11), GroundingDINO, SAM2, Florence, Qwen-VL,
  InternVL — all behind one `Detector` trait.
- **Gateway:** Node.js + TypeScript + Fastify. API gateway only; no AI logic.
- **Frontend:** React + TypeScript, TanStack Query, React Flow, Tailwind.
- **Storage:** SQLite (edge), Postgres (server), object storage for snapshots.
  Vector DB optional, never required.
- **Transport:** MQTT, WebSockets, gRPC, HTTP, MCP.

## Hardware Tiers

| Tier | Hardware | Responsibilities |
|------|----------|------------------|
| Embedded | ESP32-S3 cam (no_std) | Capture, compress, encrypt, stream, heartbeat, OTA, watchdog. **No AI.** |
| Edge | Raspberry Pi + camera | Motion detection, quantized object detection, tracking, local cache, offline operation |
| Server | Desktop/GPU/K8s | Multi-camera, GPU inference, agent orchestration, history, analytics, training |

## Detection Pipeline

Camera → Frame Buffer → Frame Validator → Motion Detection → Object Detector →
Confidence Validator → Temporal Validator → Tracking → Object Database →
Super Agent → Actions

Super Agent gate (example): person detected AND confidence > 95% AND seen in 3
consecutive frames AND motion confirmed AND tracking stable → then, and only
then, the agent runs.

## Guardrail Pipeline

LLM → JSON Schema Validation → Rule Engine → Business Validation →
Confidence Validation → Human Policy → Execution

Any failure halts execution and falls back to a safe default. Failures are
logged as first-class events.

## Object Model

Person, Dog, Cat, Horse, Bird, Car, Truck, Bus, Motorcycle, Bike, Package,
Door, Window, Weapon, Smoke, Fire, UnknownObject, Custom. Each tracked object
gets a UUID, timeline, state, movement history, confidence history, snapshots,
and relationships (object memory).

## Performance Goals

- ESP32: < 150 KB RAM overhead
- Raspberry Pi: 30 FPS
- Server: 100+ cameras
- Detection latency < 100 ms; event latency < 300 ms

## Development Standards

- Max file size 500 lines (preferred 250); functions ≤ ~75 lines
- 100% test coverage: unit, integration, e2e, property, snapshot, mutation, load
- Rust: clippy (pedantic), rustfmt, cargo deny, cargo audit; no `unwrap()` in
  production paths; rich typed errors; dependency injection; no hidden globals
- Node: ESLint, Prettier, TypeScript strict
- CI on every commit: format, lint, tests, coverage, benchmarks, security +
  dependency scans, docs generation, performance regression tests
- Every public function documents purpose, inputs, outputs, errors,
  complexity, thread-safety, usage example; ADRs for all major choices

## Roadmap

1. Single-camera edge detection (ESP32 / Pi / USB)
2. Multi-camera tracking, object memory, deterministic rule engine
3. Distributed Rust microservices, MCP plugin ecosystem, GPU workers
4. Kubernetes federation, Temporal workflows, optional cloud sync
5. Analytics, custom training, validated natural-language querying,
   enterprise policy management

## Success Criteria

Deterministic AI workflows with no opaque decision paths; heterogeneous camera
support; modular Rust architecture (files < 500 lines); full observability in
the dashboard; MCP extensibility; comprehensive guardrails; 100% automated
test coverage; production-quality documentation.
