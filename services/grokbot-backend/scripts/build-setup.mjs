/**
 * Đóng gói bộ cài mà trang tải phát ra — mảnh 2 của docs/plan/ship-to-users.md.
 *
 * Gói này KHÔNG chứa app. Nó chứa ba việc tay mà tài liệu đã liệt kê là rào cản để giao cho người
 * thứ hai: dời `app.asar`, tạo shortcut mang sẵn bốn biến môi trường, và trỏ vào backend. Người
 * dùng vẫn tự cài client từ nhà phát hành của nó — đúng ranh giới docs/legal.md đặt ra.
 *
 *   node services/grokbot-backend/scripts/build-setup.mjs
 *   → services/grokbot-backend/.data/dist/bot-noi-bo-setup-<ngày>.zip
 *
 * Launcher trong gói là bản tối giản, KHÔNG phải infra/scripts/run.ps1: run.ps1 còn dựng cả bốn
 * tiến trình backend và giả định bố cục repo. Người tải về không có repo, nên gói mang một
 * `start-bot.cmd` đứng một mình, chỉ làm đúng phần hợp đồng với client: bốn biến + mở đúng exe.
 */
import { mkdirSync, writeFileSync, copyFileSync, rmSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const svcRoot = join(here, "..");
const repoRoot = join(svcRoot, "..", "..");
const DIST = join(svcRoot, ".data", "dist");
const STAGE = join(DIST, "staging");

const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const NAME = `bot-noi-bo-setup-${stamp}`;
const ZIP = join(DIST, `${NAME}.zip`);

const INSTALL_CMD = `@echo off
setlocal enabledelayedexpansion
title Bot Noi Bo - cai dat
echo.
echo   Bot Noi Bo - cai dat
echo   ====================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [X] Khong tim thay Node.js. Cai Node 20 tro len roi chay lai file nay.
  echo       https://nodejs.org
  echo.
  pause
  exit /b 1
)

set "APP=%LOCALAPPDATA%\\Programs\\Grok Bot\\Grok Bot.exe"
if not exist "%APP%" (
  echo   [X] Chua thay client desktop o:
  echo       %APP%
  echo.
  echo       Cai client tu nha phat hanh cua no truoc, roi chay lai file nay.
  echo.
  pause
  exit /b 1
)
echo   [1/3] Tim thay client.

node "%~dp0patch-client.mjs" --apply
if errorlevel 1 (
  echo.
  echo   [X] Va client that bai. Doc dong loi phia tren.
  pause
  exit /b 1
)
echo   [2/3] Da va client.

set "BE=http://localhost:8788"
set /p "BE=  Dia chi backend [%BE%]: "
> "%~dp0backend.txt" echo %BE%

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Desktop')+'\\Bot Noi Bo.lnk');" ^
  "$s.TargetPath='%~dp0start-bot.cmd'; $s.WorkingDirectory='%~dp0'; $s.Description='Mo Bot Noi Bo (dung cach)'; $s.Save()"

echo   [3/3] Da tao shortcut "Bot Noi Bo" tren Desktop.
echo.
echo   XONG. Tu gio LUON mo bang shortcut do.
echo   Bam thang vao app da cai la no noi chuyen voi server nha phat hanh.
echo.
pause
`;

const START_CMD = `@echo off
REM Mo client da va, tro vao backend cua ban.
REM
REM Bon bien nay la toan bo hop dong voi client — thieu cai nao cung hong theo kieu rieng:
REM   CURSOR_API_BASE_URL / SAND_BACKEND_URL  -> thieu thi noi voi server nha phat hanh
REM   CURSOR_WEBSITE_URL                      -> thieu thi dang nhap bi day sang https://localhost:4443
REM   SAND_DISABLE_UPDATES                    -> thieu thi app TU CAP NHAT va xoa sach ban va
REM
REM Dat bon bien nay bang setx (muc nguoi dung) thi tien hon nhung KHONG duoc:
REM CURSOR_API_BASE_URL cung duoc Cursor IDE that doc, may nao co Cursor se bi tro nham.
REM Vi the: shortcut, khong phai bien toan cuc.

setlocal
set "BE=http://localhost:8788"
if exist "%~dp0backend.txt" set /p BE=<"%~dp0backend.txt"

set "CURSOR_API_BASE_URL=%BE%"
set "SAND_BACKEND_URL=%BE%"
set "CURSOR_WEBSITE_URL=https://cursor.com"
set "SAND_DISABLE_UPDATES=1"

set "APP=%LOCALAPPDATA%\\Programs\\Grok Bot\\Grok Bot.exe"
if not exist "%APP%" (
  echo Khong thay client o %APP% — chay lai install.cmd.
  pause
  exit /b 1
)
start "" "%APP%" %*
`;

const README = `BOT NOI BO — bo cai
===================

Goi nay KHONG chua ung dung. No chua ba viec tay ma khong nen bat nguoi dung lam:

  1. Va client da cai (doi app.asar sang mot ben)
  2. Tao shortcut mang san bon bien moi truong
  3. Ghi dia chi backend cua ban

CAN CO TRUOC
  - Windows 10/11
  - Node.js 20 tro len          https://nodejs.org
  - Client desktop da cai san   (%LOCALAPPDATA%\\Programs\\Grok Bot)
  - Mot backend dang chay       (mac dinh http://localhost:8788)

CAI
  Chay install.cmd, tra loi mot cau hoi (dia chi backend), xong.

DUNG
  LUON mo bang shortcut "Bot Noi Bo" tren Desktop.
  Bam thang vao "Grok Bot.exe" la no noi chuyen voi server cua nha phat hanh,
  VA co the tu cap nhat — lan cap nhat do se xoa sach ban va.

GO RA
  node patch-client.mjs --undo     tra client ve nguyen ban
  Roi xoa shortcut tren Desktop.

KIEM TRA
  node patch-client.mjs --verify   client da va chua, va con dung khong?
  node patch-client.mjs --status   duong dan, fuses, trang thai da ghi

Ban tu van hanh, cho muc dich ca nhan va nghien cuu. Client desktop thuoc ve nha
phat hanh cua no; goi nay chi cau hinh ban ma ban da tu cai tren may minh.
`;

// ── dựng ─────────────────────────────────────────────────────────────────────
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });

