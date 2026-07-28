# ADR 0004 — YOLO Inference Runs in the Node Orchestrator, For Now

**Status:** Accepted · **Date:** 2026-07-28

## Context

The PRD places object detection in Rust behind the `Detector` trait. The
Rust ONNX binding (`ort`) requires the MSVC toolchain on Windows; this
development machine deliberately uses the GNU toolchain because the MSVC
linker is absent (see CLAUDE.md), and `ort` does not build under mingw.
Meanwhile every capability the user actually asked for — naming stationary
objects, correct labels, depth, distance from real geometry — was blocked on
having *any* working inference runtime.

## Decision

Detection runs in `services/agent-orchestrator` via `onnxruntime-node`,
which ships prebuilt Windows binaries and loads without a compiler. The
orchestrator is already the AI service, so model inference there is
architecturally coherent. The decode/NMS math is pure TypeScript with unit
tests (`src/yolo.ts`); the session wrapper is thin (`src/detect.ts`).

The Rust `Detector` trait remains the target interface. When the MSVC
toolchain is available (CI already has it; `scripts/install.ps1` installs
it on fresh machines), a Rust `ort` backend can replace this without the
dashboard or gateway noticing, since both talk to HTTP endpoints.

## Consequences

- Detection latency is ~490 ms on CPU — fine for the 1.2 s labelling
  cadence, not for per-frame use. The motion pipeline stays the fast path;
  YOLO is the naming path.
- The monocular distance table now exists twice (`crates/spatial` and
  `src/distance.ts`), mirrored the same way the guardrails already are.
  Both files carry keep-in-sync comments; the shared-schema export planned
  in ADR 0003 covers this too.
- COCO's vocabulary bounds what this detector can name (no "drone" class);
  the VLM path can still name what COCO cannot.
