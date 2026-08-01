# ADR 0004 — YOLO Inference Runs in the Node Orchestrator, For Now

**Status:** Accepted (amended) · **Date:** 2026-07-28 · **Amended:** 2026-08-01

## Context

The PRD places object detection in Rust behind the `Detector` trait. The
Rust ONNX binding (`ort`) historically required the MSVC toolchain on
Windows; this machine used the GNU toolchain for a while, and `ort` did not
build under mingw. Meanwhile every capability the user actually asked for —
naming stationary objects, correct labels, depth, distance from real
geometry — was blocked on having *any* working inference runtime.

## Decision

**Primary (live) path:** Detection runs in `services/agent-orchestrator` via
`onnxruntime-node`, which ships prebuilt Windows binaries. The orchestrator
is already the AI service, so model inference there is architecturally
coherent. Decode/NMS math is pure TypeScript (`src/yolo.ts`); the session
wrapper is thin (`src/detect.ts`). Optional EP selection via
`WATCHINGEYE_ORT_EP=auto|cpu|cuda|dml`.

**Rust path (feature-gated):** `crates/detector` now has:
- pure `yolo_decode` (always on), and
- `OnnxYoloDetector` behind `--features ort` (MSVC + `ort` crate).

Vision-engine can inject any `Detector` through
`Engine::process_with_detector` (motion-gated). The live binary still leaves
the detector unset — HTTP `/detect` remains the naming path.

The same placement applies to **DINOv2 appearance embeddings**
(`src/embed.ts`): frozen ViT features for hybrid ReID, still never on the
Rust motion path. Identity matching stays in `crates/identity`.

**Amendment (2026-08-01) — LLM / VLM also stay in the TS orchestrator.**
ROADMAP 2.1 originally asked for a Rust-side LLM provider “for the engine.”
The engine never calls an LLM: it POSTs gated classify through the AI-free
gateway to `services/agent-orchestrator` (`LlmProvider` / Ollama / stub).
Shipping a Rust Ollama client with no consumer would be dead code and would
duplicate the Super Agent DAG. Rust keeps `guardrails`, `rules`, and
`identity`; chat/VLM inference remains Node, consistent with this ADR.
The 2.1 “Rust-side provider” checkbox is closed by this amendment, not by
porting `llm.ts`.

## Consequences

- Detect latency on this workstation: p95 ≈ **41 ms** on YOLO11n (see
  `services/agent-orchestrator/docs/detect-latency-results.md`) — under the
  PRD &lt;100 ms budget for the naming path. The motion pipeline stays the
  fast path; YOLO is the naming path; DINOv2 is the appearance path.
- The monocular distance table still exists twice (`crates/spatial` and
  `src/distance.ts`), mirrored the same way the guardrails already are.
- COCO's vocabulary bounds what this detector can name (no "drone" class);
  the VLM path can still name what COCO cannot.
- Install: `scripts/install-models` places `models/vision/yolo11n.onnx`.
  Build Rust ONNX with `cargo test -p detector --features ort` (needs MSVC
  `link.exe`, e.g. VsDevCmd).
