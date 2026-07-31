<#
.SYNOPSIS
    Make sure the ollama daemon is up and a vision model is installed.
.DESCRIPTION
    Classification refuses every event when the daemon is not running or the
    configured model is not pulled — and both failures look identical from
    the dashboard. This checks each one and reports the exact fix.

    Starts the daemon if it is installed but not listening. Never downloads
    a model without asking: a pull is multiple gigabytes.
.PARAMETER Pull
    Download the preferred vision model if none is installed.
.EXAMPLE
    .\scripts\ensure-ollama.ps1
    .\scripts\ensure-ollama.ps1 -Pull
#>
param(
    [switch]$Pull
)

function Write-Ok($msg) { Write-Host "    $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "    $msg" -ForegroundColor Yellow }

# Kept in step with KNOWN_VISION_MODELS in
# services/agent-orchestrator/src/vlm-model.ts — same order, same names.
$preferred = @("qwen2.5vl:7b", "gemma3:4b", "llama3.2-vision", "llava")

$ollamaBin = Join-Path $env:LOCALAPPDATA "Programs\Ollama"
if (Test-Path $ollamaBin) { $env:Path = "$ollamaBin;$env:Path" }
$exe = Get-Command ollama -ErrorAction SilentlyContinue

# A cold daemon can take a couple of seconds to answer its first request.
# Too tight a timeout here reads as "not running" and starts a second copy.
function Test-OllamaUp {
    param([int]$TimeoutSec = 10)
    try {
        $null = Invoke-WebRequest -Uri "http://localhost:11434/api/tags" -UseBasicParsing -TimeoutSec $TimeoutSec
        return $true
    } catch { return $false }
}

if ($null -eq $exe) {
    Write-Warn2 "ollama not installed - tracking works, classification will be refused"
    Write-Warn2 "install from https://ollama.com/download, then: ollama pull $($preferred[1])"
    exit 0
}

if (Test-OllamaUp) {
    Write-Ok "ollama daemon already running"
} else {
    Write-Warn2 "ollama installed but not running - starting it"
    Start-Process -FilePath $exe.Source -ArgumentList "serve" -WindowStyle Hidden
    $up = $false
    foreach ($i in 1..15) {
        Start-Sleep -Seconds 1
        if (Test-OllamaUp -TimeoutSec 3) { $up = $true; break }
    }
    if ($up) { Write-Ok "ollama daemon started" }
    else {
        Write-Warn2 "ollama did not come up - classification will be refused"
        exit 0
    }
}

# A running daemon with no vision model refuses just as completely.
$installed = @()
try {
    $tags = (Invoke-WebRequest -Uri "http://localhost:11434/api/tags" -UseBasicParsing -TimeoutSec 5).Content | ConvertFrom-Json
    $installed = @($tags.models | ForEach-Object { $_.name })
} catch { }

$strip = { param($n) if ($n -like "*:latest") { $n.Substring(0, $n.Length - 7) } else { $n } }
$found = $null
foreach ($want in $preferred) {
    foreach ($have in $installed) {
        if ((& $strip $have) -eq (& $strip $want)) { $found = $have; break }
    }
    if ($null -ne $found) { break }
}

if ($null -ne $found) {
    Write-Ok "vision model installed: $found"
    if ($env:VLM_MODEL) { Write-Ok "VLM_MODEL pins: $env:VLM_MODEL" }
} elseif ($Pull) {
    Write-Warn2 "no vision model installed - pulling $($preferred[1]) (several GB)"
    & $exe.Source pull $preferred[1]
    if ($LASTEXITCODE -eq 0) { Write-Ok "pulled $($preferred[1])" } else { Write-Warn2 "pull failed" }
} else {
    Write-Warn2 "no vision model installed - classification will be refused"
    Write-Warn2 "fix with: ollama pull $($preferred[1])   (or re-run with -Pull)"
}
