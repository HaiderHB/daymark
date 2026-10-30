param([string]$Executable = (Join-Path $PSScriptRoot 'Daymark.exe'), [string]$UserRoot = [Environment]::GetFolderPath('UserProfile'), [switch]$Remove)
$ErrorActionPreference = 'Stop'
if (-not $Remove -and -not (Test-Path -LiteralPath $Executable)) { throw 'Point -Executable at your installed Daymark.exe, or run this script from its release folder.' }
function Set-DaymarkHooks([string]$Path, [string]$Provider, [string[]]$Events) {
    $exists = Test-Path -LiteralPath $Path
    $config = if ($exists) { Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }
    if (-not $config.PSObject.Properties['hooks']) { $config | Add-Member -NotePropertyName hooks -NotePropertyValue ([pscustomobject]@{}) }
    foreach ($event in $Events) {
        $groups = @()
        if ($config.hooks.PSObject.Properties[$event]) {
            foreach ($group in @($config.hooks.$event)) {
                $retained = @($group.hooks | Where-Object { $_.command -notmatch 'Daymark\.exe.*--hook' })
                if ($retained.Count -gt 0) { $group.hooks = $retained; $groups += $group }
            }
        }
        if (-not $Remove) {
            $command = '"' + $Executable.Replace('\','/') + '" --hook ' + $Provider
            $handler = [ordered]@{type='command';command=$command;timeout=3}
            if ($Provider -eq 'codex') { $handler.commandWindows = $command }
            $groups += [pscustomobject]@{hooks=@([pscustomobject]$handler)}
        }
        if ($config.hooks.PSObject.Properties[$event]) { $config.hooks.$event = $groups } else { $config.hooks | Add-Member -NotePropertyName $event -NotePropertyValue $groups }
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Path) | Out-Null
    if ($exists) { Copy-Item -LiteralPath $Path -Destination ($Path + '.daymark-backup-' + (Get-Date -Format 'yyyyMMddHHmmssfff')) }
    $json = $config | ConvertTo-Json -Depth 100
    [IO.File]::WriteAllText($Path + '.daymark-tmp', $json, [Text.UTF8Encoding]::new($false))
    Move-Item -LiteralPath ($Path + '.daymark-tmp') -Destination $Path -Force
    Write-Output "Updated $Provider hooks. Existing unrelated hooks were preserved."
}
$common = @('SessionStart','UserPromptSubmit','PreToolUse','PermissionRequest','PostToolUse','SubagentStart','SubagentStop','Stop','SessionEnd')
Set-DaymarkHooks (Join-Path $UserRoot '.claude\settings.json') 'claude-code' ($common + @('PostToolUseFailure','StopFailure','Notification'))
Set-DaymarkHooks (Join-Path $UserRoot '.codex\hooks.json') 'codex' ($common + @('Interrupt','PostCompact'))
Write-Output 'Restart coding sessions. In Codex, review and trust the Daymark hooks using the hooks UI. Hook trust is not bypassed.'
