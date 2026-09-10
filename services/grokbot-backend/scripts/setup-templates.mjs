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
/**
 * `beMacDinh` — địa chỉ backend gợi ý sẵn khi bộ cài hỏi.
 *
 * Mặc định `http://localhost:8788` chỉ đúng cho người dựng gói trên chính máy chạy backend. Ai
 * tải từ trang về **máy khác** mà bấm Enter cho qua sẽ trỏ app vào chính máy họ, ở đó không có
 * gì — và triệu chứng là app im lặng không đăng nhập được, không nói vì sao. Máy dựng gói biết
 * địa chỉ công khai của nó, nên nó là chỗ đúng để điền sẵn.
 */
export const winInstaller = ({ patchB64, startB64, beMacDinh = "http://localhost:8788" }) => `@echo off
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

REM ── Dia chi backend: hoi NGUOI, tru khi khong co nguoi ─────────────────────
REM
REM Ba nhanh, va nhanh giua la ly do khoi nay ton tai: tu 03/09 launcher tu cap nhat, tuc chinh no
REM chay lai file cai nay KHONG CO AI NGOI TRUOC MAY. Mot dong "set /p" o day se treo mai mai va
REM nguoi dung chi thay app khong mo len — hong o cho xa nhat khoi nguyen nhan.
REM
REM   1. backend.txt da co  -> giu nguyen, khong hoi. Dung cho ca nguoi chay lai bo cai bang tay:
REM                            dia chi cu la cai dung, hoi lai chi de go sai.
REM   2. UNATTENDED=1       -> dung mac dinh, khong hoi, khong pause.
REM   3. con lai            -> hoi nhu cu.
if exist "%DEST%\\backend.txt" (
  set /p BE=<"%DEST%\\backend.txt"
  echo   Backend: %BE%  ^(giu nguyen tu lan cai truoc^)
) else (
  set "BE=${beMacDinh}"
  if not "%GROKBOT2_SETUP_BE%"=="" set "BE=%GROKBOT2_SETUP_BE%"
  if "%GROKBOT2_SETUP_UNATTENDED%"=="1" (
    echo   Backend: %BE%  ^(khong hoi — chay tu dong^)
  ) else (
    set /p "BE=  Dia chi backend [%BE%]: "
  )
  > "%DEST%\\backend.txt" echo %BE%
)

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
REM Chay tu dong thi dung nam giu cua so 8 giay — khong ai doc no.
if not "%GROKBOT2_SETUP_UNATTENDED%"=="1" timeout /t 8 >nul
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

REM Kho du lieu RIENG, de ban nay dung canh app cua nha phat hanh duoc.
REM
REM Khoa mot-ban cua Electron nam TRONG userData, va client doi userData TRUOC khi lay khoa. Chung
REM userData thi ban thu hai tu thoat va chi focus ban dau — trong nhu bam khong len. Chung userData
REM con nghia la chung token va chung phien.
REM "\B" trong template literal JS mat backslash — ban truoc ra "%APPDATA%Bot Noi Bo" (ho so o AppData/RoamingBot Noi Bo).
REM Di doi mot lan roi dung cho dung.
if not exist "%APPDATA%\\Bot Noi Bo" if exist "%APPDATA%Bot Noi Bo" move "%APPDATA%Bot Noi Bo" "%APPDATA%\\Bot Noi Bo" >nul 2>&1
if not defined SAND_USER_DATA_DIR set "SAND_USER_DATA_DIR=%APPDATA%\\Bot Noi Bo"

set "CURSOR_API_BASE_URL=%BE%"
set "SAND_BACKEND_URL=%BE%"
REM Tro vao BACKEND, khong phai cursor.com: dang nhap mo
REM   {CURSOR_WEBSITE_URL}/loginDeepControl?challenge=...&uuid=...
REM trong trinh duyet. De cursor.com o day thi trinh duyet mo trang cua HANG, dang nhap
REM khong bao gio xong, va uuid + challenge cua may nay bi giao cho ho.
set "CURSOR_WEBSITE_URL=%BE%"

set "APP=%LOCALAPPDATA%\\Programs\\Grok Bot\\Grok Bot.exe"
if not exist "%APP%" (
  echo Khong thay client o %APP% — chay lai bo cai.
  pause
  exit /b 1
)

REM Thu muc cai cua client, suy ra tu %APP% chu khong viet lai duong dan: hai chuoi giong nhau o hai
REM dong la hai chuoi se lech nhau. Hai khoi duoi day deu dung no.
for %%I in ("%APP%") do set "APPDIR=%%~dpI"

REM ── TU CAP NHAT: hoi backend cua minh, tai, chay bo cai ─────────────────────
REM
REM Vi sao o DAY chu khong dung updater cua client: updater goc do chu ky Authenticode truoc khi
REM chay installer va doi ten nguoi ky nam trong ["Anysphere, Inc.","Anysphere"] (trich main.cjs
REM 0.30). Nen banner goc chi dan toi mot nut Install luon that bai. Launcher thi chay TRUOC client,
REM MOI LAN mo app, va do minh viet tron — day la cho duy nhat vua so huu duoc vua chac chan duoc goi.
REM
REM Ba luat, va ca ba deu la "dung im lang lam hong viec cua nguoi dung":
REM   1. HONG THI MO APP. Mang dut, backend chet, hash lech — tat ca deu roi ve mo app nhu thuong.
REM      Mot lop cap nhat tu chan duong vao san pham la lop se bi go.
REM   2. Kiem HASH truoc khi chay. File tai ve la mot .exe/.cmd sap duoc thuc thi; sha256 trong
REM      manifest la thu duy nhat noi rang no dung la thu minh phat hanh.
REM   3. Co tiet che. Moi lan mo app mot lan hoi la nhieu; dau thoi gian trong %~dp0 chan viec do.
REM
REM   4. HAI PHA. Bo cai ghi de CHINH file start-bot.cmd nay, ma cmd doc batch tu dia theo tung dong:
REM      chay bo cai DONG BO tu trong day thi sau khi no xong, cmd doc dong ke tiep tu file MOI o
REM      offset CU — hanh vi khong doan duoc. Ban dau cua khoi nay lam dung the (03/09, sang). Nay pha 1
REM      chi kiem + tai + ghi mot script ra %TEMP% roi THOAT; pha 2 chay tach roi sau khi cmd da thoat.
REM
REM Tat han: dat GROKBOT2_NO_SELF_UPDATE=1.
REM
REM   7. DI BANG curl.exe CUA WINDOWS, GIU Invoke-WebRequest LAM DUONG LUI. Do 10/09 tren mot may
REM      THAT trong so doi may (19041.6456): ca hai dia chi IPv6 cua may chu la HO DEN 21 s moi
REM      cai, DNS xep AAAA len TRUOC (dung luat — may co dia chi IPv6 toan cuc that), va
REM      ServicePoint cua .NET thu LAN LUOT ⇒ Invoke-WebRequest ve sau 42,7 s. Voi tran 8 s o duoi
REM      thi luot hoi feed KHONG CO CACH NAO thanh cong, va catch thi exit 0 — cham thu BA cua
REM      duong giao hang, cam hoan toan. curl dua song song v4/v6 (Happy Eyeballs) nen cung URL
REM      cung may di 0,83 s; no co san trong System32 tu Windows 10 build 17063.
REM      MOT ham T, MOT ngan sach: doi tran o day la doi cho ca hai duong, khong co danh sach thu hai.
REM      $ua TU KHAI va van mang 'PowerShell/<so>' — vi so kiem ke doi may khoa hang theo ua va
REM      chuanUa() nhan launcher bang dung chuoi do. Doi sang curl ma khong dat -A la moi hang
REM      launcher THAT bong thanh 'curl/8.x' ⇒ laLauncher:false ⇒ bang Doi may ve 0/0.
REM      URL di qua TEP CAU HINH (-K), khong qua dong lenh: URL mang ?k=<token> va mot dong
REM      lenh doc duoc bang tasklist. Gia tri trong tep KHONG dat trong nhay kep — trong tep cau
REM      hinh cua curl, mot gia tri co nhay thi backslash la dau escape (backslash-t thanh TAB).
REM      Ma trang thai doc tu -D <tep dau muc> chu khong tu --write-out: khoi nay nam trong mot
REM      tep .cmd, noi % la mo dau mot bien.
REM      KHONG dung -C - (tai tiep): do 10/09 tren chinh cua tai cua minh — no tra 200 khong kem
REM      Accept-Ranges (route la createReadStream().pipe(res)), va curl gap the thi thoat 33
REM      "Cannot resume" ma KHONG ghi gi ⇒ them no vao la bien mot luot thu-lai cuu duoc thanh mot
REM      luot hong cung. Tai tiep can Range o MAY CHU truoc; thu tu khong dao duoc.
REM
REM   8. PHA 2 MO CUA SO MINIMIZED, KHONG HIDDEN — va cmd tu ghi lai khi pha 1 khong chay.
REM      Do 11/09 tren may nay: ngay khi khoi pha 1 mang them phan curl o muc 7, Windows Defender
REM      cham diem CA DONG LENH powershell va giet no o CreateProcess. Nhat ky Defender goi ten
REM      Trojan:Win32/PowhidSubExec.B (Severe, Action: Remove); cmd in "Access is denied." va
REM      errorlevel 5, con PowerShell thi KHONG chay mot dong nao — ke ca dong dau tien.
REM      Do BA doi launcher trong CUNG mot thu muc: ban 06/09 (31 dong) qua, ban dang phat
REM      0.43.20260910 (52 dong) qua, ban co curl (70 dong) CHAN. Dong Start-Process nay giong
REM      HET o ca ba, nen thu bi cham diem khong phai mot dong ma la ca dong lenh: tai tep bang
REM      mot cong cu ngoai roi chay mot PowerShell AN la dung hinh mot con dropper.
REM      Bo 'Hidden' la het — do ca ba cach (bo han, doi sang 'Minimized', tach pha 1 ra mot tep
REM      .ps1), ca ba deu qua. Chon 'Minimized' vi no doi it nhat va van THAT: co mot cua so.
REM      KHONG giau 'Hidden' sau mot bien du no cung qua — do la dung thu thuat cua ma doc that.
REM      Nhung mot phep do tren MOT may voi MOT ban dinh nghia khong bao dam duoc ngay mai, nen
REM      nua thu hai moi la nua ben vung: ba dong duoi cung doc errorlevel va ghi kq=bi-chan.
REM      Moi cho ghi khac cua muc 52 nam BEN TRONG tien trinh bi giet, nen chi CMD khai duoc ca nay.
if "%GROKBOT2_NO_SELF_UPDATE%"=="1" goto sau_cap_nhat
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$ver='';" ^
  "$bc='';" ^
  "$giaiDoan='feed-loi';" ^
  "function G($w,$l){ try{ if($bc){ $m=(Get-Date -Format o)+' ver='+$ver+' kq='+$w; if($l){ $m=$m+' lan='+$l }; Set-Content -Path $bc -Encoding utf8 -Value $m } }catch{} };" ^
  "$ua='grokbot2-launcher/1 PowerShell/'+$PSVersionTable.PSVersion;" ^
  "$curl=Join-Path $env:SystemRoot 'System32\\curl.exe'; if(-not (Test-Path $curl)){ $curl='' };" ^
  "function T($u,$ra,$giay){" ^
  "  if($curl){" ^
  "    $cf=[IO.Path]::GetTempFileName(); $hd=[IO.Path]::GetTempFileName();" ^
  "    try{" ^
  "      [IO.File]::WriteAllText($cf,('url = '+$u),(New-Object Text.UTF8Encoding $false));" ^
  "      & $curl -sS -L --max-time $giay -A $ua -D $hd -o $ra -K $cf | Out-Null;" ^
  "      if($LASTEXITCODE -ne 0){ throw ('curl thoat '+$LASTEXITCODE) }" ^
  "      $dong=@(Get-Content $hd | Where-Object { $_.StartsWith('HTTP') })[-1];" ^
  "      return [int](([string]$dong).Split(' ')[1])" ^
  "    } finally { Remove-Item $cf,$hd -Force -ErrorAction SilentlyContinue }" ^
  "  }" ^
  "  $r=Invoke-WebRequest -UseBasicParsing -UserAgent $ua -TimeoutSec $giay -Uri $u -OutFile $ra -PassThru;" ^
  "  return [int]$r.StatusCode" ^
  "};" ^
  "try{" ^
  "  $dir=(Resolve-Path '%~dp0').Path.TrimEnd('\\');" ^
  "  $bc=Join-Path $dir '.cap-nhat-cuoi.txt';" ^
  "  $moc=Join-Path $dir '.lan-hoi-cuoi';" ^
  "  $gioTietChe=6;" ^
  "  if(Test-Path $moc){ if(((Get-Date)-(Get-Item $moc).LastWriteTime).TotalHours -lt $gioTietChe){ exit 0 } }" ^
  "  $pkg=Join-Path '%APPDIR%' 'resources\\app\\package.json';" ^
  "  $ver=if(Test-Path $pkg){ (Get-Content $pkg -Raw | ConvertFrom-Json).version } else { '' };" ^
  "  $kqCu=''; if(Test-Path $bc){ $mm=[regex]::Match((Get-Content $bc -Raw),'kq=([a-z0-9-]+)'); if($mm.Success){ $kqCu=$mm.Groups[1].Value } };" ^
  "  $tf=Join-Path $env:TEMP ('gb2-feed-'+[guid]::NewGuid().ToString('N').Substring(0,8)+'.json');" ^
  "  $ma=T ('%BE%'.TrimEnd('/')+'/updates/ban-moi?nen=windows&ver='+$ver+'&kq='+[uri]::EscapeDataString($kqCu)) $tf 8;" ^
  "  Set-Content -Path $moc -Value (Get-Date -Format o) -Encoding utf8;" ^
  "  $b=$null; if($ma -eq 200){ $b=(Get-Content $tf -Raw) | ConvertFrom-Json };" ^
  "  Remove-Item $tf -Force -ErrorAction SilentlyContinue;" ^
  "  if($ma -eq 204){ G 'khong-co-ban-moi'; exit 0 }" ^
  "  if($ma -ne 200){ G 'feed-loi'; exit 0 }" ^
  "  if(-not $b.url){ G 'manifest-thieu'; exit 0 }" ^
  "  $ten=if($b.ten){ $b.ten } else { 'bot-noi-bo-'+$b.version+'.cmd' };" ^
  "  $tmp=Join-Path $env:TEMP $ten;" ^
  "  $giaiDoan='tai-hong'; $lan=0; $xong=$false;" ^
  "  while($lan -lt 3 -and -not $xong){" ^
  "    $lan=$lan+1;" ^
  "    try{" ^
  "      $mt=T $b.url $tmp 60; if($mt -ne 200){ throw ('HTTP '+$mt) }" ^
  "      if($b.sha256hash){" ^
  "        $h=(Get-FileHash $tmp -Algorithm SHA256).Hash.ToLower();" ^
  "        if($h -eq $b.sha256hash.ToLower()){ $xong=$true } else { $giaiDoan='bam-lech'; Remove-Item $tmp -Force -ErrorAction SilentlyContinue }" ^
  "      } else { $xong=$true }" ^
  "    }catch{ $giaiDoan='tai-hong'; Remove-Item $tmp -Force -ErrorAction SilentlyContinue }" ^
  "    if(-not $xong -and $lan -lt 3){ Start-Sleep -Seconds 3 }" ^
  "  }" ^
  "  if(-not $xong){ G $giaiDoan $lan; exit 0 }" ^
  "  $giaiDoan='giao-pha2-hong';" ^
  "  $pha2=Join-Path $env:TEMP 'bot-noi-bo-cap-nhat.ps1';" ^
  "  Set-Content -Path $pha2 -Encoding utf8 -Value @(" ^
  "    'Start-Sleep -Seconds 2'," ^
  "    ('$d=''' + $dir + ''''),"  ^
  "    ('$f=''' + $tmp + ''''),"  ^
  "    ('$v=''' + $ver + ''''),"  ^
  "    '$env:GROKBOT2_SETUP_UNATTENDED=''1''',"  ^
  "    '$p=Start-Process -FilePath ''cmd.exe'' -ArgumentList ''/c'',([char]34+$f+[char]34) -Wait -PassThru'," ^
  "    '$ma=-1; if($p){ $ma=$p.ExitCode }'," ^
  "    '$kq=''cai-hong''; if($ma -eq 0){ $kq=''cai-xong'' }'," ^
  "    'try{ Set-Content -Path (Join-Path $d ''.cap-nhat-cuoi.txt'') -Encoding utf8 -Value ((Get-Date -Format o)+'' ver=''+$v+'' kq=''+$kq+'' ma=''+$ma) }catch{}'," ^
  "    'Remove-Item $f -Force -ErrorAction SilentlyContinue'" ^
  "  );" ^
  "  Start-Process -FilePath 'powershell' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Minimized','-File',$pha2;" ^
  "  G 'da-giao-pha2';" ^
  "  exit 7" ^
  "}catch{ G $giaiDoan; exit 0 }"
REM Ma 7 = pha 2 da duoc giao viec. Bo cai .cmd tu mo lai app o buoc cuoi, nen o day KHONG mo lan hai;
REM va cmd nay phai THOAT NGAY de file start-bot.cmd khong con bi doc trong luc bo cai ghi de no.
set "GB2MA=%errorlevel%"
if "%GB2MA%"=="7" exit /b 0
REM Pha 1 chi thoat 0 hoac 7. Ma khac = no KHONG chay xong, va cho ghi cua muc 52 nam BEN TRONG
REM tien trinh ay nen no khong the tu khai. Do 11/09: Defender cham diem CA DONG LENH powershell va
REM giet no ngay o CreateProcess (Trojan:Win32/PowhidSubExec.B, "Access is denied.", errorlevel 5) —
REM launcher roi thang xuong mo app, khong mot dau vet. Nen vet nay phai do CMD ghi, o ngoai.
if not "%GB2MA%"=="0" >"%~dp0.cap-nhat-cuoi.txt" echo %DATE% %TIME% kq=bi-chan ma=%GB2MA%
:sau_cap_nhat

REM ── Updater GOC: tat, va tat CO CHU DICH ────────────────────────────────────
REM
REM Sang 03/09 cho nay tung co dieu kien: "client da va update-feed thi mo cap nhat". Do xong moi
REM biet la sai huong — updater goc KHONG THE cai ban cua minh, va no dong bang MA chu khong bang
REM cau hinh: truoc khi chay installer no do chu ky Authenticode va doi ten nguoi ky nam trong
REM ["Anysphere, Inc.","Anysphere"] (trich main.cjs 0.30). Nen mo no ra chi de duoc mot banner dan
REM toi cai nut Install luon that bai — te hon la khong co banner.
REM
REM Nay cap nhat do khoi TU CAP NHAT o tren lo, va no chay duoc thuc su. Updater goc thi tat, vi hai
REM ly do cung huong: no khong cai duoc, va de no song la de app co duong hoi api2.cursor.sh.
REM
REM GROKBOT2_NATIVE_UPDATES=1 mo lai — de danh cho ngay co chung chi ky so + ban va noi danh sach
REM trang nguoi ky. Luc do banner + Install goc chay that, va khoi tren tu tat (dat NO_SELF_UPDATE).
if not "%GROKBOT2_NATIVE_UPDATES%"=="1" set "SAND_DISABLE_UPDATES=1"

REM Thua huong ELECTRON_RUN_AS_NODE=1 (terminal VS Code) la Electron chay nhu Node roi thoat im — go truoc khi mo.
set "ELECTRON_RUN_AS_NODE="

start "" "%APP%" %*
`;

