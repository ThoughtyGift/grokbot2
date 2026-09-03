/**
 * Bộ cài `.exe` thật — dựng bằng Inno Setup.
 *
 * Khác bản `.cmd` ở ba chỗ người dùng thấy ngay: có icon riêng, có tên trong **Apps & features**
 * (gỡ ra được đàng hoàng), và có màn hình cài đặt thay vì một cửa sổ đen.
 *
 * **Icon là của mình, không mượn của hãng.** Shortcut trên Desktop thì trỏ icon vào client — hợp lý
 * vì bấm nó là mở client. Nhưng dán logo của họ lên bộ cài của mình thì thành mạo danh, nên bộ cài
 * mang dấu "B" đúng như trang tải.
 *
 * Không có ISCC thì hàm trả về null và bản `.cmd` vẫn là thứ được phát — không ai bị chặn vì thiếu
 * một công cụ tuỳ chọn.
 */
import { existsSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";

/** ISCC không nằm trên PATH sau khi winget cài — dò ba chỗ nó thường ở. */
export function isccPath() {
  const guesses = [
    join(homedir(), "AppData", "Local", "Programs", "Inno Setup 6", "ISCC.exe"),
    "C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe",
    "C:\\Program Files\\Inno Setup 6\\ISCC.exe",
  ];
  return guesses.find((p) => existsSync(p)) ?? null;
}

/**
 * Vẽ icon 256×256 rồi bọc thành `.ico`.
 *
 * ICO từ Vista trở đi cho phép nhét thẳng một PNG vào thay vì bitmap thô, nên chỉ cần 22 byte header
 * cộng file PNG. Nhờ vậy không phải kéo thêm thư viện icon nào.
 */
function makeIcon(dir) {
  const png = join(dir, "icon.png");
  const ico = join(dir, "icon.ico");
  const ps = `
Add-Type -AssemblyName System.Drawing
$s = 256
$bmp = New-Object System.Drawing.Bitmap $s,$s
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = 'AntiAliasGridFit'
$rect = New-Object System.Drawing.Rectangle 0,0,$s,$s
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect,
  [System.Drawing.Color]::FromArgb(255,255,106,61),
  [System.Drawing.Color]::FromArgb(255,255,157,110), 45)
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$r = 56
$path.AddArc(0,0,$r,$r,180,90); $path.AddArc($s-$r,0,$r,$r,270,90)
$path.AddArc($s-$r,$s-$r,$r,$r,0,90); $path.AddArc(0,$s-$r,$r,$r,90,90)
$path.CloseFigure()
$g.FillPath($brush,$path)
$font = New-Object System.Drawing.Font('Segoe UI',132,[System.Drawing.FontStyle]::Bold)
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = 'Center'; $fmt.LineAlignment = 'Center'
$ink = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255,26,13,7))
$g.DrawString('B',$font,$ink,(New-Object System.Drawing.RectangleF 0,0,$s,$s),$fmt)
$g.Dispose()
$bmp.Save('${png.replace(/\\/g, "\\\\")}',[System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
`;
  execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], { stdio: "pipe" });

  const body = readFileSync(png);
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);        // reserved
  header.writeUInt16LE(1, 2);        // 1 = icon
  header.writeUInt16LE(1, 4);        // một ảnh
  header.writeUInt8(0, 6);           // 0 = 256 px
  header.writeUInt8(0, 7);
  header.writeUInt8(0, 8);           // bảng màu: không
  header.writeUInt8(0, 9);
  header.writeUInt16LE(1, 10);       // planes
  header.writeUInt16LE(32, 12);      // bit/pixel
  header.writeUInt32LE(body.length, 14);
  header.writeUInt32LE(22, 18);      // offset tới dữ liệu
  writeFileSync(ico, Buffer.concat([header, body]));
  rmSync(png, { force: true });
  return ico;
}

