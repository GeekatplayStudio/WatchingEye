# WatchingEye Development Roadmap

Hard-defined steps with explicit exit criteria. A step is **done only when
every exit criterion is checked**. No step starts before the previous one is
done (exceptions require an ADR).

> **Honesty rule:** a step header is ✅ only if *all* its boxes are [x].
> Partial work stays unmarked at the step level.

---

## Where we are (2026-08-01)

**Catch-up order for jumped Phase 1–2 / Phase 6 gaps: complete** (20/20).

| Band | Status |
|------|--------|
| Phase 0 Foundation | ✅ done |
| Phase 1 Edge detection | ✅ **1.1–1.5 done** (identities + pipeline events in SQLite) |
| Phase 2 Super Agent | mostly done; **2.1** Rust LLM provider open; **2.2** VLM &lt;300 ms **miss** (best ~3.9 s `llava`) |
| Phase 3 Multi-cam / edge | **3.3 + 3.5** ✅; ESP32 board selected (firmware pending); Pi CI / split MCP open |
| Phase 6 NL + vector dataset | **6.1, 6.2, 6.4, 6.5** ✅; **6.3** missing CLIP attr vectors column |
| Phase A / 4 / 4.5 / 5 | early or not started (servos ✅; voice contracts only) |

Roughly: **core single-camera → classify → identity → NL dataset loop is live.**
Durable multi-cam config + 4 synthetic pumps proven; live IP farms, firmware,
voice TTS, and sub-300 ms VLM remain the cliffs.

---

## Remaining debt (honest open items)

| Priority | Item | Gap |
|----------|------|-----|
| P1 | **2.2** VLM &lt;300 ms | Comparative miss on RTX 3090; best warm p95 ~3.9 s (`llava`) |
| P2 | **6.3** CLIP attr vectors | `clip_embedding` for search ✅; separate open-vocab attr vectors still open |
| P2 | **2.1** Rust LLM provider | Orchestrator TS only |
| P2 | **3.2 / A.2b** Pi CI | `edge-node` binary exists; no Pi cross-compile gate |
| P2 | **3.1 / A.3** ESP32 | Freenove ESP32-S3 CAM (16 MB) selected; docs/board profile ready; firmware encode deferred |
| P2 | **3.4** Split MCP | One read-only baseline; not Camera/Timeline/Alert servers |
| P2 | **V.1 / V.2** Voice | Schemas/tests only; no Whisper/Piper live loop |
| P3 | Phase 4 / 5 | Federation, k8s, training, thermal — not started |

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

### Step 1.1 — File & USB camera backends ✅
- [x] `vision-engine --camera file --input <path>` streams frames
      (raw gray / frame directory via `camera::file::FileCamera`; `.mp4`
      via ffmpeg → 96×72 gray8, same grid as RTSP)
- [x] Golden-file integration test: fixed sequence in, fixed frame count out
      (`FileCamera` concat/dir tests + `file_pump` engine ingest count)
- [x] Frame validator rejects corrupt/truncated frames with typed
      `CameraError::BadFrame` (`camera::validate::validate_frame`)
- [x] USB / V4L2 live capture via ffmpeg in `vision-engine` (`usb_pump`:
      dshow on Windows, v4l2 on Linux → 96×72 gray8; soft-fail if ffmpeg /
      device missing). Not a `CameraSource` in `crates/camera` — same
      split as RTSP. CLI: `--camera usb [--input <device>]`

### Step 1.2 — Motion detection ✅
- [x] `crates/motion`: background model + blobs, wired into `vision-engine`
- [x] Static scene reports no motion; localized change does
- [x] 1000-frame soak: zero detector invocations when static —
      `Engine::process_with_detector` + `motion_detector_gate::maybe_invoke`
      (detector optional; live path unset per ADR 0004);
      `engine_motion_soak.rs` asserts `CountingDetector.calls == 0` over
      1000 identical blanks, and that motion does invoke once

### Step 1.3 — ONNX YOLO detector ✅
- [x] YOLO11n via `onnxruntime-node`: letterbox, decode, NMS, unit tests
- [x] Stationary objects named on ~1.2 s cadence; missing model → clean 503
- [x] Rust `Detector` trait backend — `yolo_decode` + feature-gated
      `OnnxYoloDetector` (`cargo test -p detector --features ort`); MSVC
      `ort` builds on this machine; live engine still injects none (ADR 0004)
- [x] Latency &lt; 100 ms — recorded p95 **41 ms** on RTX 3090
      (`WATCHINGEYE_DETECT_LATENCY=record`; see `detect-latency-results.md`);
      optional `WATCHINGEYE_ORT_EP=auto|cpu|cuda|dml`

### Step 1.4 — Temporal validation + tracker hardening ✅
- [x] `tracker::association`: IoU + greedy matching; live engine uses IoU
- [x] Snapshot tests of full event streams for 3 synthetic gray sequences
      (`static`, `one_walker`, `two_walkers` — 96×72 gray8,
      FileCamera-compatible; not MP4) in `fixture_streams.rs`