// ── macOS: cùng ý tưởng, khác vỏ ─────────────────────────────────────────────
export const macInstaller = ({ patchB64, startB64, beMacDinh = "http://localhost:8788" }) => `#!/bin/bash
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

printf "  Dia chi backend [${beMacDinh}]: "
read -r BE
echo "\${BE:-${beMacDinh}}" > "$DEST/backend.txt"

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

APP="\${GROKBOT2_CLIENT_DIR:-/Applications/Grok Bot.app}"

# Khoa cap nhat CHI khi client chua co ban va update-feed — xem chu thich dai o ban Windows.
# Huong hong la KHOA: doc khong duoc file thi cu coi nhu chua va.
if ! grep -q "grokbot2:update-feed" "$APP/Contents/Resources/app/dist/electron-main/main.cjs" 2>/dev/null; then
  export SAND_DISABLE_UPDATES=1
fi
# Thua huong ELECTRON_RUN_AS_NODE=1 (terminal VS Code) la Electron chay nhu Node roi thoat im — go truoc khi mo.
unset ELECTRON_RUN_AS_NODE

# Ten file thuc thi do CFBundleExecutable quyet dinh — lay cai dau tien thay vi doan ten.
BIN="$(ls "$APP/Contents/MacOS" 2>/dev/null | head -1)"
[ -n "$BIN" ] || { echo "Khong thay file thuc thi trong $APP/Contents/MacOS"; exit 1; }

"$APP/Contents/MacOS/$BIN" "$@" &
`;
