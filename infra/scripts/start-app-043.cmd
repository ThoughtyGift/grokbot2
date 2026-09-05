@echo off
REM Mo ban 0.43 SONG SONG voi ban 0.29 — bam dup file nay (shortcut "Grok Bot (local 043)").
REM
REM Khac start-app.cmd dung ba bien, con lai giao het cho run.ps1 (cung stack backend :8788):
REM   GROKBOT2_APP_EXE    -> ban 0.43 da va: uu tien bo cai song song "Programs\Bot Noi Bo 043",
REM                          roi toi ban dev "C:\cai043" (asar bung + va tay, xem bang theo doi §6 muc 20)
REM   GROKBOT2_CDP_PORT   -> 9225, de khong dung :9222 cua ban 0.29 dang mo
REM   SAND_USER_DATA_DIR  -> "Grok Bot (local 043)": ho so RIENG. 0.43 nang schema kho cuc bo; dung chung ho so
REM                          voi 0.29 la ban 0.29 mo lai co the hong. Khoa mot-ban cua Electron cung nam trong day.
REM
REM run.ps1 chi dong tien trinh cua DUNG ban sap mo (loc theo duong dan) — ban 0.29 va app cua hang khong bi dung.

if not defined GROKBOT2_CDP_PORT set "GROKBOT2_CDP_PORT=9225"
if not defined GROKBOT2_APP_EXE if exist "%LOCALAPPDATA%\Programs\Bot Noi Bo 043\Grok Bot.exe" set "GROKBOT2_APP_EXE=%LOCALAPPDATA%\Programs\Bot Noi Bo 043\Grok Bot.exe"
if not defined GROKBOT2_APP_EXE if exist "C:\cai043\Grok Bot.exe" set "GROKBOT2_APP_EXE=C:\cai043\Grok Bot.exe"
if not defined GROKBOT2_APP_EXE (
  echo Khong thay ban 0.43 nao: "%LOCALAPPDATA%\Programs\Bot Noi Bo 043\Grok Bot.exe" hay "C:\cai043\Grok Bot.exe".
  echo Dung bo cai dist\043\Bot-Noi-Bo-Setup-*-0.43.exe, hoac dat GROKBOT2_APP_EXE.
  pause
  exit /b 1
)
if not defined SAND_USER_DATA_DIR set "SAND_USER_DATA_DIR=%APPDATA%\Grok Bot (local 043)"

cd /d "%~dp0..\.."
powershell -NoProfile -ExecutionPolicy Bypass -File "infra\scripts\run.ps1" %*
if errorlevel 1 (
  echo.
  echo Launcher bao loi. Doc dong mau do phia tren.
  pause
)
