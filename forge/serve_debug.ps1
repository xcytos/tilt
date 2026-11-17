# serve_debug.ps1 - launch TILT FORGE in this window with runtime debug
# logging. Usage (separate visible terminal, never blocked):
#   powershell -NoExit -File serve_debug.ps1
# Log streams to console AND forge/forge.log (rotating, UTF-8).
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$env:FORGE_LOG_LEVEL = if ($args[0]) { $args[0] } else { "DEBUG" }
Set-Location $PSScriptRoot
Write-Host "FORGE_LOG_LEVEL=$env:FORGE_LOG_LEVEL  log=$PSScriptRoot\forge.log" -ForegroundColor Cyan
python forge_server.py
Write-Host "forge exited (code $LASTEXITCODE) - window stays open" -ForegroundColor Yellow
