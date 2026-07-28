<#
.SYNOPSIS
    Set up a development machine for WatchingEye (Windows).
.DESCRIPTION
    Installs Rust via rustup (winget) if missing, installs Node dependencies
    for the gateway and dashboard, and checks for optional tools (Ollama).
    Safe to re-run; every step is idempotent.
.PARAMETER SkipModels
    Skip downloading AI models (vision/voice); toolchain only.
.EXAMPLE
    .\scripts\install.ps1
    .\scripts\install.ps1 -SkipModels
#>
param([switch]$SkipModels)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Assert-LastExit($operation) {
    if ($LASTEXITCODE -ne 0) {
        throw "$operation failed with exit code $LASTEXITCODE."
    }
}

# Rust's default Windows target uses the Microsoft C++ linker. Visual Studio
# Build Tools installs it, but normal PowerShell sessions do not load its PATH.
function Initialize-MsvcEnvironment {
    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (-not (Test-Path -LiteralPath $vswhere)) { return $false }

    $installPath = & $vswhere -latest -products * `
        -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
        -property installationPath
    if (-not $installPath) { return $false }

    $devCmd = Join-Path $installPath "Common7\Tools\VsDevCmd.bat"
    if (-not (Test-Path -LiteralPath $devCmd)) { return $false }

    cmd.exe /s /c "`"$devCmd`" -no_logo -arch=x64 -host_arch=x64 && set" | ForEach-Object {
        $name, $value = $_ -split "=", 2
        if ($name -and $null -ne $value) {
            Set-Item -Path "Env:$name" -Value $value
        }
    }
    return $null -ne (Get-Command link.exe -ErrorAction SilentlyContinue)
}

# --- Native Windows build tools ---
Write-Step "Checking MSVC C++ build tools"
if (-not (Initialize-MsvcEnvironment)) {
    Write-Host "MSVC C++ build tools not found. Installing via winget..."
    winget install --id Microsoft.VisualStudio.2022.BuildTools -e `
        --source winget `
        --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended" `
        --accept-source-agreements --accept-package-agreements
    Assert-LastExit "Visual Studio Build Tools installation"
    if (-not (Initialize-MsvcEnvironment)) {
        throw "MSVC installation completed, but link.exe is unavailable. Restart PowerShell and rerun this script."
    }
} else {
    Write-Host "Found $((Get-Command link.exe).Source)"
}

# --- Rust ---
Write-Step "Checking Rust toolchain"
if (Test-Path -LiteralPath "$env:USERPROFILE\.cargo\bin") {
    $env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
}
$cargo = Get-Command cargo -ErrorAction SilentlyContinue
if ($null -eq $cargo) {
    Write-Host "Rust not found. Installing rustup via winget..."
    winget install --id Rustlang.Rustup -e --accept-source-agreements --accept-package-agreements
    $env:Path = "$env:USERPROFILE\.cargo\bin;$env:Path"
    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        Assert-LastExit "Rustup installation"
        throw "Rust was installed, but cargo is unavailable. Restart PowerShell and rerun this script."
    }
} else {
    Write-Host "Found $(cargo --version)"
}

if ((rustc -vV | Select-String '^host:').Line -notmatch 'windows-msvc$') {
    Write-Host "Switching Rust to the Windows MSVC toolchain..."
    rustup toolchain install stable-x86_64-pc-windows-msvc
    Assert-LastExit "Rust MSVC toolchain installation"
    rustup default stable-x86_64-pc-windows-msvc
    Assert-LastExit "Selecting the Rust MSVC toolchain"
}

Write-Step "Adding Rust components (clippy, rustfmt)"
rustup component add clippy rustfmt
Assert-LastExit "Rust component installation"

# --- Node ---
Write-Step "Checking Node.js"
$node = Get-Command node -ErrorAction SilentlyContinue
if ($null -eq $node) {
    Write-Host "Node.js not found. Installing LTS via winget..."
    winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    Assert-LastExit "Node.js installation"
} else {
    Write-Host "Found Node $(node --version)"
}

Write-Step "Installing gateway dependencies"
Push-Location "$root\apps\gateway"; npm install --no-audit --no-fund; Assert-LastExit "Gateway dependency installation"; Pop-Location

Write-Step "Installing dashboard dependencies"
Push-Location "$root\apps\dashboard"; npm install --no-audit --no-fund; Assert-LastExit "Dashboard dependency installation"; Pop-Location

# --- AI models (Ollama VLM/LLM, Whisper voice, YOLO ONNX) ---
if ($SkipModels) {
    Write-Step "Skipping AI model install (-SkipModels)"
} else {
    Write-Step "Installing AI models (vision + voice)"
    & "$PSScriptRoot\install-models.ps1"
}

# --- Build & test ---
Write-Step "Building Rust workspace"
Push-Location $root; cargo build --workspace; Assert-LastExit "Rust workspace build"; Pop-Location

Write-Step "Running Rust tests"
Push-Location $root; cargo test --workspace; Assert-LastExit "Rust workspace tests"; Pop-Location

Write-Step "Running gateway tests"
Push-Location "$root\apps\gateway"; npm test; Assert-LastExit "Gateway tests"; Pop-Location

Write-Host "`nInstall complete. Start everything with: .\scripts\run.ps1" -ForegroundColor Green
