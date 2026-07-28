@echo off
REM Stop every WatchingEye service. Double-click to shut the stack down.
title WatchingEye - Stop
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop.ps1" %*
pause
