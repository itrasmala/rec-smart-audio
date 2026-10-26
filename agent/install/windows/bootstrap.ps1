<#
  REC Smart Audio - one-line installer (served by your server at /agent/install.ps1)

  The dashboard gives you this command, ready to paste into PowerShell:
    powershell -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create((irm 'https://SERVER/agent/install.ps1'))) -Server 'https://SERVER' -Token 'rec_...'"

  It downloads the agent from YOUR server (not from the internet), then runs install.ps1.
#>
param(
  [Parameter(Mandatory = $true)][string]$Server,
  [Parameter(Mandatory = $true)][string]$Token,
  [string]$ServiceUser = ""
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$Server = $Server.TrimEnd('/')

# ---- self-elevate (the service needs administrator rights) ----
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host "Asking for administrator rights..." -ForegroundColor Cyan
  $self = Join-Path $env:TEMP "rec-agent-bootstrap.ps1"
  $body = $MyInvocation.MyCommand.ScriptBlock.ToString()
  [IO.File]::WriteAllText($self, $body, (New-Object Text.UTF8Encoding $true))
  $argList = "-NoProfile -ExecutionPolicy Bypass -NoExit -File `"$self`" -Server `"$Server`" -Token `"$Token`""
  if ($ServiceUser) { $argList += " -ServiceUser `"$ServiceUser`"" }
  Start-Process powershell -Verb RunAs -ArgumentList $argList
  Write-Host "Continue in the new administrator window." -ForegroundColor Yellow
  return
}

Write-Host ""
Write-Host "REC Smart Audio - installing the playback agent" -ForegroundColor Cyan
Write-Host "Server: $Server"

$tar = Join-Path $env:SystemRoot "System32\tar.exe"
if (-not (Test-Path $tar)) { throw "tar.exe not found - Windows 10 (1803) or newer is required" }

$work = Join-Path $env:TEMP ("rec-agent-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Force -Path $work | Out-Null
$pkg = Join-Path $work "rec-agent.tar.gz"
Write-Host "==> Downloading agent package from your server" -ForegroundColor Cyan
Invoke-WebRequest -UseBasicParsing "$Server/agent/rec-agent.tar.gz" -OutFile $pkg -TimeoutSec 120
& $tar -xzf $pkg -C $work
if ($LASTEXITCODE -ne 0) { throw "Could not extract the agent package" }

try {
  $params = @{ Server = $Server; Token = $Token }
  if ($ServiceUser) { $params.ServiceUser = $ServiceUser }
  & (Join-Path $work "install\windows\install.ps1") @params
} finally {
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
  Remove-Item (Join-Path $env:TEMP "rec-agent-bootstrap.ps1") -Force -ErrorAction SilentlyContinue
}
