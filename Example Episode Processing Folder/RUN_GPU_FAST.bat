@echo off
title Welcome to Grass Valley - GPU Accelerated
cd /d "%~dp0"
powershell.exe -ExecutionPolicy Bypass -NoExit -Command "& '.\go.ps1' -GPU"