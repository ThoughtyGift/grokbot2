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
    'C:\cai\Grok Bot.exe',
    "$env:LOCALAPPDATA\Bot Noi Bo\Grok Bot.exe"
  )) { if (Test-Path $c) { $appExe = $c; break } }
}
if (-not $appExe) { $appExe = "$env:LOCALAPPDATA\Programs\Grok Bot\Grok Bot.exe" }
$bff = 8788

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
if ((Test-Path $keyFile) -and -not ((Get-Content $keyFile -Raw).Trim().StartsWith('PASTE_'))) {
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

if (Test-HttpOk 'http://127.0.0.1:9222/json/version') {
  Write-Host 'Grok Bot already on CDP :9222 - leaving it. Close it and re-run to relaunch with a fresh env.' -ForegroundColor Green
  exit 0
}

Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like 'Grok Bot*' } | ForEach-Object {
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
# ROADMAP F6 / risk R1. The app's own kill switch, not a hack: main.cjs decides with
#   hzn(t) { return t.envDisabled ? "disabled-by-env" : t.isLabBuild ? ... }
# and `envDisabled` is `process.env.SAND_DISABLE_UPDATES === "1"`, checked FIRST, so it wins over
# every other branch. An update would overwrite resources/app and silently drop the patch set —
# the app would keep working and quietly stop being ours. Pin the version instead; re-apply
# deliberately with `node infra/scripts/patch-client.mjs --apply` after reviewing a new release.
$env:SAND_DISABLE_UPDATES = '1'
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
Write-Host 'Launching patched Grok Bot.exe  (CDP :9222, API :8788)' -ForegroundColor Cyan
$app = Start-Process -FilePath $appExe -ArgumentList '--remote-debugging-port=9222' -PassThru
if (-not $app) {
  Write-Host 'Start-Process returned no process. Retry from a console that is not running as Node.' -ForegroundColor Red
  exit 1
}
$cdpUp = $false
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Seconds 1
  if (Test-HttpOk 'http://127.0.0.1:9222/json/version') { $cdpUp = $true; break }
}
if (-not $cdpUp) {
  Write-Host "Grok Bot pid $($app.Id) started but CDP :9222 did not answer. Unset ELECTRON_RUN_AS_NODE and retry." -ForegroundColor Red
  exit 1
}
Write-Host "Grok Bot pid $($app.Id) - CDP :9222 up. Chat in the app window." -ForegroundColor Green
