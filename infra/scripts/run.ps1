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

# launch app pointed at backend
$env:CURSOR_API_BASE_URL = "http://localhost:$port"
$env:SAND_BACKEND_URL = "http://localhost:$port"
if (-not (Test-Path $appExe)) { Write-Host "App not found: $appExe" -ForegroundColor Red; exit 1 }
Write-Host 'Launching Grok Bot. Type in the composer to chat via your Claude pool.' -ForegroundColor Cyan
& $appExe
