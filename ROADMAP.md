# WatchingEye Development Roadmap

Hard-defined steps with explicit exit criteria. A step is **done only when
every exit criterion is checked**. No step starts before the previous one is
done (exceptions require an ADR).

> **Honesty rule:** a step header is ✅ only if *all* its boxes are [x].
> Partial work stays unmarked at the step level.

---

## Skipped / technical debt (jumped while later work shipped)

These were left open while Phase 3.5 ReID and Phase 6 UI advanced. Prefer
closing them before more Phase 6 depth.

| Priority | Step | Gap |
|----------|------|-----|
| P0 | **1.5** SQLite object DB | ~~No sqlite/sqlx anywhere~~ ✅ identity persistence shipped; events remain memory/Postgres JSONB only |
| P0 | **1.1** File & USB camera backends | File `CameraSource` + CLI pump + golden tests ✅; USB still deferred |
| P1 | **1.4** Tracker soak + snapshot fixtures | ~~no 100-frame soak / fixture snapshots~~ ✅ synthetic gray8 sequences + live `Engine::process` soak in CI |
| P1 | **2.3** Rules → notify webhook | ~~Rule types exist; no HTTP webhook delivery~~ ✅ zone enter + webhook + determinism tests |
| P1 | **2.2** VLM golden / latency | Golden fixture CI ✅; &lt;300 ms GPU latency gate still open |
| P1 | **2.4** Event replay UI | ~~no past-event pipeline replay~~ ✅ select + path + provenance (no pixel retention) |
| P1 | **6.1** NL intent → pipeline | ~~Settings only~~ ✅ wired via `intent-apply.ts` |
| P2 | **3.1** ESP32 firmware | `edge/esp32/README.md` only — no firmware crate |
| P2 | **2.1c / 6.3** pgvector | dataset DINOv2 ✅; text semantic RAG still open |
| P2 | **6.4** NL recall | ~~stub search only~~ ✅ grounded keyword recall + quotes; text-embed multimodal still open |
| P2 | **3.4** Split MCP servers | One read-only MCP baseline; not Camera/Timeline/Alert |

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

### Step 1.1 — File & USB camera backends (partial)
- [x] `vision-engine --camera file --input <path>` streams frames
      (raw gray / frame directory via `camera::file::FileCamera`; `.mp4`
      via ffmpeg → 96×72 gray8, same grid as RTSP)
- [x] Golden-file integration test: fixed sequence in, fixed frame count out
      (`FileCamera` concat/dir tests + `file_pump` engine ingest count)
- [x] Frame validator rejects corrupt/truncated frames with typed
      `CameraError::BadFrame` (`camera::validate::validate_frame`)
- [ ] USB / V4L2 `CameraSource` (deferred — browser webcam + RTSP cover
      live capture today)
- Note: Step header stays partial until USB lands; file path is done.

### Step 1.2 — Motion detection (partial)
- [x] `crates/motion`: background model + blobs, wired into `vision-engine`
- [x] Static scene reports no motion; localized change does
- [ ] 1000-frame soak test proving zero detector invocations when static

### Step 1.3 — ONNX YOLO detector (partial — ADR 0004)
- [x] YOLO11n via `onnxruntime-node`: letterbox, decode, NMS, unit tests
- [x] Stationary objects named on ~1.2 s cadence; missing model → clean 503
- [ ] Rust `Detector` trait backend (blocked on MSVC; ADR 0004)
- [ ] Latency < 100 ms (currently ~490 ms CPU)

### Step 1.4 — Temporal validation + tracker hardening ✅
- [x] `tracker::association`: IoU + greedy matching; live engine uses IoU
- [x] Snapshot tests of full event streams for 3 synthetic gray sequences
      (`static`, `one_walker`, `two_walkers` — 96×72 gray8,
      FileCamera-compatible; not MP4) in `fixture_streams.rs`
- [x] Formal soak: two people keep distinct UUIDs across 100 frames via
      live `Engine::process` + `associate_predicted` (`engine_soak.rs`);
      secondary pure-association soak in `tracker::association`

