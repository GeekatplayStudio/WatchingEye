#!/usr/bin/env bash
# Make sure the ollama daemon is up and a vision model is installed.
#
# Classification refuses every event when the daemon is down or the model is
# not pulled, and both look identical from the dashboard. This checks each
# and reports the exact fix. Set PULL=1 to download a model if none exists
# (several GB — never done without asking).
set -uo pipefail

ok()   { printf '    \033[32m%s\033[0m\n' "$1"; }
warn() { printf '    \033[33m%s\033[0m\n' "$1"; }

# Kept in step with KNOWN_VISION_MODELS in
# services/agent-orchestrator/src/vlm-model.ts — same order, same names.
PREFERRED=("llava" "qwen2.5vl:7b" "gemma3:4b" "llama3.2-vision")
PULL="${PULL:-0}"

# A cold daemon can take a couple of seconds to answer its first request.
up() { curl -fsS -o /dev/null --max-time "${1:-10}" http://localhost:11434/api/tags; }

if ! command -v ollama >/dev/null 2>&1; then
    warn "ollama not installed - tracking works, classification will be refused"
    warn "install from https://ollama.com/download, then: ollama pull ${PREFERRED[0]}"
    exit 0
fi

if up 10; then
    ok "ollama daemon already running"
else
    warn "ollama installed but not running - starting it"
    (ollama serve >/dev/null 2>&1 &)
    STARTED=0
    for _ in $(seq 1 15); do
        sleep 1
        if up 3; then STARTED=1; break; fi
    done
    if [ "$STARTED" = "1" ]; then
        ok "ollama daemon started"
    else
        warn "ollama did not come up - classification will be refused"
        exit 0
    fi
fi

# A running daemon with no vision model refuses just as completely.
TAGS="$(curl -fsS --max-time 5 http://localhost:11434/api/tags 2>/dev/null || echo '')"
strip() { echo "${1%:latest}"; }

FOUND=""
for want in "${PREFERRED[@]}"; do
    # Match the bare name so an implicit :latest tag still counts.
    if echo "$TAGS" | grep -q "\"$(strip "$want")"; then FOUND="$want"; break; fi
done

if [ -n "$FOUND" ]; then
    ok "vision model installed: $FOUND"
    [ -n "${VLM_MODEL:-}" ] && ok "VLM_MODEL pins: $VLM_MODEL"
elif [ "$PULL" = "1" ]; then
    warn "no vision model installed - pulling ${PREFERRED[1]} (several GB)"
    if ollama pull "${PREFERRED[1]}"; then ok "pulled ${PREFERRED[1]}"; else warn "pull failed"; fi
else
    warn "no vision model installed - classification will be refused"
    warn "fix with: ollama pull ${PREFERRED[1]}   (or re-run with PULL=1)"
fi
