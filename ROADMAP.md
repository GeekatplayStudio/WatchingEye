# WatchingEye Development Roadmap

Hard-defined steps with explicit exit criteria. A step is **done only when
every exit criterion passes in CI**. No step starts before the previous one
is done (exceptions require an ADR).

---

## Phase 0 — Foundation (current)

### Step 0.1 — Repo skeleton ✅
- [x] Cargo workspace with `schemas`, `events`, `rules`, `guardrails`,
      `camera`, `detector`, `tracker`, `vision-engine`
- [x] Gateway (Fastify/TS) and dashboard (React/Vite) scaffolds
- [x] CI: fmt, clippy `-D warnings`, tests, cargo-deny, docs
- [x] PRD, ADRs 0001–0002, architecture overview

### Step 0.2 — Toolchain & scripts
- Exit criteria:
  - [ ] `scripts/install.ps1` / `scripts/install.sh` bring a clean machine to
        a working build (Rust via rustup, Node deps)
  - [ ] `scripts/install-models` provisions all AI models: Ollama +
        qwen2.5vl:7b (VLM), llama3.2:3b (LLM), yolo11n.onnx (detection),
        Whisper ggml-base.en (voice)
  - [ ] `scripts/run.ps1` / `scripts/run.sh` start engine, gateway, dashboard
  - [ ] `cargo test --workspace` green locally and in CI
  - [ ] `git init` + first commit + CI green on main

---

## Phase 1 — Single-Camera Edge Detection

### Step 1.1 — File & USB camera backends
- Implement `CameraSource` for video files (baseline for reproducible tests)
  and USB webcams (via `nokhwa` or OpenCV bindings).
- Exit criteria:
  - [ ] `vision-engine --camera file --input sample.mp4` streams frames
  - [ ] Golden-file integration test: fixed video in, fixed frame count out
  - [ ] Frame validator rejects corrupt/truncated frames with typed errors

### Step 1.2 — Motion detection ✅ (core algorithm)
- Frame-differencing motion gate in Rust (no ML), configurable sensitivity.
- Exit criteria:
  - [x] `crates/motion`: brightness-compensated frame differencing, 7 tests
  - [x] Static scene reports no motion; localized change does
  - [x] Invariant to constant brightness offsets (cloud/auto-exposure test)
  - [ ] Wired into `vision-engine` against a real camera stream
  - [ ] 1000-frame soak test proving zero detector invocations when static

### Step 1.3 — ONNX YOLO detector backend ✅ (in the orchestrator — see ADR 0004)
- Exit criteria:
  - [x] YOLO11n runs via `onnxruntime-node` in the agent orchestrator:
        letterbox preprocess, `[1,84,8400]` decode, per-class NMS — all pure
        functions with unit tests
  - [x] Verified on a real photo: person at 89%, 490 ms CPU latency,
        distance estimate attached (~2.0 m)
  - [x] Missing model = clean 503 with the fix named, never invented boxes
  - [x] Stationary objects are named: detection runs on the full snapshot
        every ~1.2 s, independent of motion
  - [ ] Rust `Detector` trait implementation (blocked on MSVC; ADR 0004)
  - [ ] Latency < 100 ms (currently ~490 ms CPU; needs quantization or GPU)

### Step 1.4 — Temporal validation + tracker hardening (in progress)
- Replace naive class-matching with IoU association; add `Lost` events.
- Exit criteria:
  - [x] `tracker::association`: IoU + greedy matching, 8 tests, deterministic
        tie-breaking; two adjacent people keep distinct tracks
  - [ ] `Tracker::observe` switched from class-matching to IoU association
  - [ ] Two people in frame keep distinct UUIDs across 100 frames
  - [ ] `TriggerGate` fires exactly once per continuous presence
  - [ ] Snapshot tests of full event streams for 3 fixture videos

### Step 1.5 — SQLite object database
- Persist objects, events, snapshots via SQLx; schema migrations.
- Exit criteria:
  - [ ] Engine restart resumes with prior object history intact
  - [ ] Timeline query: all events for object UUID in < 10 ms
  - [ ] Migration test: v0 → current on a seeded database

**Phase 1 demo:** point a USB webcam at a driveway; person walks in; event
row + snapshot in SQLite; dashboard timeline shows it. No LLM yet.

---

## Phase 2 — Super Agent with Guardrails

### Step 2.1 — Ollama client (LLM abstraction layer) ✅
- Exit criteria:
  - [x] `LlmProvider` interface + `OllamaProvider` + `StubProvider`
        (`services/agent-orchestrator/src/llm.ts`), 6 tests, zero network
  - [x] Provenance (model version, prompt version) on every response
  - [x] Deterministic sampling (temperature 0, fixed seed) and timeouts
  - [ ] Rust-side provider for the engine (currently TS service only)

