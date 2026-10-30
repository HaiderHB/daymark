param([string]$Runtime = 'win-x64', [string]$Dotnet = 'dotnet')
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$destination = Join-Path $repo "artifacts\Daymark-$Runtime"
& $Dotnet publish (Join-Path $repo 'src\Daymark') -c Release -r $Runtime --self-contained true -p:DebugType=None -p:DebugSymbols=false -o $destination
if ($LASTEXITCODE -ne 0) { throw 'Publish failed.' }
$symbols = Join-Path $destination 'Daymark.pdb'
if (Test-Path -LiteralPath $symbols) { Remove-Item -LiteralPath $symbols }
Copy-Item -LiteralPath (Join-Path $repo 'extension') -Destination $destination -Recurse -Force
Copy-Item -LiteralPath (Join-Path $repo 'licenses') -Destination $destination -Recurse -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'install.ps1'), (Join-Path $PSScriptRoot 'uninstall.ps1'), (Join-Path $PSScriptRoot 'install-ai-hooks.ps1'), (Join-Path $repo 'LICENSE') -Destination $destination -Force
Copy-Item -LiteralPath (Join-Path $repo 'docs\START-HERE.txt') -Destination $destination -Force
$zip = Join-Path $repo "artifacts\Daymark-$Runtime.zip"
Compress-Archive -Path (Join-Path $destination '*') -DestinationPath $zip -Force
Write-Output "Built $zip"
