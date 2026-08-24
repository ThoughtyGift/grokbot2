@echo off
REM Bat app local dung cach — bam dup vao file nay thay vi vao "Grok Bot.exe".
REM
REM Bam dup vao app da cai la KHONG du. App can bon bien moi truong, va run.ps1 dat ca bon:
REM   CURSOR_API_BASE_URL / SAND_BACKEND_URL  -> noi voi backend cua minh, khong phai server hang
REM   CURSOR_WEBSITE_URL                      -> thieu thi login bi day sang https://localhost:4443
REM   SAND_DISABLE_UPDATES                    -> thieu thi app TU CAP NHAT va xoa sach ban patch
REM
REM Dat bon bien nay o muc nguoi dung (setx) thi tien hon, nhung KHONG duoc:
REM CURSOR_API_BASE_URL cung duoc Cursor IDE that doc, va may nay co cai Cursor —
REM lam vay se tro Cursor vao backend nay va lam hong no. Vi the: shortcut, khong phai bien toan cuc.
REM
REM run.ps1 tu dong dong moi tien trinh "Grok Bot*" dang chay truoc khi bat lai, nen neu ban
REM da bam dup nham vao app thi chay file nay la sua duoc luon.

cd /d "%~dp0..\.."
powershell -NoProfile -ExecutionPolicy Bypass -File "infra\scripts\run.ps1" %*
if errorlevel 1 (
  echo.
  echo Launcher bao loi. Doc dong mau do phia tren.
  pause
)
