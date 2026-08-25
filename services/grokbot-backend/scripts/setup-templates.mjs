/**
 * Nội dung hai bộ cài — tách khỏi build-setup.mjs vì đó là chỗ *đóng gói*, còn đây là chỗ *nội dung*.
 *
 * Bài học từ lần đầu: gói ra 6 mục lộn xộn (`patches/`, `scripts/`, ba file lạ) trông không giống
 * một bộ cài. Bản này là **một file duy nhất** — bộ vá nằm ngay trong nó dưới dạng base64, giải ra
 * lúc chạy. Người dùng tải một file, bấm, xong.
 *
 * Ba việc bộ cài phải làm mà lần đầu làm thiếu:
 *   1. **Cài vào chỗ cố định** (`%LOCALAPPDATA%\\Bot Noi Bo`), không để trong Downloads — xoá thư mục
 *      tải về là shortcut chết.
 *   2. **Lấy logo thật**: shortcut trỏ `IconLocation` vào chính client, nên biểu tượng trên Desktop
 *      là logo app chứ không phải icon file .cmd.
 *   3. **Mở app lên** ở bước cuối. Cài xong mà không thấy gì thì người dùng không biết đã xong chưa.
 *
 * `GROKBOT2_SETUP_DRYRUN=1` = giải nén + báo cáo rồi dừng, không vá, không tạo shortcut. Có nó thì
 * mới kiểm được bộ cài mà không đụng vào client đang chạy.
 */

/** Base64 xuống dòng 76 ký tự cho dễ đọc; bảng chữ base64 không có ký tự nào cmd/bash hiểu nhầm. */
export const b64 = (text) =>
  Buffer.from(text, "utf8").toString("base64").match(/.{1,76}/g).join("\r\n");

// ── Windows: một file .cmd, bộ vá nằm sau `exit /b` nên cmd không bao giờ đọc tới ────────────
export const winInstaller = ({ patchB64, startB64 }) => `@echo off
setlocal enabledelayedexpansion
title Bot Noi Bo - cai dat
color 0F
echo.
echo   ============================================
echo     BOT NOI BO  -  cai dat
echo   ============================================
echo.

set "DEST=%LOCALAPPDATA%\\Bot Noi Bo"
set "APP=%LOCALAPPDATA%\\Programs\\Grok Bot\\Grok Bot.exe"

where node >nul 2>nul
if errorlevel 1 (
  echo   [X] Chua co Node.js. Cai Node 20 tro len roi chay lai:  https://nodejs.org
  echo.
  pause
  exit /b 1
)

if not exist "%APP%" (
  echo   [X] Chua thay client desktop o:
  echo       %APP%
  echo.
  echo       Cai client tu nha phat hanh cua no truoc, roi chay lai file nay.
  echo.
  pause
  exit /b 1
)
echo   [1/5] Tim thay client.

REM Giai bo va tu chinh file nay ra thu muc cai dat. PowerShell doc file, cat lay khoi giua hai moc.
if not exist "%DEST%" mkdir "%DEST%" >nul 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$t=[IO.File]::ReadAllText('%~f0');" ^
  "foreach($p in @(@('#PATCH#','patch-client.mjs'),@('#START#','start-bot.cmd'))){" ^
  "  $m=[regex]::Match($t,$p[0]+'([A-Za-z0-9+/=\\s]*?)'+$p[0]);" ^
  "  if(-not $m.Success){Write-Error ('thieu khoi '+$p[0]); exit 1}" ^
  "  [IO.File]::WriteAllBytes((Join-Path '%DEST%' $p[1]),[Convert]::FromBase64String(($m.Groups[1].Value -replace '\\s','')))}"
if errorlevel 1 (
  echo   [X] Khong giai duoc bo va tu file cai dat. File co the da bi sua hoac tai thieu.
  pause
  exit /b 1
)
echo   [2/5] Da bung bo va vao "%DEST%".

if "%GROKBOT2_SETUP_DRYRUN%"=="1" (
  echo.
  echo   DRYRUN: dung o day. Khong va client, khong tao shortcut, khong mo app.
  dir /b "%DEST%"
  exit /b 0
)

node "%DEST%\\patch-client.mjs" --apply
if errorlevel 1 (
  echo.
  echo   [X] Va client that bai. Doc dong loi phia tren.
  pause
  exit /b 1
)
echo   [3/5] Da va client.

set "BE=http://localhost:8788"
set /p "BE=  Dia chi backend [%BE%]: "
> "%DEST%\\backend.txt" echo %BE%

REM IconLocation tro vao chinh client, nen shortcut mang LOGO THAT cua app — khong phai icon .cmd.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\\Bot Noi Bo.lnk');" ^
  "$s.TargetPath='%DEST%\\start-bot.cmd'; $s.WorkingDirectory='%DEST%';" ^
  "$s.IconLocation='%APP%,0'; $s.Description='Mo Bot Noi Bo (dung cach)'; $s.Save()"
echo   [4/5] Da tao shortcut "Bot Noi Bo" tren Desktop (mang logo app).

echo   [5/5] Dang mo app...
start "" "%DEST%\\start-bot.cmd"

echo.
echo   XONG. Tu gio LUON mo bang shortcut "Bot Noi Bo" tren Desktop.
echo   Bam thang vao app da cai la no noi chuyen voi server nha phat hanh.
echo.
timeout /t 8 >nul
exit /b 0

REM ==========================================================================
REM  Duoi day la du lieu, khong phai lenh. cmd da thoat o dong tren nen khong
REM  bao gio doc toi. Sua bat ky ky tu nao trong hai khoi nay la bo va hong.
REM ==========================================================================
#PATCH#
${patchB64}
#PATCH#
#START#
${startB64}
#START#
`;

