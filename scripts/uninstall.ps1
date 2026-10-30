$ErrorActionPreference = 'Stop'
$destination = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs\Daymark'))
$expected = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs')) + '\'
if (-not $destination.StartsWith($expected, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path $destination -Leaf) -ne 'Daymark') { throw 'Unexpected installation path.' }
$running = Get-Process Daymark -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq (Join-Path $destination 'Daymark.exe') }
if ($running) { throw 'Quit Daymark from its tray menu before uninstalling.' }
$hooksScript = Join-Path $destination 'install-ai-hooks.ps1'
if (Test-Path -LiteralPath $hooksScript) { & $hooksScript -Remove }
Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name Daymark -ErrorAction SilentlyContinue
$shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'Daymark.lnk'
if (Test-Path -LiteralPath $shortcut) { Remove-Item -LiteralPath $shortcut }
if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Recurse -Force }
Write-Output 'Daymark removed. Your history remains in %LOCALAPPDATA%\Daymark. Remove the browser extension separately.'
