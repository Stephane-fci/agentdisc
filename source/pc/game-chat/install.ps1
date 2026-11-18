param([string]$SourceDirectory = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
$destination = Join-Path $env:LOCALAPPDATA 'AgentDisc\game-chat'
$files = @('host.bat', 'host.ps1', 'window.ps1', 'hover.ps1')
$source = (Resolve-Path -LiteralPath $SourceDirectory).Path
foreach ($file in ($files + 'native-host.json')) {
    if (-not (Test-Path -LiteralPath (Join-Path $source $file) -PathType Leaf)) {
        throw ('Game chat source is missing ' + $file)
    }
}
$manifest = Get-Content -LiteralPath (Join-Path $source 'native-host.json') -Raw | ConvertFrom-Json
if ($manifest.name -cne 'co.sfrance.agentdisc.game_chat' -or $manifest.type -cne 'stdio' -or
    @($manifest.allowed_origins).Count -ne 1 -or
    $manifest.allowed_origins[0] -cne 'chrome-extension://jjhlicnmjdacfcedgepakpfchocpkmck/') {
    throw 'The game chat manifest does not match AgentDisc.'
}
[void][IO.Directory]::CreateDirectory($destination)
foreach ($file in $files) {
    $from = Join-Path $source $file
    $to = Join-Path $destination $file
    if ([IO.Path]::GetFullPath($from) -ine [IO.Path]::GetFullPath($to)) {
        Copy-Item -LiteralPath $from -Destination $to -Force
    }
}
$manifest.path = Join-Path $destination 'host.bat'
$manifestPath = Join-Path $destination 'native-host.json'
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding($false)))
# Registration is last. No machine-wide key or unrelated native host is changed.
$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\Google\Chrome\NativeMessagingHosts\co.sfrance.agentdisc.game_chat')
try { $key.SetValue('', $manifestPath, [Microsoft.Win32.RegistryValueKind]::String) } finally { $key.Dispose() }
Write-Output 'Game chat helper installed for this Windows user.'
