/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import { isBookmarked, togglePriority } from "@plugins/channelGroups";
import { openNewChannel, openRename } from "@plugins/channelGroups/boxes";
import { channelHeaderSelector } from "@plugins/panelSwitches";
import { ChannelStore, SelectedChannelStore, showToast, Toasts } from "@webpack/common";

import { plain } from "./channelSearch";

// Channel shortcuts (Stephane, 6 Oct), the letter keys whatever the keyboard:
//   Ctrl+B  bookmark the channel or thread open now, or take the bookmark off. With text
//           selected in the message box, Ctrl+B still makes it bold.
//   Ctrl+R  rename the channel or thread open now (a click on its name at the top too).
//   Alt+N   create a channel. Chrome keeps Ctrl+N for a new window and never passes it to
//           the page; when it does (full screen), Ctrl+N works too.

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
    if (e.repeat || e.metaKey || e.shiftKey) return;
    const key = e.key.toLowerCase();

    if (e.altKey && !e.ctrlKey && (key === "n" || e.code === "KeyN")) {
        stop(e);
        openNewChannel();
        return;
    }
    if (!e.ctrlKey || e.altKey) return;

    if (key === "n") {
        stop(e);
        openNewChannel();
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

// A click on the channel name above the messages opens the rename box.
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