/**
 * Địa chỉ backend **điền sẵn** trong bộ cài.
 *
 * Đây là chỗ đã làm mất một buổi trên máy thứ hai. Bản trước điền sẵn `http://localhost:8788` kèm
 * dòng chữ "Để nguyên nếu backend chạy ngay trên máy này" — nghe hợp lý, nhưng `localhost` là giá
 * trị **chắc chắn sai** trên mọi máy không phải máy dev. Người cài bấm Next như với mọi bộ cài khác,
 * rồi app báo *"Can't reach your computer"*: không phải backend hỏng, mà app đang gọi vào chính máy
 * vừa cài.
 *
 * Nên địa chỉ được **nướng vào lúc dựng**: bộ cài phát cho ai thì mang sẵn địa chỉ của người đó, và
 * bấm Next là đúng. Dựng cho máy mình, không khai gì, thì vẫn là `localhost` như trước.
 *
 * Luôn có gạch chéo cuối: thiếu nó thì client làm rụng tiền tố đường dẫn (đo 26/08). nginx nay nhận
 * cả hai dạng, nhưng phát ra dạng đúng thì không phải trông vào bản vá đó.
 */
const defaultBackend = () =>
  `${(process.env.GROKBOT2_PUBLIC_BACKEND ?? "http://localhost:8788").trim().replace(/\/+$/, "")}/`;

const ISS = ({ version, iconPath, outDir, outName }) => `; Sinh bởi scripts/setup-exe.mjs — đừng sửa tay, sửa ở đó.
[Setup]
AppId={{9F2C7A31-6B1E-4E52-9E44-BOT2NOIBO01}
AppName=Bot Noi Bo
AppVersion=${version}
AppPublisher=Bot Noi Bo (ban tu van hanh)
DefaultDirName={localappdata}\\Bot Noi Bo
DefaultGroupName=Bot Noi Bo
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=lowest
OutputDir=${outDir}
OutputBaseFilename=${outName}
SetupIconFile=${iconPath}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=Bot Noi Bo
UninstallDisplayIcon={app}\\icon.ico

[Languages]
Name: "vi"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "{#SourceDir}\\patch-client.mjs"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\\start-bot.cmd";    DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\\icon.ico";         DestDir: "{app}"; Flags: ignoreversion

[Icons]
; Shortcut tro icon vao chinh client — bam no la mo client, nen mang logo client la dung.
Name: "{userdesktop}\\Bot Noi Bo"; Filename: "{app}\\start-bot.cmd"; WorkingDir: "{app}"; \\
  IconFilename: "{localappdata}\\Programs\\Grok Bot\\Grok Bot.exe"; IconIndex: 0
Name: "{group}\\Bot Noi Bo"; Filename: "{app}\\start-bot.cmd"; WorkingDir: "{app}"; \\
  IconFilename: "{localappdata}\\Programs\\Grok Bot\\Grok Bot.exe"; IconIndex: 0

[Run]
Filename: "{app}\\start-bot.cmd"; Description: "Mo Bot Noi Bo ngay"; Flags: postinstall nowait skipifsilent

[Code]
var BackendPage: TInputQueryWizardPage;

// Thieu Node hoac thieu client thi bao NGAY o buoc dau, khong de nguoi dung cai xong moi biet hong.
function InitializeSetup(): Boolean;
var ResultCode: Integer;
begin
  if not FileExists(ExpandConstant('{localappdata}\\Programs\\Grok Bot\\Grok Bot.exe')) then
  begin
    MsgBox('Chua thay client desktop trong may.' + #13#10 +
           'Cai client tu nha phat hanh cua no truoc, roi chay lai bo cai nay.', mbError, MB_OK);
    Result := False;
    Exit;
  end;
  if not Exec('cmd.exe', '/c where node', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then
  begin
    MsgBox('Chua co Node.js (can ban 20 tro len).' + #13#10 + 'Tai o https://nodejs.org roi chay lai.',
           mbError, MB_OK);
    Result := False;
    Exit;
  end;
  Result := True;
end;

procedure InitializeWizard();
begin
  BackendPage := CreateInputQueryPage(wpSelectDir,
    'Backend cua ban', 'App se noi chuyen voi dia chi nao?',
    'Bo cai nay da dien san dung dia chi. Doi duoc sau: sua backend.txt trong thu muc cai dat.');
  BackendPage.Add('Dia chi backend:', False);
  BackendPage.Values[0] := '${defaultBackend()}';
end;

procedure CurStepChanged(CurStep: TSetupStep);
var ResultCode: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    SaveStringToFile(ExpandConstant('{app}\\backend.txt'), BackendPage.Values[0] + #13#10, False);
    // Va client. That bai thi noi ra va go cai — de lai nua voi la trang thai te nhat.
    if not Exec('cmd.exe', '/c node "' + ExpandConstant('{app}\\patch-client.mjs') + '" --apply',
                '', SW_HIDE, ewWaitUntilTerminated, ResultCode) or (ResultCode <> 0) then
      MsgBox('Va client that bai (ma loi ' + IntToStr(ResultCode) + ').' + #13#10 +
             'Dong app roi chay lai bo cai.', mbError, MB_OK);
  end;
end;
`;

