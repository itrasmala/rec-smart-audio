<#
  REC Smart Audio — إزالة التثبيت من هذا الكمبيوتر
  Removes the services. Your data (database, audio files) is kept unless you add -RemoveData.
     & "C:\REC-Smart-Audio\uninstall-windows.ps1"            (PowerShell as Administrator)
#>
param([string]$InstallDir = "C:\REC-Smart-Audio", [switch]$RemoveData)
$ErrorActionPreference = "Continue"
$nssm = "$InstallDir\nssm.exe"
foreach ($svc in @("RECAudioServer", "RECAudioAgent")) {
  if (Get-Service $svc -ErrorAction SilentlyContinue) {
    if (Test-Path $nssm) { & $nssm stop $svc | Out-Null; & $nssm remove $svc confirm | Out-Null }
    else { Stop-Service $svc -Force; sc.exe delete $svc | Out-Null }
  }
  if (Get-ScheduledTask -TaskName $svc -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $svc; Unregister-ScheduledTask -TaskName $svc -Confirm:$false
  }
}
Get-NetFirewallRule -DisplayName "REC Smart Audio" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Remove-Item (Join-Path ([Environment]::GetFolderPath("CommonDesktopDirectory")) "REC Smart Audio.url") -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$InstallDir\app", "$env:ProgramFiles\REC-Audio-Agent" -ErrorAction SilentlyContinue
if ($RemoveData) {
  Remove-Item -Recurse -Force $InstallDir, "$env:ProgramData\REC-Audio-Agent" -ErrorAction SilentlyContinue
  Write-Host "Removed everything, including data."
} else {
  Write-Host "Removed. Data kept in $InstallDir\data (run again with -RemoveData to delete it)."
}
