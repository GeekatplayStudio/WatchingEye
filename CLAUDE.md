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
- Gateway: `cd apps/gateway && npm test`
- Orchestrator: `cd services/agent-orchestrator && npm test`
- Dashboard: `cd apps/dashboard && npm run dev` (proxies /api to :8080)
- Postgres: `docker compose up -d` (pgvector; gateway falls back to memory)

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
- `crates/{events,rules,guardrails,camera,detector,tracker}` — one concern each
- `services/vision-engine` — pipeline wiring (stub backends today)
- `apps/gateway` — Fastify proxy, **no AI logic allowed here**
- `apps/dashboard` — React UI
- `edge/esp32` — firmware skeleton, separate toolchain, **no AI on device**
