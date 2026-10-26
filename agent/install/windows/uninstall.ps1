param([string]$InstallDir = "$env:ProgramFiles\REC-Audio-Agent")
$ErrorActionPreference = "Stop"
$ServiceName = "RECAudioAgent"
$Nssm = (Get-Command nssm -ErrorAction SilentlyContinue).Source
if (-not $Nssm) { $Nssm = Join-Path $PSScriptRoot "nssm.exe" }
if (Get-Service $ServiceName -ErrorAction SilentlyContinue) {
  & $Nssm stop $ServiceName | Out-Null
  & $Nssm remove $ServiceName confirm | Out-Null
}
Remove-Item -Recurse -Force $InstallDir -ErrorAction SilentlyContinue
Write-Host "✔ تمت إزالة الخدمة. البيانات والإعدادات باقية في $env:ProgramData\REC-Audio-Agent (احذفها يدويًا عند الحاجة)."
