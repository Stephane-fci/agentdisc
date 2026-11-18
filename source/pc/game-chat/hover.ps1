param([Parameter(Mandatory = $true)][long]$WindowHandle,
    [Parameter(Mandatory = $true)][uint32]$OwnerProcessId,
    [Parameter(Mandatory = $true)][ValidatePattern('\A[a-f0-9]{32}\z')][string]$RunId)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$taskName = 'AgentDisc-GameChat-Hover-' + $RunId
$runtime = Join-Path (Join-Path $env:LOCALAPPDATA 'AgentDisc\game-chat\runtime') $RunId
$readyPath = Join-Path $runtime 'ready.json'
$errorPath = Join-Path $runtime 'error.json'
$marker = 'AgentDisc.GameChat.' + $RunId
$handle = [IntPtr]$WindowHandle
$started = $false
try {
    . (Join-Path $PSScriptRoot 'window.ps1')
    [void][AgentDiscChatWindow]::SetProcessDPIAware()
    $owner = Get-Process -Id $OwnerProcessId
    if ($owner.ProcessName -ne 'chrome' -or -not [AgentDiscChatWindow]::Same($handle, $OwnerProcessId, $marker)) {
        throw 'The new game chat window is no longer available.'
    }
    $previous = -1
    while (-not $owner.HasExited -and [AgentDiscChatWindow]::Same($handle, $OwnerProcessId, $marker)) {
        $alpha = if (-not [AgentDiscChatWindow]::IsIconic($handle) -and [AgentDiscChatWindow]::Over($handle)) { 230 } else { 140 }
        if ($alpha -ne $previous) {
            if (-not [AgentDiscChatWindow]::SetLayeredWindowAttributes($handle, 0, [byte]$alpha, 2)) { throw 'The window no longer accepts transparency.' }
            $previous = $alpha
        }
        if (-not $started) {
            $ready = @{ok = $true; handle = $WindowHandle; ownerPid = $OwnerProcessId; workerPid = $PID}
            # Rename within this directory makes the readiness receipt atomic for the opener.
            $tempPath = Join-Path $runtime 'ready.tmp'
            $ready | ConvertTo-Json -Compress | Set-Content -LiteralPath $tempPath -Encoding UTF8
            Move-Item -LiteralPath $tempPath -Destination $readyPath -Force
            $started = $true
        }
        Start-Sleep -Milliseconds 120
    }
} catch {
    if (-not $started -and (Test-Path -LiteralPath $runtime -PathType Container)) {
        '{"ok":false}' | Set-Content -LiteralPath $errorPath -Encoding UTF8
    }
} finally {
    # The marker vanishes with the HWND. Leave it for opener rollback on failure.
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $readyPath, (Join-Path $runtime 'ready.tmp') -Force -ErrorAction SilentlyContinue
    # An initial error remains only until the waiting opener consumes and removes it.
    try { [IO.Directory]::Delete($runtime) } catch { }
}
