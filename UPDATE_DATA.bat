@echo off
title LQP MC Dashboard - Cap Nhat Du Lieu Tu Excel
cd /d "%~dp0"
echo ============================================================
echo   CAP NHAT DU LIEU MC DASHBOARD (EXCEL -^> DATA.JSON / JS)
echo ============================================================
echo.
echo [1/2] Dang keo manual_data.json moi nhat tu GitHub (tranh ghi de)...
python scripts\github_sync.py pull
echo.
echo [2/2] Dang doc 4 file Excel PMS + Skyline/KPI va ghep du lieu...
python sync_data.py --include-manual-excel
echo.
echo ============================================================
echo Hoan tat cap nhat tren may!
echo Neu muon day len GitHub Pages ngay, hay chay PUSH_TO_GITHUB.bat
echo ============================================================
pause
