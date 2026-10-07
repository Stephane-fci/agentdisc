# What AgentDisc does

AgentDisc makes Discord in the browser calmer and easier when you work with AI agents. It starts with Stephane's own setup; everything below can be switched on or off.

## Feedback mode

A speech-bubble button in the top bar, or Ctrl+L, turns feedback mode on (the button turns orange). Move the mouse over any message and the paragraph under it lights up orange (a bullet point counts as a paragraph). Tap Ctrl to switch to the single sentence under the mouse, and tap it again to go back to the whole paragraph. A click puts it in your message box as "the text" >> , ready for your answer; each new click adds the next one on its own line. Text you select yourself goes in as it is. Click the button again, press Ctrl+L again or press Esc to stop.

## Find a channel

A button in the top bar, or Ctrl+O, opens a search box. As soon as you type, the matching channels and threads of the server you are in show, best first, each with its category and the day of its last message (the time if it was today). In direct messages it searches all your servers and shows the server too. A click or Enter takes you there; the arrows move through the list and Esc closes it. Emoji, dashes and capitals do not matter: "lifely po" finds "🦕-lifely-po-allocation".

## Links in a channel

A link button in the top bar opens a panel with every link posted in the channel you are in and in all its threads (or only in the thread, when you are in a thread), newest first, each with its date, who posted it and a Jump button to the message. Type in the filter to find one quickly, for example figma or dashboard. A link from a thread carries a small tag with the thread's name. A gear at the top of the panel offers four tick boxes, all on at first: hide links to Discord channels and messages, hide Slack links, group the same link posted several times into one line (grouped lines have no Jump button, since they point to several messages), and also group links that only differ by tracking codes (a Figma file counts once, whatever frame it points to). Untick grouping to see every post of a link with its own Jump button.

## Bookmarks

A flag button in the top bar, or Ctrl+B, bookmarks the channel or thread you are in; do it again to remove the bookmark. You can also right-click any channel or thread and choose "Bookmark". A bookmark stays until you remove it and only colours the line, which keeps its place in the list, in the colour of what is happening in it: green while an agent is working there, red when no agent is working and something is unread (go there first), yellow when no agent is working and everything is read. A bookmarked channel stays visible in a closed category, and a bookmarked thread stays visible when its channel's threads are folded away. A "Clear" button above the channel list removes every bookmark at once.

## Above the channel list

A row of buttons stays at the top of the channel list. "Hide threads" or "Show threads" folds or opens every channel's threads. "Close categories" or "Open categories" closes or opens every category of the server. A closed category still shows a channel that is bookmarked or where someone is typing (in it or in one of its threads), like it shows unread ones. The magnifier opens a filter: as you type, only the matching channels and threads of the server stay in the panel, the arrows move, Enter opens one, and Esc clears it. The plus creates a channel (Ctrl+P does the same): type its name and press Enter, and it opens. It goes outside any category unless you pick one in the box; archive categories are not offered.

## Tidy a channel into its category

Ctrl+K on a channel outside any category moves it into the first category whose name starts with the same emoji (never an archive category), at the top of that category: "🥑-discord-app" goes into "🥑 Tools & Skills". Ctrl+K on a channel inside a category takes it out, to the top of the channel list. In a thread, its channel moves.

## Map and calendar above the members

When the member list is open, two things sit above it. First a map: the channel you are in is the orange dot in the middle, and around it are the channels linked from it (a channel mentioned by name, a link to a channel or a message, a forwarded message); a click on a dot opens that channel. Then a calendar of the month, like Obsidian's: a dot under a day means you wrote in this channel or its threads that day, and a click on it opens the channel at that day's first message. The first visit to a long channel takes a few seconds to read it; after that, only new messages are read.

## Rename a channel

Ctrl+R, or a click on the channel name above the messages, opens a small box with the name of the channel or thread you are in. Change it and press Enter to save, or Esc to leave it as it was.

## Buttons in the top bar

Three buttons sit in the top bar, just before the inbox. Search opens Discord's search; when the channel header is hidden, it comes back while you search and goes away after (Ctrl+F does the same). The server list button shows or hides the servers. The member list button is Discord's own member list switch, lit while the list is open; it shows in server channels, threads and group chats.

## The AgentDisc button

A small purple robot at the top of Discord opens one simple menu with three groups: Theme, Panels and Channel signs. While a message is being read, it also offers "Stop reading". Every choice is saved and stays after a restart.

## Read any message aloud

Next to the name on every message there is a small purple play button. Click it and a natural AI voice reads that message, plus the messages sent right after it under the same name, so an agent's answer split in several parts is read as one. You can also right-click a message and choose "Read aloud".

