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
    ["Ctrl+L", "Feedback mode on or off; tap Ctrl for a sentence or a paragraph"],
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
    ["Flag", "Top bar: bookmark the channel or thread you are in"],
    ["Speech bubble", "Top bar: feedback mode, click text to quote it in your reply"],
    ["Magnifier with lines", "Top bar: find a channel"],
    ["Magnifier", "Top bar: Discord's message search"],
    ["Chain link", "Top bar: every link posted in this channel and its threads"],
    ["Two panel icons", "Top bar: fold or open the server list, and the whole right panel"],
    ["# before the channel name", "At the top: copy the link of this channel or thread"],
    ["Link icon on a message", "In the bar that shows on hover: copy the link of that message"],
    ["AgentDisc", "Top bar: every AgentDisc switch and setting"],
    ["Hide / Show threads", "Above the channels: fold or open every channel's threads"],
    ["Clear", "Above the channels: remove every bookmark"],
    ["Close / Open categories", "Above the channels: close or open every category"],
    ["Magnifier", "Above the channels: filter the channel list as you type"],
    ["Plus", "Above the channels: create a channel"],
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