const patchSrc = join(repoRoot, "infra", "scripts", "patch-client.mjs");
if (!existsSync(patchSrc)) {
  console.error(`Không thấy ${patchSrc} — gói cài không có bộ vá thì vô nghĩa.`);
  process.exit(1);
}
copyFileSync(patchSrc, join(STAGE, "patch-client.mjs"));
writeFileSync(join(STAGE, "install.cmd"), INSTALL_CMD.replace(/\n/g, "\r\n"), "utf8");
writeFileSync(join(STAGE, "start-bot.cmd"), START_CMD.replace(/\n/g, "\r\n"), "utf8");
writeFileSync(join(STAGE, "README.txt"), README.replace(/\n/g, "\r\n"), "utf8");

rmSync(ZIP, { force: true });
// Compress-Archive có sẵn trên mọi Windows 10+; `zip` là lối thoát khi dựng trên Linux/CI.
try {
  execFileSync("powershell", [
    "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
    `Compress-Archive -Path '${STAGE}\\*' -DestinationPath '${ZIP}' -Force`,
  ], { stdio: "pipe" });
} catch {
  execFileSync("zip", ["-r", "-q", ZIP, "."], { cwd: STAGE, stdio: "pipe" });
}

const size = statSync(ZIP).size;
console.log(`✓ ${ZIP}`);
console.log(`  ${(size / 1024).toFixed(1)} KB · install.cmd · start-bot.cmd · patch-client.mjs · README.txt`);
console.log(`  Thử: curl -sI http://localhost:8788/download/windows`);
