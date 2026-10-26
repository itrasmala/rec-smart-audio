<#
  REC Smart Audio - Audio Agent installer for Windows 10/11 / Windows Server 2019+
  تثبيت جهاز التشغيل كخدمة Windows

  Easiest: copy the one-line command from the dashboard (Devices > Add device).
  أسهل طريقة: انسخ الأمر الجاهز من لوحة التحكم (الأجهزة والسماعات > إضافة جهاز).

  Manual (PowerShell as Administrator, inside the agent folder):
      Set-ExecutionPolicy -Scope Process Bypass
      .\install\windows\install.ps1 -Server "https://audio.example.com" -Token "rec_xxx"

  Re-running is safe: it updates the program and, if -Token is given, the device token.
  Python 3.12 and NSSM are installed automatically when missing.
  Bluetooth: run the service as the user who paired the speaker:  -ServiceUser ".\recaudio"
#>
param(
  [string]$Server = "",
  [string]$Token = "",
  [string]$ServiceUser = "",
  [string]$InstallDir = "$env:ProgramFiles\REC-Audio-Agent",
  [string]$DataDir = "$env:ProgramData\REC-Audio-Agent",
  [switch]$KeepSleepSettings
)
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$ServiceName = "RECAudioAgent"
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

# console output is English only: the classic Windows console cannot render Arabic correctly
function Step($en, $ar) { Write-Host ""; Write-Host "==> $en" -ForegroundColor Cyan }
function Ok($msg) { Write-Host "    [OK] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    [!] $msg" -ForegroundColor Yellow }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}

$id = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw "Run PowerShell as Administrator"
}

$Src = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

# ------------------------------------------------------------------ Python
function Find-Python {
  $candidates = @()
  foreach ($c in @("py", "python")) {
    $cmd = Get-Command $c -ErrorAction SilentlyContinue
    if ($cmd) { $candidates += $cmd.Source }
  }
  $candidates += Get-ChildItem "$env:ProgramFiles\Python3*\python.exe", "$env:LOCALAPPDATA\Programs\Python\Python3*\python.exe" -ErrorAction SilentlyContinue | ForEach-Object FullName
  foreach ($c in $candidates) {
    if ($c -like "*WindowsApps*") { continue }   # Microsoft Store stub, not a real Python
    try {
      $args_ = if ((Split-Path $c -Leaf) -eq "py.exe") { @("-3", "-c") } else { @("-c") }
      $exe = & $c @args_ "import sys; print(sys.executable if sys.version_info >= (3,10) else '')" 2>$null
      if ($LASTEXITCODE -eq 0 -and $exe -and (Test-Path $exe.Trim())) { return $exe.Trim() }
    } catch {}
  }
  return $null
}

Step "Checking Python 3.10+" "التحقق من Python"
$PythonExe = Find-Python
if (-not $PythonExe) {
  Warn "Python not found - installing Python 3.12 (this takes a minute)"
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    & winget install -e --id Python.Python.3.12 --scope machine --silent --accept-package-agreements --accept-source-agreements | Out-Null
    Refresh-Path
    $PythonExe = Find-Python
  }
  if (-not $PythonExe) {
    $pyUrl = "https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe"
    $pyInst = Join-Path $env:TEMP "python-3.12-installer.exe"
    Invoke-WebRequest -UseBasicParsing $pyUrl -OutFile $pyInst
    Start-Process $pyInst -ArgumentList "/quiet InstallAllUsers=1 PrependPath=1 Include_test=0 Include_launcher=1" -Wait
    Remove-Item $pyInst -Force -ErrorAction SilentlyContinue
    Refresh-Path
    $PythonExe = Find-Python
  }
  if (-not $PythonExe) { throw "Could not install Python automatically. Install Python 3.12 from python.org (Install for all users) and run this command again." }
}
Ok "Python: $PythonExe"

