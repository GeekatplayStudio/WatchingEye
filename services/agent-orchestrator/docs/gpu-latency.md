# GPU classify latency benchmark (ROADMAP 2.2)

Measures **gate-open → VLM decision** (LangGraph `invoke` only — not
identity, YOLO, or ANPR) against the PRD budget of **&lt; 300 ms**.

Default `npm test` and GitHub Actions **skip** the hard assert so CI never
claims the GPU budget. Enable only on a machine with a vision model loaded
on a GPU (or fast enough local runtime).

## Prerequisites

1. `ollama serve`
2. A known vision model, e.g. `ollama pull qwen2.5vl:7b`  
   (or set `VLM_MODEL` to an installed tag)
3. Prefer GPU-backed Ollama; CPU-only runs will usually miss the budget

## Run

```bash
# Record p50/p95 without failing the budget (writes docs/gpu-latency-results.*)
WATCHINGEYE_GPU_LATENCY=record npm run test:gpu-latency

# Strict budget gate (fails if p95 ≥ 300 ms)
WATCHINGEYE_GPU_LATENCY=1 npm run test:gpu-latency

# Windows PowerShell
$env:WATCHINGEYE_GPU_LATENCY = "record"
npm run test:gpu-latency
```

Optional env:

| Variable | Default | Meaning |
|----------|---------|---------|
| `WATCHINGEYE_GPU_LATENCY_SAMPLES` | `5` | Timed samples after one warm-up |
| `WATCHINGEYE_OLLAMA_TIMEOUT_MS` | `180000` | Per-request Ollama timeout (load-friendly) |
| `VLM_MODEL` | resolved installed vision tag | Override model |

The suite warms once, times N classifies on `fixtures/golden-scene.png`,
writes `docs/gpu-latency-results.json` + `.md`, and (mode `1` only) fails
if p95 ≥ 300 ms.

## Honesty note

A warm `qwen2.5vl:7b` classify on RTX 3090-class hardware is typically
**multi-second**, not sub-300 ms. Use `record` to capture evidence; leave
the ROADMAP “proven &lt;300 ms” checkbox open until a faster VLM path exists.
See the latest `gpu-latency-results.md` after a local run.