### Step 1.5 — SQLite object database (partial)
- [x] Engine restart resumes with prior identities intact — `rusqlite`
      (`bundled`) store in `vision-engine`, seeded into `identity::Registry`
      on startup (`identify.rs`, `identity_store.rs`); matching itself stays
      in `crates/identity` (`Registry::import`), the store is a thin,
      identity-crate-agnostic persistence layer
- [x] Timeline query: all events for object UUID in < 10 ms — `GET
      /api/identities/{id}/timeline` reads `memory_json` by primary key;
      covered by a timing-asserting unit test
- [x] Migration test: v0 → current on a seeded database — `PRAGMA
      user_version` gates schema creation, exercised by
      `migrating_from_v0_creates_the_v1_schema_and_is_idempotent`
- Note: this covers **identity** history only, not generic pipeline events
  (still memory/Postgres JSONB) — see the debt table above.

---

## Phase 2 — Super Agent with Guardrails

### Step 2.0 — Dashboard & gateway foundation ✅
- [x] Next.js console: live feed, evidence, tuning, pipeline, WebSocket
- [x] Gateway: settings API, Postgres/memory event store, AI-free proxy
- [x] LangGraph Super Agent DAG + zod guardrails
- [x] MCP server (read-only) baseline (`list_cameras`, `recent_events`, `get_settings`)

### Step 2.1 — Ollama / LLM abstraction (partial)
- [x] `LlmProvider` + Ollama + stub; provenance on every response
- [ ] Rust-side provider for the engine (currently TS only)

### Step 2.1b — AI-safety screening ✅
- [x] `guardrails::safety` + orchestrator `screen.ts` mirror

### Step 2.1c — RAG grounding (partial)
- [x] `KeywordRetriever` + `verifyGrounded`
- [x] Live grounded keyword recall path — gateway `recall.ts` +
      `GET /api/dataset/recall` (multi-term score, yesterday/today window,
      template answer, citations ⊆ retrieved, evidence quotes)
- [ ] pgvector-backed **text** semantic retriever (DINOv2 appearance
      vectors are not text RAG; still open)

### Step 2.2 — VLM scene analysis (partial)
- [x] Gated classify path: snapshot → VLM → guardrails → identity
- [ ] End-to-end latency < 300 ms gate-open → decision (GPU benchmark)
- [x] Fixture-image golden decision test in CI —
      `fixtures/golden-scene.png` + `golden-decision.test.ts` runs
      snapshot → StubProvider VLM → guardrails → `outcome: "action"`
      in the orchestrator vitest job (no Ollama required)

### Step 2.3 — Rule engine expansion + actions ✅
- [x] Zones, time windows, notify webhook end-to-end —
      `ZoneMonitor` (right-half `"garage"`) emits `EnteredZone` once per stay;
      `rules::evaluate` with env/hard-coded zone+class (+ optional
      `WATCHINGEYE_RULE_HOURS`); `Notifier` POSTs JSON from vision-engine
      (`WATCHINGEYE_NOTIFY_WEBHOOK_URL` / `WATCHINGEYE_NOTIFY_CHANNELS`)
- [x] Rule evaluation property test for determinism
      (`evaluate_is_deterministic_across_repeats` in `crates/rules`)
- Note: live motion tracks use `ObjectClass::Unknown` until classify attaches
  a real class; set `WATCHINGEYE_RULE_CLASS` accordingly. Actuator remains
  servos-only; gateway has no webhook delivery.

### Step 2.4 — Zero-black-box dashboard ✅
- [x] Live evidence chips, refusal reasons, identity verdicts on console
- [x] Replay: select a past event, see exact pipeline path taken —
      Live monitor hydrates `GET /api/events/recent`, selectable
      `EventCard` → `EventDetail` receipt with highlighted DAG stages
      (`pipelinePathFor`); `GET /api/events/:id` for store lookup
