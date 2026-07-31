#!/usr/bin/env bash
# Build every WatchingEye component for release (macOS / Linux).
# Produces: target/release/vision-engine, apps/gateway/dist,
# services/agent-orchestrator/dist, apps/dashboard/.next
# Flags: SKIP_RUST=1 or SKIP_NODE=1 to build only one half.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKIP_RUST="${SKIP_RUST:-0}"
SKIP_NODE="${SKIP_NODE:-0}"

step() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }
ok()   { printf '    \033[32m%s\033[0m\n' "$1"; }
warn() { printf '    \033[33m%s\033[0m\n' "$1"; }
fail() { printf '    \033[31m%s\033[0m\n' "$1"; }

printf '\033[36m  WatchingEye - release build\033[0m\n'

[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"

FAILED=()

if [ "$SKIP_RUST" != "1" ]; then
    step "Building the Rust workspace (release)"
    if (cd "$ROOT" && cargo build --workspace --release); then
        ok "vision-engine + crates built"
    else
        FAILED+=("rust workspace")
    fi
fi

if [ "$SKIP_NODE" != "1" ]; then
    step "Installing Node dependencies"
    for proj in apps/gateway apps/dashboard services/agent-orchestrator; do
        if [ ! -d "$ROOT/$proj/node_modules" ]; then
            warn "installing $proj"
            (cd "$ROOT/$proj" && npm install --no-audit --no-fund) || FAILED+=("$proj (npm install)")
        else
            ok "$proj ready"
        fi
    done

    # The dashboard builds into .next-prod, never .next: overwriting the dev
    # server's build directory while it is running breaks it with a
    # "Cannot find module './NNN.js'" that looks like corruption.
    export NEXT_DIST_DIR=".next-prod"
    for proj in services/agent-orchestrator apps/gateway apps/dashboard; do
        step "Building $proj"
        if (cd "$ROOT/$proj" && npm run build); then
            ok "$proj built"
        else
            FAILED+=("$proj")
        fi
    done
fi

if [ "${#FAILED[@]}" -gt 0 ]; then
    printf '\n\033[31mBuild failed:\033[0m\n'
    for f in "${FAILED[@]}"; do fail "- $f"; done
    exit 1
fi

printf '\n\033[32mBuild complete.\033[0m\n'
echo "  engine        target/release/vision-engine"
echo "  gateway       apps/gateway/dist"
echo "  orchestrator  services/agent-orchestrator/dist"
echo "  dashboard     apps/dashboard/.next-prod"
printf '\nRun it with: ./scripts/start-release.sh\n'