While it reads, a player sits inside the channel's top bar, between the channel name and its buttons (or just above the message box when the top bar is hidden): play and pause, back 10 seconds, forward 10 seconds, a timeline you can drag, speed from 1× to 2×, and close. Space pauses or plays, and the left and right arrows go back or forward 10 seconds (in the message box only while it is empty, so typing is never disturbed). The word being read lights up in the message, and a click on any word of that message jumps the reading there. The play button turns while the voice is being prepared, shows pause while it plays, and the player closes by itself at the end unless you moved around in it. Reading goes on when you change channel. While the voice plays, any YouTube tab turns down to a fifth of its volume, without pausing, and goes back to where it was when the voice stops (a switch in the AgentDiscVoice settings turns this off).

Links are read as "a link to" plus the site, and code blocks are skipped. Playing the same message again is free for 30 days. If the voice is not set up or not answering, Chrome's own voice reads instead.

## Typing signs

Three moving dots, with the small photos of who is typing, appear beside every channel and every thread where someone is writing, so you see at a glance which agent is working. When a channel's threads are busy, the channel itself shows a small thread sign with the number of busy threads; hover it to see their names. When a channel's threads are folded away, the photos and dots of whoever is typing in them move onto the channel line, just right of the thread sign. The red mention badge sits before the dots, so the dots always line up on the right.

## Threads grouped under their channel

A channel whose threads are open sits on one rounded soft blue card together with its threads, so you see at once which threads belong to which channel. Channels without open threads look as usual. The channel or thread you are in is solid purple with white text, easy to spot at a glance. Where Discord shows the white unread dot, a channel with threads gets a small arrow instead: click it to fold or unfold its threads (the arrow turns white when a folded thread has something new). A button above the channel list shows or hides every channel's threads at once.

## Panels you can hide

From the Panels group of the menu, each part of Discord can be hidden on its own: the server list, the channel list, the top bar, the channel header, notice banners, the server name bar, the Events and Server Boosts lines, the account bar at the bottom (with the call buttons), the add server and Discover buttons, the gift, GIF, sticker, emoji and apps buttons of the message box, and the member list. A hidden channel list slides back while the mouse sits at the left edge of the window; a hidden top bar slides back at the top edge.

The server list and member list also have their own buttons in the top bar (see above).

Ctrl+Alt+F switches "chat only" on and off: it hides the server list, channel list and member list at once (or everything except the chat, a choice in the settings, on the PanelSwitches cog).

## Theme

Midnight: a near-black channel list, a slightly lighter chat so the two stand apart, and a dark message box. Or Discord's normal dark look. Both work over Discord's own Dark theme (Discord settings, Appearance). Messages keep the same background when the mouse passes over them, so the chat stays still.

## Moving around with the keyboard

Discord's own shortcuts: Alt with the up and down arrows moves to the channel above or below, Alt with left and right goes back and forward through the channels you visited, and Alt with Shift and the arrows jumps between unread channels.

AgentDisc adds the same moves for the left hand: Alt with Z (up), S (down), Q (back) and D (forward) on an AZERTY keyboard, or Alt with W, S, A and D on a QWERTY keyboard.

More AgentDisc shortcuts: Ctrl+O finds a channel, Ctrl+L turns feedback mode on and off, Ctrl+B bookmarks the channel you are in (with text selected in the message box it still makes the text bold), Ctrl+R renames it, Ctrl+P creates a channel, Ctrl+K moves it into or out of its category, and Ctrl+H shows a window with every shortcut and button. Discord's own Ctrl+K (quick switcher, use Ctrl+O instead) and Ctrl+P (pinned messages, the pin button stays) give way to these.

## Long messages

When a message is longer than Discord allows, Enter no longer opens the "message too long" window: the text is attached as a text file right away, and Enter again sends it. The "Send longer messages with Discord Nitro!" line under the message box is gone.

## Small tidy-ups

The invite and settings buttons that pop up when the mouse passes over a channel are gone (right-click still has both). Discord's tracking is blocked. Links no longer try to open the Discord desktop app. If a Discord update breaks one of the AgentDisc parts, a thin purple bar appears at the top; hover it to see which part, and ask your agent to rebuild the app.

## Stephane's starting setup

The Midnight theme is on. Hidden: the server list, the channel header, notice banners, the server name bar, the Events and Boosts lines, the account bar, the add server and Discover buttons, and the message box buttons. Shown: the channel list, the top bar and everything else. Typing signs show the dots with the small photos, the busy threads sign is on, and signs also show on the channel you are in. The voice is a calm, clear American man.

## Settings

Press Ctrl and comma in Discord to open the settings (the account bar with the gear is hidden at first), then choose AgentDisc and Plugins. Each part has a cog with its own options: the voice, a voice per agent, how to say certain names, and which letters the left-hand shortcuts use.