- [x] Every decision in the DB fully reconstructable in the UI —
      stored evidence, identity, descriptors, risk, refusal, and full
      `provenance` (model/prompt/input_images refs/timestamp) round-trip
      on classify
- Note: **snapshot image bytes are not retained** — UI reconstructs the
  stored decision path and provenance refs, not pixel re-infer. True
  re-classification would be a new decision with new provenance.
---

## Phase 3 — Multi-Camera, Edge Nodes, MCP, Appearance ReID

### Step 3.1 — ESP32 firmware ⛔ skipped
- [ ] Frames streamed to hub over WiFi; heartbeat; RAM/watchdog/OTA criteria
- Note: `edge/esp32/README.md` only — no firmware sources.

### Step 3.2 — Raspberry Pi edge mode (partial)
- [x] `edge-node` binary (~309 KB) wire-compatible with vision-engine
- [ ] Pi cross-compile in CI; offline SQLite cache + sync-on-reconnect

### Step 3.3 — RTSP/IP camera backend (in progress)
- [x] RTSP connect/disconnect + Discover UI; frames into the real pipeline
- [ ] Exit: 4 simultaneous RTSP streams proven; durable per-camera config store

### Step 3.4 — MCP servers (partial)
- [x] Single read-only MCP baseline (2.0)
- [ ] Dedicated Camera / Timeline / Alert MCP servers + client demo

### Step 3.5 — Hybrid appearance ReID + multi-camera identity ✅
Integrated without replacing motion → IoU → TriggerGate. (Shipped ahead of
several Phase 1–2 items — see debt table.)

- [x] DINOv2-small ONNX embedder in orchestrator (`/embed`)
- [x] Hybrid identity: attributes ⊕ appearance cosine; plate refute wins
- [x] Dual-bank work/stable memory; Strong/Ambiguous/Weak gating
- [x] Tentative → Confirmed lifecycle
- [x] Hungarian `observe_batch` + `/api/identify/batch`; detect `{ identify: true }`
- [x] Camera-agnostic gallery; `crossed_camera` / `cameras_seen`
- [x] `GET /api/identities/{id}`; dashboard Identities page
- [x] Docs + `export-dinov2.py` / install-models hooks

Optional later: neighbor graphs, multi-prototype banks, DINOv3, SigLIP.

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

### Step A.2b — Two-app split (partial)
- [x] Desktop hub + `edge-node` (309 KB); hot-path and binary size wins
- [ ] Pi CI cross-compile gate; ESP32 `no_std` port

### Step A.3 — Device transport ⛔ not started
- [ ] WiFi / BLE / serial `transport` crate; ESP32 command path; deadman

### Step A.4 — Logic designer ⛔ not started
- [ ] Node-graph editor + deterministic Rust eval + guardrails on outputs

### Step A.5 — Audio input ⛔ not started
- [ ] DoA “look toward sound”; wake-word into the logic graph

---

## Phase 4.5 — Voice Module

### Step V.1 — Speech recognition (contracts only)
- [x] `VoiceCommand` schema + reject-unknown parse (tested)
- [ ] Whisper binding; guardrail routing; audio-event detection

### Step V.2 — Voice response (contracts only)
- [x] `renderSpeech` from validated facts only (tested)
- [ ] Piper TTS; two-way RAG ask/answer; Voice page live loop

---

## Phase 5 — Advanced
- Custom training; heatmaps; enterprise policy; thermal cameras
- RAG over event history with pgvector (auditable quotes in evidence)

---

## Phase 6 — NL Dynamic Tracking, Deep Vision & Vector Dataset

Builds on Step 3.5. See ADR 0005 (partially implemented).

### Step 6.1 — Natural language intent & target registration ✅
- [x] `nl-parser.ts` + `/parse-intent` + gateway `/api/nlp/target`
- [x] Parse `"track all dogs"` → `dog` + `dataset_enroll` flags
- [x] Parse `"track cars and capture plates"` → `car` + `anpr_ocr`
- [x] Settings `activeIntent` + WebSocket broadcast; panel refreshes live
- [x] `datasetEnroll` / `anprEnabled` / attributes applied on classify
      (`intent-apply.ts`: enroll gate, regex ANPR, descriptor filter, `ocr_unconfirmed`)

