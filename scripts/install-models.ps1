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
Write-Step "Pulling vision-language model: llava (faster default; pin VLM_MODEL=qwen2.5vl:7b for quality)"
ollama pull llava

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

# --- YAMNet audio events (optional; stub detector works without it) ---
Write-Step "Downloading YAMNet audio-event model (ONNX, optional)"
$yamnet = "$models\voice\yamnet.onnx"
if (Test-Path $yamnet) {
    Write-Host "Already present: $yamnet"
} else {
    try {
        Invoke-WebRequest -Uri "https://huggingface.co/jafet21/yamnetonnx/resolve/main/yamnet.onnx" -OutFile $yamnet
        if (Test-Path $yamnet) {
            Write-Host "Saved to $yamnet"
        } else {
            Write-Host "YAMNet download failed — audio events stay on stub." -ForegroundColor Yellow
        }
    } catch {
        Write-Host "YAMNet download failed — audio events stay on stub." -ForegroundColor Yellow
        Remove-Item -Force $yamnet -ErrorAction SilentlyContinue
    }
}

# --- openWakeWord (optional; wake gate stays on stub without it) ---
Write-Step "Downloading openWakeWord ONNX assets (optional)"
$oww = "$models\voice\openwakeword"
New-Item -ItemType Directory -Force -Path $oww | Out-Null
$owwBase = "https://github.com/dscripka/openWakeWord/releases/download/v0.5.1"
$owwOk = $true
foreach ($f in @("melspectrogram.onnx", "embedding_model.onnx", "hey_jarvis_v0.1.onnx")) {
    $dest = Join-Path $oww $f
    if (Test-Path $dest) {
        Write-Host "Already present: $dest"
    } else {
        try {
            Invoke-WebRequest -Uri "$owwBase/$f" -OutFile $dest
            Write-Host "Saved to $dest"
        } catch {
            Write-Host "Failed $f — wake engine stays on stub." -ForegroundColor Yellow
            Remove-Item -Force $dest -ErrorAction SilentlyContinue
            $owwOk = $false
        }
    }
}
if ($owwOk) {
    Write-Host "openWakeWord ready (keyword hey_jarvis; not mapped to watchingeye)"
}

# --- Piper TTS voice (optional; stub beep works without it / without piper binary) ---
Write-Step "Downloading Piper TTS voice: en_US-lessac-medium (optional)"
$piperOnnx = "$models\voice\en_US-lessac-medium.onnx"
$piperJson = "$piperOnnx.json"
$piperBase = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium"
if ((Test-Path $piperOnnx) -and (Test-Path $piperJson)) {
    Write-Host "Already present: Piper en_US-lessac-medium"
} else {
    try {
        if (-not (Test-Path $piperOnnx)) {
            Invoke-WebRequest -Uri "$piperBase/en_US-lessac-medium.onnx" -OutFile $piperOnnx
        }
        if (-not (Test-Path $piperJson)) {
            Invoke-WebRequest -Uri "$piperBase/en_US-lessac-medium.onnx.json" -OutFile $piperJson
        }
        if ((Test-Path $piperOnnx) -and (Test-Path $piperJson)) {
            Write-Host "Saved Piper voice (+ config). Needs piper CLI on PATH for live TTS."
        } else {
            Write-Host "Piper download incomplete — TTS stays on stub." -ForegroundColor Yellow
        }
    } catch {
        Write-Host "Piper download failed — TTS stays on stub." -ForegroundColor Yellow
        Remove-Item -Force $piperOnnx, $piperJson -ErrorAction SilentlyContinue
    }
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

# --- DINOv2 appearance embedding (ONNX, for hybrid ReID) ---
Write-Step "Downloading DINOv2-small appearance model (ONNX)"
$dino = "$models\vision\dinov2_vits14.onnx"
if (Test-Path $dino) {
    Write-Host "Already present: $dino"
} else {
    $python = Get-Command python -ErrorAction SilentlyContinue
    if ($null -eq $python) {
        Write-Host "Python not found - skipping DINOv2 export." -ForegroundColor Yellow
        Write-Host "Install Python, then run: python scripts/export-dinov2.py" -ForegroundColor Yellow
    } else {
        pip install --quiet torch torchvision transformers onnx
        python "$root\scripts\export-dinov2.py" --out $dino
        if (Test-Path $dino) {
            Write-Host "Saved to $dino"
        } else {
            Write-Host "DINOv2 export failed — appearance ReID stays unavailable." -ForegroundColor Yellow
        }
    }
}

# --- CLIP open-vocab (optional; HSV colour scoring works without it) ---
Write-Step "Exporting CLIP ViT-B/32 open-vocab assets (optional)"
$clipOnnx = "$models\vision\clip_vit_b32_vision.onnx"
$clipText = "$models\vision\open_vocab_text_embeds.json"
if ((Test-Path $clipOnnx) -and (Test-Path $clipText)) {
    Write-Host "Already present: CLIP open-vocab assets"
} else {
    $python = Get-Command python -ErrorAction SilentlyContinue
    if ($null -eq $python) {
        Write-Host "Python not found - skipping CLIP export (HSV open-vocab still works)." -ForegroundColor Yellow
    } else {
        pip install --quiet torch transformers onnx
        python "$root\scripts\export-open-vocab-clip.py"
        if ((Test-Path $clipOnnx) -and (Test-Path $clipText)) {
            Write-Host "Saved CLIP open-vocab assets"
        } else {
            Write-Host "CLIP export failed — breed zero-shot stays on stub/HSV." -ForegroundColor Yellow
        }
    }
}

Write-Host "`nModel install complete. Inventory:" -ForegroundColor Green
Write-Host "  Ollama:  llava (VLM), llama3.2:3b (LLM)"
Write-Host "  Voice:   models/voice/ggml-base.en.bin (Whisper base.en)"
Write-Host "  TTS:     models/voice/en_US-lessac-medium.onnx (+ .json; needs piper CLI)"
Write-Host "  AudioEvt: models/voice/yamnet.onnx (YAMNet, optional; stub without it)"
Write-Host "  Wake:    models/voice/openwakeword/* (openWakeWord, optional; stub without it)"
Write-Host "  Vision:  models/vision/yolo11n.onnx (YOLO11-nano)"
Write-Host "  ReID:    models/vision/dinov2_vits14.onnx (DINOv2-small appearance)"
Write-Host "  OpenVocab: models/vision/clip_vit_b32_vision.onnx (+ text embeds, optional)"
Write-Host "  CLIP text: scripts/clip-text-embed.py (transformers; optional for NL CLIP recall)"
