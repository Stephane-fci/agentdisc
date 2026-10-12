/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { closeBox, openBoxKind, showBox } from "@plugins/channelGroups/boxes";

// Ctrl+H (Stephane, 6 Oct): one window with every AgentDisc shortcut and button. Ctrl+H
// again, Esc or a click outside closes it. Keep it in step with WHAT-AGENTDISC-DOES.md.

const SHORTCUTS: [string, string][] = [
    ["Ctrl+O", "Find a channel or thread in this server, with its category and last message day"],
    ["Ctrl+P", "Create a channel, outside any category unless you pick one"],
    ["Ctrl+R", "Rename this channel or thread (or click its name at the top)"],
    ["Ctrl+B", "Bookmark this channel or thread, or remove the bookmark"],
    ["Ctrl+K", "Put this channel in the category with the same emoji (never an archive), or take it out, under the other channels above the categories"],
    ["Shift twice", "Feedback mode on or off; each tap on Ctrl: the paragraph, the sentence, a piece of it (up to a comma or colon)"],
    ["Shift + ← / →", "Hide or show the left panel (servers and channels) / the right panel; while typing, Shift with the arrows still selects text"],
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
    ["Flag", "Channel bar: bookmark the channel or thread you are in"],
    ["Speech bubble", "Channel bar: feedback mode, click text to quote it in your reply"],
    ["Magnifier with lines", "Channel bar: find a channel"],
    ["Chain link", "Channel bar: every link posted in this channel and its threads"],
    ["Three panel icons", "Channel bar: fold or open the server list alone, the whole left panel, and the right panel"],
    ["Inbox, help, AgentDisc", "Channel bar, at its end: Discord's inbox and help, and every AgentDisc switch and setting"],
    ["# of a channel", "At the top, or in the channel list: turns into a link icon under the mouse; a click copies the link of that channel"],
    ["Link icon on a message", "In the bar that shows on hover: copy the link of that message"],
    ["Squares above the channels", "From left: hide or show every thread, remove every bookmark, close or open every category, filter the channels, create a channel, add people"],
    ["Arrow left of a channel", "Fold or open that channel's threads"],
    ["Map above the members", "Channels (purple) and threads (orange) linked with this channel, both ways; drag dots, zoom with the wheel, click a dot to open it; tick boxes for channels, threads and names"],
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
