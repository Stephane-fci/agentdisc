# AgentDisc

AgentDisc is a Chrome extension that makes Discord in the browser calmer and easier when you work with AI agents. It was made by Stephane Franceschini on top of Vencord.

- **Typing signs:** dots and small photos show which channel or thread an agent is working in, even inside threads.
- **Clear channel list:** a channel with open threads sits on one soft blue card with them; the open channel is solid purple, and one click folds a channel's threads.
- **Bookmarks:** one click on the flag or Ctrl+B bookmarks a channel or thread; its line shows green while an agent works there, red when something waits for you, yellow when all is read; one button clears every bookmark.
- **Channel tools:** close or open every category, filter the channel list as you type, create a channel (Ctrl+P), rename one (Ctrl+R or a click on its name), and put a channel in the category with its emoji (Ctrl+K). Ctrl+H lists every shortcut.
- **Feedback mode:** click paragraphs or sentences in a long answer to quote them into your reply, ready for your comments.
- **Find a channel:** Ctrl+O or a top-bar button, type a few letters, Enter to go; each match shows its category and the day of its last message.
- **Map and calendar:** above the member list, the channels linked from this channel and the days you wrote in it.
- **Links panel:** every link posted in a channel, with its date and a jump to the message.
- **Panels you can hide:** the server list, the channel header, the account bar and more, each with its own switch.
- **Read aloud:** a play button on every message reads it in a natural Google voice, and the words light up as they are read.
- **Midnight theme and left-hand shortcuts:** a calm dark theme, and Alt with Z Q S D (or W A S D) to move between channels.

The full tour is in `WHAT-AGENTDISC-DOES.md`.

## Install

Download `AgentDisc.zip` from the latest release on the right of this page, unzip it, and give the folder to your AI agent with this sentence: "Read START-HERE-FOR-YOUR-AGENT.md and install AgentDisc for me." The guide walks the agent through everything: your own Google voice key, a small free Cloudflare service that keeps the key out of your browser, and loading the app in Chrome. Your part is a few minutes of clicks.

You can also follow `START-HERE-FOR-YOUR-AGENT.md` yourself; every step is written out.

## What is in here

- `extension/`: the finished app, ready to load in Chrome.
- `voice-service/`: the small Cloudflare service for the voice.
- `source/`: the full source of the app.

Every update is published as a new release with its own notes.

## Credits and license

Built on Vencord by Vendicated and contributors (https://github.com/Vendicated/Vencord), under the GNU General Public License v3.0, like this project (see `LICENSE`). AgentDisc is not made by or affiliated with Discord or the Vencord team. Changing the Discord client is against Discord's terms of service; use it at your own risk.
