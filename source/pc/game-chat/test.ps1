# Safe on the PC: every child is host.ps1 -ValidateOnly. No windows or tasks open.
param([string]$HostDirectory = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
$hostPath = Join-Path (Resolve-Path -LiteralPath $HostDirectory).Path 'host.ps1'
$powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'

function Frame([string]$Json) {
    $body = [Text.Encoding]::UTF8.GetBytes($Json)
    return ,([BitConverter]::GetBytes([uint32]$body.Length) + $body)
}
function Check([string]$Name, [byte[]]$InputBytes, [bool]$Expected, [string]$Origin = '') {
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $powerShell
    $start.Arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $hostPath + '" -ValidateOnly'
    if ($Origin) { $start.Arguments += ' -Origin "' + $Origin + '"' }
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $start
    $output = New-Object IO.MemoryStream
    try {
        [void]$process.Start()
        $copy = $process.StandardOutput.BaseStream.CopyToAsync($output)
        $errors = $process.StandardError.ReadToEndAsync()
        $process.StandardInput.BaseStream.Write($InputBytes, 0, $InputBytes.Length)
        $process.StandardInput.BaseStream.Flush()
        $process.StandardInput.Close()
        if (-not $process.WaitForExit(15000)) { $process.Kill(); throw ($Name + ': helper timed out') }
        $copy.GetAwaiter().GetResult()
        $stderr = $errors.GetAwaiter().GetResult()
        $bytes = $output.ToArray()
        if ($process.ExitCode -ne 0 -or $stderr -or $bytes.Length -lt 4) { throw ($Name + ': helper did not return a clean native response') }
        $length = [BitConverter]::ToUInt32($bytes, 0)
        if ($bytes.Length -ne (4 + $length)) { throw ($Name + ': stdout contains unframed or trailing output') }
        $reply = [Text.Encoding]::UTF8.GetString($bytes, 4, $length) | ConvertFrom-Json
        if ($reply.ok -isnot [bool] -or $reply.ok -ne $Expected -or
            ($Expected -and $reply.validated -ne $true) -or
            (-not $Expected -and ($reply.error -isnot [string] -or -not $reply.error))) {
            throw ($Name + ': unexpected response')
        }
    } finally { $output.Dispose(); $process.Dispose() }
    Write-Output ('PASS ' + $Name)
}

$valid = 'https://discord.com/channels/123/456#agentdisc-minimal'
$good = '{"op":"open","url":"' + $valid + '"}'
Check 'channel' (Frame $good) $true
Check 'direct message' (Frame '{"op":"open","url":"https://discord.com/channels/@me/123#agentdisc-minimal"}') $true
Check 'allowed extension' (Frame $good) $true 'chrome-extension://jjhlicnmjdacfcedgepakpfchocpkmck/'
Check 'other extension' (Frame $good) $false 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/'
Check 'unknown operation' (Frame ($good.Replace('"open"', '"close"'))) $false
Check 'operation case' (Frame ($good.Replace('"open"', '"OPEN"'))) $false
Check 'unknown field' (Frame ($good.Replace('"op":', '"command":"whoami","op":'))) $false
Check 'top level array' (Frame ('[' + $good + ']')) $false
Check 'missing field' (Frame '{"op":"open"}') $false
Check 'null' (Frame 'null') $false
foreach ($bad in @(
    $valid.Replace('https://', 'http://'),
    $valid.Replace('discord.com/', 'discord.com.evil.example/'),
    $valid.Replace('discord.com/', 'user@discord.com/'),
    $valid.Replace('discord.com/', 'discord.com:443/'),
    $valid.Replace('#agentdisc-minimal', '?test=1#agentdisc-minimal'),
    $valid.Replace('#agentdisc-minimal', ''),
    $valid.Replace('/channels/', '/channels/-'),
    $valid.Replace('#agentdisc-minimal', '/123#agentdisc-minimal'),
    ($valid + [char]10))) {
    Check 'refused address' (Frame (@{op = 'open'; url = $bad} | ConvertTo-Json -Compress)) $false
}
Check 'invalid JSON' (Frame '{') $false
Check 'zero length' ([byte[]]@(0, 0, 0, 0)) $false
Check 'oversize' ([BitConverter]::GetBytes([uint32]16385)) $false
Check 'short header' ([byte[]]@(4, 0)) $false
Check 'short body' ([byte[]]@(4, 0, 0, 0, 123)) $false
Check 'invalid UTF8' ([byte[]]@(1, 0, 0, 0, 255)) $false
Write-Output 'Safe protocol checks passed. No Chrome window or hover worker was opened.'
