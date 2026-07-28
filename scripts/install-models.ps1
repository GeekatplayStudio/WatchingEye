<#
.SYNOPSIS
    Download all AI models for WatchingEye (Windows).
.DESCRIPTION
    Installs Ollama if missing, pulls the vision-language and LLM models,
    downloads the Whisper voice-recognition model, and exports a YOLO ONNX
    detection model (requires Python; skipped with instructions otherwise).
    Models land in the repo-local models/ directory (git-ignored).
    Idempotent; safe to re-run.
.EXAMPLE
    .\scripts\install-models.ps1
#>
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$models = Join-Path $root "models"
New-Item -ItemType Directory -Force -Path $models, "$models\vision", "$models\voice" | Out-Null

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

# --- Ollama (VLM + LLM runtime) ---
Write-Step "Checking Ollama"
$ollama = Get-Command ollama -ErrorAction SilentlyContinue
if ($null -eq $ollama) {
    Write-Host "Installing Ollama via winget..."
    winget install --id Ollama.Ollama -e --accept-source-agreements --accept-package-agreements
    $env:Path = "$env:LOCALAPPDATA\Programs\Ollama;$env:Path"
}
Write-Host "Found $(ollama --version)"

# --- Vision-language + LLM models (served by Ollama) ---
Write-Step "Pulling vision-language model: qwen2.5vl:7b (scene analysis)"
ollama pull qwen2.5vl:7b

Write-Step "Pulling small LLM: llama3.2:3b (structured reasoning)"
ollama pull llama3.2:3b

# --- Voice recognition model (Whisper, GGML format for whisper.cpp/whisper-rs) ---
Write-Step "Downloading Whisper voice model: ggml-base.en.bin"
$whisper = "$models\voice\ggml-base.en.bin"
if (Test-Path $whisper) {
    Write-Host "Already present: $whisper"
} else {
    Invoke-WebRequest -Uri "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin" -OutFile $whisper
    Write-Host "Saved to $whisper"
}

# --- YOLO detection model (ONNX export, needs Python + ultralytics) ---
Write-Step "Exporting YOLO11-nano detection model to ONNX"
$yolo = "$models\vision\yolo11n.onnx"
if (Test-Path $yolo) {
    Write-Host "Already present: $yolo"
} else {
    $python = Get-Command python -ErrorAction SilentlyContinue
    if ($null -eq $python) {
        Write-Host "Python not found - skipping YOLO export." -ForegroundColor Yellow
        Write-Host "Install Python, then run:" -ForegroundColor Yellow
        Write-Host "  pip install ultralytics && yolo export model=yolo11n.pt format=onnx" -ForegroundColor Yellow
        Write-Host "  and move yolo11n.onnx to $yolo" -ForegroundColor Yellow
    } else {
        pip install --quiet ultralytics
        Push-Location $models\vision
        python -c "from ultralytics import YOLO; YOLO('yolo11n.pt').export(format='onnx')"
        Remove-Item -Force yolo11n.pt -ErrorAction SilentlyContinue
        Pop-Location
        Write-Host "Saved to $yolo"
    }
}

Write-Host "`nModel install complete. Inventory:" -ForegroundColor Green
Write-Host "  Ollama:  qwen2.5vl:7b (VLM), llama3.2:3b (LLM)"
Write-Host "  Voice:   models/voice/ggml-base.en.bin (Whisper base.en)"
Write-Host "  Vision:  models/vision/yolo11n.onnx (YOLO11-nano)"
