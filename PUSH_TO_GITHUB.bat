@echo off
title LQP MC Dashboard - Day Cap Nhat Len GitHub Pages
cd /d "%~dp0"
echo ============================================================
echo   DAY DU LIEU / CODE MOI LEN GITHUB PAGES
echo ============================================================
echo.
echo Chon che do:
echo   [1] Chi day du lieu moi (data.json, data.js, manual_data.json)
echo   [2] Day TOAN BO app (lan dau trien khai hoac sau khi nang cap code)
echo.
set /p choice="Nhap 1 hoac 2 roi nhan Enter: "
if "%choice%"=="2" (
    python scripts\github_sync.py push-all
) else (
    python scripts\github_sync.py push
)
if errorlevel 1 (
    echo.
    echo ============================================================
    echo [LOI] Chua day duoc len GitHub! Vui long xem thong bao loi o tren.
    echo ============================================================
    pause
    exit /b 1
)
echo.
echo ============================================================
echo Hoan tat! Web GitHub Pages se cap nhat sau ~30 giay.
echo Link: https://huynhphathuy-mech.github.io/LQP-MC-Dashboard/
echo ============================================================
pause
