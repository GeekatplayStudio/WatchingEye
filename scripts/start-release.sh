#!/usr/bin/env bash
# Start WatchingEye from built release artifacts (macOS / Linux).
# Requires ./scripts/build.sh to have run first. Set BUILD=1 to build now.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD="${BUILD:-0}"
NO_BROWSER="${NO_BROWSER:-0}"

step() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }
ok()   { printf '    \033[32m%s\033[0m\n' "$1"; }
warn() { printf '    \033[33m%s\033[0m\n' "$1"; }

printf '\033[36m  WatchingEye - release mode\033[0m\n'

[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"

if [ "$BUILD" = "1" ]; then
    bash "$ROOT/scripts/build.sh" || exit 1
fi

step "Checking build artifacts"
MISSING=()
check() { if [ -e "$2" ]; then ok "$1 ready"; else MISSING+=("$1"); fi; }
check gateway      "$ROOT/apps/gateway/dist/index.js"
check orchestrator "$ROOT/services/agent-orchestrator/dist/index.js"
check dashboard    "$ROOT/apps/dashboard/.next-prod"
if [ "${#MISSING[@]}" -gt 0 ]; then
    warn "missing: ${MISSING[*]}"
    printf '\n\033[31mRun ./scripts/build.sh first (or re-run with BUILD=1).\033[0m\n'
    exit 1
fi

ENGINE="$ROOT/target/release/vision-engine"
ENGINE_OK=0
if [ -x "$ENGINE" ]; then ENGINE_OK=1; else warn "vision-engine not built - dashboard runs without live tracking"; fi

step "Checking the vision model daemon"
bash "$ROOT/scripts/ensure-ollama.sh"

step "Starting services"
PIDS=()
cleanup() { for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

if [ "$ENGINE_OK" = "1" ]; then
    "$ENGINE" & PIDS+=($!)
    ok "vision-engine :8090"
fi
(cd "$ROOT/services/agent-orchestrator" && npm start) & PIDS+=($!)
ok "orchestrator :8085"
(cd "$ROOT/apps/gateway" && npm start) & PIDS+=($!)
ok "gateway :8080"
# Must match the directory build.sh wrote to, or `next start` looks in
# `.next` and reports a missing production build.
(cd "$ROOT/apps/dashboard" && NEXT_DIST_DIR=.next-prod npm start) & PIDS+=($!)
ok "dashboard :3000"

step "Waiting for the dashboard"
READY=0
for _ in $(seq 1 60); do
    sleep 1
    if curl -fsS -o /dev/null --max-time 2 http://localhost:3000; then READY=1; break; fi
done

if [ "$READY" = "1" ]; then
    ok "dashboard is up"
    if [ "$NO_BROWSER" != "1" ]; then
        if command -v open >/dev/null 2>&1; then open http://localhost:3000
        elif command -v xdg-open >/dev/null 2>&1; then xdg-open http://localhost:3000
        fi
    fi
    printf '\n\033[32mWatchingEye is running (release):\033[0m\n'
    echo "  Dashboard      http://localhost:3000"
    echo "  Console        http://localhost:3000/cameras   <- connect your webcam here"
    echo "  Documentation  http://localhost:3000/docs"
    printf '\nPress Ctrl+C, or run ./scripts/stop.sh, to stop everything.\n'
    wait
else
    warn "dashboard did not respond within 60s"
    exit 1
fi
