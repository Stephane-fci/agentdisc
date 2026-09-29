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
    line?: Record<"wrapper" | "typeThread" | "link" | "unread", string>;
    group?: Record<"container" | "spine" | "spineBorder" | "invertedSpine", string>;
}

const sel = (cls: string) => cls.split(" ").map(c => "." + c).join("");

export function buildGroupCss({ line, group }: GroupClasses) {
    const rules: string[] = [];

    if (line) {
        rules.push(
            // The white unread mark at the left edge is gone; the fold arrow uses that spot,
            // and an unread channel still shows its name in white.
            `${sel(line.unread)}{display:none!important}`,
            `${sel(line.typeThread)} ${sel(line.link)}{padding-block:${4 - THREAD_TRIM / 2}px!important}`
        );
    }

    if (group) {
        const g = sel(group.container);
        rules.push(
            // The threads sit on a soft purple card, starting where the channel lines start.
            `${g}>ul{position:relative}`,
            `${g}>ul:before{content:"";position:absolute;inset:0 0 0 var(--space-xs,8px);border-radius:var(--radius-sm,8px);background:color-mix(in oklab,#5865f2 14%,transparent);pointer-events:none}`,
            `${g}:after{content:"";display:block;height:${GAP_BELOW}px}`,
            // The thread lines' little curves move up with the shorter lines.
            `${g} ${sel(group.spine)}{margin-top:-${THREAD_TRIM / 2}px}`,
            `li[data-dnd-name]:has(+${g}){padding-top:${GAP_ABOVE}px}`
        );
    }

    return rules.join("\n");
}
