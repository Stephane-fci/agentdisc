# What AgentDisc does

AgentDisc makes Discord in the browser calmer and easier when you work with AI agents. It starts with Stephane's own setup; everything below can be switched on or off.

## Feedback mode

A speech-bubble button in the channel bar (the bar above the messages), or Shift pressed twice, turns feedback mode on (the button turns orange). Move the mouse over any message and the paragraph under it lights up orange (a bullet point counts as a paragraph). Each tap on Ctrl goes one step smaller: the sentence under the mouse, then the piece of that sentence between commas, colons or semicolons (handy for a title before a colon), then back to the whole paragraph. A click puts it in your message box in italics, as *"the text"* >> , ready for your answer; each new click adds the next one after an empty line, so every quote and answer stands apart. Text you select yourself goes in as it is. Click the button again, press Shift twice again or press Esc to stop.

## Find a channel

A button in the channel bar, or Ctrl+O, opens a search box. As soon as you type, the matching channels and threads of the server you are in show, best first, each with its category and the day of its last message (the time if it was today). In direct messages it searches all your servers and shows the server too. A click or Enter takes you there; the arrows move through the list and Esc closes it. Emoji, dashes and capitals do not matter: "lifely po" finds "🦕-lifely-po-allocation". When no channel has exactly the name you typed, the last line offers to create it: click it, or move to it and press Enter, and the new channel box opens with that name.

## Links in a channel

A link button in the channel bar opens a panel with every link posted in the channel you are in and in all its threads (or only in the thread, when you are in a thread), newest first, each with its date, who posted it and a Jump button to the message. Type in the filter to find one quickly, for example figma or dashboard. A link from a thread carries a small tag with the thread's name. A gear at the top of the panel offers four tick boxes, all on at first: hide links to Discord channels and messages, hide Slack links, group the same link posted several times into one line (grouped lines have no Jump button, since they point to several messages), and also group links that only differ by tracking codes (a Figma file counts once, whatever frame it points to). Untick grouping to see every post of a link with its own Jump button.

## Bookmarks

A flag button in the channel bar, or Ctrl+B, bookmarks the channel or thread you are in; do it again to remove the bookmark. You can also right-click any channel or thread and choose "Bookmark". A bookmark stays until you remove it and only colours the line, which keeps its place in the list, in the colour of what is happening in it, the strongest first: green while an agent is working there; orange when no agent is working and something is unread (go there first); blue when an agent has planned its next check there, like the next run of something; purple when you monitor it; yellow when it is quiet.

Monitoring is for a channel you want to follow closely with nothing to do yourself. Ctrl+M, or "Monitor" in the right-click menu, starts it, and the flag turns purple; the same again stops it, and the line goes back to how it was (a plain bookmark, or no bookmark if monitoring added it). New messages in a monitored or waiting channel still turn it orange, but only messages in the channel itself: unread messages in its folded threads no longer keep it orange. The blue lines need the mission board: the agents' planned checks come from it, so without a board set up nothing shows as waiting. A bookmarked channel stays visible in a closed category, and a bookmarked thread stays visible when its channel's threads are folded away. The flag square above the channel list removes every bookmark at once; it is red while there are bookmarks.

## Above the channel list

One line of square buttons stays at the top of the channel list, always in the same order, so your hand learns where each one is; a square greys out when it has nothing to do. From the left: hide or show every channel's threads; remove every bookmark; close or open every category of the server; filter the channels; create a channel; add people to the server. A closed category still shows a channel that is bookmarked or where someone is typing (in it or in one of its threads), like it shows unread ones; unread messages in a channel's threads alone do not keep it in view. The magnifier opens a filter: as you type, only the matching channels and threads of the server stay in the panel, the arrows move, Enter opens one, and Esc clears it. The plus creates a channel (Ctrl+P does the same): type its name and press Enter, and it opens. The name is written the way Discord writes channel names, small letters with a hyphen for each space. It never goes into a category: it lands at the bottom of the channels with no category, and Ctrl+K moves it into its category later. Picking a category in the box only puts that category's emoji at the start of the name (archive categories are not offered), and "No category" takes it off again. The last square opens Discord's own window to invite people.

## Tidy a channel into its category

AgentDisc reads the categories of the server you are in, so it works with any server and follows the categories as you add or remove them. Categories that differ only by an archive mark are one family: "🦕 Lifely", "🦕 Lifely Archive 1" and "🦕 Lifely Archive 2" are all Lifely. A family is its emoji and its name together, so two families that share a name or an emoji are never mixed up. Ctrl+K on a channel outside any category moves it into its family's main category, at the top: the family with the same emoji ("🥑-discord-app" goes into "🥑 Tools & Skills"), or, when the channel name has no emoji, the family whose name it holds ("chris-weekly-report" goes into "Chris"). It never moves a channel into an archive. Ctrl+K on a channel inside a category takes it out, under the other channels above the categories. In a thread, Ctrl+K moves its channel. The new channel box lists one line per family, and only families with an emoji, since picking one only adds its emoji to the name.

