# Launch grokbot-backend + the stock Grok Bot app pointed at it (Windows).
$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot)          # repo root
$backend = Join-Path $repo 'services\grokbot-backend'
$appExe = "$env:LOCALAPPDATA\Programs\Grok Bot\Grok Bot.exe"
$port = 8788

Write-Host '=== Grok Bot 2 ===' -ForegroundColor Cyan

# CRITICAL: this env var makes the Electron exe run as Node (no GUI) — must be unset.
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

# stop old app + free port
Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like 'Grok Bot*' } | ForEach-Object { try { $_.Kill() } catch {} }
$c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($c) { $c.OwningProcess | Select-Object -Unique | ForEach-Object { try { Stop-Process -Id $_ -Force } catch {} } }
Start-Sleep -Milliseconds 700

# key check
$keyFile = Join-Path $backend 'pool-key.txt'
if ((Test-Path $keyFile) -and -not ((Get-Content $keyFile -Raw).Trim().StartsWith('PASTE_'))) {
  Write-Host 'Pool key: FOUND (chat → Claude pool).' -ForegroundColor Green
} else {
  Write-Host "Pool key: NOT SET. Put a hal_xxx key in $keyFile" -ForegroundColor Yellow
}

# start backend (new window, live logs)
Write-Host "Starting backend on :$port ..."
Start-Process powershell -ArgumentList @('-NoExit', '-Command', "Set-Location `"$backend`"; pnpm dev")
Start-Sleep -Seconds 3

# box check — the computer pane stays empty without a noVNC page URL (see .env / .env.example)
$envFile = Join-Path $repo '.env'
if ((Test-Path $envFile) -and ((Get-Content $envFile -Raw) -match '(?m)^\s*GROKBOT2_VNC_URL\s*=\s*\S')) {
  Write-Host 'Box VNC: configured (.env).' -ForegroundColor Green
} else {
  Write-Host 'Box VNC: NOT SET. The computer pane will report the box as off.' -ForegroundColor Yellow
  Write-Host '  Run infra/vps/grok-box-up.sh on the host and put the printed URL in .env as GROKBOT2_VNC_URL.'
}

# launch app pointed at backend
$env:CURSOR_API_BASE_URL = "http://localhost:$port"
$env:SAND_BACKEND_URL = "http://localhost:$port"
# Without this the app treats a localhost API base as dev mode and sends login to https://localhost:4443.
$env:CURSOR_WEBSITE_URL = 'https://cursor.com'
if (-not (Test-Path $appExe)) { Write-Host "App not found: $appExe" -ForegroundColor Red; exit 1 }
Write-Host 'Launching Grok Bot. Type in the composer to chat via your Claude pool.' -ForegroundColor Cyan
# CDP stays open so scripts/e2e-*.mjs can drive and inspect the real app (incl. the VNC webview).
& $appExe --remote-debugging-port=9222
