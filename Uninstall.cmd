@echo off
rem Removes PR Explainer from this computer.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -Uninstall
