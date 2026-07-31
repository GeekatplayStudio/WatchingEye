#!/usr/bin/env bash
# One-click start for WatchingEye (macOS / Linux).
# Installs whatever is missing, builds the core, starts every service, and
# opens the dashboard. Safe to re-run.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKIP_MODELS="${SKIP_MODELS:-0}"

step() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }
ok()   { printf '    \033[32m%s\033[0m\n' "$1"; }
warn() { printf '    \033[33m%s\033[0m\n' "$1"; }

cat <<'BANNER'
  WatchingEye
  Deterministic edge vision - every decision explained.
BANNER

[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"

step "Checking prerequisites"
NEED_INSTALL=0
for tool in cargo node; do
    if command -v "$tool" >/dev/null 2>&1; then ok "$tool present"; else warn "$tool not found"; NEED_INSTALL=1; fi
done
if [ "$NEED_INSTALL" = "1" ]; then
    step "Running installer (this happens once)"
    SKIP_MODELS="$SKIP_MODELS" bash "$ROOT/scripts/install.sh"
    [ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
fi

if [ "$SKIP_MODELS" != "1" ] && [ ! -f "$ROOT/models/vision/yolo11n.onnx" ]; then
    step "Downloading AI models (first run only)"
    bash "$ROOT/scripts/install-models.sh"
else
    ok "AI models present (or skipped)"
fi

step "Checking Node dependencies"
for proj in apps/gateway apps/dashboard services/agent-orchestrator; do
    if [ ! -d "$ROOT/$proj/node_modules" ]; then
        warn "installing $proj"
        (cd "$ROOT/$proj" && npm install --no-audit --no-fund)
    else
        ok "$proj ready"
    fi
done

step "Building the vision engine"
ENGINE_OK=1
(cd "$ROOT" && cargo build -p vision-engine --release) || ENGINE_OK=0
if [ "$ENGINE_OK" = "1" ]; then ok "engine built"; else warn "engine build failed - dashboard runs without live tracking"; fi

step "Checking the vision model daemon"
bash "$ROOT/scripts/ensure-ollama.sh"

step "Starting services"
PIDS=()
cleanup() { for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

if [ "$ENGINE_OK" = "1" ]; then
    (cd "$ROOT" && cargo run -p vision-engine --release) & PIDS+=($!)
    ok "vision-engine :8090"
fi
(cd "$ROOT/services/agent-orchestrator" && npm run dev) & PIDS+=($!)
ok "orchestrator :8085"
(cd "$ROOT/apps/gateway" && npm run dev) & PIDS+=($!)
ok "gateway :8080"
(cd "$ROOT/apps/dashboard" && npm run dev) & PIDS+=($!)
ok "dashboard :3000"

step "Waiting for the dashboard"
READY=0
for _ in $(seq 1 60); do
    sleep 1
    if curl -fsS -o /dev/null --max-time 2 http://localhost:3000; then READY=1; break; fi
done

if [ "$READY" = "1" ]; then
    ok "dashboard is up"
    if command -v open >/dev/null 2>&1; then open http://localhost:3000
    elif command -v xdg-open >/dev/null 2>&1; then xdg-open http://localhost:3000
    fi
    printf '\n\033[32mWatchingEye is running:\033[0m\n'
    echo "  Dashboard      http://localhost:3000"
    echo "  Console        http://localhost:3000/cameras   <- connect your webcam here"
    echo "  Documentation  http://localhost:3000/docs"
    printf '\nPress Ctrl+C, or run ./scripts/stop.sh, to stop everything.\n'
    wait
else
    warn "dashboard did not respond within 60s"
    exit 1
fi
