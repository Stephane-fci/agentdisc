/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// The look of a channel with its threads, as one style text built from Discord's own
// class names. Kept free of Discord imports so a test page can use the same text.

// Discord's list places every line from heights it computes itself, so each pixel
// taken or added here is also given to the list (index.tsx, rowHeight).
export const THREAD_TRIM = 4; // a thread line is 4px shorter: 2px less above and below
export const GAP_ABOVE = 4; // space above a channel that shows threads
export const GAP_BELOW = 8; // space under its threads
export const GROUP_SPACE = GAP_ABOVE + GAP_BELOW;

export interface GroupClasses {
    line?: Record<"wrapper" | "typeThread" | "link" | "unread" | "modeSelected" | "name" | "icon", string>;
    group?: Record<"container" | "spine" | "spineBorder" | "invertedSpine", string>;
}

const sel = (cls: string) => cls.split(" ").map(c => "." + c).join("");

export const SELECTED = "#5865f2";
export const STRIPE = "rgb(255 255 255 / 4.5%)";

// Channel lines alternate like the rows of a sheet, and a channel's threads take its
// shade (Stephane, 1 Oct). The shaded channels come from the list's own order, so the
// pattern stays the same while scrolling and whether threads are open or folded.
export function buildStripeCss(shadedIds: string[], container?: string) {
    if (!shadedIds.length) return "";
    const rows = shadedIds.map(id => `li[data-dnd-name]:has([data-list-item-id="channels___${id}"])`);
    const all = container ? rows.flatMap(r => [r, `${r}+${sel(container)}`]) : rows;
    return `${all.join(",")}{background:${STRIPE}}`;
}

export function buildGroupCss({ line, group }: GroupClasses) {
    const rules: string[] = [];

    if (line) {
        const selected = sel(line.modeSelected);
        rules.push(
            // The white unread mark at the left edge is gone; the fold arrow uses that spot,
            // and an unread channel still shows its name in white.
            `${sel(line.unread)}{display:none!important}`,
            `${sel(line.typeThread)} ${sel(line.link)}{padding-block:${4 - THREAD_TRIM / 2}px!important}`,
            // The channel or thread being read stands out at a glance (Stephane, 1 Oct):
            // a solid purple line with white text instead of Discord's faint grey.
            `${selected} ${sel(line.link)},${selected}:hover ${sel(line.link)}{background:${SELECTED}!important;box-shadow:inset 0 0 0 1px rgb(255 255 255 / 14%),0 2px 10px rgb(88 101 242 / 40%)}`,
            `${selected} ${sel(line.name)},${selected}:hover ${sel(line.name)},${selected} ${sel(line.icon)},${selected}:hover ${sel(line.icon)}{color:#fff!important}`
        );
    }

    if (group) {
        const g = sel(group.container);
        rules.push(
            `${g}:after{content:"";display:block;height:${GAP_BELOW}px}`,
            // The thread lines' little curves move up with the shorter lines.
            `${g} ${sel(group.spine)}{margin-top:-${THREAD_TRIM / 2}px}`,
            `li[data-dnd-name]:has(+${g}){padding-top:${GAP_ABOVE}px}`
        );
    }

    return rules.join("\n");
}
