param([switch]$ValidateOnly, [string]$Origin = '')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
$VerbosePreference = 'SilentlyContinue'
$InformationPreference = 'SilentlyContinue'

function Read-Exact([System.IO.Stream]$Stream, [int]$Length) {
    $bytes = New-Object byte[] $Length
    $offset = 0
    while ($offset -lt $Length) {
        $read = $Stream.Read($bytes, $offset, $Length - $offset)
        if ($read -eq 0) { throw 'Game chat: The browser request was incomplete.' }
        $offset += $read
    }
    return ,$bytes
}

try {
    $inputStream = [Console]::OpenStandardInput()
    $header = Read-Exact $inputStream 4
    # Chrome on Windows uses a four-byte little-endian length, not text lines.
    $length = [BitConverter]::ToUInt32($header, 0)
    if ($length -eq 0 -or $length -gt 16384) { throw 'Game chat: The browser request has an invalid size.' }
    $body = Read-Exact $inputStream ([int]$length)
    try {
        $utf8 = New-Object System.Text.UTF8Encoding($false, $true)
        $json = $utf8.GetString($body)
        if (-not $json.TrimStart().StartsWith('{')) { throw 'A JSON object is required.' }
        $request = $json | ConvertFrom-Json
    } catch { throw 'Game chat: The browser request was not valid JSON.' }
    if ($null -eq $request -or $request -isnot [PSCustomObject]) {
        throw 'Game chat: The browser request must contain an operation and a channel address.'
    }
    $keys = @($request.PSObject.Properties.Name)
    if ($keys.Count -ne 2 -or 'op' -cnotin $keys -or 'url' -cnotin $keys -or
        $request.op -isnot [string] -or $request.op -cne 'open') {
        throw 'Game chat: Only opening a channel is supported.'
    }
    if ($request.url -isnot [string] -or $request.url.Length -gt 2048 -or
        $request.url -cnotmatch '\Ahttps://discord[.]com/channels/(?:[0-9]+|@me)/[0-9]+#agentdisc-minimal\z') {
        throw 'Game chat: Open a Discord channel before using this button.'
    }
    $allowedOrigin = 'chrome-extension://jjhlicnmjdacfcedgepakpfchocpkmck/'
    if (($Origin -and $Origin -cne $allowedOrigin) -or (-not $ValidateOnly -and $Origin -cne $allowedOrigin)) {
        throw 'Game chat: This helper accepts requests only from AgentDisc.'
    }
    if ($ValidateOnly) {
        # No native code, profile read, files, tasks, or Chrome launch above this return.
        $reply = @{ok = $true; validated = $true}
    } else {
        . (Join-Path $PSScriptRoot 'window.ps1')
        $reply = Open-GameChat -Url $request.url
    }
} catch {
    $message = [string]$_.Exception.Message
    if (-not $message.StartsWith('Game chat: ')) { $message = 'Game chat: Could not open the window. Please try again.' }
    $reply = @{ok = $false; error = $message.Substring(11)}
}

# Nothing else writes to stdout. Native messaging must not receive a BOM or newline.
$outputStream = [Console]::OpenStandardOutput()
$response = [System.Text.Encoding]::UTF8.GetBytes(($reply | ConvertTo-Json -Compress -Depth 4))
$prefix = [BitConverter]::GetBytes([uint32]$response.Length)
$outputStream.Write($prefix, 0, 4)
$outputStream.Write($response, 0, $response.Length)
$outputStream.Flush()