export const winStart = `@echo off
REM Mo client da va, tro vao backend cua ban.
REM
REM Bon bien nay la toan bo hop dong voi client — thieu cai nao cung hong theo kieu rieng:
REM   CURSOR_API_BASE_URL / SAND_BACKEND_URL  -> thieu thi noi voi server nha phat hanh
REM   CURSOR_WEBSITE_URL                      -> thieu thi dang nhap bi day sang https://localhost:4443
REM   SAND_DISABLE_UPDATES                    -> thieu thi app TU CAP NHAT va xoa sach ban va
REM
REM Dat bon bien nay bang setx (muc nguoi dung) thi tien hon nhung KHONG duoc:
REM CURSOR_API_BASE_URL cung duoc Cursor IDE that doc, may nao co Cursor se bi tro nham.

setlocal
set "BE=http://localhost:8788"
if exist "%~dp0backend.txt" set /p BE=<"%~dp0backend.txt"

set "CURSOR_API_BASE_URL=%BE%"
set "SAND_BACKEND_URL=%BE%"
REM Tro vao BACKEND, khong phai cursor.com: dang nhap mo
REM   {CURSOR_WEBSITE_URL}/loginDeepControl?challenge=...&uuid=...
REM trong trinh duyet. De cursor.com o day thi trinh duyet mo trang cua HANG, dang nhap
REM khong bao gio xong, va uuid + challenge cua may nay bi giao cho ho.
set "CURSOR_WEBSITE_URL=%BE%"
set "SAND_DISABLE_UPDATES=1"

set "APP=%LOCALAPPDATA%\\Programs\\Grok Bot\\Grok Bot.exe"
if not exist "%APP%" (
  echo Khong thay client o %APP% — chay lai bo cai.
  pause
  exit /b 1
)
start "" "%APP%" %*
`;

