# grokbot2 web — do not spawn Grok Bot.exe
$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $repo
Write-Host "grokbot2 web on http://localhost:5173  (proxies /v1 -> :8788)"
Write-Host "Start the BFF first if it is not up: pnpm backend"
pnpm --filter @grokbot2/web dev