/**
 * Dựng `.exe`. Trả về đường dẫn, hoặc `null` khi máy chưa có Inno Setup.
 *
 * @param {{ distDir: string, stagingDir: string, patchSrc: string, startSrc: string, version: string, outName: string }} opts
 */
export function buildExe({ distDir, stagingDir, patchSrc, startSrc, version, outName }) {
  const iscc = isccPath();
  if (!iscc) return null;

  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });
  writeFileSync(join(stagingDir, "patch-client.mjs"), patchSrc, "utf8");
  writeFileSync(join(stagingDir, "start-bot.cmd"), startSrc.replace(/\r?\n/g, "\r\n"), "utf8");
  const iconPath = makeIcon(stagingDir);

  const iss = join(stagingDir, "setup.iss");
  writeFileSync(iss, ISS({ version, iconPath, outDir: distDir, outName }), "utf8");
  execFileSync(iscc, [`/DSourceDir=${stagingDir}`, iss], { stdio: "pipe" });

  const exe = join(distDir, `${outName}.exe`);
  return existsSync(exe) ? exe : null;
}

// ── Bản CHỞ CẢ ỨNG DỤNG ──────────────────────────────────────────────────────
//
// Khác bản 2 MB ở đúng một điểm: nó mang theo cây app đã vá (~490 MB), nên người dùng KHÔNG cần cài
// client trước, và KHÔNG cần Node. Một file, cài, chạy — đúng hình dạng bộ cài của hãng.
//
// **Dùng cho máy của chính bạn.** Gói này chứa client desktop của nhà phát hành; nó tồn tại để thử
// T2–T5 trên máy thứ hai của bạn, không phải để phát ra ngoài. `docs/legal.md` vẫn là ranh giới.
//
// Bản gốc `app.asar.disabled-by-grokbot2` bị loại: 46 MB đó chỉ để `--undo`, mà bản chở sẵn thì
// không có gì phải hoàn lại.

// `String.raw` là bắt buộc ở đây: ISS đầy dấu `\` (đường dẫn, và dấu nối dòng cuối dòng). Trong một
// template thường, `\B` bị JS nuốt thành `B` — và bản dựng đầu tiên đã hỏng đúng vì thế:
// `{userdesktop}\Bot Noi Bo` ra thành `{userdesktop}Bot Noi Bo`, Inno báo "Name must include a path".

/**
 * Icon của bản CHỞ APP: lấy thẳng từ `Grok Bot.exe`.
 *
 * Bản 2 MB mang dấu "B" của mình, và phải như vậy — nó chỉ là bộ cấu hình, dán logo của hãng lên đó
 * là nói sai nó là gì. Bản chở app thì **cài đúng ứng dụng đó**, nên mang icon của ứng dụng là mô tả
 * đúng, không phải mạo danh. Nó cũng giải quyết một chuyện thật: ba file trong Downloads cùng một
 * dấu "B" thì không phân biệt được cái nào là bản nào.
 *
 * Ranh giới không đổi: gói này dùng cho máy của chính bạn. Ngày nào phát ra ngoài thì icon phải quay
 * về dấu của mình, vì lúc đó nó mới thành chuyện nguồn gốc.
 *
 * `PrivateExtractIcons` lấy được bản 256×256; `ExtractAssociatedIcon` chỉ cho 32×32 mờ.
 */