### Step 2.1b — AI-safety screening ✅
- Exit criteria:
  - [x] `guardrails::safety`: prompt-injection markers, duplicate-evidence
        detection, unsupported-risk check, and a rule that the model may not
        reclassify what the deterministic pipeline detected — 9 tests
  - [x] `validate_and_screen` is the single production entry point

### Step 2.1c — RAG grounding ✅ (retrieval half)
- Exit criteria:
  - [x] `KeywordRetriever` fallback that needs no vector DB (PRD: optional)
  - [x] `verifyGrounded` rejects answers citing unretrieved records — the
        anti-hallucination gate for question answering, 9 tests
  - [ ] pgvector-backed retriever for semantic search

### Step 2.2 — VLM scene analysis
- On `TriggerGate` open: send snapshot to VLM (qwen2.5-vl via Ollama),
  demand JSON matching `AgentDecision` schema.
- Exit criteria:
  - [ ] Malformed VLM output → `GuardrailError`, safe default, logged event
  - [ ] Fixture image of person → valid decision with evidence list
  - [ ] End-to-end latency < 300 ms from gate-open to validated decision
        (local GPU) — benchmark-gated

### Step 2.3 — Rule engine expansion + actions
- Zones (polygon config), time windows, class combinators; `Notify` action
  executes (webhook + dashboard push via WebSocket).
- Exit criteria:
  - [ ] Rules loaded from schema-validated TOML/JSON config
  - [ ] "person AND garage AND after midnight → notify" works end-to-end
  - [ ] Rule evaluation is pure: property test for determinism

### Step 2.0 — Dashboard & gateway foundation ✅ (pulled forward from 2.4)
- [x] Next.js 15 + Tailwind 4 + shadcn-style dashboard: live monitor with
      real-time WebSocket feed, evidence chips, camera grid, pipeline view
- [x] Tuning page: gate/policy thresholds editable live (validated, broadcast)
- [x] Gateway: WebSocket streaming, settings API, Postgres event store
      (pgvector image via docker-compose) with in-memory fallback
- [x] LangGraph Super Agent DAG (orchestration only): validate → analyze →
      zod guardrail → action, safe-default fallback, 4 passing tests
- [x] MCP server (read-only): list_cameras, recent_events, get_settings

### Step 2.4 — Zero-black-box dashboard
- Decision inspector: evidence, confidence, frames, model+prompt versions,
  input snapshot, raw vs validated JSON diff. Live event feed via WebSocket.
- Exit criteria:
  - [ ] Every decision in the DB is fully reconstructable in the UI
  - [ ] Replay: select a past event, see exact pipeline path taken
  - [ ] Gateway remains AI-free (enforced by review checklist)

**Phase 2 demo:** dog walks through yard → gate opens → VLM says "dog,
low risk" → rule engine stays quiet. Stranger at night → notification with
full evidence chain visible in the dashboard.

---

## Phase 3 — Multi-Camera, Edge Nodes, MCP

### Step 3.1 — ESP32 firmware (capture/stream only)
- Exit criteria: frames streamed to hub over WiFi; heartbeat; < 150 KB RAM
  overhead; watchdog reboot on hang; OTA update path documented.

### Step 3.2 — Raspberry Pi edge mode
- Exit criteria: Pi runs motion + YOLO-nano at 30 FPS; offline operation
  with local SQLite cache; sync-on-reconnect tested.

### Step 3.3 — RTSP/IP camera backend
- Exit criteria: 4 simultaneous RTSP streams on the hub; per-camera config.

### Step 3.4 — MCP servers
- Wrap subsystems as MCP servers: Camera MCP, Timeline MCP, Alert MCP.
- Exit criteria: an MCP client (e.g. Claude) can list cameras, query an
  object timeline, and read decision provenance — read-only by default.

### Step 3.5 — Multi-camera identity
- Exit criteria: same person crossing two cameras keeps one UUID
  (appearance embedding match); cross-camera timeline in dashboard.

---

## Phase 4 — Scale & Federation
- Postgres backend; gRPC between services; GPU inference workers;
  Kubernetes manifests; Temporal for long-running workflows; 100-camera
  load test (synthetic streams) with event latency < 300 ms p95.

## Phase A — Animatronics Control (vision → motion)

The vision platform drives an animatronic rig: ESP32/Pi controllers moving
servos in response to what the cameras and microphones perceive.

### Step A.1 — Aim and servo safety ✅
- [x] `crates/actuator`: pan/tilt head with travel limits, rate limiting,
      deadband, and a failsafe that recentres when vision stops arriving
- [x] Engine picks a target deterministically, emits normalised aim
      coordinates and a commanded pan/tilt per frame
- [x] Track velocity reported so clients can extrapolate between updates
- [x] Console shows commanded angles, aim crosshair, fps and latency

### Step A.2 — Fast tracking
- [x] Capture paced by `requestAnimationFrame`, not a fixed sleep
- [x] Overlay redraws at display rate, extrapolating from velocity
- [x] Motion direction per track: eight-point heading + speed in
      frame-fractions/s, verified in all directions against the live engine