## Map and calendar above the members

When the right panel is open, two things sit above the member list. First a map: the channel you are in is the white dot in the middle, and around it are the channels (purple) and threads (orange) linked with it, both ways: a channel or thread mentioned, a link to a channel, thread or message, or a forwarded message, posted here or posted elsewhere about this channel. The map moves like Obsidian's graph: the dots float and pull on each other, dragging a dot moves it and the dots tied to it follow, the mouse wheel zooms, dragging the background moves the view, and the corner button fits the whole map again. Lines also join dots that link to each other. Tick boxes under the map show or hide channels, threads and names. A click on a dot opens it. In a thread, the panel shows the thread's channel. Then a calendar of the month: a dot under a day means you wrote in this channel or its threads that day, and a click on it opens the channel at that day's first message. The first visit to a long channel takes a few seconds to read; the other channels of the server are then read slowly in the background to find the links made to this one.

The mirrored panel icon in the channel bar folds the whole right panel away or opens it again, and dragging its left edge makes it wider or narrower; the width is kept.

## A mission board in the right panel

Where a mission board (one simple Kanban board per channel) is set up on your computer, the right panel shows the board of the channel you are in instead of the map, the calendar and the member list. It follows you as you change channel, without reloading, and marks the card of the thread you are in; a click on a card's thread opens that thread. The board opens without a login, through a key kept in your browser. "Mission board in the right panel" in the Panels group of the AgentDisc menu switches back to the map, the calendar and the members. Without a board set up, the right panel stays as described above.

## Copy a link

A click on the # just before the channel name at the top, or on the # of a channel in the channel list, copies the link of that channel (or thread); under the mouse, the # turns into a link icon of the same size to show it. In the small bar that shows over a message, a link icon copies the link of that message.

## Rename a channel

Ctrl+R, or a click on the channel name above the messages, opens a small box with the name of the channel or thread you are in. Change it and press Enter to save, or Esc to leave it as it was.

## No top bar, a busy bar instead

Discord's bar across the top of the window is gone, and its pieces moved closer to where you work. The server's picture sits before its name at the top of the channel list, with the back and forward arrows right after the name. Every icon that sat at the top right now sits in the channel bar, the bar above the messages: first AgentDisc's own (bookmark, feedback mode, find a channel, links, and three panel buttons), then Discord's own channel icons, then Discord's inbox and help and the AgentDisc robot. The three panel buttons hide or show the server list alone, the whole left panel (servers and channels together), and the right panel with the member list. Shift with the left arrow does the same as the left panel button, and Shift with the right arrow the same as the right panel button; while you type in a box that holds text, Shift with the arrows still selects text.

Where the top bar was, a thin busy bar runs across the screen. It counts the conversations, channels and threads of the server you are in, where an agent (Claude Code, Codex or any bot) is working right now, and fills a little more with each one. Its colour and words change in steps: green with a few ("Easy mode", "I'm cheating"), yellow from 4 ("Okay, now we're getting into it"), orange from 8 ("Okay, this is serious work"), red from 13 ("Things are heating up"), and at 20 it is full and burns, with flames along it ("The system is burning"). Beyond 20 it turns purple ("Beyond burning"). Each step has a few phrases and picks one at random, so the words change. When a new conversation starts, the bar jumps, flashes and a "+1" pops out of its end; when one ends, it eases down. A conversation counts while its agent shows "typing", and for a few seconds after, so a short pause does not drop it.

## The AgentDisc button

A small purple robot at the end of the channel bar opens one simple menu with three groups: Theme, Panels and Channel signs. While a message is being read, it also offers "Stop reading". Every choice is saved and stays after a restart.

## Read any message aloud

Next to the name on every message there is a small purple play button. Click it and a natural AI voice reads that message, plus the messages sent right after it under the same name, so an agent's answer split in several parts is read as one. You can also right-click a message and choose "Read aloud".

While it reads, a player sits inside the channel bar, between the channel name and its buttons (or just above the message box when that bar is hidden or too narrow): play and pause, back 10 seconds, forward 10 seconds, a timeline you can drag, speed from 1× to 2×, and close. Space pauses or plays, and the left and right arrows go back or forward 10 seconds (in the message box only while it is empty, so typing is never disturbed). The word being read lights up in the message, and a click on any word of that message jumps the reading there. The play button turns while the voice is being prepared, shows pause while it plays, and the player closes by itself at the end unless you moved around in it. Reading goes on when you change channel. While the voice plays, any YouTube tab turns down to a fifth of its volume, without pausing, and goes back to where it was when the voice stops (a switch in the AgentDiscVoice settings turns this off).

