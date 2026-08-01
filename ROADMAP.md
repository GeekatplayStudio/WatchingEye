# WatchingEye Development Roadmap

Hard-defined steps with explicit exit criteria. A step is **done only when
every exit criterion passes in CI**. No step starts before the previous one
is done (exceptions require an ADR).

---

## Phase 0 — Foundation ✅

### Step 0.1 — Repo skeleton ✅
- [x] Cargo workspace with core crates + vision-engine
- [x] Gateway (Fastify/TS) and dashboard (Next.js) scaffolds
- [x] CI: fmt, clippy `-D warnings`, tests, cargo-deny, docs
- [x] PRD, ADRs 0001–0002, architecture overview

### Step 0.2 — Toolchain & scripts ✅
- [x] `scripts/install.ps1` / `scripts/install.sh` bring a clean machine up
- [x] `scripts/install-models` provisions: Ollama (qwen2.5vl:7b, llama3.2:3b),
      yolo11n.onnx, Whisper ggml-base.en, DINOv2-small ONNX (`export-dinov2.py`)
- [x] Start/stop scripts for the full stack (port-conflict fallback)
- [x] Repo on GitHub with CI

---

## Phase 1 — Single-Camera Edge Detection

### Step 1.1 — File & USB camera backends
- [ ] `vision-engine --camera file --input sample.mp4` streams frames
- [ ] Golden-file integration test: fixed video in, fixed frame count out
- [ ] Frame validator rejects corrupt/truncated frames with typed errors
- Note: live USB/webcam path works via the dashboard console today; file
  backend + golden tests remain.

### Step 1.2 — Motion detection ✅
- [x] `crates/motion`: background model + blobs, wired into `vision-engine`
- [x] Static scene reports no motion; localized change does
- [ ] 1000-frame soak test proving zero detector invocations when static

### Step 1.3 — ONNX YOLO detector ✅ (orchestrator — ADR 0004)
- [x] YOLO11n via `onnxruntime-node`: letterbox, decode, NMS, unit tests
- [x] Stationary objects named on ~1.2 s cadence; missing model → clean 503
- [ ] Rust `Detector` trait backend (blocked on MSVC; ADR 0004)
- [ ] Latency < 100 ms (currently ~490 ms CPU)

### Step 1.4 — Temporal validation + tracker hardening
- [x] `tracker::association`: IoU + greedy matching; live engine uses IoU
- [ ] Snapshot tests of full event streams for 3 fixture videos
- [ ] Formal soak: two people keep distinct UUIDs across 100 frames

### Step 1.5 — SQLite object database
- [ ] Engine restart resumes with prior object history intact
- [ ] Timeline query: all events for object UUID in < 10 ms
- [ ] Migration test: v0 → current on a seeded database

---

## Phase 2 — Super Agent with Guardrails

### Step 2.0 — Dashboard & gateway foundation ✅
- [x] Next.js console: live feed, evidence, tuning, pipeline, WebSocket
- [x] Gateway: settings API, Postgres/memory event store, AI-free proxy
- [x] LangGraph Super Agent DAG + zod guardrails
- [x] MCP server (read-only) baseline

### Step 2.1 — Ollama / LLM abstraction ✅
- [x] `LlmProvider` + Ollama + stub; provenance on every response
- [ ] Rust-side provider for the engine (currently TS only)

### Step 2.1b — AI-safety screening ✅
- [x] `guardrails::safety` + orchestrator `screen.ts` mirror

### Step 2.1c — RAG grounding ✅ (keyword half)
- [x] `KeywordRetriever` + `verifyGrounded`
- [ ] pgvector-backed semantic retriever

### Step 2.2 — VLM scene analysis
- [x] Gated classify path: snapshot → VLM → guardrails → identity
- [ ] End-to-end latency < 300 ms gate-open → decision (GPU benchmark)
- [ ] Fixture-image golden decision test in CI

### Step 2.3 — Rule engine expansion + actions
- [ ] Zones, time windows, notify webhook end-to-end
- [ ] Rule evaluation property test for determinism

### Step 2.4 — Zero-black-box dashboard
- [x] Live evidence chips, refusal reasons, identity verdicts on console
- [ ] Replay: select a past event, see exact pipeline path taken
- [ ] Every decision in the DB fully reconstructable in the UI

---

## Phase 3 — Multi-Camera, Edge Nodes, MCP, Appearance ReID

### Step 3.1 — ESP32 firmware (capture/stream only)
- [ ] Frames streamed to hub over WiFi; heartbeat; RAM/watchdog/OTA criteria

### Step 3.2 — Raspberry Pi edge mode
- [x] `edge-node` binary (~309 KB) wire-compatible with vision-engine
- [ ] Pi cross-compile in CI; offline SQLite cache + sync-on-reconnect