function appIcon(appExe, dir) {
  const out = join(dir, "app-icon.ico");
  const ps = String.raw`
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class IcoX {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  public static extern int PrivateExtractIcons(string sz, int idx, int cx, int cy, IntPtr[] h, int[] id, int n, int flags);
}
"@
foreach ($size in 256,128,64,48,32) {
  $h = New-Object IntPtr[] 1; $id = New-Object int[] 1
  $n = [IcoX]::PrivateExtractIcons($env:GB2_SRC, 0, $size, $size, $h, $id, 1, 0)
  if ($n -gt 0 -and $h[0] -ne [IntPtr]::Zero) {
    $icon = [System.Drawing.Icon]::FromHandle($h[0])
    $fs = [IO.File]::Create($env:GB2_OUT); $icon.Save($fs); $fs.Close()
    exit 0
  }
}
exit 1
`;
  try {
    execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
      { stdio: "pipe", env: { ...process.env, GB2_SRC: appExe, GB2_OUT: out } });
    return existsSync(out) ? out : null;
  } catch {
    return null;   // không lấy được thì dùng dấu "B" — không chặn bản dựng vì một cái icon
  }
}

const ISS_FULL = ({ version, iconPath, outDir, outName, appSrc }) => String.raw`; Sinh bởi scripts/setup-exe.mjs — đừng sửa tay.
[Setup]
AppId={{9F2C7A31-6B1E-4E52-9E44-BOT2NOIBOFULL}
AppName=Bot Noi Bo
AppVersion=${version}
AppPublisher=Bot Noi Bo (ban tu van hanh)
DefaultDirName={localappdata}\Programs\Bot Noi Bo
DefaultGroupName=Bot Noi Bo
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=${outDir}
OutputBaseFilename=${outName}
SetupIconFile=${iconPath}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=Bot Noi Bo
UninstallDisplayIcon={app}\Grok Bot.exe

[Languages]
Name: "vi"; MessagesFile: "compiler:Default.isl"

[Files]
; Ca cay app da va. Bo ban goc de ben: 46 MB do chi de --undo, ban cho san khong can.
Source: "${appSrc}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion; \
  Excludes: "app.asar.disabled-by-grokbot2"
Source: "{#SourceDir}\start-bot.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SourceDir}\*.ico";         DestDir: "{app}"; Flags: ignoreversion
${process.env.GROKBOT2_FULL_DOWNLOAD_TOKEN
    ? `; token.txt — de launcher tu cap nhat hoi DUNG goi cua no (/updates/ban-moi?k=). Chi co khi
; GROKBOT2_FULL_DOWNLOAD_TOKEN duoc dat luc dung goi; Inno bao loi neu Source thieu nen dong nay co dieu kien.
Source: "{#SourceDir}\token.txt";     DestDir: "{app}"; Flags: ignoreversion`
    : `; (khong co token.txt — dung goi ma khong dat GROKBOT2_FULL_DOWNLOAD_TOKEN: launcher se khong tu cap nhat)`}

[Icons]
; Tro vao start-bot.cmd, KHONG tro thang vao exe: bon bien moi truong nam trong do.
Name: "{userdesktop}\Bot Noi Bo"; Filename: "{app}\start-bot.cmd"; WorkingDir: "{app}"; \
  IconFilename: "{app}\Grok Bot.exe"; IconIndex: 0
Name: "{group}\Bot Noi Bo"; Filename: "{app}\start-bot.cmd"; WorkingDir: "{app}"; \
  IconFilename: "{app}\Grok Bot.exe"; IconIndex: 0

[Run]
Filename: "{app}\start-bot.cmd"; Description: "Mo Bot Noi Bo ngay"; Flags: postinstall nowait skipifsilent

[Code]
var BackendPage: TInputQueryWizardPage;

procedure InitializeWizard();
begin
  BackendPage := CreateInputQueryPage(wpSelectDir,
    'Backend cua ban', 'App se noi chuyen voi dia chi nao?',
    'Bo cai nay da dien san dung dia chi. Doi duoc sau: sua backend.txt trong thu muc cai dat.');
  BackendPage.Add('Dia chi backend:', False);
  BackendPage.Values[0] := '${defaultBackend()}';
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    SaveStringToFile(ExpandConstant('{app}\backend.txt'), BackendPage.Values[0] + #13#10, False);
end;
`;

