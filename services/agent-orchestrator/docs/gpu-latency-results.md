# GPU classify latency results (ROADMAP 2.2)

Recorded: `2026-08-01T22:16:36.897Z`
Mode: `record`
Hardware: NVIDIA GeForce RTX 3090 (24 GB), driver 610.62

Budget: **300 ms** (p95)

| Model | samples | p50 (ms) | p95 (ms) | budget met |
|-------|--------:|---------:|---------:|:----------:|
| `gemma3:4b` | 3 | 5453 | 5638 | **no** |
| `llava:latest` | 3 | 3876 | 3967 | **no** |
| `qwen2.5vl:7b` | 3 | 4169 | 4378 | **no** |

Raw samples (ms):
- `gemma3:4b`: 5378, 5453, 5638
- `llava:latest`: 3967, 3876, 3866
- `qwen2.5vl:7b`: 4169, 4378, 4121

No model in this run met p95 &lt; 300 ms. Fastest warm p95 was `llava:latest` at 3967 ms. Keep the proven-&lt;300ms checkbox open until a faster VLM path exists. Fixture is 1×1 PNG — cost is model/runtime, not pixels.