Links are read as "a link to" plus the site, and code blocks are skipped. Playing the same message again is free for 30 days. If the voice is not set up or not answering, Chrome's own voice reads instead.

## Typing signs

Three moving dots, with the small photos of who is typing, appear beside every channel and every thread where someone is writing, so you see at a glance which agent is working. When a channel's threads are busy, the channel itself shows a small thread sign with the number of busy threads; hover it to see their names. When a channel's threads are folded away, the photos and dots of whoever is typing in them move onto the channel line, just right of the thread sign. The red mention badge sits before the dots, so the dots always line up on the right.

## Threads grouped under their channel

A channel whose threads are open sits on one rounded soft blue card together with its threads, so you see at once which threads belong to which channel. Channels without open threads look as usual. The channel or thread you are in is solid purple with white text, easy to spot at a glance. Where Discord shows the white unread dot, a channel with threads gets a small arrow instead: click it to fold or unfold its threads (the arrow turns white when a folded thread has something new). A button above the channel list shows or hides every channel's threads at once. Resting the mouse on a channel no longer opens Discord's "More Active Threads" box beside it.

## Panels you can hide

From the Panels group of the menu, each part of Discord can be hidden on its own: the server list, the channel list, the channel header (with it go the buttons it holds), notice banners, the server name bar, the Events and Server Boosts lines, the account bar at the bottom (with the call buttons), the add server and Discover buttons, the gift, GIF, sticker, emoji and apps buttons of the message box, and the member list. A hidden channel list slides back while the mouse sits at the left edge of the window.

The server list and member list also have their own buttons in the channel bar (see above).

Ctrl+Alt+F switches "chat only" on and off: it hides the server list, channel list and member list at once (or everything except the chat, a choice in the settings, on the PanelSwitches cog).

## Theme

Midnight: a near-black channel list, a slightly lighter chat so the two stand apart, and a dark message box. Or Discord's normal dark look. Both work over Discord's own Dark theme (Discord settings, Appearance). Messages keep the same background when the mouse passes over them, so the chat stays still.

## Moving around with the keyboard

Discord's own shortcuts: Alt with the up and down arrows moves to the channel above or below, Alt with left and right goes back and forward through the channels you visited, and Alt with Shift and the arrows jumps between unread channels.

AgentDisc adds the same moves for the left hand: Alt with Z (up), S (down), Q (back) and D (forward) on an AZERTY keyboard, or Alt with W, S, A and D on a QWERTY keyboard. Moving up and down follows the list as you see it: the threads of a folded channel are skipped.

More AgentDisc shortcuts: Ctrl+O finds a channel, Shift pressed twice turns feedback mode on and off, Shift with the left or right arrow hides or shows the left or right panel, Ctrl+B bookmarks the channel you are in (with text selected in the message box it still makes the text bold), Ctrl+M monitors it, Ctrl+R renames it, Ctrl+P creates a channel, Ctrl+K moves it into or out of its category, and Ctrl+H shows a window with every shortcut and button. Discord's own Ctrl+K (quick switcher, use Ctrl+O instead) and Ctrl+P (pinned messages, the pin button stays) give way to these.

## Long messages

When a message is longer than Discord allows, Enter no longer opens the "message too long" window: the text is attached as a text file right away, and Enter again sends it. The "Send longer messages with Discord Nitro!" line under the message box is gone.

## Small tidy-ups

The invite and settings buttons that pop up when the mouse passes over a channel are gone (right-click still has both). Discord's tracking is blocked. A link opens in a new tab at once, without the "Leaving Discord" window. Mentions in threads no longer count: the red numbers on the server icon and in the tab title come only from channels, and a message in a thread never plays a sound or shows an alert. Links no longer try to open the Discord desktop app. If a Discord update breaks one of the AgentDisc parts, a thin purple bar appears at the top; hover it to see which part, and ask your agent to rebuild the app.

## Stephane's starting setup

The Midnight theme is on. Hidden: the server list, notice banners, the Events and Boosts lines, the account bar, the add server and Discover buttons, and the message box buttons. Shown: the channel list, the channel header and the server name bar (they hold the buttons), the busy bar and everything else. Typing signs show the dots with the small photos, the busy threads sign is on, and signs also show on the channel you are in. The voice is a calm, clear American man.

## Settings

Press Ctrl and comma in Discord to open the settings (the account bar with the gear is hidden at first), then choose AgentDisc and Plugins. Each part has a cog with its own options: the voice, a voice per agent, how to say certain names, and which letters the left-hand shortcuts use.