/**
 * Bản app sắp chở đi đã có bản vá `update-feed` chưa?
 *
 * Nó quyết định một dòng duy nhất trong launcher, và dòng đó quyết định người dùng có bao giờ thấy
 * banner "New update available" hay không:
 *
 *   CÓ vá   → hằng số feed trong client đã trỏ về backend của MÌNH ⇒ bỏ `SAND_DISABLE_UPDATES`,
 *             app hỏi mình, mình trả lời, banner hiện đúng lúc mình phát hành.
 *   CHƯA vá → hằng số feed vẫn là `api2.cursor.sh` ⇒ PHẢI giữ `SAND_DISABLE_UPDATES`, không thì app
 *             tự tải bản của hãng, cài đè và xoá sạch bộ vá.
 *
 * Mặc định (không đọc được file) là CHƯA vá — hướng hỏng an toàn: mất banner còn hơn mất bộ vá.
 *
 * Đo 03/09: máy thứ tư của người dùng chạy 0.20.0 với đúng dòng `Updates are disabled by
 * SAND_DISABLE_UPDATES` trên màn hình Settings, và đó là MỘT trong bốn lý do banner không bao giờ
 * tới được họ (xem docs/state/bang-theo-doi.md §7).
 *
 * @param {string} appSrc thư mục cài của app sắp đóng gói
 */
export function coVaUpdateFeed(appSrc) {
  try {
    return readFileSync(join(appSrc, "resources", "app", "dist", "electron-main", "main.cjs"), "utf8")
      .includes("/*grokbot2:update-feed*/");
  } catch { return false; }
}

/**
 * Launcher của bản chở app: exe nằm NGAY CẠNH nó, không phải ở thư mục của hãng.
 *
 * @param {boolean} khoaCapNhat giữ `SAND_DISABLE_UPDATES=1` hay không — xem `coVaUpdateFeed`
 */
