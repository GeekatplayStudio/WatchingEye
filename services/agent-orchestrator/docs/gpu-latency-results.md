# GPU classify latency results (ROADMAP 2.2)

Recorded: `2026-08-01T21:42:17.848Z`
Mode: `record`
Hardware: NVIDIA GeForce RTX 3090 (24 GB), driver 610.62
Model: `qwen2.5vl:7b`

| Metric | Value |
|--------|------:|
| samples | 3 |
| p50 | 4578 ms |
| p95 | 4625 ms |
| budget | 300 ms |
| budget met | **no** |

Raw samples (ms): 4578, 4552, 4625

p95 over budget on this hardware/model. `qwen2.5vl:7b` typically needs
multiple seconds per warm classify even on RTX 3090-class GPUs. Keep the
proven-&lt;300 ms ROADMAP checkbox open until a faster VLM path exists.

Re-run: `WATCHINGEYE_GPU_LATENCY=record npm run test:gpu-latency`
