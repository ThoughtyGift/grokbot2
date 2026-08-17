# Keep the box's Chrome DevTools port reachable from this machine.
#
# The browser tools drive Chrome INSIDE the box so the user can watch the agent work in the
# VNC pane. Its DevTools port is bound to 127.0.0.1 on the box on purpose (an open CDP port is
# unauthenticated remote code execution), so it is reached over an SSH tunnel, never published.
#
# Run directly to hold a tunnel in the foreground, or install it as a logon task:
#   infra\scripts\box-tunnel.ps1 -Install      # register + start
#   infra\scripts\box-tunnel.ps1 -Uninstall    # remove it again
#   infra\scripts\box-tunnel.ps1 -Status       # up / blocked / down, in one line
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
  [switch]$Status,
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

function Write-Log([string]$msg) {
  $line = "$(Get-Date -Format 'HH:mm:ss') $msg"
  Add-Content -Path $logFile -Value $line
  Write-Host $line
}

# The only question that matters is whether CDP answers, not whether something is bound.
# A bound port proves a socket exists; a half-dead ssh keeps one bound while forwarding
# nothing, which is exactly the state that reads as "the backend is broken".
function Test-Tunnel([int]$port) {
  try {
    Invoke-WebRequest "http://127.0.0.1:$port/json/version" -UseBasicParsing -TimeoutSec 4 | Out-Null
    return $true
  } catch { return $false }
}

function Get-PortOwner([int]$port) {
  $c = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $c) { return $null }
  $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue
  return [pscustomobject]@{ Pid = $c.OwningProcess; Name = if ($p) { $p.ProcessName } else { 'unknown' } }
}

if ($Status) {
  $owner = Get-PortOwner $LocalPort
  if (Test-Tunnel $LocalPort)  { Write-Host "UP    127.0.0.1:$LocalPort answers CDP (held by $($owner.Name), PID $($owner.Pid))" -ForegroundColor Green }
  elseif ($owner)              { Write-Host "STUCK 127.0.0.1:$LocalPort is held by $($owner.Name) (PID $($owner.Pid)) but does not answer CDP" -ForegroundColor Red }
  else                         { Write-Host "DOWN  nothing is listening on 127.0.0.1:$LocalPort" -ForegroundColor Yellow }
  Write-Host "log: $logFile"
  exit 0
}

Write-Log "tunnel loop start: 127.0.0.1:$LocalPort -> box:$RemotePort (ssh $user@${boxHost}:$sshPort)"

# --- hold it open, and put it back when it drops ------------------------------
# A dropped tunnel presents to the agent as "no page target", which reads as a broken backend
# rather than a dead link, so reconnect instead of exiting.
#
# The previous version skipped a cycle whenever ANYTHING held the port and logged nothing until
# ssh exited. With a manual `ssh -L` already running that meant an empty log and a loop that
# never dialed and never explained itself - it read as hung. Decide on the CDP probe instead,
# and say which of the three states we are in every time it changes.
$lastState = ''
while ($true) {
  $owner = Get-PortOwner $LocalPort

  if (Test-Tunnel $LocalPort) {
    # Working, whoever owns it. Someone else's tunnel is still a tunnel.
    if ($lastState -ne 'up') { Write-Log "up: CDP answers on $LocalPort (held by $($owner.Name), PID $($owner.Pid)) - standing by" }
    $lastState = 'up'
    Start-Sleep -Seconds 15
    continue
  }

  if ($owner) {
    # Bound but not answering. Binding again is impossible, so report it rather than
    # silently spinning - this is the state that needs a human.
    if ($lastState -ne 'blocked') { Write-Log "blocked: $($owner.Name) (PID $($owner.Pid)) holds $LocalPort but CDP does not answer - close it, or run with -LocalPort <other>" }
    $lastState = 'blocked'
    Start-Sleep -Seconds 15
    continue
  }

  if ($lastState -ne 'dialing') { Write-Log "dialing ssh" }
  $lastState = 'dialing'

  # Keep ssh's own words. Piping this to Out-Null hid "connect failed: Connection refused"
  # for long enough to send a diagnosis down the wrong path once already.
  & ssh -i $key -p $sshPort -N `
    -o ExitOnForwardFailure=yes -o BatchMode=yes `
    -o ServerAliveInterval=30 -o ServerAliveCountMax=3 `
    -o StrictHostKeyChecking=accept-new `
    -L "${LocalPort}:127.0.0.1:${RemotePort}" "$user@$boxHost" 2>&1 |
    ForEach-Object { "$(Get-Date -Format 'HH:mm:ss') ssh: $_" } | Add-Content -Path $logFile

  Write-Log "ssh exited, redialing in 5s"
  $lastState = ''
  Start-Sleep -Seconds 5
}