export const startBundled = () => `@echo off
REM Mo Bot Noi Bo. App nam ngay canh file nay — day la ban tu chua, khong can client cua hang.
REM
REM Bon bien duoi day la toan bo hop dong voi client, thieu cai nao cung hong theo kieu rieng:
REM   CURSOR_API_BASE_URL / SAND_BACKEND_URL  -> thieu thi noi voi server nha phat hanh
REM   CURSOR_WEBSITE_URL                      -> thieu thi dang nhap bi day sang https://localhost:4443
REM   SAND_DISABLE_UPDATES                    -> thieu thi app TU CAP NHAT va xoa sach ban va
REM
REM Dat bang setx thi tien hon nhung KHONG duoc: CURSOR_API_BASE_URL cung duoc Cursor IDE that doc.

setlocal
set "BE=http://localhost:8788"
if exist "%~dp0backend.txt" set /p BE=<"%~dp0backend.txt"

REM Kho du lieu RIENG, de ban nay dung canh app cua nha phat hanh duoc.
REM Khoa mot-ban cua Electron nam TRONG userData va client doi userData truoc khi lay khoa; chung
REM userData thi ban thu hai tu thoat (trong nhu bam khong len), va hai ban dung chung token.
if not defined SAND_USER_DATA_DIR set "SAND_USER_DATA_DIR=%APPDATA%\Bot Noi Bo"

set "CURSOR_API_BASE_URL=%BE%"
set "SAND_BACKEND_URL=%BE%"
REM Tro vao BACKEND, khong phai cursor.com. Dang nhap mo
REM   {CURSOR_WEBSITE_URL}/loginDeepControl?challenge=...&uuid=...
REM trong trinh duyet. De cursor.com o day thi may nay mo trang cua HANG: dang nhap khong bao gio
REM xong, va uuid + challenge cua phien tren may nay bi giao cho ho.
set "CURSOR_WEBSITE_URL=%BE%"

REM ── Updater GOC: tat, co chu dich ────────────────────────────────────────────
REM Updater goc KHONG cai duoc ban cua minh: truoc khi chay installer no do chu ky Authenticode va
REM doi ten nguoi ky nam trong ["Anysphere, Inc.","Anysphere"] (trich main.cjs 0.30). Mo no chi de
REM duoc mot banner dan toi nut Install luon that bai. Cap nhat do khoi duoi day lo.
REM GROKBOT2_NATIVE_UPDATES=1 mo lai — cho ngay co chung chi ky so + ban va noi danh sach trang.
if not "%GROKBOT2_NATIVE_UPDATES%"=="1" set "SAND_DISABLE_UPDATES=1"

if not exist "%~dp0Grok Bot.exe" (
  echo Thieu "%~dp0Grok Bot.exe" — cai dat khong tron. Chay lai bo cai.
  pause
  exit /b 1
)

REM ── TU CAP NHAT, HAI PHA ─────────────────────────────────────────────────────
REM
REM Vi sao hai pha: bo cai ghi de CHINH file start-bot.cmd nay. cmd doc batch tu dia theo tung dong,
REM nen neu bo cai chay DONG BO tu trong day, sau khi no xong cmd doc dong ke tiep tu file MOI o
REM offset CU — hanh vi khong doan duoc. Pha 1 (o day) chi kiem + tai + ghi mot script ra %TEMP% roi
REM THOAT; pha 2 chay tach roi, sau khi cmd nay da thoat, moi cai va mo lai app.
REM
REM Token: bo cai dat token.txt canh app luc dung goi. Co no thi hoi DUNG goi cua minh (ban cho-app,
REM qua ?k=); khong co thi 204 la dung — cai ban 50 KB len may nay la sai goi.
REM
REM Ba luat nhu launcher cong khai: HONG THI MO APP · kiem sha256 truoc khi CHAY · tiet che (24h, vi
REM goi nang ~105 MB). Tat han: GROKBOT2_NO_SELF_UPDATE=1.
if "%GROKBOT2_NO_SELF_UPDATE%"=="1" goto sau_cap_nhat
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "try{" ^
  "  $dir=(Resolve-Path '%~dp0').Path.TrimEnd('\\');" ^
  "  $moc=Join-Path $dir '.lan-hoi-cuoi';" ^
  "  if(Test-Path $moc){ if(((Get-Date)-(Get-Item $moc).LastWriteTime).TotalHours -lt 24){ exit 0 } }" ^
  "  $tk=Join-Path $dir 'token.txt'; if(-not (Test-Path $tk)){ exit 0 }" ^
  "  $k=(Get-Content $tk -Raw).Trim(); if(-not $k){ exit 0 }" ^
  "  $pkg=Join-Path $dir 'resources\\app\\package.json';" ^
  "  $ver=if(Test-Path $pkg){ (Get-Content $pkg -Raw | ConvertFrom-Json).version } else { '' };" ^
  "  $r=Invoke-WebRequest -UseBasicParsing -TimeoutSec 8 -Uri ('%BE%'.TrimEnd('/')+'/updates/ban-moi?nen=windows&ver='+$ver+'&k='+[uri]::EscapeDataString($k));" ^
  "  Set-Content -Path $moc -Value (Get-Date -Format o) -Encoding utf8;" ^
  "  if($r.StatusCode -ne 200){ exit 0 }" ^
  "  $b=$r.Content | ConvertFrom-Json;" ^
  "  if(-not $b.ten -or -not $b.sha256hash){ exit 0 }" ^
  "  $tmp=Join-Path $env:TEMP $b.ten;" ^
  "  Invoke-WebRequest -UseBasicParsing -TimeoutSec 900 -Uri $b.url -OutFile $tmp;" ^
  "  $h=(Get-FileHash $tmp -Algorithm SHA256).Hash.ToLower();" ^
  "  if($h -ne $b.sha256hash.ToLower()){ Remove-Item $tmp -Force; exit 0 }" ^
  "  $pha2=Join-Path $env:TEMP 'bot-noi-bo-cap-nhat.ps1';" ^
  "  Set-Content -Path $pha2 -Encoding utf8 -Value @(" ^
  "    'Start-Sleep -Seconds 2'," ^
  "    ('$d=''' + $dir + ''''),"  ^
  "    ('$f=''' + $tmp + ''''),"  ^
  "    'Start-Process -FilePath $f -ArgumentList ''/VERYSILENT'',''/SUPPRESSMSGBOXES'',''/NORESTART'',(''/DIR=''+[char]34+$d+[char]34) -Wait'," ^
  "    'Remove-Item $f -Force -ErrorAction SilentlyContinue'," ^
  "    'Start-Process -FilePath (Join-Path $d ''start-bot.cmd'') -WorkingDirectory $d'" ^
  "  );" ^
  "  Start-Process -FilePath 'powershell' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',$pha2;" ^
  "  exit 7" ^
  "}catch{ exit 0 }"
REM Ma 7 = pha 2 da duoc giao viec: no se cai roi tu mo app. Cmd nay phai THOAT NGAY de file khong bi giu.
if errorlevel 7 exit /b 0
:sau_cap_nhat

start "" "%~dp0Grok Bot.exe" %*
`;

