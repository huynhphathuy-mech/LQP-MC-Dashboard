@echo off
title LQP MC Dashboard - Dong Bo Tu GitHub Ve May
cd /d "%~dp0"
echo ============================================================
echo   DONG BO DU LIEU MOI NHAT TU GITHUB VE MAY TINH (O E:)
echo ============================================================
echo.
python scripts\github_sync.py pull
echo.
echo ============================================================
echo Hoan tat! Ban co the mo index.html xem offline ngay.
echo ============================================================
pause
