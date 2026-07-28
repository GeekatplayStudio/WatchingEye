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

### Step 1.2 — Motion detection
- Frame-differencing motion gate in Rust (no ML), configurable sensitivity.
- Exit criteria:
  - [ ] Static scene produces zero detector invocations over 1000 frames
  - [ ] Motion clip triggers detector within 2 frames of first movement
  - [ ] Property test: output invariant to constant brightness offsets

### Step 1.3 — ONNX YOLO detector backend
- Implement `Detector` with ONNX Runtime; YOLO11-nano quantized model.
- Exit criteria:
  - [ ] Person/dog/car detected on fixture images with conf ≥ 0.9
  - [ ] Detection latency < 100 ms on CPU (benchmark in CI, regression-gated)
  - [ ] Model file resolved via config; missing model = clean typed error

### Step 1.4 — Temporal validation + tracker hardening
- Replace naive class-matching with IoU association; add `Lost` events.
- Exit criteria:
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

### Step 2.1 — Ollama client (LLM abstraction layer)
- Rust client behind an `LlmProvider` trait; Ollama first, OpenAI-compatible
  second. Structured-output requests only (JSON mode).
- Exit criteria:
  - [ ] Trait mock allows full pipeline tests with zero network
  - [ ] Provenance (model version, prompt version) captured on every call
  - [ ] Timeout + retry policy is deterministic and configurable

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

## Phase 5 — Advanced
- Custom object training pipeline; validated natural-language querying;
  analytics/heatmaps; enterprise policy management; thermal cameras.
- **Voice recognition**: Whisper (whisper-rs) audio pipeline — spoken-command
  control of the dashboard and audio-event detection (glass break, shout),
  routed through the same guardrail/rule pipeline as vision events.

---

## Standing quality gates (every step, every phase)
- `cargo fmt` / `clippy -D warnings` / `cargo deny` clean
- All new public items documented with examples
- No file > 500 lines; no function > ~75 lines
- Tests accompany every change; coverage never decreases
- Model/prompt version bumped whenever a prompt changes
