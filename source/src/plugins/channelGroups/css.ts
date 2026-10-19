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
// The soft blue card: a channel whose threads are open sits on it together with its
// threads (Stephane, 1 Oct: "If it has a thread and the dropdown is open, threads and the
// main channel have the same blue color"). Other channels stay as Discord draws them.
export const CARD = "color-mix(in oklab,#5865f2 12%,transparent)";
const CARD_RADIUS = 8;

// Priority lines (Stephane, 1 Oct): a channel or thread he marks stands out until he
// removes the mark, in the colour of what is happening in it, the strongest first:
//   green   an agent is working there
//   orange  no agent works and something is unread: go there first (red until 14 Oct, now
//           the mission board's orange for "needs you to check"). For a blue or purple
//           line only its own new messages count, not its folded threads (18 Oct).
//   blue    an agent has planned its next check there and nothing needs him (18 Oct, the
//           mission board's Waiting blue; no hover label since 19 Oct, his ask)
//   purple  he monitors it: he follows it closely with nothing to do (18 Oct, Ctrl+M)
//   yellow  quiet: no agent, nothing unread
// A tint, a bar on the left and white text; when it is also the open one, it keeps the
// purple with the coloured bar.
export type PriorityState = "green" | "orange" | "blue" | "purple" | "yellow";
export const PRIORITY_COLOURS: Record<PriorityState, string> = {
    green: "#23a55a",
    orange: "#f57c2a",
    blue: "#4ba3f5",
    purple: "#a970ff",
    yellow: "#f0b232"
};

// next: for a blue line, when its soonest planned check is due (the clock on the line).
export interface PriorityItem { id: string; state: PriorityState; next?: string; }

export function buildPriorityCss(items: PriorityItem[], line?: GroupClasses["line"]) {
    if (!items.length || !line) return "";
    const rules: string[] = [];
    const rowOf = (id: string) => `${sel(line.wrapper)}:has([data-list-item-id="channels___${id}"])`;
    for (const state of Object.keys(PRIORITY_COLOURS) as PriorityState[]) {
        const rows = items.filter(i => i.state === state).map(i => rowOf(i.id));
        if (!rows.length) continue;
        const colour = PRIORITY_COLOURS[state];
        rules.push(
            `${rows.map(r => `${r} ${sel(line.link)}`).join(",")}{background:color-mix(in oklab,${colour} 22%,transparent)!important;box-shadow:inset 3px 0 0 ${colour}!important}`,
            `${rows.map(r => `${r}${sel(line.modeSelected)} ${sel(line.link)}`).join(",")}{background:${SELECTED}!important;box-shadow:inset 4px 0 0 ${colour},0 2px 10px rgb(88 101 242 / 40%)!important}`
        );
    }
    rules.push(`${items.map(i => `${rowOf(i.id)} ${sel(line.name)}`).join(",")}{color:#fff!important}`);
    return rules.join("\n");
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
            // The card: rounded, starting where the channel lines start, drawn inside the
            // lines' own boxes so no line changes height.
            `li[data-dnd-name]:has(+${g}){position:relative;isolation:isolate}`,
            `li[data-dnd-name]:has(+${g}):before{content:"";position:absolute;inset:${GAP_ABOVE}px 0 0 var(--space-xs,8px);border-radius:${CARD_RADIUS}px ${CARD_RADIUS}px 0 0;background:${CARD};z-index:-1;pointer-events:none}`,
            `${g}>ul{position:relative;isolation:isolate}`,
            `${g}>ul:before{content:"";position:absolute;inset:0 0 0 var(--space-xs,8px);border-radius:0 0 ${CARD_RADIUS}px ${CARD_RADIUS}px;background:${CARD};z-index:-1;pointer-events:none}`,
            `${g}:after{content:"";display:block;height:${GAP_BELOW}px}`,
            // The thread lines' little curves move up with the shorter lines.
            `${g} ${sel(group.spine)}{margin-top:-${THREAD_TRIM / 2}px}`,
            `li[data-dnd-name]:has(+${g}){padding-top:${GAP_ABOVE}px}`
        );
    }

    return rules.join("\n");
}
