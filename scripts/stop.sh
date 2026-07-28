#!/usr/bin/env bash
# Stop every WatchingEye service (macOS / Linux).
#
# Only processes listening on WatchingEye's ports are stopped, so unrelated
# work on this machine is left alone.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

step() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }
ok()   { printf '    \033[32m%s\033[0m\n' "$1"; }

PORTS=(3000 8080 8085 8090 8091 8092 8093 8094 8095 8096 8097 8098 8099)
STOPPED=0

step "Stopping services on ports: 3000, 8080, 8085, 8090-8099"
for port in "${PORTS[@]}"; do
    # lsof is present on macOS and most Linux installs; fall back to fuser.
    if command -v lsof >/dev/null 2>&1; then
        pids=$(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null || true)
    else
        pids=$(fuser "$port/tcp" 2>/dev/null || true)
    fi
    for pid in $pids; do
        name=$(ps -p "$pid" -o comm= 2>/dev/null || echo "process")
        if kill "$pid" 2>/dev/null; then
            ok "stopped $name (PID $pid) on port $port"
            STOPPED=$((STOPPED + 1))
        fi
    done
done

# Give them a moment to exit cleanly, then insist.
sleep 1
for port in "${PORTS[@]}"; do
    if command -v lsof >/dev/null 2>&1; then
        for pid in $(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null || true); do
            kill -9 "$pid" 2>/dev/null && ok "force-stopped PID $pid on port $port"
        done
    fi
done

step "Checking for an engine that had not yet bound a port"
pkill -f "vision-engine" 2>/dev/null && ok "stopped vision-engine" || true

if [ -f "$ROOT/.runtime/engine.port" ]; then
    rm -f "$ROOT/.runtime/engine.port"
    printf '    \033[90mcleared .runtime/engine.port\033[0m\n'
fi

if [ "$STOPPED" -eq 0 ]; then
    printf '\n\033[90mNothing was running.\033[0m\n'
else
    printf '\n\033[32mStopped %s process(es).\033[0m\n' "$STOPPED"
fi