# ------------------------------------------------------------------ program files
Step "Installing REC Audio Agent to $InstallDir" "نسخ البرنامج"
New-Item -ItemType Directory -Force -Path $InstallDir, $DataDir, "$DataDir\logs" | Out-Null
$existingSvc = Get-Service $ServiceName -ErrorAction SilentlyContinue
$Nssm = $null
foreach ($n in @((Get-Command nssm -ErrorAction SilentlyContinue).Source, "$InstallDir\nssm.exe", (Join-Path $PSScriptRoot "nssm.exe"))) {
  if ($n -and (Test-Path $n)) { $Nssm = $n; break }
}
if ($existingSvc -and $existingSvc.Status -eq "Running") {
  Warn "Stopping the running service for the update"
  if ($Nssm) { & $Nssm stop $ServiceName | Out-Null } else { Stop-Service $ServiceName -Force }
}
if (Get-ScheduledTask -TaskName $ServiceName -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $ServiceName -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*rec_agent*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1

Remove-Item -Recurse -Force "$InstallDir\rec_agent" -ErrorAction SilentlyContinue
Copy-Item -Recurse "$Src\rec_agent" "$InstallDir\rec_agent"
Copy-Item "$Src\requirements.txt", "$Src\config.example.toml" $InstallDir -Force
if (Test-Path "$Src\install") { Copy-Item -Recurse -Force "$Src\install" "$InstallDir\" }
Get-ChildItem -Recurse "$InstallDir\rec_agent" -Include "__pycache__" -Directory | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Ok "Files copied"

Step "Installing Python libraries" "تثبيت المكتبات"
if (-not (Test-Path "$InstallDir\venv\Scripts\python.exe")) { & $PythonExe -m venv "$InstallDir\venv" }
$VPy = "$InstallDir\venv\Scripts\python.exe"
& $VPy -m pip install --upgrade pip -q --disable-pip-version-check | Out-Null
& $VPy -m pip install -r "$InstallDir\requirements.txt" -q --disable-pip-version-check
if ($LASTEXITCODE -ne 0) { throw "pip install failed - check internet access to pypi.org" }
# make `python -m rec_agent` work from any directory
$site = (& $VPy -c "import sysconfig; print(sysconfig.get_paths()['purelib'])").Trim()
[IO.File]::WriteAllText((Join-Path $site "rec-agent.pth"), $InstallDir, (New-Object Text.UTF8Encoding $false))
Ok "Libraries installed"

# ------------------------------------------------------------------ config
Step "Writing configuration" "حفظ الإعدادات"
$Conf = "$DataDir\config.toml"
if (-not (Test-Path $Conf)) {
  if (-not $Server) { $Server = Read-Host "Server URL (https://...)" }
  if (-not $Token) { $Token = Read-Host "Device token" }
  $content = Get-Content "$Src\config.example.toml" -Raw -Encoding UTF8
  $content = $content -replace '(?m)^# data_dir = .*$', ("data_dir = '" + $DataDir + "'")
} else {
  $content = Get-Content $Conf -Raw -Encoding UTF8
}
if ($Server) { $content = $content -replace '(?m)^server_url = .*$', ("server_url = `"" + $Server.TrimEnd('/') + "`"") }
if ($Token) { $content = $content -replace '(?m)^token = .*$', ("token = `"" + $Token + "`"") }
[IO.File]::WriteAllText($Conf, $content, (New-Object Text.UTF8Encoding $false))
# config holds the device token: Administrators + SYSTEM only (+ service user)
icacls $Conf /inheritance:r /grant:r "Administrators:F" "SYSTEM:F" | Out-Null
if ($ServiceUser) {
  icacls $Conf /grant:r "${ServiceUser}:R" | Out-Null
  icacls $DataDir /grant "${ServiceUser}:(OI)(CI)M" | Out-Null
}
Ok $Conf

Step "Checking connection to the server" "اختبار الاتصال بالخادم"
& $VPy -m rec_agent --config $Conf --check
if ($LASTEXITCODE -ne 0) { Warn "Server not reachable right now - the agent will keep retrying in the background" }

# ------------------------------------------------------------------ NSSM
if (-not $Nssm) {
  Step "Getting NSSM (service manager)" "تنزيل مدير الخدمة"
  try {
    $zip = Join-Path $env:TEMP "nssm.zip"
    Invoke-WebRequest -UseBasicParsing "https://nssm.cc/release/nssm-2.24.zip" -OutFile $zip -TimeoutSec 60
    $ex = Join-Path $env:TEMP "nssm-extract"
    Remove-Item -Recurse -Force $ex -ErrorAction SilentlyContinue
    Expand-Archive $zip $ex -Force
    $arch = if ([Environment]::Is64BitOperatingSystem) { "win64" } else { "win32" }
    Copy-Item (Get-ChildItem $ex -Recurse -Filter nssm.exe | Where-Object { $_.FullName -like "*\$arch\*" } | Select-Object -First 1).FullName "$InstallDir\nssm.exe" -Force
    $Nssm = "$InstallDir\nssm.exe"
    Remove-Item $zip, $ex -Recurse -Force -ErrorAction SilentlyContinue
  } catch {
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
      & winget install -e --id NSSM.NSSM --silent --accept-package-agreements --accept-source-agreements | Out-Null
      Refresh-Path
      $Nssm = (Get-Command nssm -ErrorAction SilentlyContinue).Source
    }
  }
}

# ------------------------------------------------------------------ service / startup task
if ($Nssm) {
  Step "Registering Windows service '$ServiceName'" "تسجيل خدمة Windows"
  if (Get-ScheduledTask -TaskName $ServiceName -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $ServiceName -Confirm:$false }
  if (-not (Get-Service $ServiceName -ErrorAction SilentlyContinue)) { & $Nssm install $ServiceName $VPy | Out-Null }
  & $Nssm set $ServiceName Application $VPy | Out-Null
  & $Nssm set $ServiceName AppDirectory $InstallDir | Out-Null
  & $Nssm set $ServiceName AppParameters "-m rec_agent --config `"$Conf`"" | Out-Null
  & $Nssm set $ServiceName DisplayName "REC Smart Audio Agent" | Out-Null
  & $Nssm set $ServiceName Description "REC Smart Audio - adhan and announcements on the building speakers" | Out-Null
  & $Nssm set $ServiceName Start SERVICE_AUTO_START | Out-Null
  & $Nssm set $ServiceName AppEnvironmentExtra "PYTHONUNBUFFERED=1" "PYTHONIOENCODING=utf-8" | Out-Null
  & $Nssm set $ServiceName AppStdout "$DataDir\logs\service.out.log" | Out-Null
  & $Nssm set $ServiceName AppStderr "$DataDir\logs\service.err.log" | Out-Null
  & $Nssm set $ServiceName AppRotateFiles 1 | Out-Null
  & $Nssm set $ServiceName AppRotateBytes 5242880 | Out-Null
  # restart on ANY exit after 5 s, never throttle
  & $Nssm set $ServiceName AppExit Default Restart | Out-Null
  & $Nssm set $ServiceName AppRestartDelay 5000 | Out-Null
  & $Nssm set $ServiceName AppThrottle 0 | Out-Null
  & $Nssm set $ServiceName AppPriority ABOVE_NORMAL_PRIORITY_CLASS | Out-Null
  sc.exe failure $ServiceName reset= 0 actions= restart/5000/restart/5000/restart/10000 | Out-Null
  sc.exe failureflag $ServiceName 1 | Out-Null
  sc.exe config $ServiceName depend= Audiosrv/AudioEndpointBuilder | Out-Null
  if ($ServiceUser) {
    $cred = Get-Credential -UserName $ServiceUser -Message "Password for $ServiceUser"
    & $Nssm set $ServiceName ObjectName $cred.UserName $cred.GetNetworkCredential().Password | Out-Null
  }
  & $Nssm start $ServiceName | Out-Null
  $mode = "Windows service (NSSM)"
} else {
  # Fallback without NSSM: a startup task that restarts itself every minute if it stops
  Step "NSSM unavailable - registering a startup task instead" "تسجيل مهمة تبدأ مع تشغيل الجهاز"
  $action = New-ScheduledTaskAction -Execute $VPy -Argument "-m rec_agent --config `"$Conf`"" -WorkingDirectory $InstallDir
  $trigger = New-ScheduledTaskTrigger -AtStartup
  $settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $ServiceName -Action $action -Trigger $trigger -Settings $settings -User "SYSTEM" -RunLevel Highest -Force | Out-Null
  Start-ScheduledTask -TaskName $ServiceName
  $mode = "Startup task (Task Scheduler)"
}

# ------------------------------------------------------------------ 24/7
if (-not $KeepSleepSettings) {
  powercfg /change standby-timeout-ac 0 | Out-Null
  powercfg /change hibernate-timeout-ac 0 | Out-Null
  powercfg /change disk-timeout-ac 0 | Out-Null
}

Start-Sleep -Seconds 6
$healthy = $false
try { $h = Invoke-RestMethod http://127.0.0.1:8765/health -TimeoutSec 5; $healthy = $true } catch {}

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host " REC Audio Agent installed" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host " Runs as:  $mode  (starts with Windows, restarts on failure)"
if ($healthy) { Write-Host " Status:   running - output: $($h.output.name)" -ForegroundColor Green }
else { Write-Host " Status:   starting... check the dashboard in a few seconds" -ForegroundColor Yellow }
Write-Host " Log:      $DataDir\logs\agent.log"
Write-Host " Outputs:  & '$VPy' -m rec_agent --config '$Conf' --list-outputs"
Write-Host ""
Write-Host " Next: open the dashboard > Live control > Test speakers"