### Step 3.3 — RTSP/IP camera backend (in progress)
- [x] RTSP connect/disconnect + Discover UI; frames into the real pipeline
- [ ] Exit: 4 simultaneous RTSP streams on the hub; per-camera config store

### Step 3.4 — MCP servers
- [ ] Camera / Timeline / Alert MCP servers; read-only client demo

### Step 3.5 — Hybrid appearance ReID + multi-camera identity ✅
Inspired by REMIND (DINOv2 descriptors, dual-bank memory, ambiguity gating,
Hungarian assignment) — integrated without replacing the deterministic
motion → IoU → TriggerGate spine.

- [x] DINOv2-small ONNX embedder in orchestrator (`/embed`, ADR 0004 pattern)
- [x] Hybrid identity: weighted attributes ⊕ appearance cosine; plate refute wins
- [x] Dual-bank work/stable appearance memory; Strong/Ambiguous/Weak update gating
- [x] Tentative → Confirmed identity lifecycle
- [x] Hungarian `observe_batch` + `POST /api/identify/batch`; detect opt-in
      `{ identify: true }`
- [x] Camera-agnostic gallery; `crossed_camera` / `cameras_seen` on outcomes
- [x] `GET /api/identities/{id}` timeline; dashboard **Identities** page
- [x] Docs: architecture overview, identity docs, install-models + `export-dinov2.py`

Optional follow-ups (not blocking): neighbor co-occurrence graphs, multi-prototype
banks, DINOv3 upgrade, SigLIP open-vocab attributes (Phase 6).

---

## Phase 4 — Scale & Federation
- Postgres backend hardening; gRPC; GPU workers; k8s; Temporal; 100-camera
  load test (synthetic) with event latency < 300 ms p95.

---

## Phase A — Animatronics Control (vision → motion)

### Step A.1 — Aim and servo safety ✅
- [x] `crates/actuator` limits, rate limit, deadband, failsafe
- [x] Console aim crosshair, fps, latency

### Step A.2 — Fast tracking (partial)
- [x] rAF capture, velocity overlay, heading/speed, monocular distance
- [ ] Binary frame transport; face-specific aim; published e2e latency budget

### Step A.2b — Two-app split ✅
- [x] Desktop hub + `edge-node` (309 KB); hot-path and binary size wins
- [ ] Pi CI cross-compile gate; ESP32 `no_std` port

### Step A.3 — Device transport
- [ ] WiFi / BLE / serial `transport` crate; ESP32 command path; deadman

### Step A.4 — Logic designer
- [ ] Node-graph editor + deterministic Rust eval + guardrails on outputs

### Step A.5 — Audio input
- [ ] DoA “look toward sound”; wake-word into the logic graph

---

## Phase 4.5 — Voice Module

### Step V.1 — Speech recognition (contracts done)
- [x] `VoiceCommand` schema + reject-unknown parse (tested)
- [ ] Whisper binding; guardrail routing; audio-event detection

### Step V.2 — Voice response (TTS)
- [x] `renderSpeech` from validated facts only (tested)
- [ ] Piper TTS; two-way RAG ask/answer; Voice page live loop

---

## Phase 5 — Advanced
- Custom training; heatmaps; enterprise policy; thermal cameras
- RAG over event history with pgvector (auditable quotes in evidence)

---

## Phase 6 — NL Dynamic Tracking, Deep Vision & Vector Dataset

Builds on Step 3.5 appearance identity. See ADR 0005 (partially implemented).

### Step 6.1 — Natural language intent & target registration ✅
- [x] `nl-parser.ts` + `/parse-intent` + gateway `/api/nlp/target`
- [x] `"track all dogs"` → `dog` + `dataset_enroll` / breed+color attributes
- [x] `"track cars and capture plates"` → `car` + `anpr_ocr` / license_plate
- [x] Settings store `activeIntent`; WebSocket broadcast on apply (UI shows `broadcastMs`)
- [x] Active tracking panel listens for settings push and refreshes targets live

### Step 6.2 — Deeper recognition (ANPR & fine-grained)
- [x] Regex ANPR helper + VLM descriptors (baseline)
- [ ] Real OCR ANPR; breed/color extractor with confidence; `ocr_unconfirmed`

### Step 6.3 — Multimodal vector dataset auto-builder
- [ ] Persist gated events + DINOv2/CLIP vectors into pgvector with provenance

### Step 6.4 — Natural language recall & multimodal search
- [ ] Grounded queries over dataset (`golden retriever yesterday`, plate lookup)

### Step 6.5 — Live active tracking monitor
- [x] Active tracking panel scaffold on console
- [ ] NL quick-add → immediate monitor; live dataset count

---

## Standing quality gates (every step)
- `cargo fmt` / `clippy -D warnings` / `cargo deny` clean
- Public items documented with examples; files ≤ 500 lines; functions ≤ ~75
- Tests accompany every change; model/prompt version bumped on prompt edits
