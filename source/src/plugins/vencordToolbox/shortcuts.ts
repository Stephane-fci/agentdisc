/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import { isBookmarked, toggleMonitoring, togglePriority } from "@plugins/channelGroups";
import { openNewChannel, openRename, tidyChannel } from "@plugins/channelGroups/boxes";
import { channelHeaderSelector } from "@plugins/panelSwitches";
import { copyWithToast } from "@utils/discord";
import { ChannelStore, SelectedChannelStore, showToast, Toasts } from "@webpack/common";

import { plain } from "./channelSearch";
import { toggleHelp } from "./help";

// Channel shortcuts (Stephane, 6 Oct), the letter keys whatever the keyboard:
//   Ctrl+B  bookmark the channel or thread open now, or take the bookmark off. With text
//           selected in the message box, Ctrl+B still makes it bold.
//   Ctrl+M  monitor the channel or thread open now, or stop monitoring it (18 Oct).
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
    } else if (key === "m") {
        const id = SelectedChannelStore.getChannelId();
        if (!id || !ChannelStore.getChannel(id)?.guild_id || !isPluginEnabled("ChannelGroups")) return;
        stop(e);
        showToast(toggleMonitoring(id) ? "Monitoring" : "Monitoring stopped", Toasts.Type.SUCCESS);
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

// The # (or thread sign) just before the channel name above the messages, or a channel's #
// in the channel list: a click copies the link of that channel or thread (Stephane, 7 Oct).
// Returns the icon and the link it copies, or null.
function copyIcon(target: HTMLElement | null): { icon: SVGElement; link: string; label: string; } | null {
    const icon = target?.closest?.("svg");
    if (!icon) return null;

    const row = icon.closest<HTMLElement>('[data-list-item-id^="channels___"]');
    if (row) {
        if (row.querySelector("svg") !== icon) return null;
        const listed = ChannelStore.getChannel(row.getAttribute("data-list-item-id")!.slice("channels___".length));
        if (!listed?.guild_id || listed.isThread?.()) return null;
        return { icon, link: `https://discord.com/channels/${listed.guild_id}/${listed.id}`, label: "Channel link copied" };
    }

    const header = channelHeaderSelector();
    const inHeader = header ? icon.closest(header) : null;
    if (!inHeader) return null;
    const channel = ChannelStore.getChannel(SelectedChannelStore.getChannelId());
    const name = channel?.guild_id ? plain(channel.name) : "";
    if (!name) return null;
    const label = nameElement(inHeader, name);
    const a = icon.getBoundingClientRect();
    const b = label?.getBoundingClientRect();
    if (!b || a.right > b.left + 4 || b.left - a.right >= 48 || Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) >= 16) return null;
    return { icon, link: `https://discord.com/channels/${channel!.guild_id}/${channel!.id}`, label: channel!.isThread?.() ? "Thread link copied" : "Channel link copied" };
}

// A click on the channel name above the messages opens the rename box; a click on the #
// copies the link.
function onClick(e: MouseEvent) {
    if (e.button !== 0 || e.ctrlKey || e.shiftKey || e.altKey) return;
    const target = e.target as HTMLElement | null;

    const copy = copyIcon(target);
    if (copy) {
        stop(e);
        copyWithToast(copy.link, copy.label);
        return;
    }

    const header = channelHeaderSelector();
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

// Under the mouse, that # turns into a link icon of the same size (Stephane, 12 Oct: no
// change of shape, only the sign), so it shows a click copies the link.
const LINK_SIGN = "agentdisc-copy-sign";
let signed: SVGElement | null = null;

function onOver(e: MouseEvent) {
    const icon = copyIcon(e.target as HTMLElement | null)?.icon ?? null;
    if (icon === signed) return;
    signed?.classList.remove(LINK_SIGN);
    signed = icon;
    signed?.classList.add(LINK_SIGN);
}

export function startChannelShortcuts() {
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("mouseover", onOver, true);
}

export function stopChannelShortcuts() {
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("mouseover", onOver, true);
    signed?.classList.remove(LINK_SIGN);
    signed = null;
}
