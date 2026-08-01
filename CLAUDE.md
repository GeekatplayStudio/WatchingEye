# WatchingEye — Agent Guide

Deterministic edge-vision platform. Rust core, Node gateway, React dashboard.
Full requirements: [docs/PRD.md](docs/PRD.md). Architecture:
[docs/architecture/overview.md](docs/architecture/overview.md).

## Hard rules (from the PRD — do not relax)

- **Never trust an LLM.** Model output enters the system only through
  `guardrails::validate`. No exceptions, no direct execution.
- **Zero black box.** Every decision carries `schemas::Provenance` (model +
  prompt versions, inputs, timestamp) and enumerated `Evidence`.
- **Deterministic orchestration.** No LLM-driven routing, no cycles, no
  autonomous loops. The Super Agent runs only when `tracker::TriggerGate`
  opens.
- Max 500 lines per file (prefer ≤ 250); functions ≤ ~75 lines.
- No `unwrap()`/`expect()` in production paths (tests are fine) — enforced
  by workspace clippy lints.
- Every public item gets rustdoc/JSDoc with an example; new code ships with
  tests.

## Development agents

Project subagents live in `.claude/agents/`. Delegate to them by name:

| Agent | Use for |
|-------|---------|
| `rust-core` | Any Rust feature/refactor in `crates/` or `services/vision-engine` |
| `guardrail-auditor` | Read-only audit that no model output escapes validation |
| `test-coverage` | Finding untested code and writing the missing tests |
| `dashboard-ui` | Next.js dashboard work (verifies in a real browser) |

## Commands

- Rust: `cargo test --workspace`, `cargo clippy --workspace --all-targets -- -D warnings`,
  `cargo fmt --all`
- Pi cross-compile (also CI `edge-node-pi`):  
  `cargo build -p edge-node --profile edge --target aarch64-unknown-linux-gnu`
- Rust perf bench: `cargo run -p motion --example bench --release`
- Gateway: `cd apps/gateway && npm test`
- Orchestrator: `cd services/agent-orchestrator && npm test`
- Dashboard: `cd apps/dashboard && npm run dev` (proxies /api to :8080, /engine to :8090)
- Postgres: `docker compose up -d` (pgvector; gateway falls back to memory)
- Start/stop everything: `Start-WatchingEye.bat` / `Stop-WatchingEye.bat`
  (or `./start.sh` / `./scripts/stop.sh`) — prefer these over manual
  `cargo run` in a fresh terminal; they set up PATH and avoid port collisions

### Windows toolchain note

Rust needs a linker. Either install MSVC C++ Build Tools (what
`scripts/install.ps1` does), or use the GNU toolchain — this machine is set
up the second way:

```
rustup default stable-x86_64-pc-windows-gnu
$env:Path = "$env:USERPROFILE\.cargo\bin;C:\Users\$env:USERNAME\AppData\Local\Microsoft\WinGet\Packages\BrechtSanders.WinLibs.POSIX.UCRT_Microsoft.Winget.Source_8wekyb3d8bbwe\mingw64\bin;$env:Path"
```

Test modules carry `#![allow(clippy::unwrap_used, clippy::expect_used,
clippy::float_cmp)]` — production code stays strict, tests stay readable.

## Layout

- `crates/schemas` — root types; everything depends on it, it depends on nothing internal
- `crates/{events,rules,guardrails,camera,motion,tracker,identity,actuator,spatial,detector}` — one concern each
- `services/vision-engine` — desktop pipeline (axum): motion, tracking, aim, identity registry
- `services/edge-node` — same deterministic chain, sized for Pi-class devices (tiny_http, 309 KB, no async runtime)
- `services/agent-orchestrator` — LangGraph Super Agent (TS): VLM classification,
  YOLO detection + DINOv2 appearance embed via onnxruntime-node, zod guardrails
- `apps/gateway` — Fastify proxy, **no AI logic allowed here**
- `apps/dashboard` — Next.js UI (Console + Identities + Discover)
- `edge/esp32` — firmware skeleton, separate toolchain, **no AI on device**
  (capture/stream only). Lab board: **Freenove ESP32-S3 CAM (FNK0085, 16 MB)** —
  docs in `docs/hardware/`, board profile in `edge/esp32/boards/`; encode after
  hardware arrives (see ROADMAP 3.1)

Real-code status: the pipeline is live (not stub) — background-model motion
detection, IoU tracking, servo aim with failsafe, hybrid identity (VLM
attributes ⊕ DINOv2 cosine, dual-bank memory, Hungarian batch, multi-cam
timeline), and YOLO11 object labelling all run today. See
`docs/architecture/overview.md` for the current data flow and ADR 0004 for
why YOLO/DINOv2 inference lives in the Node orchestrator rather than Rust.
