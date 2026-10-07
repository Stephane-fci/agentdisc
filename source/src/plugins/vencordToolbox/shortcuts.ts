/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import { isBookmarked, togglePriority } from "@plugins/channelGroups";
import { openNewChannel, openRename, tidyChannel } from "@plugins/channelGroups/boxes";
import { channelHeaderSelector } from "@plugins/panelSwitches";
import { copyWithToast } from "@utils/discord";
import { ChannelStore, SelectedChannelStore, showToast, Toasts } from "@webpack/common";

import { plain } from "./channelSearch";
import { toggleHelp } from "./help";

// Channel shortcuts (Stephane, 6 Oct), the letter keys whatever the keyboard:
//   Ctrl+B  bookmark the channel or thread open now, or take the bookmark off. With text
//           selected in the message box, Ctrl+B still makes it bold.
//   Ctrl+R  rename the channel or thread open now (a click on its name at the top too).
//   Ctrl+P  create a channel (Chrome keeps Ctrl+N for a new window). Discord's own Ctrl+P
//           (pinned messages) is taken off in index.tsx.
//   Ctrl+K  put the channel in the category with its emoji, or take it out to the top.
//           Discord's own Ctrl+K (quick switcher) is taken off; Ctrl+O finds channels.
//   Ctrl+H  the window with every shortcut and button.

function stop(e: Event) {
    e.preventDefault();
    e.stopPropagation();
}

function boldingInMessageBox() {
    const box = (document.activeElement as HTMLElement | null)?.closest?.('[role="textbox"]');
    const selection = window.getSelection();
    return !!box && !!selection && !selection.isCollapsed && box.contains(selection.anchorNode);
}

function onKey(e: KeyboardEvent) {
    if (e.repeat || e.metaKey || e.shiftKey || !e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();

    if (key === "p") {
        stop(e);
        openNewChannel();
    } else if (key === "h") {
        stop(e);
        toggleHelp();
    } else if (key === "k") {
        stop(e);
        tidyChannel();
    } else if (key === "r") {
        if (openRename()) stop(e);
    } else if (key === "b") {
        const id = SelectedChannelStore.getChannelId();
        if (!id || !ChannelStore.getChannel(id)?.guild_id || boldingInMessageBox() || !isPluginEnabled("ChannelGroups")) return;
        stop(e);
        togglePriority(id);
        showToast(isBookmarked(id) ? "Bookmarked" : "Bookmark removed", Toasts.Type.SUCCESS);
    }
}

// The element above the messages that shows exactly the channel's name.
function nameElement(header: Element, name: string): HTMLElement | null {
    let found: HTMLElement | null = null;
    for (const el of header.querySelectorAll<HTMLElement>("*")) {
        if (plain(el.textContent ?? "") === name) found = el; // the deepest one wins
    }
    return found;
}

// A click on the channel name above the messages opens the rename box; a click on the # (or
// thread sign) just before it copies the link of the channel or thread (Stephane, 7 Oct).
function onClick(e: MouseEvent) {
    if (e.button !== 0 || e.ctrlKey || e.shiftKey || e.altKey) return;
    const header = channelHeaderSelector();
    const target = e.target as HTMLElement | null;
    const inHeader = header ? target?.closest?.(header) : null;
    if (!inHeader || target?.closest("input, textarea, [role='textbox'], button, a")) return;
    const channel = ChannelStore.getChannel(SelectedChannelStore.getChannelId());
    if (!channel?.guild_id) return;
    const name = plain(channel.name);
    if (!name) return;

    const icon = target?.closest("svg");
    if (icon) {
        const label = nameElement(inHeader, name);
        const a = icon.getBoundingClientRect();
        const b = label?.getBoundingClientRect();
        if (b && a.right <= b.left + 4 && b.left - a.right < 48 && Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < 16) {
            stop(e);
            copyWithToast(`https://discord.com/channels/${channel.guild_id}/${channel.id}`, channel.isThread?.() ? "Thread link copied" : "Channel link copied");
            return;
        }
    }

    for (let el: HTMLElement | null = target; el && el !== inHeader; el = el.parentElement) {
        if (plain(el.textContent ?? "") === name) {
            stop(e);
            openRename();
            return;
        }
    }
}

export function startChannelShortcuts() {
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("click", onClick, true);
}

export function stopChannelShortcuts() {
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("click", onClick, true);
}
