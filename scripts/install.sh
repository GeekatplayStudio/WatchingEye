#!/usr/bin/env bash
# Set up a development machine for WatchingEye (macOS / Linux / Raspberry Pi).
# On macOS, missing tools are installed via Homebrew. Idempotent; safe to re-run.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OS="$(uname -s)"

step() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }

if [ "$OS" = "Darwin" ] && ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew not found. Install it first: https://brew.sh" >&2
    echo '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"' >&2
    exit 1
fi

step "Checking Rust toolchain"
if ! command -v cargo >/dev/null 2>&1; then
    echo "Installing rustup..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    # shellcheck disable=SC1091
    source "$HOME/.cargo/env"
else
    echo "Found $(cargo --version)"
fi
rustup component add clippy rustfmt

step "Checking Node.js"
if ! command -v node >/dev/null 2>&1; then
    if [ "$OS" = "Darwin" ]; then
        echo "Installing Node.js via Homebrew..."
        brew install node@22
        brew link --overwrite node@22
    else
        echo "Node.js >= 20 required. Install via your package manager or https://nodejs.org" >&2
        exit 1
    fi
fi
echo "Found Node $(node --version)"

step "Installing gateway dependencies"
(cd "$ROOT/apps/gateway" && npm install --no-audit --no-fund)

step "Installing dashboard dependencies"
(cd "$ROOT/apps/dashboard" && npm install --no-audit --no-fund)

# --- AI models (Ollama VLM/LLM, Whisper voice, YOLO ONNX) ---
if [ "${SKIP_MODELS:-0}" = "1" ]; then
    step "Skipping AI model install (SKIP_MODELS=1)"
else
    step "Installing AI models (vision + voice)"
    bash "$ROOT/scripts/install-models.sh"
fi

step "Building Rust workspace"
(cd "$ROOT" && cargo build --workspace)

step "Running Rust tests"
(cd "$ROOT" && cargo test --workspace)

step "Running gateway tests"
(cd "$ROOT/apps/gateway" && npm test)

printf '\n\033[32mInstall complete. Start everything with: ./scripts/run.sh\033[0m\n'