- [x] Distance estimates on detected objects (pinhole model, assumption
      attached; see `crates/spatial` and its TS mirror)
- [ ] Binary frame transport (JSON arrays dominate the round trip)
- [ ] Face-specific detection — currently the aim point is a heuristic
      (30% down the tracked region), not a detected face
- [ ] Measure and publish end-to-end latency budget

### Step A.2b — Two-app split and extreme optimization ✅
The system now builds as two applications from one workspace:
- **Desktop hub** (`vision-engine` + orchestrator + gateway + dashboard):
  full pipeline, identity, VLM, YOLO, UI.
- **Edge node** (`services/edge-node`): the same deterministic chain for
  Raspberry Pi-class devices — synchronous, one camera, no async runtime,
  no UUID/RNG dependency, compiled-in thresholds. Wire-compatible frame API.

Measured results (96×72 grid, desktop CPU):
- [x] Pipeline hot path 25.0 → 13.2 µs/frame (1.9×) — flood fill no longer
      allocates per pixel, blob scratch is reused per camera, and the sample
      buffer moves instead of being cloned
- [x] `vision-engine` binary 1.71 → 1.04 MB (fat LTO, single codegen unit,
      stripped, panic=abort); 0.74 MB on the size-first `edge` profile
- [x] `edge-node` binary: **309 KB** (edge profile), 4 tests, verified live:
      tracks, gates once, reports heading, commands the servo
- [ ] Pi cross-compile in CI (`aarch64-unknown-linux-gnu`) with size gate
- [ ] ESP32: true `no_std` port of `motion`/`actuator` cores (the crates
      still assume `std`; ESP32-S3 needs alloc-only slices and fixed-point
      review). Until then the ESP32 tier remains capture/stream only, per
      the original PRD.

### Step A.3 — Device transport (WiFi / Bluetooth)
- [ ] `crates/transport`: one trait, backends for WebSocket/HTTP over WiFi,
      BLE, and serial
- [ ] ESP32 firmware accepts `ServoCommand` frames, applies its own limits
      (never trust the host), and heartbeats back
- [ ] Deadman: controller parks the rig if commands stop arriving
- [ ] Device discovery and pairing UI

### Step A.4 — Logic designer
Adapting the node-graph editor from the LogiBoard/LogiTensor project
(React Flow + Zustand, `NodeDefinition`/`PortDefinition` model).
- [ ] Node types for this domain: camera input, audio input, detection,
      identity, zone, timer, condition, servo output, sound output
- [ ] Deterministic evaluation in Rust, mirroring the TS preview engine
- [ ] Graphs are data: saved, versioned, diffable
- [ ] Guardrails apply to graph outputs exactly as to model outputs — a
      graph cannot command a servo outside its limits

### Step A.5 — Audio input
- [ ] Microphone capture → direction of arrival for "look toward the sound"
- [ ] Wake-word and command recognition feeding the same logic graph

## Phase 4.5 — Voice Module (recognize + talk back)

### Step V.1 — Speech recognition (Whisper) — contracts done
- Exit criteria:
  - [x] `VoiceCommand` closed schema + rule-based `parseTranscript`:
        unrecognized speech is **rejected, never guessed**; a spoken
        injection attempt fails to parse (tested)
  - [x] `SpeechRecognizer` / `SpeechSynthesizer` interfaces for DI
  - [ ] Whisper binding wired to `SpeechRecognizer` (model already installed
        by `scripts/install-models` at `models/voice/ggml-base.en.bin`)
  - [ ] Commands routed through the guardrail pipeline before actuating
  - [ ] Audio-event detection: glass break, shout, doorbell → rule engine

### Step V.2 — Voice response (TTS talk-back)
- Exit criteria:
  - [x] `renderSpeech` templates speech from validated facts only — the
        system cannot say something the data doesn't support (tested)
  - [ ] Local Piper TTS: spoken alerts ("person at the front door") and
        command confirmations
  - [ ] Every utterance is the rendering of a validated, logged decision
        with provenance — never free-form LLM output
  - [ ] Two-way loop: ask "who was at the door today?" → RAG over event
        history → validated answer → spoken response
  - [ ] Dashboard Voice page: live transcript, command history, TTS replay

## Phase 5 — Advanced
- Custom object training pipeline; validated natural-language querying;
  analytics/heatmaps; enterprise policy management; thermal cameras.
- **RAG over event history**: pgvector embeddings of events/snapshots for
  retrieval-grounded answers; retrieved context is quoted in evidence so
  answers stay auditable.

---

## Standing quality gates (every step, every phase)
- `cargo fmt` / `clippy -D warnings` / `cargo deny` clean
- All new public items documented with examples
- No file > 500 lines; no function > ~75 lines
- Tests accompany every change; coverage never decreases
- Model/prompt version bumped whenever a prompt changes
