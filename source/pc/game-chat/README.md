# AgentDisc game chat helper

One button request opens the current channel in a fresh Chrome app window, with the existing profile, minimal mode, topmost, 140/255 idle alpha and 230/255 when hovered. Each deliberate click opens a new window. Concurrent opening requests are refused. We avoid reusing windows because a saved HWND can point at another window after close. Yesterday's WoW window and worker are never selected or changed.

Chrome talks to `co.sfrance.agentdisc.game_chat` through `host.bat` and Windows PowerShell 5.1 at the browser's normal rights. The only allowed extension is `jjhlicnmjdacfcedgepakpfchocpkmck`. One request is `{ "op": "open", "url": "https://discord.com/channels/123/456#agentdisc-minimal" }`. The reply is `{ "ok": true }` or `{ "ok": false, "error": "plain explanation" }`, with Chrome's four-byte little-endian framing. The helper handles one request then exits. The manifest and host both restrict the origin. Only an exact HTTPS Discord channel route with the minimal marker is accepted.

`window.ps1` reuses the earlier native window mechanism. It compares the new visible Chrome windows with the set before launch, waits for one stable window, then checks again before modifications. If more than one appears, no window is changed. The last-used existing profile comes only from Chrome's `Local State` profile name, with no profile contents or auth files read. This follows the earlier opener; simultaneous Chrome profiles still need the installer's live check to establish which profile Chrome marks last used.

The hover worker uses a per-window Windows task, with normal rights and no triggers. This keeps the worker alive when Chrome closes the native message host. There is no startup task, service, network listener, or automatic browser restart. It checks HWND, Chrome PID, original process lifetime, and a window property that vanishes on close. Hover comes from the actual root window under the pointer, not its rectangle. It changes opacity on transitions, without moving the pointer or sending input. Closing the window ends its worker and removes its task and per-run receipt folder. The parent `%LOCALAPPDATA%\AgentDisc\game-chat\runtime` directory may remain empty. On a failed initial setup, the opener removes only its own task and restores its new window's previous style and bounds, leaving the new Chrome window open.

Install, only when John is ready:

```powershell
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\AgentDisc-source\pc\game-chat\install.ps1" -SourceDirectory "C:\AgentDisc-source\pc\game-chat"
```

The installer is idempotent. It writes only `%LOCALAPPDATA%\AgentDisc\game-chat` and `HKCU\Software\Google\Chrome\NativeMessagingHosts\co.sfrance.agentdisc.game_chat`. Replace the example source checkout path with the actual copy location. The source lives outside `browser/`, and the installed copy lives outside the update mirror. The parent's automatic updater uses a temporary source copy, calls this installer after the normal extension update, then deletes that copy. Installation does not open a window. Reload the extension once after its nativeMessaging permission change.

Safe checks before installation, or from any temporary copy:

```powershell
powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\AgentDisc-source\pc\game-chat\test.ps1"
```

Every test invokes `host.ps1 -ValidateOnly`. That switch returns after parsing and validation, before loading native calls, reading Chrome state, writing files, creating tasks, or launching Chrome. The tests cover framing, malformed/truncated input, valid routes, rejected operations, rejected origins, and rejected addresses. It writes only test output, with no screen or pointer actions. Parse all scripts first if running from a newly copied folder:

```powershell
Get-ChildItem -LiteralPath "C:\AgentDisc-source\pc\game-chat" -Filter *.ps1 | ForEach-Object { $tokens=$null; $errors=$null; [void][Management.Automation.Language.Parser]::ParseFile($_.FullName,[ref]$tokens,[ref]$errors); if($errors){throw $errors[0]} }
```

The live check belongs to John when WoW is not in front. Check one button click from a signed-in channel, native topmost and alpha readback, actual idle/hover without test sends, minimal UI and no left-edge reveal, then close and click again. Check normal Chrome and unsent input remain. A missing host or an ambiguous new-window set must show the page's failure notice. Do not use yesterday's saved handle or touch its task. Whole-window alpha fades the text as well as the background.
