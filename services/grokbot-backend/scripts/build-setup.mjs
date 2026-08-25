/**
 * Đóng gói bộ cài mà trang tải phát ra — mảnh 2 của docs/plan/ship-to-users.md.
 *
 * Gói này KHÔNG chứa app. Nó chứa ba việc tay mà tài liệu đã liệt kê là rào cản để giao cho người
 * thứ hai: dời `app.asar`, tạo lối mở mang sẵn bốn biến môi trường, và trỏ vào backend. Người dùng
 * vẫn tự cài client từ nhà phát hành của nó — đúng ranh giới docs/legal.md đặt ra.
 *
 *   node services/grokbot-backend/scripts/build-setup.mjs
 *   → .data/dist/bot-noi-bo-setup-win-<ngày>.zip
 *   → .data/dist/bot-noi-bo-setup-mac-<ngày>.zip
 *
 * Launcher trong gói là bản tối giản, KHÔNG phải infra/scripts/run.ps1: run.ps1 còn dựng cả bốn
 * tiến trình backend và giả định bố cục repo. Người tải về không có repo, nên gói mang một launcher
 * đứng một mình, chỉ làm đúng phần hợp đồng với client: bốn biến + mở đúng chương trình.
 */
import { mkdirSync, writeFileSync, copyFileSync, rmSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const svcRoot = join(here, "..");
const repoRoot = join(svcRoot, "..", "..");
const DIST = join(svcRoot, ".data", "dist");
const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");

const crlf = (s) => s.replace(/\n/g, "\r\n");

// ── Windows ──────────────────────────────────────────────────────────────────
const WIN_INSTALL = `@echo off
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

const WIN_START = `@echo off
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

const WIN_README = `BOT NOI BO — bo cai (Windows)
=============================

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

// ── macOS ────────────────────────────────────────────────────────────────────
//
// Hai chỗ macOS khác Windows đủ để làm hỏng nếu chép nguyên xi:
//
//   1. `open -a` KHÔNG truyền biến môi trường. LaunchServices mở app trong môi trường của nó,
//      không phải của shell — nên bốn biến sẽ bay mất và client quay về server nhà phát hành.
//      Vì thế launcher gọi thẳng file thực thi trong Contents/MacOS.
//   2. Zip dựng trên Windows KHÔNG giữ cờ chạy (+x). Nên bước đầu chạy bằng `bash install.command`,
//      và chính nó chmod cho các file còn lại.
const MAC_INSTALL = `#!/bin/bash
# Bot Noi Bo — cai dat (macOS)
#
# Lan dau chay bang:  bash install.command
# (zip khong giu co +x, nen double-click co the khong an — dong nay la ly do.)
set -e
cd "$(dirname "$0")"

echo
echo "  Bot Noi Bo - cai dat"
echo "  ===================="
echo

command -v node >/dev/null 2>&1 || {
  echo "  [X] Khong tim thay Node.js. Cai Node 20 tro len roi chay lai."
  echo "      https://nodejs.org"
  exit 1
}

APP="\${GROKBOT2_CLIENT_DIR:-/Applications/Grok Bot.app}"
if [ ! -d "$APP" ]; then
  echo "  [X] Chua thay client desktop o:"
  echo "      $APP"
  echo
  echo "      Cai client tu nha phat hanh cua no truoc, roi chay lai."
  exit 1
fi
echo "  [1/3] Tim thay client."

node "$(pwd)/patch-client.mjs" --apply
echo "  [2/3] Da va client."

printf "  Dia chi backend [http://localhost:8788]: "
read -r BE
echo "\${BE:-http://localhost:8788}" > backend.txt

chmod +x start-bot.command
ln -sf "$(pwd)/start-bot.command" "$HOME/Desktop/Bot Noi Bo.command"
echo "  [3/3] Da tao loi mo 'Bot Noi Bo' tren Desktop."

echo
echo "  XONG. Tu gio LUON mo bang loi mo do."
echo "  Mo thang app trong /Applications la no noi chuyen voi server nha phat hanh."
echo
`;

const MAC_START = `#!/bin/bash
# Mo client da va, tro vao backend cua ban.
#
# Bon bien duoi day la toan bo hop dong voi client — thieu cai nao cung hong theo kieu rieng:
#   CURSOR_API_BASE_URL / SAND_BACKEND_URL  -> thieu thi noi voi server nha phat hanh
#   CURSOR_WEBSITE_URL                      -> thieu thi dang nhap bi day sang https://localhost:4443
#   SAND_DISABLE_UPDATES                    -> thieu thi app TU CAP NHAT va xoa sach ban va
#
# KHONG dung \`open -a\`: LaunchServices mo app trong moi truong CUA NO, khong phai cua shell nay,
# nen bon bien tren se khong toi duoc app. Goi thang file thuc thi thi moi truong duoc ke thua.
cd "$(dirname "$0")"

BE="http://localhost:8788"
[ -f backend.txt ] && BE="$(cat backend.txt)"

export CURSOR_API_BASE_URL="$BE"
export SAND_BACKEND_URL="$BE"
export CURSOR_WEBSITE_URL="https://cursor.com"
export SAND_DISABLE_UPDATES=1

APP="\${GROKBOT2_CLIENT_DIR:-/Applications/Grok Bot.app}"
# Ten file thuc the trong Contents/MacOS do CFBundleExecutable quyet dinh — lay cai dau tien thay vi
# doan ten, vi doan sai thi loi rat kho hieu.
BIN="$(ls "$APP/Contents/MacOS" 2>/dev/null | head -1)"
if [ -z "$BIN" ]; then
  echo "Khong thay file thuc thi trong $APP/Contents/MacOS — chay lai install.command."
  exit 1
fi

"$APP/Contents/MacOS/$BIN" "$@" &
`;

const MAC_README = `BOT NOI BO — bo cai (macOS)
===========================

Goi nay KHONG chua ung dung. No chua ba viec tay:

  1. Va client da cai (doi app.asar sang mot ben)
  2. Tao loi mo mang san bon bien moi truong
  3. Ghi dia chi backend cua ban

CAN CO TRUOC
  - macOS
  - Node.js 20 tro len          https://nodejs.org
  - Client desktop da cai san   (/Applications/Grok Bot.app)
  - Mot backend dang chay       (mac dinh http://localhost:8788)

CAI  — chay dong nay trong Terminal:

      bash install.command

  Vi sao khong double-click: file .zip tao tren Windows khong giu co chay (+x),
  nen lan dau phai goi qua bash. Sau do install.command tu chmod cho phan con lai.

DUNG
  LUON mo bang "Bot Noi Bo" tren Desktop.
  Mo thang app trong /Applications la no noi chuyen voi server nha phat hanh,
  VA co the tu cap nhat — lan cap nhat do se xoa sach ban va.

GO RA
  node patch-client.mjs --undo     tra client ve nguyen ban

KIEM TRA
  node patch-client.mjs --verify   client da va chua, va con dung khong?
  node patch-client.mjs --status   duong dan, trang thai da ghi

CHUA KIEM TREN MAY MAC THAT
  Duong dan, chot "app dang chay" (pgrep) va launcher deu viet theo dung cach macOS,
  va phan logic duong dan co bai kiem tu dong. Nhung ca bo chua chay tren mot may Mac
  that lan nao. Gap loi thi doc dong loi — no se chi thang ra cho sai.

Ban tu van hanh, cho muc dich ca nhan va nghien cuu. Client desktop thuoc ve nha
phat hanh cua no; goi nay chi cau hinh ban ma ban da tu cai tren may minh.
`;

// ── dựng ─────────────────────────────────────────────────────────────────────
const patchSrc = join(repoRoot, "infra", "scripts", "patch-client.mjs");
const pathsSrc = join(repoRoot, "infra", "patches", "client-paths.mjs");
const patchesIndex = join(repoRoot, "infra", "patches", "index.mjs");
for (const f of [patchSrc, pathsSrc, patchesIndex]) {
  if (!existsSync(f)) { console.error(`Không thấy ${f} — gói cài thiếu bộ vá thì vô nghĩa.`); process.exit(1); }
}

/**
 * `patch-client.mjs` import `../patches/index.mjs` và `../patches/client-paths.mjs`, nên gói phải
 * giữ nguyên hình dạng thư mục đó — bằng không nó gãy ngay dòng import đầu tiên.
 */
function stageCommon(stage) {
  mkdirSync(join(stage, "scripts"), { recursive: true });
  mkdirSync(join(stage, "patches"), { recursive: true });
  copyFileSync(patchSrc, join(stage, "scripts", "patch-client.mjs"));
  // Bộ vá thật nằm cạnh index.mjs; chép trọn thư mục để không phải đoán tên từng cái — thêm một
  // bản vá mới mà quên sửa chỗ này thì gói sẽ thiếu, và lỗi chỉ lộ ra trên máy người dùng.
  const dir = join(repoRoot, "infra", "patches");
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".mjs"))) {
    copyFileSync(join(dir, name), join(stage, "patches", name));
  }
}

/** Một gói = staging riêng → zip riêng. Trả về đường dẫn zip. */
function build(kind, files) {
  const stage = join(DIST, `staging-${kind}`);
  const zip = join(DIST, `bot-noi-bo-setup-${kind}-${stamp}.zip`);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { recursive: true });
  stageCommon(stage);
  // patch-client.mjs được gọi từ gốc gói cho gọn — một shim một dòng, rẻ hơn bắt người dùng cd.
  writeFileSync(join(stage, "patch-client.mjs"), 'import "./scripts/patch-client.mjs";\n', "utf8");
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(join(stage, name), name.endsWith(".command") ? body : crlf(body), "utf8");
  }
  rmSync(zip, { force: true });
  try {
    execFileSync("powershell", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
      `Compress-Archive -Path '${stage}\\*' -DestinationPath '${zip}' -Force`,
    ], { stdio: "pipe" });
  } catch {
    execFileSync("zip", ["-r", "-q", zip, "."], { cwd: stage, stdio: "pipe" });
  }
  return zip;
}

mkdirSync(DIST, { recursive: true });
const built = [
  build("win", { "install.cmd": WIN_INSTALL, "start-bot.cmd": WIN_START, "README.txt": WIN_README }),
  build("mac", { "install.command": MAC_INSTALL, "start-bot.command": MAC_START, "README.txt": MAC_README }),
];
for (const z of built) console.log(`✓ ${z}  (${(statSync(z).size / 1024).toFixed(1)} KB)`);
console.log("  Thử: curl -sI http://localhost:8788/download/windows · /download/mac");
