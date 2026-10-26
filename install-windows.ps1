<#
  REC Smart Audio — تثبيت كامل على كمبيوتر Windows واحد (بدون سيرفر)
  Full install on ONE Windows PC: dashboard + database + speaker agent. No cloud server.

  Open PowerShell and paste (keep this file WITHOUT a BOM: `irm | iex` breaks on one):
      irm https://raw.githubusercontent.com/itrasmala/rec-smart-audio/main/install-windows.ps1 | iex

  - Downloads a ready-built package (built by GitHub Actions) — nothing to compile.
  - Includes its own Node.js and a built-in database; installs Python automatically if missing.
  - Registers two Windows services that start with the PC and restart themselves:
      RECAudioServer  (dashboard + database, port 4000)
      RECAudioAgent   (plays the adhan/announcements on this PC's speakers)
  - Dashboard: http://localhost:4000 on this PC, http://<this-PC-IP>:4000 from phones on the same network.
  Re-running the same command updates the program and keeps all data.
#>
param(
  [string]$InstallDir = "C:\REC-Smart-Audio",
  [int]$Port = 4000,
  [string]$BundleUrl = "https://github.com/itrasmala/rec-smart-audio/releases/download/windows-bundle/rec-smart-audio-windows.zip"
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$ScriptUrl = "https://raw.githubusercontent.com/itrasmala/rec-smart-audio/main/install-windows.ps1"
$ServerService = "RECAudioServer"

function Step($en, $ar) { Write-Host ""; Write-Host "==> $en" -ForegroundColor Cyan; if ($ar) { Write-Host "    $ar" -ForegroundColor DarkGray } }
function Ok($msg) { Write-Host "    [OK] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    [!] $msg" -ForegroundColor Yellow }

# ------------------------------------------------------------------ administrator
$id = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host "Asking for administrator rights... | طلب صلاحيات المسؤول" -ForegroundColor Cyan
  $cmd = "irm '$ScriptUrl' | iex"
  if ($PSCommandPath) { $cmd = "& '$PSCommandPath' -InstallDir '$InstallDir' -Port $Port" }
  Start-Process powershell -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -NoExit -Command `"$cmd`""
  Write-Host "Continue in the new administrator window. | أكمل في النافذة الجديدة." -ForegroundColor Yellow
  return
}

Write-Host ""
Write-Host "REC Smart Audio - installing on this PC (no server needed)" -ForegroundColor Cyan
Write-Host "تثبيت نظام الإذاعة والأذان على هذا الكمبيوتر" -ForegroundColor Cyan

$App = Join-Path $InstallDir "app"
$Data = Join-Path $InstallDir "data"
New-Item -ItemType Directory -Force -Path $InstallDir, $Data, "$Data\logs" | Out-Null
# data holds the database and the device token: Administrators + SYSTEM only
icacls $Data /inheritance:r /grant:r "Administrators:(OI)(CI)F" "SYSTEM:(OI)(CI)F" | Out-Null

# ------------------------------------------------------------------ port check
$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  $owner = (Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue).Path
  if ($owner -and ($owner -notlike "$App*")) { throw "Port $Port is already used by $owner. Re-run with another port:  & ([scriptblock]::Create((irm '$ScriptUrl'))) -Port 4010" }
}

# ------------------------------------------------------------------ download package
Step "Downloading the program" "تنزيل البرنامج"
$zip = Join-Path $env:TEMP "rec-smart-audio-windows.zip"
try {
  Invoke-WebRequest -UseBasicParsing $BundleUrl -OutFile $zip -TimeoutSec 600
} catch {
  throw "Could not download $BundleUrl. Open the GitHub repository > Actions and check that 'Windows package' finished (green), then run this command again."
}
Ok ("{0:N1} MB" -f ((Get-Item $zip).Length / 1MB))