/**
 * Dựng bộ cài chở cả app. Trả về đường dẫn, hoặc `null` khi thiếu Inno Setup / thiếu cây app.
 *
 * @param {{ distDir: string, stagingDir: string, appSrc: string, version: string, outName: string }} opts
 */
export function buildFullExe({ distDir, stagingDir, appSrc, version, outName }) {
  const iscc = isccPath();
  if (!iscc) return null;
  if (!existsSync(join(appSrc, "Grok Bot.exe"))) {
    console.error(`Không thấy "Grok Bot.exe" trong ${appSrc} — không có gì để chở.`);
    return null;
  }

  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });
  writeFileSync(join(stagingDir, "start-bot.cmd"), startBundled().replace(/\r?\n/g, "\r\n"), "utf8");
  // token.txt — launcher dùng nó để hỏi ĐÚNG gói của mình (bản chở-app) qua /updates/ban-moi?k=.
  // Chỉ ghi khi có token; ISS_FULL cũng chỉ liệt kê file này khi cùng biến ấy được đặt.
  const tokenDay = (process.env.GROKBOT2_FULL_DOWNLOAD_TOKEN ?? "").trim();
  if (tokenDay) writeFileSync(join(stagingDir, "token.txt"), `${tokenDay}\r\n`, "utf8");
  // Icon của chính ứng dụng được cài; lấy không được thì rơi về dấu "B" — một cái icon không được
  // phép chặn cả bản dựng.
  const iconPath = appIcon(join(appSrc, "Grok Bot.exe"), stagingDir) ?? makeIcon(stagingDir);
  console.log(`  icon bộ cài: ${iconPath.endsWith("app-icon.ico") ? "lấy từ Grok Bot.exe" : 'dấu "B" của mình'}`);

  const iss = join(stagingDir, "setup-full.iss");
  writeFileSync(iss, ISS_FULL({ version, iconPath, outDir: distDir, outName, appSrc }), "utf8");
  // Nén 490 MB bằng lzma2/max mất vài phút — đó là phần lâu nhất của cả bản dựng.
  execFileSync(iscc, [`/DSourceDir=${stagingDir}`, iss], { stdio: "pipe", maxBuffer: 64 << 20 });

  const exe = join(distDir, `${outName}.exe`);
  return existsSync(exe) ? exe : null;
}

/**
 * Bản ZIP — giải nén ra là dùng, không cần bộ cài.
 *
 * Bản gốc của nhà phát hành phát `.exe` (đo được: `Grok_Bot_0.18.0_Setup.exe`, 120 MB), nên bản
 * `.exe` mới là thứ bám sát họ. ZIP có mặt vì lý do khác, thực tế hơn cho việc **thử trên máy khác**:
 *
 *   - không có bộ cài thì không có cảnh báo "unknown publisher" lúc cài;
 *   - giải nén ra thấy ngay từng file, không phải tin một cái wizard;
 *   - chép qua USB cũng dùng được, không cần chạy gì.
 *
 * Đổi lại: **to hơn**. ZIP dùng deflate, `.exe` dùng lzma2 — cùng một cây app, zip nặng gần gấp đôi.
 *
 * Dùng `bsdtar` (có sẵn trong Windows 10+) chứ không `Compress-Archive`: nhanh hơn nhiều trên 490 MB,
 * và không ngốn RAM theo kích thước như bản PowerShell.
 */
