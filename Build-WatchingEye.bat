@echo off
REM Release build for WatchingEye (Windows).
REM Compiles the Rust workspace, gateway, orchestrator, and dashboard.
title WatchingEye Build
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build.ps1" %*
if errorlevel 1 (
  echo.
  echo Build failed. The message above says why.
  pause
  exit /b 1
)
pause