// ── macOS: cùng ý tưởng, khác vỏ ─────────────────────────────────────────────
export const macInstaller = ({ patchB64, startB64 }) => `#!/bin/bash
# Bot Noi Bo - cai dat (macOS)
#
# Chay:  bash "Cai dat Bot Noi Bo.command"
# (file tai tu web khong co co +x; goi qua bash la xong, khong can chmod truoc.)
set -e

DEST="$HOME/Library/Application Support/Bot Noi Bo"
APP="\${GROKBOT2_CLIENT_DIR:-/Applications/Grok Bot.app}"
SELF="$0"

echo
echo "  ============================================"
echo "    BOT NOI BO  -  cai dat"
echo "  ============================================"
echo

command -v node >/dev/null 2>&1 || {
  echo "  [X] Chua co Node.js. Cai Node 20 tro len roi chay lai: https://nodejs.org"
  exit 1
}

[ -d "$APP" ] || {
  echo "  [X] Chua thay client desktop o: $APP"
  echo "      Cai client tu nha phat hanh cua no truoc, roi chay lai."
  exit 1
}
echo "  [1/5] Tim thay client."

mkdir -p "$DEST"
awk '/^#PATCH#$/{f=!f; next} f' "$SELF" | tr -d '\\n' | base64 -d > "$DEST/patch-client.mjs"
awk '/^#START#$/{f=!f; next} f' "$SELF" | tr -d '\\n' | base64 -d > "$DEST/start-bot.command"
chmod +x "$DEST/start-bot.command"
echo "  [2/5] Da bung bo va vao $DEST"

if [ "\${GROKBOT2_SETUP_DRYRUN:-}" = "1" ]; then
  echo
  echo "  DRYRUN: dung o day. Khong va client, khong tao loi mo, khong mo app."
  ls -la "$DEST"
  exit 0
fi

node "$DEST/patch-client.mjs" --apply
echo "  [3/5] Da va client."

printf "  Dia chi backend [http://localhost:8788]: "
read -r BE
echo "\${BE:-http://localhost:8788}" > "$DEST/backend.txt"

ln -sf "$DEST/start-bot.command" "$HOME/Desktop/Bot Noi Bo.command"
echo "  [4/5] Da tao loi mo 'Bot Noi Bo' tren Desktop."

echo "  [5/5] Dang mo app..."
"$DEST/start-bot.command" &

echo
echo "  XONG. Tu gio LUON mo bang 'Bot Noi Bo' tren Desktop."
echo "  Mo thang app trong /Applications la no noi chuyen voi server nha phat hanh."
echo
exit 0

# ==========================================================================
#  Duoi day la du lieu, khong phai lenh. Script da exit o tren.
# ==========================================================================
#PATCH#
${patchB64}
#PATCH#
#START#
${startB64}
#START#
`;

export const macStart = `#!/bin/bash
# Mo client da va, tro vao backend cua ban.
#
# KHONG dung \`open -a\`: LaunchServices mo app trong moi truong CUA NO, khong phai cua shell nay,
# nen bon bien duoi day se khong toi duoc app va client quay ve server nha phat hanh.
cd "$(dirname "$0")"

BE="http://localhost:8788"
[ -f backend.txt ] && BE="$(cat backend.txt)"

export CURSOR_API_BASE_URL="$BE"
export SAND_BACKEND_URL="$BE"
# Tro vao BACKEND, khong phai cursor.com — xem chu thich o ban Windows ben tren.
export CURSOR_WEBSITE_URL="$BE"
export SAND_DISABLE_UPDATES=1

APP="\${GROKBOT2_CLIENT_DIR:-/Applications/Grok Bot.app}"
# Ten file thuc thi do CFBundleExecutable quyet dinh — lay cai dau tien thay vi doan ten.
BIN="$(ls "$APP/Contents/MacOS" 2>/dev/null | head -1)"
[ -n "$BIN" ] || { echo "Khong thay file thuc thi trong $APP/Contents/MacOS"; exit 1; }

"$APP/Contents/MacOS/$BIN" "$@" &
`;
