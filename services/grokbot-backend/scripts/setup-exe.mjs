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
    'De nguyen neu backend chay ngay tren may nay.');
  BackendPage.Add('Dia chi backend:', False);
  BackendPage.Values[0] := 'http://localhost:8788';
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