# ------------------------------------------------------------------ stop running services
$Nssm = $null
foreach ($n in @("$InstallDir\nssm.exe", (Get-Command nssm -ErrorAction SilentlyContinue).Source)) { if ($n -and (Test-Path $n)) { $Nssm = $n; break } }
if (Get-Service $ServerService -ErrorAction SilentlyContinue) {
  Warn "Stopping the running server for the update"
  if ($Nssm) { & $Nssm stop $ServerService | Out-Null } else { Stop-Service $ServerService -Force }
}
if (Get-ScheduledTask -TaskName $ServerService -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $ServerService -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ExecutablePath -like "$App*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
Start-Sleep -Seconds 2

Step "Installing to $App" "تثبيت الملفات"
$tmp = Join-Path $env:TEMP ("rec-pkg-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
& (Join-Path $env:SystemRoot "System32\tar.exe") -xf $zip -C $tmp
if ($LASTEXITCODE -ne 0) { throw "Could not extract the package" }
if (Test-Path $App) { Remove-Item -Recurse -Force $App }
Move-Item (Join-Path $tmp "app") $App
Remove-Item -Recurse -Force $tmp, $zip -ErrorAction SilentlyContinue
Ok "Files ready"

# ------------------------------------------------------------------ settings
$codeFile = Join-Path $Data "setup-code.txt"
if (-not (Test-Path $codeFile)) {
  $alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".ToCharArray()
  $bytes = New-Object byte[] 8; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $code = -join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
  Set-Content -Path $codeFile -Value ($code.Substring(0, 4) + "-" + $code.Substring(4, 4)) -Encoding ASCII
}
$SetupCode = (Get-Content $codeFile -Raw).Trim()

# the service runs this wrapper, which sets the environment for the server
$runner = Join-Path $InstallDir "run-server.cmd"
@"
@echo off
rem REC Smart Audio server (generated by install-windows.ps1)
set NODE_ENV=production
set HOST=0.0.0.0
set PORT=$Port
set DB_DIR=$Data\db
set STORAGE_DIR=$Data\audio
set WEB_DIR=$App\web\out
set AGENT_DIR=$App\agent
set COOKIE_SECURE=false
set TRUST_PROXY=false
set SETUP_CODE=$SetupCode
set LOCAL_AGENT_TOKEN_FILE=$Data\agent-token.txt
set LOG_LEVEL=info
cd /d "$App\server"
"$App\node.exe" dist\index.js
"@ | Set-Content -Path $runner -Encoding ASCII

# ------------------------------------------------------------------ NSSM
if (-not $Nssm) {
  Step "Getting the service manager (NSSM)" "تنزيل مدير الخدمات"
  try {
    $nz = Join-Path $env:TEMP "nssm.zip"
    Invoke-WebRequest -UseBasicParsing "https://nssm.cc/release/nssm-2.24.zip" -OutFile $nz -TimeoutSec 60
    $ex = Join-Path $env:TEMP "nssm-extract"; Remove-Item -Recurse -Force $ex -ErrorAction SilentlyContinue
    Expand-Archive $nz $ex -Force
    $arch = if ([Environment]::Is64BitOperatingSystem) { "win64" } else { "win32" }
    Copy-Item (Get-ChildItem $ex -Recurse -Filter nssm.exe | Where-Object { $_.FullName -like "*\$arch\*" } | Select-Object -First 1).FullName "$InstallDir\nssm.exe" -Force
    $Nssm = "$InstallDir\nssm.exe"
    Remove-Item $nz, $ex -Recurse -Force -ErrorAction SilentlyContinue
    Ok "NSSM ready"
  } catch {
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
      & winget install -e --id NSSM.NSSM --silent --accept-package-agreements --accept-source-agreements | Out-Null
      $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
      $Nssm = (Get-Command nssm -ErrorAction SilentlyContinue).Source
    }
    if (-not $Nssm) { Warn "NSSM unavailable - using a startup task instead" }
  }
}

# ------------------------------------------------------------------ server service
Step "Starting the dashboard service" "تشغيل خدمة لوحة التحكم"
if ($Nssm) {
  if (Get-ScheduledTask -TaskName $ServerService -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $ServerService -Confirm:$false }
  if (-not (Get-Service $ServerService -ErrorAction SilentlyContinue)) { & $Nssm install $ServerService "$env:SystemRoot\System32\cmd.exe" | Out-Null }
  & $Nssm set $ServerService Application "$env:SystemRoot\System32\cmd.exe" | Out-Null
  & $Nssm set $ServerService AppParameters "/c `"$runner`"" | Out-Null
  & $Nssm set $ServerService AppDirectory $InstallDir | Out-Null
  & $Nssm set $ServerService DisplayName "REC Smart Audio Server" | Out-Null
  & $Nssm set $ServerService Description "REC Smart Audio - dashboard and database" | Out-Null
  & $Nssm set $ServerService Start SERVICE_AUTO_START | Out-Null
  & $Nssm set $ServerService AppStdout "$Data\logs\server.log" | Out-Null
  & $Nssm set $ServerService AppStderr "$Data\logs\server.log" | Out-Null
  & $Nssm set $ServerService AppRotateFiles 1 | Out-Null
  & $Nssm set $ServerService AppRotateBytes 10485760 | Out-Null
  & $Nssm set $ServerService AppExit Default Restart | Out-Null
  & $Nssm set $ServerService AppRestartDelay 3000 | Out-Null
  & $Nssm set $ServerService AppThrottle 0 | Out-Null
  & $Nssm set $ServerService AppStopMethodConsole 15000 | Out-Null
  sc.exe failure $ServerService reset= 0 actions= restart/5000/restart/5000/restart/10000 | Out-Null
  & $Nssm start $ServerService | Out-Null
} else {
  $action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\cmd.exe" -Argument "/c `"$runner`" >> `"$Data\logs\server.log`" 2>&1"
  $settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $ServerService -Action $action -Trigger (New-ScheduledTaskTrigger -AtStartup) -Settings $settings -User "SYSTEM" -RunLevel Highest -Force | Out-Null
  Start-ScheduledTask -TaskName $ServerService
}

$up = $false
for ($i = 0; $i -lt 90; $i++) {
  try { $null = Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 3; $up = $true; break } catch { Start-Sleep -Seconds 2 }
}
if (-not $up) {
  Get-Content "$Data\logs\server.log" -Tail 30 -ErrorAction SilentlyContinue
  throw "The dashboard did not start. Send the lines above to support."
}
Ok "Dashboard running on port $Port"

# ------------------------------------------------------------------ firewall (local network only)
Get-NetFirewallRule -DisplayName "REC Smart Audio" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName "REC Smart Audio" -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow `
  -Profile Domain, Private, Public -RemoteAddress LocalSubnet | Out-Null
Ok "Firewall: phones on the same network can open the dashboard"

# ------------------------------------------------------------------ speaker agent on this PC
Step "Connecting this PC's speakers" "ربط سماعات هذا الكمبيوتر"
$tokenFile = Join-Path $Data "agent-token.txt"
for ($i = 0; $i -lt 30 -and -not (Test-Path $tokenFile); $i++) { Start-Sleep -Seconds 1 }
if (-not (Test-Path $tokenFile)) { throw "The device token was not created - see $Data\logs\server.log" }
$token = (Get-Content $tokenFile -Raw).Trim()
& (Join-Path $App "agent\install\windows\install.ps1") -Server "http://127.0.0.1:$Port" -Token $token

# ------------------------------------------------------------------ shortcut + summary
$shortcut = Join-Path ([Environment]::GetFolderPath("CommonDesktopDirectory")) "REC Smart Audio.url"
"[InternetShortcut]`r`nURL=http://localhost:$Port/`r`n" | Set-Content -Path $shortcut -Encoding ASCII

$ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" -and $_.PrefixOrigin -ne "WellKnown" } |
  Select-Object -ExpandProperty IPAddress
$needsSetup = $false
try { $needsSetup = (Invoke-RestMethod "http://127.0.0.1:$Port/api/setup/status").needsSetup } catch {}

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host " REC Smart Audio is ready  |  النظام جاهز" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host " On this PC / على هذا الكمبيوتر:      http://localhost:$Port"
foreach ($ip in $ips) { Write-Host " From phones on the network / من الجوال: http://${ip}:$Port" }
if ($needsSetup) {
  Write-Host ""
  Write-Host " Setup code / رمز الإعداد:  $SetupCode" -ForegroundColor Yellow
  Write-Host " Open the dashboard and enter this code to create the admin account."
  Write-Host " افتح لوحة التحكم وأدخل هذا الرمز لإنشاء حساب المدير."
}
Write-Host ""
Write-Host " A 'REC Smart Audio' shortcut was added to the desktop."
Write-Host " Update later: run the same command again (your data is kept)."
Start-Process "http://localhost:$Port/"
