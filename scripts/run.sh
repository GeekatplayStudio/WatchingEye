#!/usr/bin/env bash
# Run WatchingEye components (Linux/macOS).
#
# Usage:
#   ./scripts/run.sh              # start engine + gateway + dashboard (background, logs to /tmp)
#   ./scripts/run.sh engine       # one component, foreground
#   ./scripts/run.sh gateway
#   ./scripts/run.sh dashboard
#   ./scripts/run.sh test         # full test suite
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPONENT="${1:-all}"

case "$COMPONENT" in
    engine)
        cd "$ROOT" && exec cargo run -p vision-engine
        ;;
    gateway)
        cd "$ROOT/apps/gateway" && exec npm run dev
        ;;
    dashboard)
        cd "$ROOT/apps/dashboard" && exec npm run dev
        ;;
    test)
        cd "$ROOT"
        cargo test --workspace
        cargo clippy --workspace --all-targets -- -D warnings
        cd "$ROOT/apps/gateway" && npm test
        ;;
    all)
        echo "Starting vision engine, gateway (:8080), dashboard (:5173)..."
        (cd "$ROOT" && cargo run -p vision-engine) &
        (cd "$ROOT/apps/gateway" && npm run dev) &
        (cd "$ROOT/apps/dashboard" && npm run dev) &
        echo "Dashboard: http://localhost:5173 | Gateway health: http://localhost:8080/health"
        echo "Press Ctrl+C to stop all."
        wait
        ;;
    *)
        echo "Unknown component '$COMPONENT'. Use: all | engine | gateway | dashboard | test" >&2
        exit 1
        ;;
esac
