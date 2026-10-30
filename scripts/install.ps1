param([switch]$NoStartup, [switch]$NoLaunch)
$ErrorActionPreference = 'Stop'
$destination = Join-Path $env:LOCALAPPDATA 'Programs\Daymark'
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'Daymark.exe'))) { throw 'Run install.ps1 from an extracted Daymark release, next to Daymark.exe.' }
$running = Get-Process Daymark -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq (Join-Path $destination 'Daymark.exe') }
if ($running) { throw 'Quit Daymark from its tray menu before installing an update.' }
New-Item -ItemType Directory -Force -Path $destination | Out-Null
if ([IO.Path]::GetFullPath($PSScriptRoot) -ne [IO.Path]::GetFullPath($destination)) {
    Get-ChildItem -LiteralPath $PSScriptRoot | Copy-Item -Destination $destination -Recurse -Force
}
$exe = Join-Path $destination 'Daymark.exe'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Programs')) 'Daymark.lnk'))
$shortcut.TargetPath = $exe
$shortcut.WorkingDirectory = $destination
$shortcut.Description = 'Your time, in perspective.'
$shortcut.Save()
if (-not $NoStartup) {
    $registry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    New-Item -Path $registry -Force | Out-Null
    Set-ItemProperty -Path $registry -Name Daymark -Value ('"' + $exe + '" --background')
}
if (-not $NoLaunch) { Start-Process -FilePath $exe -ArgumentList '--background' -WindowStyle Hidden }
Write-Output "Daymark installed at $destination"
Write-Output 'Open Daymark from the Start menu or its green system tray icon. Pair the browser extension from Settings.'
