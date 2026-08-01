# YOLO detect latency results (ROADMAP 1.3)

Recorded: `2026-08-01T21:49:54Z` (approx.)
Mode: `record`
Hardware: NVIDIA GeForce RTX 3090 (24 GB), Windows 10.0.26200
Model: `yolo11n-onnx` via `onnxruntime-node`
ORT EP env: `auto` (CUDA EP unavailable in this Node package build; CPU/DML path)

| Metric | Value |
|--------|------:|
| samples | 5 |
| p50 | 29 ms |
| p95 | 41 ms |
| budget | 100 ms |
| budget met | **yes** |

Raw samples (ms): 32, 41, 28, 29, 27

Re-run: `WATCHINGEYE_DETECT_LATENCY=record npm run test:detect-latency`