- [x] Formal soak: two people keep distinct UUIDs across 100 frames via
      live `Engine::process` + `associate_predicted` (`engine_soak.rs`);
      secondary pure-association soak in `tracker::association`

### Step 1.5 — SQLite object database ✅
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
- [x] Pipeline event persistence without Postgres — gateway
      `SqliteEventStore` (`node:sqlite`) at `data/events.sqlite` (or
      `WATCHINGEYE_EVENTS_DB`); Postgres still preferred when
      `DATABASE_URL` works; Vitest / `memory` stay ephemeral

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

### Step 2.1c — RAG grounding ✅
- [x] `KeywordRetriever` + `verifyGrounded`
- [x] Live grounded keyword recall path — gateway `recall.ts` +
      `GET /api/dataset/recall` (multi-term score, yesterday/today window,
      template answer, citations ⊆ retrieved, evidence quotes)
- [x] pgvector-backed **text** semantic retriever —
      orchestrator `text-embed.ts` (Ollama `nomic-embed-text` or
      `WATCHINGEYE_TEXT_EMBED=stub`); `HybridRetriever` =
      keyword ∪ text NN; `dataset_events.text_embedding vector(768)`
      separate from DINOv2 `embedding vector(384)`; enroll + recall
      best-effort text embed (soft-fail without model)

### Step 2.2 — VLM scene analysis (partial)
- [x] Gated classify path: snapshot → VLM → guardrails → identity
- [x] Opt-in GPU latency benchmark harness —
      `classify-latency.bench.test.ts` + `npm run test:gpu-latency`
      (`WATCHINGEYE_GPU_LATENCY=1` assert, `=record` measure-only;
      `WATCHINGEYE_GPU_LATENCY_MODELS=known` comparative matrix);
      writes `docs/gpu-latency-results.{json,md}`
- [x] Comparative VLM latency record (RTX 3090) — `llava` fastest warm
      p95 ≈ 3.9 s; `qwen2.5vl:7b` ≈ 4.2–5.0 s; `gemma3:4b` slower;
      default detect order prefers `llava` (pin `VLM_MODEL` for quality)
- [ ] Proven p95 &lt; 300 ms on GPU — **still a miss** (fastest recorded
      ~3.9 s); keep open until a sub-second VLM path exists
- [x] Fixture-image golden decision test in CI —
      `fixtures/golden-scene.png` + `golden-decision.test.ts` runs
      snapshot → StubProvider VLM → guardrails → `outcome: "action"`
      in the orchestrator vitest job (no Ollama required)
- Note: see `services/agent-orchestrator/docs/gpu-latency.md`

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

### Step 3.1 — ESP32 firmware ⛔ skipped (hardware selected)
- [x] Lab board chosen — Freenove ESP32-S3 CAM (**FNK0085**, **16 MB Flash**);
      docs + pin profile (`docs/hardware/freenove-esp32-s3-cam.md`,
      `edge/esp32/boards/freenove-esp32-s3-wroom.toml`); encode after arrival
- [ ] Frames streamed to hub over WiFi; heartbeat; RAM/watchdog/OTA criteria
- Note: no firmware sources yet — vendor Camera Web Server is the first
      smoke test when the board lands; WatchingEye firmware follows.

### Step 3.2 — Raspberry Pi edge mode (partial)
- [x] `edge-node` binary (~309 KB) wire-compatible with vision-engine
- [ ] Pi cross-compile in CI; offline SQLite cache + sync-on-reconnect

### Step 3.3 — RTSP/IP camera backend ✅
- [x] RTSP connect/disconnect + Discover UI; frames into the real pipeline
- [x] Durable per-camera config — `camera_store.rs` SQLite
      (`data/cameras.sqlite` / `WATCHINGEYE_CAMERA_DB`); upsert on connect,
      delete on disconnect; restore-enabled on engine start
- [x] Four simultaneous streams proven — `rtsp_scale.rs` runs 4 concurrent
      synthetic gray-grid pumps into the shared `Engine` (same path RTSP
      uses after ffmpeg decode); not a live IP-camera farm claim

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

### Step 6.2 — Deeper recognition (ANPR & fine-grained) ✅
- [x] Regex ANPR on live classify when `anprEnabled` (gateway `anpr.ts`)
- [x] Real OCR ANPR path — orchestrator `plate-ocr.ts`: vehicle plate-band
      crop → injectable `OcrProvider` → regex confirm → VLM regex fallback;
      gateway passes `anpr: true` and prefers orchestrator `plate` evidence.
      Enable tesseract with `WATCHINGEYE_OCR=tesseract`, PaddleOCR with
      `paddle` / `auto` (soft-fail otherwise).
- [x] Breed/color extractor with confidence beyond VLM text —
      `open-vocab.ts`: HSV colour histogram banks (`fur_color` /
      `vehicle_color`) + stub breed path (`WATCHINGEYE_OPEN_VOCAB=stub`);
      merges into descriptors above a confidence floor without overwriting
      VLM keys