### Step 6.2 — Deeper recognition (ANPR & fine-grained) (partial)
- [x] Regex ANPR on live classify when `anprEnabled` (gateway `anpr.ts`)
- [x] Real OCR ANPR path — orchestrator `plate-ocr.ts`: vehicle plate-band
      crop → injectable `OcrProvider` → regex confirm → VLM regex fallback;
      gateway passes `anpr: true` and prefers orchestrator `plate` evidence.
      Enable tesseract with `WATCHINGEYE_OCR=tesseract` (soft-fail otherwise).
- [ ] Breed/color extractor with confidence beyond VLM text (CLIP/SigLIP)
- [ ] Dedicated Paddle/Fast-LPR plate detector when generic OCR misses

### Step 6.3 — Multimodal vector dataset auto-builder (partial)
- [x] Persist gated enrollments + DINOv2 vectors into pgvector with
      provenance — `vector-db.ts` / `dataset_events` (`vector(384)`),
      classify enroll calls orchestrator `/embed` best-effort; memory
      fallback + `POST /api/dataset/similar` for cosine lookup
- [ ] CLIP / open-vocab attribute vectors alongside appearance
- Note: snapshot *bytes* still not retained (2.4 policy); only vectors +
  refs. Text semantic RAG remains Step 2.1c / 6.4.

### Step 6.4 — Natural language recall & multimodal search (partial)
- [x] Grounded queries over dataset (plate / breed keywords, `yesterday` /
      `today` window) — `GET /api/dataset/recall` + dashboard quotes in
      Active Tracking panel
- [ ] Text-embedding / CLIP multimodal semantic search
- Note: keyword + appearance-NN (`/similar`) only; no text vector column yet.

### Step 6.5 — Live active tracking monitor ✅
- [x] Active tracking panel on console (NL quick-add → settings)
- [x] Live dataset count; intent-driven monitoring metrics —
      `GET /api/dataset/stats` (`DatasetStoreLike.count`); panel badge
      `dataset N` + session row `matched · filtered · plates · seen`
      from WS events scoped to active intent / tracked classes

---

## Recommended catch-up order

1. ~~**6.1 remaining** — wire `activeIntent` into classify / dataset / ANPR~~ ✅
2. ~~**1.5** — SQLite identity persistence~~ ✅ (event persistence still open)
3. ~~**1.1** — file camera backend + golden fixture test~~ ✅ (USB still open)
4. ~~**2.3** — notify webhook from rules~~ ✅
5. ~~**1.4** — tracker soak + gray-sequence snapshot fixtures~~ ✅
6. ~~**2.2** — fixture-image golden decision in CI~~ ✅ (GPU &lt;300 ms latency still open)
7. ~~**2.4** — event replay UI~~ ✅ (metadata path; snapshot bytes not stored)
8. ~~**6.3** — DINOv2 dataset → pgvector on enroll~~ ✅ (CLIP / text RAG still open)
9. ~~**6.2** — OCR ANPR path + regex fallback~~ ✅ (CLIP breed/color + Paddle still open)
10. ~~**6.4** — grounded keyword NL recall~~ ✅ (text-embed multimodal still open)
11. ~~**6.5** — live dataset count / intent metrics~~ ✅
12. **2.1c remaining** — text embedding semantic retriever ← **next**
13. **1.1 USB** — when a native capture backend is needed beyond browser/RTSP
14. **2.2 latency** — GPU benchmark when hardware is available
15. **6.2 remaining** — CLIP attrs / Paddle-LPR when needed

---

## Standing quality gates (every step)
- `cargo fmt` / `clippy -D warnings` / `cargo deny` clean
- Public items documented with examples; files ≤ 500 lines; functions ≤ ~75
- Tests accompany every change; model/prompt version bumped on prompt edits
