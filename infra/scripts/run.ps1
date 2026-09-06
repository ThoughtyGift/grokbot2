# F2 launcher: four-process stack + patched Grok Bot.exe on CDP :9222.
#
#   pnpm dev:app
#   infra\scripts\run.ps1
#
# Does not spawn the Vite FE. That is `pnpm web` / run-web.ps1 (fallback only).
$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot)
$backend = Join-Path $repo 'services\grokbot-backend'
# Duong dan app — thu nhieu cho, vi cho MAC DINH khong con la cua ta.
#
# Bo cai 0.29 cua hang dat vao dung `%LOCALAPPDATA%\Programs\Grok Bot` va **thay the** ban 0.20 da
# va o do (do 27/08: thu muc bien mat hoan toan). Ban tu chua o `C:\cai` con nguyen. Ghi cung mot
# duong dan nghia la launcher chet ngay lan cai dat tiep theo cua hang.
$appExe = $env:GROKBOT2_APP_EXE
if (-not $appExe) {
  foreach ($c in @(
    "$env:LOCALAPPDATA\Programs\Grok Bot\Grok Bot.exe",
    "$env:LOCALAPPDATA\Programs\Bot Noi Bo\Grok Bot.exe",
    'C:\cai\Grok Bot.exe',
    "$env:LOCALAPPDATA\Bot Noi Bo\Grok Bot.exe"
  )) { if (Test-Path $c) { $appExe = $c; break } }
}
if (-not $appExe) { $appExe = "$env:LOCALAPPDATA\Programs\Grok Bot\Grok Bot.exe" }
$bff = 8788
# CDP port: 9222 cho ban chinh; start-app-043.cmd dat GROKBOT2_CDP_PORT=9225 de ban 0.43 mo song song.
$cdp = if ($env:GROKBOT2_CDP_PORT) { [int]$env:GROKBOT2_CDP_PORT } else { 9222 }

Write-Host '=== grokbot2  pnpm dev:app ===' -ForegroundColor Cyan

# CRITICAL: leftover ELECTRON_RUN_AS_NODE makes the exe parse as Node and exit with no GUI.
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

function Test-HttpOk([string]$Url) {
  try {
    $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    return $r.StatusCode -eq 200
  } catch { return $false }
}

function Get-ListenPids([int]$Port) {
  @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique)
}

# -- patch gate ----------------------------------------------------------------
# Unpatched install would boot vendor asar (no cOt) while looking fine. Fail closed.
# Kiem DUNG ban sap mo, khong phai duong dan mac dinh.
#
# `$appExe` o tren da thu ba cho, vi bo cai 0.29 cua hang chiem mat cho mac dinh. Nhung
# `patch-client.mjs` van doc duong mac dinh cua rieng no, nen no kiem MOT ban trong khi launcher mo
# mot ban KHAC — va tu 28/08 thi ban mac dinh khong con ton tai, nen `--verify` do va launcher tu
# choi chay chinh ban app dang dung duoc.
$env:GROKBOT2_CLIENT_DIR = Split-Path $appExe
$verify = & node (Join-Path $repo 'infra\scripts\patch-client.mjs') --verify
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Client is not patched (or the patch drifted). Do not launch the vendor bundle.' -ForegroundColor Red
  Write-Host '  node infra/scripts/patch-client.mjs --apply'
  Write-Host '  then: pnpm dev:app'
  exit 2
}

# -- e2e zombie ports 8792-8817 ------------------------------------------------
# Leftover spawned BFFs make e2e-handoff / e2e-cron look red. Never touch 8788-8791.
$killed = @()
foreach ($p in 8792..8817) {
  foreach ($listenPid in (Get-ListenPids $p)) {
    if (-not $listenPid) { continue }
    $proc = Get-Process -Id $listenPid -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -match '^(node|tsx)$') {
      try {
        Stop-Process -Id $listenPid -Force -ErrorAction Stop
        $killed += "${p}:$listenPid"
      } catch { }
    }
  }
}
if ($killed.Count) {
  Write-Host ("Cleared leftover test listeners: " + ($killed -join ', ')) -ForegroundColor Yellow
}

# -- stack ---------------------------------------------------------------------
$keyFile = Join-Path $backend 'pool-key.txt'
# Kiem theo NOI DUNG, khong theo dong dau: file co the giu dong placeholder PASTE_ roi khoa hal_ o duoi,
# va config.ts scan() lay dung khoa do — 05/09 launcher bao NOT SET trong khi backend chat binh thuong.
if ((Test-Path $keyFile) -and ((Get-Content $keyFile -Raw) -match 'hal_[A-Za-z0-9_-]{8,}')) {
  Write-Host 'Pool key: FOUND.' -ForegroundColor Green
} else {
  Write-Host "Pool key: NOT SET. Put a hal_xxx key in $keyFile" -ForegroundColor Yellow
}

