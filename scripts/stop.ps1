<#
.SYNOPSIS
    Stop every WatchingEye service (Windows).
.DESCRIPTION
    Frees the ports the stack uses and stops the processes holding them.
    Only processes actually listening on WatchingEye's ports are touched, so
    unrelated Node or Rust work on this machine is left alone.
.PARAMETER Force
    Also stop processes whose port could not be determined but whose command
    line clearly belongs to this project.
.EXAMPLE
    .\scripts\stop.ps1
#>
param([switch]$Force)
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "    $msg" -ForegroundColor Green }
function Write-Skip($msg) { Write-Host "    $msg" -ForegroundColor DarkGray }

# Dashboard, gateway, orchestrator, and the engine's fallback scan range.
$ports = @(3000, 8080, 8085) + (8090..8099)

Write-Step "Stopping services on ports: 3000, 8080, 8085, 8090-8099"
$stopped = @{}
foreach ($port in $ports) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($conn in $conns) {
        $procId = $conn.OwningProcess
        if ($stopped.ContainsKey($procId)) { continue }
        $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($null -eq $proc) { continue }
        try {
            Stop-Process -Id $procId -Force -ErrorAction Stop
            $stopped[$procId] = $true
            Write-Ok "stopped $($proc.ProcessName) (PID $procId) on port $port"
        } catch {
            Write-Host "    could not stop PID $procId on port $port : $_" -ForegroundColor Yellow
        }
    }
}

# The engine may be mid-startup and not yet listening, so catch it by name.
Write-Step "Checking for engine processes not yet bound to a port"
foreach ($proc in (Get-Process vision-engine -ErrorAction SilentlyContinue)) {
    if ($stopped.ContainsKey($proc.Id)) { continue }
    Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    $stopped[$proc.Id] = $true
    Write-Ok "stopped vision-engine (PID $($proc.Id))"
}

if ($Force) {
    Write-Step "Force: stopping node processes started from this project"
    $projectPath = $root.Replace("\", "\\")
    Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -match [regex]::Escape($root) } |
        ForEach-Object {
            if (-not $stopped.ContainsKey($_.ProcessId)) {
                Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
                $stopped[$_.ProcessId] = $true
                Write-Ok "stopped node (PID $($_.ProcessId))"
            }
        }
}

# Clear the recorded port so nothing points at a dead engine.
$portFile = Join-Path $root ".runtime\engine.port"
if (Test-Path $portFile) {
    Remove-Item $portFile -Force -ErrorAction SilentlyContinue
    Write-Skip "cleared .runtime/engine.port"
}

Write-Step "Verifying the ports are free"
$stillHeld = @()
foreach ($port in $ports) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        $stillHeld += $port
    }
}

if ($stopped.Count -eq 0) {
    Write-Host "`nNothing was running." -ForegroundColor DarkGray
} else {
    Write-Host "`nStopped $($stopped.Count) process(es)." -ForegroundColor Green
}
if ($stillHeld.Count -gt 0) {
    Write-Host "Still in use: $($stillHeld -join ', ') - another application owns these." -ForegroundColor Yellow
    Write-Host "Identify it with: Get-NetTCPConnection -LocalPort <port> -State Listen | ForEach-Object { Get-Process -Id `$_.OwningProcess }" -ForegroundColor DarkGray
} else {
    Write-Host "All WatchingEye ports are free." -ForegroundColor Green
}
