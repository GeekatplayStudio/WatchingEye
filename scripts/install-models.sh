#!/usr/bin/env bash
# Download all AI models for WatchingEye (macOS / Linux / Raspberry Pi).
# Installs Ollama if missing, pulls VLM + LLM models, downloads the Whisper
# voice-recognition model, and exports a YOLO ONNX detection model.
# Models land in the repo-local models/ directory (git-ignored). Idempotent.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODELS="$ROOT/models"
OS="$(uname -s)"
mkdir -p "$MODELS/vision" "$MODELS/voice"

step() { printf '\n\033[36m==> %s\033[0m\n' "$1"; }

# --- Ollama (VLM + LLM runtime) ---
step "Checking Ollama"
if ! command -v ollama >/dev/null 2>&1; then
    if [ "$OS" = "Darwin" ]; then
        echo "Installing Ollama via Homebrew..."
        brew install ollama
    else
        echo "Installing Ollama via official script..."
        curl -fsSL https://ollama.com/install.sh | sh
    fi
fi
echo "Found $(ollama --version)"

# Make sure the Ollama server is up (brew installs don't autostart).
if ! ollama list >/dev/null 2>&1; then
    step "Starting Ollama server"
    (ollama serve >/dev/null 2>&1 &)
    sleep 3
fi

# --- Vision-language + LLM models ---
step "Pulling vision-language model: qwen2.5vl:7b (scene analysis)"
ollama pull qwen2.5vl:7b

step "Pulling small LLM: llama3.2:3b (structured reasoning)"
ollama pull llama3.2:3b

# --- Voice recognition model (Whisper GGML for whisper.cpp/whisper-rs) ---
step "Downloading Whisper voice model: ggml-base.en.bin"
WHISPER="$MODELS/voice/ggml-base.en.bin"
if [ -f "$WHISPER" ]; then
    echo "Already present: $WHISPER"
else
    curl -L -o "$WHISPER" \
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"
    echo "Saved to $WHISPER"
fi

# --- YOLO detection model (ONNX export, needs Python + ultralytics) ---
step "Exporting YOLO11-nano detection model to ONNX"
YOLO="$MODELS/vision/yolo11n.onnx"
if [ -f "$YOLO" ]; then
    echo "Already present: $YOLO"
elif command -v python3 >/dev/null 2>&1; then
    python3 -m pip install --quiet ultralytics
    (cd "$MODELS/vision" && python3 -c "from ultralytics import YOLO; YOLO('yolo11n.pt').export(format='onnx')" && rm -f yolo11n.pt)
    echo "Saved to $YOLO"
else
    echo "Python3 not found - skipping YOLO export."
    echo "Install Python3, then: pip install ultralytics && yolo export model=yolo11n.pt format=onnx"
    echo "and move yolo11n.onnx to $YOLO"
fi

# --- DINOv2 appearance embedding (ONNX, for hybrid ReID) ---
step "Exporting DINOv2-small appearance model to ONNX"
DINO="$MODELS/vision/dinov2_vits14.onnx"
if [ -f "$DINO" ]; then
    echo "Already present: $DINO"
elif command -v python3 >/dev/null 2>&1; then
    python3 -m pip install --quiet torch torchvision transformers onnx
    python3 "$ROOT/scripts/export-dinov2.py" --out "$DINO"
    if [ -f "$DINO" ]; then
        echo "Saved to $DINO"
    else
        echo "DINOv2 export failed — appearance ReID stays unavailable."
    fi
else
    echo "Python3 not found - skipping DINOv2 export."
    echo "Install Python3, then: python3 scripts/export-dinov2.py"
fi

printf '\n\033[32mModel install complete. Inventory:\033[0m\n'
echo "  Ollama:  qwen2.5vl:7b (VLM), llama3.2:3b (LLM)"
echo "  Voice:   models/voice/ggml-base.en.bin (Whisper base.en)"
echo "  Vision:  models/vision/yolo11n.onnx (YOLO11-nano)"
echo "  ReID:    models/vision/dinov2_vits14.onnx (DINOv2-small appearance)"