if (Test-HttpOk "http://127.0.0.1:$bff/health") {
  Write-Host "Backend already up on :$bff (reusing computer/runtime/ops if they are)." -ForegroundColor Green
} else {
  Write-Host 'Starting pnpm backend (computer :8790, runtime :8789, ops :8791, BFF :8788) ...'
  # cmd start: Start-Process powershell has been silent about not creating a process.
  $cmd = "cd /d `"$repo`" && pnpm backend"
  cmd /c start "grokbot2-backend" cmd /k $cmd
  $up = $false
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Seconds 1
    if (Test-HttpOk "http://127.0.0.1:$bff/health") { $up = $true; break }
  }
  if (-not $up) {
    Write-Host "BFF did not answer http://127.0.0.1:$bff/health in 40s. Check the grokbot2-backend window." -ForegroundColor Red
    exit 1
  }
  Write-Host 'BFF is up.' -ForegroundColor Green
}

foreach ($pair in @(
  @{ n = 'runtime'; u = 'http://127.0.0.1:8789/health' },
  @{ n = 'computer'; u = 'http://127.0.0.1:8790/health' },
  @{ n = 'ops'; u = 'http://127.0.0.1:8791/health' }
)) {
  if (Test-HttpOk $pair.u) { Write-Host ("  {0,-8} up" -f $pair.n) }
  else { Write-Host ("  {0,-8} not answering yet (app can still chat; pane/cron may lag)" -f $pair.n) -ForegroundColor Yellow }
}

$envFile = Join-Path $repo '.env'
if ((Test-Path $envFile) -and ((Get-Content $envFile -Raw) -match '(?m)^\s*GROKBOT2_VNC_URL\s*=\s*\S')) {
  Write-Host 'Box VNC: configured (.env).' -ForegroundColor Green
} else {
  Write-Host 'Box VNC: NOT SET. Computer pane reports off until GROKBOT2_VNC_URL is set.' -ForegroundColor Yellow
}

# -- app -----------------------------------------------------------------------
if (-not (Test-Path $appExe)) {
  Write-Host "App not found: $appExe" -ForegroundColor Red
  exit 1
}

if (Test-HttpOk "http://127.0.0.1:$cdp/json/version") {
  Write-Host "Grok Bot already on CDP :$cdp - leaving it. Close it and re-run to relaunch with a fresh env." -ForegroundColor Green
  exit 0
}

# Giet theo DUONG DAN, khong theo ten — may nay co HAI ban cai.
#
# Ban truoc loc `ProcessName -like 'Grok Bot*'`, nen no giet ca ban cua HANG o
# "C:\Program Files\Grok Bot" du ta chi dinh khoi dong lai ban da va. Do 02/09: chay run.ps1 mot lan
# la app goc di tu 10 tien trinh xuong 0, va no la app tham chieu de doi chieu hanh vi — dong no la
# mat cai duy nhat noi cho biet "app goc lam gi o ca nay".
#
# Cung mot lop loi voi guard `--apply` sua cung ngay: hoi "co app nao ten the nay dang chay khong"
# thay vi "ban TOI SAP DONG co dang chay khong".
$appDirKill = Split-Path $appExe
Get-Process -ErrorAction SilentlyContinue | Where-Object {
  $_.ProcessName -like 'Grok Bot*' -and $_.Path -and $_.Path.StartsWith($appDirKill, [System.StringComparison]::OrdinalIgnoreCase)
} | ForEach-Object {
  try { $_.Kill() } catch {}
}
Start-Sleep -Milliseconds 400

$env:CURSOR_API_BASE_URL = "http://localhost:$bff"
$env:SAND_BACKEND_URL = "http://localhost:$bff"
# Without this the app treats a localhost API base as dev mode and sends login to https://localhost:4443.
#
# Points at OUR backend, not cursor.com — and since 26/08 that matters. Sign-in opens
# `{CURSOR_WEBSITE_URL}/loginDeepControl?challenge=…&uuid=…` in the browser; with the vendor's site
# here, the browser lands on THEIR page, our login never completes, and the uuid + challenge of a
# session on this machine are handed to them. Harmless while `/auth/poll` answered everyone; a real
# bug now that it does not.
$env:CURSOR_WEBSITE_URL = "http://localhost:$bff"
# KHONG dat SAND_DISABLE_UPDATES nua — tu 03/09 bao ve nam o cho khac, va bien nay chan luon
# banner cua CHINH TA.
#
# Cong cap nhat cua client xet theo thu tu:
#   envDisabled -> isLabBuild -> hasDevFeedOverride -> ...
# nen `SAND_DISABLE_UPDATES=1` thang moi nhanh khac. Truoc day dung no la dung: hang so feed van tro
# `api2.cursor.sh`, mot lan tu cap nhat la `resources/app` bi xoa va bo va bien mat trong im lang.
#
# Nay ban va `update-feed` doi hang so ay sang backend cua minh (do: chuoi `api2.cursor.sh/updates`
# xuat hien 0 lan trong bundle da cai). App khong con duong nao toi may chu hang, ke ca mo tran —
# nen updater song lai la AN TOAN, va no phuc vu kenh phat hanh cua minh:
# docs/plan/quy-trinh-phat-hanh-app-local.md
#
# `--verify` chot ca hai ve: thieu va feed la do, con `sandLab` sot lai cung la do.

# Khoa gateway cho tien trinh main cua app.
#
# Ban va `computer-tab` be cau IPC `getSandMachines` sang backend nay, va moi loi goi `/gw/api/*`
# deu phai co Bearer. Main KHONG doc duoc file trong repo (no chay tu C:\cai029), nen khoa di
# bang bien moi truong — cung duong ma bon bien kia da di.
#
# Thieu bien nay thi bang Settings -> Computer trong, chu khong vo: ban va tra `null` khi backend
# tu choi, va renderer coi `null` la "chua co du lieu".
$tokenFile = Join-Path $PSScriptRoot "..\..\services\grokbot-backend\.data\gateway-token.txt"
if (Test-Path $tokenFile) { $env:GROKBOT2_GATEWAY_TOKEN = (Get-Content $tokenFile -Raw).Trim() }
# Kho du lieu RIENG cho ban da va — de no dung canh app cua hang duoc.
#
# Khoa mot-ban cua Electron nam TRONG userData, va client doi userData truoc khi lay khoa:
#   cUn(): oUt(argv, env) -> app.setPath("userData", e); app.setPath("sessionData", e)
# nen hai ban chung userData thi ban thu hai tu thoat va chi focus ban dau. Chung userData con
# nghia la chung token va chung phien — hai tai khoan giam len nhau.
#
# Ban cua HANG giu cho mac dinh (%APPDATA%\Grok Bot) de no chay binh thuong tu Start menu; ban cua
# ta doi cho. Gia: lan dau sau thay doi nay phai dang nhap lai mot lan, vi token nam trong userData.
if (-not $env:SAND_USER_DATA_DIR) { $env:SAND_USER_DATA_DIR = Join-Path $env:APPDATA 'Grok Bot (local)' }
Write-Host "User data: $env:SAND_USER_DATA_DIR" -ForegroundColor DarkGray
Write-Host "Launching patched Grok Bot.exe  (CDP :$cdp, API :$bff) from $appExe" -ForegroundColor Cyan
$app = Start-Process -FilePath $appExe -ArgumentList "--remote-debugging-port=$cdp" -PassThru
if (-not $app) {
  Write-Host 'Start-Process returned no process. Retry from a console that is not running as Node.' -ForegroundColor Red
  exit 1
}
$cdpUp = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Seconds 1
  if (Test-HttpOk "http://127.0.0.1:$cdp/json/version") { $cdpUp = $true; break }
}
if (-not $cdpUp) {
  Write-Host "Grok Bot pid $($app.Id) started but CDP :$cdp did not answer. Unset ELECTRON_RUN_AS_NODE and retry." -ForegroundColor Red
  exit 1
}
Write-Host "Grok Bot pid $($app.Id) - CDP :$cdp up. Chat in the app window." -ForegroundColor Green

# F7 soak: dong dau "hom nay co dung app" ngay luc mo, chay nen, khong chan gi (06/09).
# soak-day.mjs chi tinh mot ngay khi patch-client --verify xanh TREN BAN VUA MO (GROKBOT2_CLIENT_DIR) va
# gateway da phuc vu >= 50 loi goi ke tu ngay ghi truoc; chay lai trong ngay chi cap nhat so cua ngay do,
# nen mo app nhieu lan khong sinh them ngay. Ban ghi luc mo co the con "does NOT count" (chua du loi goi)
# - `pnpm soak` cuoi ngay chot lai. Thieu node hay loi gi cung khong duoc lam hong lan mo app.
try {
  $env:GROKBOT2_CLIENT_DIR = Split-Path -Parent $appExe
  $soak = Join-Path $repo 'services\grokbot-backend\scripts\soak-day.mjs'
  Start-Process -FilePath 'node' -ArgumentList "`"$soak`"" -WorkingDirectory $repo -WindowStyle Hidden | Out-Null
  Write-Host 'soak: dang dong dau ngay dung app (nen).' -ForegroundColor DarkGray
} catch {
  Write-Host "soak: khong dong dau duoc ($_)" -ForegroundColor DarkGray
}
