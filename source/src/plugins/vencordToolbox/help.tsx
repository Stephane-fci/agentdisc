/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { closeBox, openBoxKind, showBox } from "@plugins/channelGroups/boxes";

// Ctrl+H (Stephane, 6 Oct): one window with every AgentDisc shortcut and button. Ctrl+H
// again, Esc or a click outside closes it. Keep it in step with WHAT-AGENTDISC-DOES.md.

const SHORTCUTS: [string, string][] = [
    ["Ctrl+O", "Find a channel or thread in this server, with its category and last message day; when none has the name typed, the last line creates it"],
    ["Ctrl+P", "Create a channel at the bottom of the channels with no category: small letters and hyphens as you type, a category's emoji added when you pick one (also from Ctrl+O when no channel has that name)"],
    ["Ctrl+R", "Rename this channel or thread (or click its name at the top)"],
    ["Ctrl+B", "Bookmark this channel or thread (a channel moves under the other bookmarked ones), or remove the bookmark"],
    ["Ctrl+K", "Put this channel in its category: the one with the same emoji (or, with no emoji, the one whose name it holds), never an archive; or take it out, under the other channels above the categories"],
    ["Shift twice", "Feedback mode on or off; each tap on Ctrl: the paragraph, the sentence, a piece of it (up to a comma or colon)"],
    ["Shift + ← / →", "Hide or show the left panel (servers and channels) / the right panel; while typing, Shift with the arrows still selects text"],
    ["Ctrl+J", "Drop an idea: the right panel's Ideas part switched on, the cursor in its box (where the mission board is set up)"],
    ["Ctrl+H", "This window"],
    ["Alt+Z / Alt+S", "Channel above / below (Alt+W / Alt+S on QWERTY)"],
    ["Alt+Q / Alt+D", "Back / forward through the channels you visited (Alt+A / Alt+D on QWERTY)"],
    ["Alt+↑ / Alt+↓", "Channel above / below (Discord's own)"],
    ["Alt+Shift+↑ / ↓", "Unread channel above / below (Discord's own)"],
    ["Space, ← →", "While a message is read aloud: pause, go back, go forward"],
    ["Enter", "On a message that is too long: attach it as a text file"],
    ["Esc", "Close a box, stop feedback mode"]
];

const BUTTONS: [string, string][] = [
    ["Busy bar", "Top of the screen: how many conversations have an agent working in this server; green, yellow, orange, red, burning at 20, purple beyond"],
    ["Picture and arrows", "Server name: the server's picture before its name, back and forward right after it"],
    ["Flag", "Channel bar: bookmark the channel or thread you are in; a newly bookmarked channel moves under the other bookmarked ones (in servers you own). A bookmarked line is green while an agent works, red when something is unread (for a blue line, only in the channel itself, not its folded threads), blue while an agent's next check is planned (a small clock on the line shows when), yellow when quiet"],
    ["Speech bubble", "Channel bar: feedback mode, click text to quote it in your reply"],
    ["Magnifier with lines", "Channel bar: find a channel"],
    ["Chain link", "Channel bar: every link posted in this channel and its threads"],
    ["Three panel icons", "Channel bar: fold or open the server list alone, the whole left panel, and the right panel"],
    ["Inbox, help, AgentDisc", "Channel bar, at its end: Discord's inbox and help, and every AgentDisc switch and setting"],
    ["# of a channel", "At the top, or in the channel list: turns into a link icon under the mouse; a click copies the link of that channel"],
    ["Link icon on a message", "In the bar that shows on hover: copy the link of that message"],
    ["Squares above the channels", "From left: hide or show every thread, remove every bookmark, close or open every category, filter the channels, create a channel, add people"],
    ["Arrow left of a channel", "Fold or open that channel's threads"],
    ["Board, Ideas, Team, Calendar", "Top of the right panel: a click shows or hides that part, a double click shows it alone, dragging a button moves its part up or down, dragging the line between two parts shares the room. Parts: the channel's mission board; a box to drop an idea, which goes to the right channel; the people in the server, no bots; the map of linked channels and your calendar. Board and Ideas only where the board is set up"],
    ["Mission board", "Right panel, Board: the board of the channel you are in, its open thread's card marked; a click on a card's thread opens it"],
    ["Map", "Right panel, Calendar: channels (purple) and threads (orange) linked with this channel, both ways; drag dots, zoom with the wheel, click a dot to open it; tick boxes for channels, threads and names"],
    ["Right panel edge", "Drag it to make the right panel wider or narrower"],
    ["Calendar above the members", "The days you wrote here; click a marked day to open its first message"],
    ["Play button on a message", "Read it aloud; the words light up as they are read"]
];

function Rows({ rows }: { rows: [string, string][]; }) {
    return (
        <div className="agentdisc-help-rows">
            {rows.map(([key, what], i) => (
                <div key={i} className="agentdisc-help-row">
                    <span className="agentdisc-help-key">{key}</span>
                    <span className="agentdisc-help-what">{what}</span>
                </div>
            ))}
        </div>
    );
}

function Help() {
    return (
        <div className="agentdisc-find-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) closeBox(); }}>
            <div
                className="agentdisc-find agentdisc-help"
                role="dialog"
                aria-label="AgentDisc shortcuts"
                tabIndex={-1}
                ref={el => el?.focus()}
                onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); closeBox(); } }}
            >
                <div className="agentdisc-namebox-title">Shortcuts</div>
                <Rows rows={SHORTCUTS} />
                <div className="agentdisc-namebox-title">Buttons</div>
                <Rows rows={BUTTONS} />
            </div>
        </div>
    );
}

export function toggleHelp() {
    if (openBoxKind() === "help") closeBox();
    else showBox(<Help />, "help");
}
