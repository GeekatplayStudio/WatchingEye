# GPU classify latency benchmark (ROADMAP 2.2)

Measures **gate-open → VLM decision** (LangGraph `invoke` only — not
identity, YOLO, or ANPR) against the PRD budget of **&lt; 300 ms**.

Default `npm test` and GitHub Actions **skip** the hard assert so CI never
claims the GPU budget. Enable the gate only on a machine with a vision model
loaded on a GPU (or fast enough local runtime).

## Prerequisites

1. `ollama serve`
2. A known vision model, e.g. `ollama pull qwen2.5vl:7b`  
   (or set `VLM_MODEL` to an installed tag)
3. Prefer GPU-backed Ollama; CPU-only runs will usually miss the budget

## Run

```bash
# Linux / macOS
WATCHINGEYE_GPU_LATENCY=1 npm run test:gpu-latency

# Windows PowerShell
$env:WATCHINGEYE_GPU_LATENCY = "1"
npm run test:gpu-latency
```

The suite warms the model once, then times a second classify on
`fixtures/golden-scene.png` and fails if elapsed ≥ 300 ms.
