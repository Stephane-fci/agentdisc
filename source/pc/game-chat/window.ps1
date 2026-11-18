# Shared native calls, based on the working WoW chat opener and hover helper.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class AgentDiscChatWindow {
    public struct POINT { public int X, Y; }
    public struct RECT { public int Left, Top, Right, Bottom; }
    public delegate bool EnumProc(IntPtr h, IntPtr p);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr data);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int length);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int index);
    [DllImport("user32.dll", SetLastError=true)] public static extern int SetWindowLong(IntPtr h, int index, int value);
    [DllImport("user32.dll", SetLastError=true)] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll", SetLastError=true)] public static extern bool SetLayeredWindowAttributes(IntPtr h, uint color, byte alpha, uint flags);
    [DllImport("user32.dll")] public static extern bool GetLayeredWindowAttributes(IntPtr h, out uint color, out byte alpha, out uint flags);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool SetProp(IntPtr h, string name, IntPtr value);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr GetProp(IntPtr h, string name);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr RemoveProp(IntPtr h, string name);
    public static bool IsChrome(IntPtr h) {
        var name = new StringBuilder(256);
        GetClassName(h, name, name.Capacity);
        uint p; GetWindowThreadProcessId(h, out p);
        try { return name.ToString() == "Chrome_WidgetWin_1" && System.Diagnostics.Process.GetProcessById((int)p).ProcessName == "chrome"; }
        catch { return false; }
    }
    public static long[] ChromeWindows() {
        var result = new List<long>();
        EnumWindows((h,p) => { if (IsWindowVisible(h) && IsChrome(h)) result.Add(h.ToInt64()); return true; }, IntPtr.Zero);
        return result.ToArray();
    }
    public static bool Same(IntPtr h, uint expectedPid, string marker) {
        uint p; GetWindowThreadProcessId(h, out p);
        return IsWindow(h) && p == expectedPid && GetProp(h, marker) == new IntPtr(1);
    }
    public static bool Over(IntPtr h) {
        POINT p;
        return GetCursorPos(out p) && GetAncestor(WindowFromPoint(p), 2) == h;
    }
    public static int Alpha(IntPtr h) {
        uint color, flags; byte alpha;
        return GetLayeredWindowAttributes(h, out color, out alpha, out flags) ? alpha : -1;
    }
}
'@ | Out-Null

