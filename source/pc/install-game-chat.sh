#!/usr/bin/env bash
# Called by the existing AgentDisc PC update, after its checks pass.
set -euo pipefail
game_chat_target=${1:?SSH alias of the Windows user}
game_chat_source=$(cd "$(dirname "$0")/game-chat" && pwd)
game_chat_stage="AgentDisc-game-chat-$(python3 -c 'import uuid; print(uuid.uuid4().hex)')"
cleanup_game_chat_stage() {
    ssh -o BatchMode=yes -o ConnectTimeout=8 "$game_chat_target" "powershell.exe -NoProfile -NonInteractive -Command \"Remove-Item -LiteralPath (Join-Path \$env:TEMP '$game_chat_stage') -Recurse -Force -ErrorAction SilentlyContinue\"" >/dev/null 2>&1 || true
}
trap cleanup_game_chat_stage EXIT
ssh -o BatchMode=yes "$game_chat_target" "powershell.exe -NoProfile -NonInteractive -Command \"New-Item -ItemType Directory -Path (Join-Path \$env:TEMP '$game_chat_stage') -ErrorAction Stop | Out-Null\""
scp -qr "$game_chat_source/." "${game_chat_target}:AppData/Local/Temp/$game_chat_stage/"
ssh -o BatchMode=yes "$game_chat_target" "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command \"\$s=Join-Path \$env:TEMP '$game_chat_stage'; & (Join-Path \$s 'install.ps1') -SourceDirectory \$s\""
