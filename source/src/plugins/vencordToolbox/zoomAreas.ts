/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "@api/Settings";

// Zoom one area at a time (Stephane, 24 Oct: "the same way I can use my mouse wheel to scroll
// the board and the ideas while maintaining control to zoom in and out"): Ctrl and the mouse
// wheel over the chat, the channel list, the server list, the Team part or the Calendar part
// makes that area bigger or smaller, and only that one; the zoom of each is kept. The board,
// the ideas page and the map of connections zoom by themselves already.
//
// Each area is the scrolling box under the mouse, scaled whole (CSS zoom), so it keeps its
// place and Discord's own lists still count their lines right. It is found again after
// Discord redraws it by the first class name of that box, Discord's name for that part.
//
// The page listens to the wheel only while Ctrl is held: a wheel listener that may stop the
// page's own zoom makes Chrome wait for the page on every scroll (his lag report, 21 Oct).

type Area = "chat" | "channels" | "servers" | "team" | "calendar";
const NAMES: Record<Area, string> = { chat: "Chat", channels: "Channels", servers: "Servers", team: "Team", calendar: "Calendar" };
const MIN = 0.6;
const MAX = 2;
const STEP = 1.1;

interface Kept { selector: string; zoom: number; }

let style: HTMLStyleElement | null = null;
let listening = false;
let badge: HTMLElement | null = null;
let badgeTimer: ReturnType<typeof setTimeout> | null = null;

function read(): Partial<Record<Area, Kept>> {
    try {
        const kept = JSON.parse(String(Settings.plugins.VencordToolbox?.areaZoom || "{}"));
        return kept && typeof kept === "object" ? kept : {};
    } catch {
        return {};
    }
}

function write(next: Partial<Record<Area, Kept>>) {
    Settings.plugins.VencordToolbox.areaZoom = JSON.stringify(next);
    apply();
}

// The server list's column follows its zoom (Stephane, 24 Oct: "when making the channel list
// smaller, I want the gap to be filled by the channel list"): Discord sizes that column from
// one value, the icon plus its padding, and the channel list takes the rest of the side.
const SERVER_COLUMN = (zoom: number) => `:root,.refresh-fast-follow-avatars{--custom-guild-list-width:calc((var(--guildbar-avatar-size) + var(--custom-guild-list-padding) * 2) * ${zoom})!important}`;

function apply() {
    if (!style) return;
    const kept = read();
    const rules = Object.values(kept)
        .filter((k): k is Kept => !!k && typeof k.selector === "string" && /^[.\w-]+$/.test(k.selector) && k.zoom !== 1)
        .map(k => `${k.selector}{zoom:${k.zoom}}`);
    const servers = kept.servers?.zoom;
    if (typeof servers === "number" && servers !== 1) rules.push(SERVER_COLUMN(servers));
    style.textContent = rules.join("\n");
}

function scrollerOf(start: Element | null): HTMLElement | null {
    for (let el = start as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
        const y = getComputedStyle(el).overflowY;
        if (y === "auto" || y === "scroll") return el;
    }
    return null;
}

// What makes a scrolling box one area or another.
const IS: Record<Exclude<Area, "calendar">, (el: HTMLElement) => boolean> = {
    chat: el => !!el.querySelector('ol[data-list-id="chat-messages"]'),
    channels: el => !!el.querySelector('[data-list-item-id^="channels___"]'),
    servers: el => !!el.querySelector('[data-list-item-id^="guildsnav___"]'),
    team: el => !!el.closest("[data-agentdisc-team]") && !el.closest(".agentdisc-own")
};

// Discord's own name for the box (name_hash), so the rule still finds it after a redraw. Of
// its names, the one the fewest elements share, and only if every element bearing it is the
// same kind of area: every scrolling box also carries the names of Discord's common
// scroller, and zooming by one of those would zoom them all (24 Oct, caught in the test).
function selectorOf(el: HTMLElement, area: Area) {
    if (area === "calendar") return ".agentdisc-side-calendar";
    const names = [...el.classList]
        .filter(name => /^[A-Za-z][\w-]*_[\w-]{4,}$/.test(name))
        .map(name => ({ name, all: [...document.getElementsByClassName(name)] as HTMLElement[] }))
        .sort((a, b) => a.all.length - b.all.length);
    const fit = names.find(n => n.all.every(x => x === el || IS[area](x)));
    return fit ? `.${fit.name}` : null;
}

function areaAt(target: Element): { area: Area; element: HTMLElement; } | null {
    const calendar = target.closest<HTMLElement>(".agentdisc-side-calendar");
    if (calendar) return { area: "calendar", element: calendar };
    // The map zooms itself; the board's frames get their own wheel.
    if (target.closest(".agentdisc-side-graph, .agentdisc-part")) return null;
    const box = scrollerOf(target);
    if (!box) return null;
    for (const area of Object.keys(IS) as (keyof typeof IS)[]) if (IS[area](box)) return { area, element: box };
    return null;
}

function show(text: string, x: number, y: number) {
    badge ??= Object.assign(document.createElement("div"), { className: "agentdisc-zoom-badge" });
    badge.textContent = text;
    badge.style.left = `${x + 12}px`;
    badge.style.top = `${y + 12}px`;
    if (!badge.isConnected) document.body.append(badge);
    if (badgeTimer) clearTimeout(badgeTimer);
    badgeTimer = setTimeout(() => badge?.remove(), 900);
}

function onWheel(e: WheelEvent) {
    if (!e.ctrlKey || !(e.target instanceof Element)) return;
    const found = areaAt(e.target);
    if (!found) return;
    const selector = selectorOf(found.element, found.area);
    if (!selector) return;
    e.preventDefault();
    e.stopPropagation();
    const kept = read();
    const before = kept[found.area]?.selector === selector ? kept[found.area]!.zoom : 1;
    let zoom = e.deltaY < 0 ? before * STEP : before / STEP;
    zoom = Math.min(MAX, Math.max(MIN, Math.round(zoom * 100) / 100));
    // Back near the normal size, it snaps to it.
    if (Math.abs(zoom - 1) < 0.04) zoom = 1;
    write({ ...kept, [found.area]: { selector, zoom } });
    show(`${NAMES[found.area]} ${Math.round(zoom * 100)}%`, e.clientX, e.clientY);
}

function listen(on: boolean) {
    if (on === listening) return;
    listening = on;
    if (on) window.addEventListener("wheel", onWheel, { capture: true, passive: false });
    else window.removeEventListener("wheel", onWheel, { capture: true });
}

const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Control") listen(true); };
const onKeyUp = (e: KeyboardEvent) => { if (e.key === "Control") listen(false); };
const onBlur = () => listen(false);

export function resetZoom() {
    write({});
}

export function hasZoom() {
    return Object.values(read()).some(k => k && k.zoom !== 1);
}

export function startZoomAreas() {
    style = document.createElement("style");
    style.id = "agentdisc-area-zoom";
    (document.head ?? document.documentElement).append(style);
    apply();
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
}

export function stopZoomAreas() {
    listen(false);
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("blur", onBlur);
    style?.remove();
    style = null;
    badge?.remove();
}
