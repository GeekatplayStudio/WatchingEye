# GPU classify latency benchmark (ROADMAP 2.2)

Measures **gate-open → VLM decision** (LangGraph `invoke` only — not
identity, YOLO, or ANPR) against the PRD budget of **&lt; 300 ms**.

Default `npm test` and GitHub Actions **skip** the hard assert so CI never
claims the GPU budget. Enable only on a machine with a vision model loaded
on a GPU (or fast enough local runtime).

## Prerequisites

1. `ollama serve`
2. A known vision model, e.g. `ollama pull llava` or `ollama pull qwen2.5vl:7b`  
   (or set `VLM_MODEL` to an installed tag)
3. Prefer GPU-backed Ollama; CPU-only runs will usually miss the budget

## Run

```bash
# Record p50/p95 without failing the budget (writes docs/gpu-latency-results.*)
WATCHINGEYE_GPU_LATENCY=record npm run test:gpu-latency

# Comparative matrix — every installed tag from KNOWN_VISION_MODELS
WATCHINGEYE_GPU_LATENCY=record WATCHINGEYE_GPU_LATENCY_MODELS=known npm run test:gpu-latency

# Explicit list
WATCHINGEYE_GPU_LATENCY=record WATCHINGEYE_GPU_LATENCY_MODELS=llava,qwen2.5vl:7b npm run test:gpu-latency

# Strict budget gate (fails if any timed model's p95 ≥ 300 ms)
WATCHINGEYE_GPU_LATENCY=1 npm run test:gpu-latency

# Windows PowerShell
$env:WATCHINGEYE_GPU_LATENCY = "record"
$env:WATCHINGEYE_GPU_LATENCY_MODELS = "known"
$env:WATCHINGEYE_GPU_HARDWARE = "NVIDIA GeForce RTX 3090 (24 GB), driver 610.62"
npm run test:gpu-latency
```

Optional env:

| Variable | Default | Meaning |
|----------|---------|---------|
| `WATCHINGEYE_GPU_LATENCY_SAMPLES` | `5` | Timed samples after one warm-up |
| `WATCHINGEYE_OLLAMA_TIMEOUT_MS` | `180000` | Per-request Ollama timeout (load-friendly) |
| `WATCHINGEYE_GPU_LATENCY_MODELS` | `single` | `single` / `known` / `a,b,c` |
| `WATCHINGEYE_GPU_HARDWARE` | unset | Free-text GPU line written into results |
| `VLM_MODEL` | resolved installed vision tag | Override for `single` mode |

Models that fail to load (e.g. unsupported `mllama` arch) are recorded as
**error** rows and skipped; the run still succeeds in `record` mode if at
least one model timed.

## Honesty note

Warm 7B-class VLM classify on RTX 3090-class hardware is typically
**multi-second**, not sub-300 ms. Comparative runs on this machine show
`llava` ≈ 3.9 s p95 vs `qwen2.5vl:7b` ≈ 4.2–5.0 s — still an order of
magnitude over budget. Use `record` to capture evidence; leave the ROADMAP
“proven &lt;300 ms” checkbox open until a genuinely faster VLM path exists.
See the latest `gpu-latency-results.md` after a local run.