- [x] Full CLIP ViT-B/32 zero-shot ONNX banks for breed/color —
      `export-open-vocab-clip.py` + `OnnxClipOpenVocabScorer` (soft-fail
      without weights; composite with HSV when assets present)
- [x] Dedicated Paddle/Fast-LPR plate path when generic OCR misses —
      `plate-lpr.ts` + `scripts/paddle-lpr.py` sidecar; soft-empty without
      `paddleocr`. Enable with `WATCHINGEYE_OCR=paddle` or `auto` (paddle →
      tesseract cascade). Regex/VLM fallback unchanged.

### Step 6.3 — Multimodal vector dataset auto-builder (partial)
- [x] Persist gated enrollments + DINOv2 vectors into pgvector with
      provenance — `vector-db.ts` / `dataset_events` (`vector(384)`),
      classify enroll calls orchestrator `/embed` best-effort; memory
      fallback + `POST /api/dataset/similar` for cosine lookup
- [ ] CLIP / open-vocab attribute vectors alongside appearance
- Note: snapshot *bytes* still not retained (2.4 policy); only vectors +
  refs. CLIP multimodal search is Step 6.4 (separate `clip_embedding`).

### Step 6.4 — Natural language recall & multimodal search ✅
- [x] Grounded queries over dataset (plate / breed keywords, `yesterday` /
      `today` window) — `GET /api/dataset/recall` + dashboard quotes in
      Active Tracking panel; hybrid keyword ∪ text-NN when text embedder
      is available (Step 2.1c)
- [x] CLIP / open-vocab multimodal semantic search —
      enroll stores optional `clip_embedding vector(512)` (vision ONNX);
      recall unions CLIP NN (text via `clip-text-embed.py` sidecar, or
      POST image) with keyword ∪ nomic; soft-fail without weights
- Note: nomic text RAG remains a separate 768-d channel; CLIP is image↔text.

### Step 6.5 — Live active tracking monitor ✅
- [x] Active tracking panel on console (NL quick-add → settings)
- [x] Live dataset count; intent-driven monitoring metrics —
      `GET /api/dataset/stats` (`DatasetStoreLike.count`); panel badge
      `dataset N` + session row `matched · filtered · plates · seen`
      from WS events scoped to active intent / tracked classes

---

## Recommended catch-up order

1. ~~**6.1 remaining** — wire `activeIntent` into classify / dataset / ANPR~~ ✅
2. ~~**1.5** — SQLite identity + pipeline event persistence~~ ✅
3. ~~**1.1** — file + USB camera backends (ffmpeg USB/V4L2 in vision-engine)~~ ✅
4. ~~**2.3** — notify webhook from rules~~ ✅
5. ~~**1.4** — tracker soak + gray-sequence snapshot fixtures~~ ✅
6. ~~**2.2** — fixture-image golden + opt-in GPU latency harness~~ ✅ (budget still open; best ~3.9 s `llava`)
7. ~~**2.4** — event replay UI~~ ✅ (metadata path; snapshot bytes not stored)
8. ~~**6.3** — DINOv2 dataset → pgvector on enroll~~ ✅ (CLIP attr vectors still open)
9. ~~**6.2** — OCR ANPR path + regex fallback~~ ✅
10. ~~**6.4** — grounded keyword NL recall~~ ✅
11. ~~**6.5** — live dataset count / intent metrics~~ ✅
12. ~~**2.1c** — text embedding semantic retriever~~ ✅
13. ~~**6.2 breed/color open-vocab** — HSV banks + stub~~ ✅
14. ~~**6.2 CLIP ONNX zero-shot** — optional ViT-B/32 banks~~ ✅
15. ~~**6.2 Paddle-LPR** — optional Python sidecar + cascade OCR~~ ✅
16. ~~**6.4 multimodal CLIP search** — enroll CLIP-512 + hybrid recall~~ ✅
17. ~~**2.2 latency record** — RTX 3090 + qwen2.5vl:7b p95 recorded (miss)~~ ✅
18. ~~**1.2 motion soak** — 1000-frame static → zero detector invocations~~ ✅
19. ~~**1.3** — Rust YOLO (`ort` feature) + detect &lt;100 ms recorded~~ ✅
20. ~~**1.5 event SQLite** — gateway `SqliteEventStore` without Postgres~~ ✅
21. ~~**3.3 RTSP scale** — durable camera SQLite + 4-pump soak~~ ✅
22. ~~**2.2 comparative VLM** — multi-model matrix; prefer `llava` (~3.9 s); budget still open~~ ✅
23. ~~**ESP32 lab board** — Freenove ESP32-S3 CAM docs + board profile~~ ✅ (encode when hardware arrives)
24. **Pi CI / 6.3 CLIP attr vectors / ESP32 firmware encode** ← opportunistic next

---

## Standing quality gates (every step)
- `cargo fmt` / `clippy -D warnings` / `cargo deny` clean
- Public items documented with examples; files ≤ 500 lines; functions ≤ ~75
- Tests accompany every change; model/prompt version bumped on prompt edits