export function buildZip({ distDir, stagingDir, appSrc, outName }) {
  if (!existsSync(join(appSrc, "Grok Bot.exe"))) {
    console.error(`Không thấy "Grok Bot.exe" trong ${appSrc}`);
    return null;
  }
  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(join(stagingDir, outName), { recursive: true });
  const root = join(stagingDir, outName);

  // Chép cây app, bỏ bản gốc để bên (46 MB chỉ dùng cho --undo).
  /*
   * robocopy tra ma 0-7 la THANH CONG (1 = da chep file, 3 = chep + thua file dich...). Chi tu 8 tro
   * len moi la loi that. `execFileSync` thi coi moi ma khac 0 la nem — nen bat lai va tu phan xu.
   */
  try {
    execFileSync("robocopy", [appSrc, root, "/E", "/NFL", "/NDL", "/NJH", "/NJS", "/NP",
      // debug.log la rac cua lan chay truoc tren may dung — dong goi kem thi nguoi nhan tuong la loi.
      "/XF", "app.asar.disabled-by-grokbot2", "debug.log"], { stdio: "pipe" });
  } catch (e) {
    const code = typeof e.status === "number" ? e.status : 16;
    if (code >= 8) throw new Error("robocopy that bai, ma " + code);
  }
  // Windows doc file .cmd/.txt bang CRLF; ghi LF thi Notepad hien mot dong dai dinh lien.
  const crlf = (t) => t.split(String.fromCharCode(10)).join(String.fromCharCode(13,10));
  writeFileSync(join(root, "start-bot.cmd"), crlf(startBundled()), "utf8");
  {
    const tokenDay = (process.env.GROKBOT2_FULL_DOWNLOAD_TOKEN ?? "").trim();
    if (tokenDay) writeFileSync(join(root, "token.txt"), `${tokenDay}\r\n`, "utf8");
  }
  writeFileSync(join(root, "backend.txt"), "http://localhost:8788" + String.fromCharCode(13,10), "utf8");
  writeFileSync(join(root, "DOC-DAY-TRUOC.txt"), crlf(README_ZIP), "utf8");

  const zip = join(distDir, `${outName}.zip`);
  rmSync(zip, { force: true });
  // `-a` cho bsdtar tự chọn định dạng theo đuôi `.zip`.
  /*
   * Goi THANG bsdtar cua Windows, khong goi "tar" tren PATH.
   *
   * Git Bash dat GNU tar truoc trong PATH, ma GNU tar khong hieu co `-a` (tu chon dinh dang theo
   * duoi file) — no bao loi kho hieu. bsdtar o System32 co tu Windows 10, va no biet ghi .zip.
   */
  // Dùng `join` thay vì viết chuỗi có dấu gạch ngược: chuỗi "C:\Windows\System32\tar.exe" trong JS
  // đọc \W \S \t là ký tự thoát, ra một đường dẫn sai mà nhìn thì vẫn thấy đúng.
  const bsdtar = join(process.env.SystemRoot ?? "C:/Windows", "System32", "tar.exe");
  const tarBin = existsSync(bsdtar) ? bsdtar : "tar";
  execFileSync(tarBin, ["-a", "-c", "-f", zip, "-C", stagingDir, outName], { stdio: "pipe", maxBuffer: 64 << 20 });
  rmSync(stagingDir, { recursive: true, force: true });
  return existsSync(zip) ? zip : null;
}

const README_ZIP = `BOT NOI BO — ban giai nen (khong can cai dat)
============================================

CACH DUNG — 3 buoc:

  1. Giai nen ca thu muc nay ra dau cung duoc (vi du C:\BotNoiBo)
  2. Mo file backend.txt, sua thanh dia chi backend cua ban
     (mac dinh http://localhost:8788 — neu backend chay o may khac thi doi thanh
      http://<ip-may-do>:8788)
  3. Bam dup start-bot.cmd

     LUON mo bang start-bot.cmd, DUNG bam thang "Grok Bot.exe":
     bam thang vao exe thi thieu 4 bien moi truong, app se noi chuyen voi
     server cua nha phat hanh thay vi backend cua ban.

TAO LOI TAT (tuy chon):
  Chuot phai start-bot.cmd → Send to → Desktop (create shortcut)

CO SAN GI TRONG DAY:
  Grok Bot.exe        ung dung (da va san, khong can cai them gi)
  resources/app       phan da va
  start-bot.cmd       lenh mo dung cach — mang 4 bien moi truong
  backend.txt         dia chi backend, sua bang Notepad

KHONG CAN: Node.js, khong can cai client, khong can quyen admin.

Ban tu van hanh, cho muc dich ca nhan va nghien cuu.
`;