function Open-GameChat([string]$Url) {
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $mutex = New-Object Threading.Mutex($false, ('Local\AgentDisc.GameChat.Open.' + $sid))
    $locked = $false
    $handle = [IntPtr]::Zero
    $ownerPid = [uint32]0
    $marker = ''
    $taskName = ''
    $runtime = ''
    $changed = $false
    $completed = $false
    try {
        try { $locked = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $locked = $true }
        if (-not $locked) { throw 'Game chat: A window is already opening. Please wait a moment.' }
        [void][AgentDiscChatWindow]::SetProcessDPIAware()
        Add-Type -AssemblyName System.Windows.Forms | Out-Null
        $chrome = @('C:\Program Files\Google\Chrome\Application\chrome.exe',
            'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
            (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')) |
            Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
        if (-not $chrome) { throw 'Game chat: Chrome could not be found.' }
        $localState = Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data\Local State'
        $profile = 'Default'
        if (Test-Path -LiteralPath $localState -PathType Leaf) {
            try { $state = Get-Content -LiteralPath $localState -Raw | ConvertFrom-Json }
            catch { throw 'Game chat: Chrome could not identify the current profile. Please try again.' }
            if ($state.profile.last_used -cnotmatch '\A(?:Default|Profile [0-9]+)\z') {
                throw 'Game chat: Chrome could not identify the current profile. Please try again.'
            }
            $profile = [string]$state.profile.last_used
        }
        $foreground = [AgentDiscChatWindow]::GetForegroundWindow()
        $before = @([AgentDiscChatWindow]::ChromeWindows())
        Start-Process -FilePath $chrome -ArgumentList @('--profile-directory="' + $profile + '"', '--app="' + $Url + '"') | Out-Null
        $until = (Get-Date).AddSeconds(20)
        $candidate = [long]0
        $stable = 0
        do {
            Start-Sleep -Milliseconds 250
            $new = @([AgentDiscChatWindow]::ChromeWindows() | Where-Object { $_ -notin $before })
            if ($new.Count -gt 1) { throw 'Game chat: More than one new Chrome window appeared. No window was changed.' }
            if ($new.Count -eq 1) {
                if ($candidate -eq $new[0]) { $stable++ } else { $candidate = $new[0]; $stable = 1 }
            } else { $candidate = 0; $stable = 0 }
        } while ($stable -lt 4 -and (Get-Date) -lt $until)
        if ($stable -lt 4) { throw 'Game chat: Could not identify one new Chrome window. No window was changed.' }
        # Recheck the entire new-window set immediately before the first change.
        $new = @([AgentDiscChatWindow]::ChromeWindows() | Where-Object { $_ -notin $before })
        if ($new.Count -ne 1 -or $new[0] -ne $candidate) {
            throw 'Game chat: The new Chrome window was ambiguous. No window was changed.'
        }
        $handle = [IntPtr]$candidate
        [void][AgentDiscChatWindow]::GetWindowThreadProcessId($handle, [ref]$ownerPid)
        $oldStyle = [AgentDiscChatWindow]::GetWindowLong($handle, -20)
        $oldAlpha = [AgentDiscChatWindow]::Alpha($handle)
        $oldRect = New-Object AgentDiscChatWindow+RECT
        if (-not [AgentDiscChatWindow]::GetWindowRect($handle, [ref]$oldRect)) { throw 'Game chat: The new window closed before it was ready.' }
        $runId = [guid]::NewGuid().ToString('N')
        $marker = 'AgentDisc.GameChat.' + $runId
        if (-not [AgentDiscChatWindow]::SetProp($handle, $marker, [IntPtr]1)) { throw 'Game chat: Could not prepare this window safely.' }
        $taskName = 'AgentDisc-GameChat-Hover-' + $runId
        $runtime = Join-Path (Join-Path $env:LOCALAPPDATA 'AgentDisc\game-chat\runtime') $runId
        [void][IO.Directory]::CreateDirectory($runtime)
        $area = [System.Windows.Forms.Screen]::FromHandle($foreground).WorkingArea
        $width = [Math]::Min(660, $area.Width)
        $height = [Math]::Min(800, $area.Height)
        $x = [Math]::Max($area.Left, $area.Right - $width - 20)
        $y = [Math]::Min($area.Top + 40, $area.Bottom - $height)
        if (-not [AgentDiscChatWindow]::Same($handle, $ownerPid, $marker)) { throw 'Game chat: The new window closed before it was ready.' }
        $changed = $true
        if (-not [AgentDiscChatWindow]::SetWindowPos($handle, [IntPtr](-1), $x, $y, $width, $height, 0x0010)) {
            throw 'Game chat: Could not position the new window.'
        }
        [void][AgentDiscChatWindow]::SetWindowLong($handle, -20, ($oldStyle -bor 0x00080000))
        if (-not [AgentDiscChatWindow]::SetLayeredWindowAttributes($handle, 0, 140, 2)) { throw 'Game chat: Could not make the new window transparent.' }
        [void][AgentDiscChatWindow]::SetForegroundWindow($foreground)
        $powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $workerArgs = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' +
            (Join-Path $PSScriptRoot 'hover.ps1') + '" -WindowHandle ' + $candidate + ' -OwnerProcessId ' + $ownerPid +
            ' -RunId ' + $runId
        $action = New-ScheduledTaskAction -Execute $powerShell -Argument $workerArgs
        $principal = New-ScheduledTaskPrincipal -UserId $sid -LogonType Interactive -RunLevel Limited
        $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
        Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings | Out-Null
        Start-ScheduledTask -TaskName $taskName
        $readyPath = Join-Path $runtime 'ready.json'
        $errorPath = Join-Path $runtime 'error.json'
        $until = (Get-Date).AddSeconds(10)
        while (-not (Test-Path -LiteralPath $readyPath) -and -not (Test-Path -LiteralPath $errorPath) -and (Get-Date) -lt $until) {
            Start-Sleep -Milliseconds 150
        }
        if (-not (Test-Path -LiteralPath $readyPath) -or (Test-Path -LiteralPath $errorPath)) {
            throw 'Game chat: The hover helper did not start. Please try again.'
        }
        $ready = Get-Content -LiteralPath $readyPath -Raw | ConvertFrom-Json
        if ($ready.ok -ne $true -or $ready.handle -ne $candidate -or $ready.ownerPid -ne $ownerPid -or
            -not [AgentDiscChatWindow]::Same($handle, $ownerPid, $marker) -or
            ([AgentDiscChatWindow]::GetWindowLong($handle, -20) -band 8) -eq 0 -or
            [AgentDiscChatWindow]::Alpha($handle) -notin @(140, 230)) {
            throw 'Game chat: Could not verify the game chat window. Please try again.'
        }
        $completed = $true
        return @{ok = $true}
    } finally {
        if (-not $completed) {
            if ($taskName) {
                Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
                Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
            }
            if ($marker -and [AgentDiscChatWindow]::Same($handle, $ownerPid, $marker)) {
                if ($changed) {
                    [void][AgentDiscChatWindow]::SetWindowLong($handle, -20, $oldStyle)
                    if ($oldAlpha -ge 0) { [void][AgentDiscChatWindow]::SetLayeredWindowAttributes($handle, 0, [byte]$oldAlpha, 2) }
                    $after = if (($oldStyle -band 8) -ne 0) { [IntPtr](-1) } else { [IntPtr](-2) }
                    [void][AgentDiscChatWindow]::SetWindowPos($handle, $after, $oldRect.Left, $oldRect.Top,
                        ($oldRect.Right - $oldRect.Left), ($oldRect.Bottom - $oldRect.Top), 0x0010)
                }
                [void][AgentDiscChatWindow]::RemoveProp($handle, $marker)
            }
            if ($runtime) {
                Remove-Item -LiteralPath (Join-Path $runtime 'ready.json'), (Join-Path $runtime 'error.json'), (Join-Path $runtime 'ready.tmp') -Force -ErrorAction SilentlyContinue
                try { [IO.Directory]::Delete($runtime) } catch { }
            }
        }
        if ($locked) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}
