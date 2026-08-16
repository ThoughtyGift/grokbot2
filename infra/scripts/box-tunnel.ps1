# Keep the box's Chrome DevTools port reachable from this machine.
#
# The browser tools drive Chrome INSIDE the box so the user can watch the agent work in the
# VNC pane. Its DevTools port is bound to 127.0.0.1 on the box on purpose (an open CDP port is
# unauthenticated remote code execution), so it is reached over an SSH tunnel, never published.
#
# Run directly to hold a tunnel in the foreground, or install it as a logon task:
#   infra\scripts\box-tunnel.ps1 -Install      # register + start
#   infra\scripts\box-tunnel.ps1 -Uninstall    # remove it again
#
# Connection details come from .env (never committed):
#   GROKBOT2_BOX_SSH=root@HOST:PORT
#   GROKBOT2_BOX_SSH_KEY=id_ed25519            # name under ~/.ssh, optional
#
# NOTE: ASCII only. Windows PowerShell 5.1 reads .ps1 as ANSI unless the file has a BOM, so a
# stray em dash or curly quote in a comment breaks the parser at load time.
param(
  [switch]$Install,
  [switch]$Uninstall,
  [int]$LocalPort = 9223,
  [int]$RemotePort = 9223
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot)
$taskName = 'GrokBot2 box tunnel'

# Installed into the per-user Startup folder rather than as a scheduled task: schtasks
# /sc onlogon needs elevation, and this needs none. Same effect, nothing system-wide.
$startup = [Environment]::GetFolderPath('Startup')
$shim = Join-Path $startup 'grokbot2-box-tunnel.cmd'

if ($Uninstall) {
  if (Test-Path $shim) { Remove-Item $shim -Force; Write-Host "Removed $shim" -ForegroundColor Yellow }
  else { Write-Host "Nothing installed at $shim" }
  schtasks /delete /tn $taskName /f 2>$null | Out-Null   # clean up an older install, if any
  Write-Host "A tunnel already running stays up until you close it."
  exit 0
}

if ($Install) {
  # start /min so logon does not flash a console window.
  @(
    '@echo off',
    "start `"grokbot2 tunnel`" /min powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$PSCommandPath`""
  ) | Set-Content -Path $shim -Encoding ascii

  if (-not (Test-Path $shim)) { Write-Error "Could not write $shim"; exit 1 }
  Write-Host "Installed: $shim (runs at logon)" -ForegroundColor Green

  Start-Process -FilePath $shim -WindowStyle Hidden
  Start-Sleep -Seconds 8
  # Report what actually happened, not what was attempted.
  try {
    Invoke-WebRequest "http://127.0.0.1:$LocalPort/json/version" -UseBasicParsing -TimeoutSec 5 | Out-Null
    Write-Host "Tunnel is up on 127.0.0.1:$LocalPort." -ForegroundColor Green
  } catch {
    Write-Host "Started, but 127.0.0.1:$LocalPort is not answering yet - check .env and the key." -ForegroundColor Yellow
  }
  Write-Host "Remove with: infra\scripts\box-tunnel.ps1 -Uninstall"
  exit 0
}

# --- read connection details from .env ---------------------------------------
$envFile = Join-Path $repo '.env'
if (-not (Test-Path $envFile)) { Write-Error "No .env at $envFile - see .env.example"; exit 1 }
$target = $null; $keyName = 'id_ed25519'
foreach ($line in Get-Content $envFile) {
  if ($line -match '^\s*GROKBOT2_BOX_SSH\s*=\s*(.+?)\s*$')     { $target  = $Matches[1] }
  if ($line -match '^\s*GROKBOT2_BOX_SSH_KEY\s*=\s*(.+?)\s*$') { $keyName = $Matches[1] }
}
if (-not $target) { Write-Error "GROKBOT2_BOX_SSH not set in .env (expected root@HOST:PORT)"; exit 1 }

# root@host:port  ->  user, host, port
if ($target -notmatch '^(?<user>[^@]+)@(?<host>[^:]+)(?::(?<port>\d+))?$') {
  Write-Error "GROKBOT2_BOX_SSH must look like root@HOST:PORT (got '$target')"; exit 1
}
$user = $Matches['user']; $boxHost = $Matches['host']
$sshPort = if ($Matches['port']) { $Matches['port'] } else { '22' }
$key = Join-Path $env:USERPROFILE ".ssh\$keyName"

$logFile = Join-Path $env:TEMP 'grokbot2-box-tunnel.log'
Write-Host "Tunnel 127.0.0.1:$LocalPort -> box:$RemotePort  (ssh $user@${boxHost}:$sshPort)"
Write-Host "ssh output goes to $logFile"

# --- hold it open, and put it back when it drops ------------------------------
# A dropped tunnel presents to the agent as "no page target", which reads as a broken backend
# rather than a dead link, so reconnect instead of exiting.
while ($true) {
  # Someone else already holds the port (a manual tunnel, a local Chrome): wait, do not fight.
  $busy = Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue
  if ($busy) { Start-Sleep -Seconds 15; continue }

  # Keep ssh's own words. Piping this to Out-Null hid "connect failed: Connection refused"
  # for long enough to send a diagnosis down the wrong path once already.
  & ssh -i $key -p $sshPort -N `
    -o ExitOnForwardFailure=yes -o BatchMode=yes `
    -o ServerAliveInterval=30 -o ServerAliveCountMax=3 `
    -o StrictHostKeyChecking=accept-new `
    -L "${LocalPort}:127.0.0.1:${RemotePort}" "$user@$boxHost" 2>&1 |
    ForEach-Object { "$(Get-Date -Format 'HH:mm:ss') $_" } | Add-Content -Path $logFile

  "$(Get-Date -Format 'HH:mm:ss') ssh exited, redialing in 5s" | Add-Content -Path $logFile
  Start-Sleep -Seconds 5   # ssh exited; back off briefly, then redial
}
