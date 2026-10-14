/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { EXTENSION_BASE_URL, metaReady } from "@utils/web-metadata";
import { ChannelStore, NavigationRouter } from "@webpack/common";

// The mission board in the right panel (Stephane, 14 Oct): one Kanban board per channel,
// shown instead of the map, the calendar and the member list. It follows the channel he
// opens and marks the open thread's card; a click on a card's thread opens that thread.
//
// The board's address comes from a setup file beside the app on his computer
// (dist/mission-board.json); the browser's own background part adds the board's key to the
// board's requests (service-worker.js). Without the setup file the panel stays as it was.
//
// One frame lives for the whole session, laid over the panel's place, so switching channels
// never reloads it: the board is told which channel to show by a message.

let origin: string | null = null;
const listeners = new Set<() => void>();

export const hasBoard = () => origin != null;

export function onBoardFound(fn: () => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
}

async function loadBoard() {
    try {
        await metaReady;
        if (!EXTENSION_BASE_URL) return;
        const res = await fetch(EXTENSION_BASE_URL + "dist/mission-board.json", { cache: "no-store" });
        if (!res.ok) return;
        const url = new URL(String((await res.json())?.board ?? ""));
        if (url.protocol !== "https:") return;
        origin = url.origin;
        listeners.forEach(fn => fn());
    } catch { }
}

let frame: HTMLIFrameElement | null = null;
let loaded = false;
let shown = "";
let slot: HTMLElement | null = null;
let raf = 0;
let last = "";

function boardFrame() {
    if (frame) return frame;
    frame = document.createElement("iframe");
    frame.className = "agentdisc-board-frame";
    frame.title = "Mission board";
    // Chrome fires a load for the empty frame the moment it is added; only the board's own
    // page counts.
    frame.addEventListener("load", () => { if (frame?.getAttribute("src")) loaded = true; });
    document.body.append(frame);
    return frame;
}

// The panel's resize handle sits on its left edge; the frame leaves it free.
const HANDLE = 4;

function place() {
    raf = 0;
    if (!frame) return;
    const rect = slot?.isConnected ? slot.getBoundingClientRect() : null;
    const visible = !!rect && rect.width > 40 && rect.height > 40;
    const next = visible ? `${rect!.left + HANDLE}|${rect!.top}|${rect!.width - HANDLE}|${rect!.height}` : "hidden";
    if (next !== last) {
        last = next;
        if (!visible) frame.style.display = "none";
        else Object.assign(frame.style, {
            display: "block",
            left: `${rect!.left + HANDLE}px`,
            top: `${rect!.top}px`,
            width: `${rect!.width - HANDLE}px`,
            height: `${rect!.height}px`
        });
    }
    if (slot) raf = requestAnimationFrame(place);
}

// The panel's place is on screen: lay the frame over it and keep it there.
export function attachSlot(element: HTMLElement) {
    slot = element;
    boardFrame();
    if (!raf) raf = requestAnimationFrame(place);
}

export function detachSlot(element: HTMLElement) {
    if (slot !== element) return;
    slot = null;
    if (!raf) raf = requestAnimationFrame(place);
}

// Show a channel's board, marking the open thread's card. The first time the frame loads
// the page; after that a message switches the board with no reload.
export function showBoard(channelId: string, threadId: string | null) {
    if (!origin) return;
    const f = boardFrame();
    const key = `${channelId}|${threadId ?? ""}`;
    if (key === shown) return;
    shown = key;
    if (!loaded || !f.contentWindow) {
        loaded = false;
        f.src = `${origin}/c/${channelId}?panel=1${threadId ? `&thread=${threadId}` : ""}`;
        return;
    }
    f.contentWindow.postMessage({ type: "mission-control:show", channel: channelId, thread: threadId }, origin);
}

// A click on a card's thread or icon in the board opens that thread or message here.
function onMessage(e: MessageEvent) {
    if (!origin || e.origin !== origin || !frame || e.source !== frame.contentWindow) return;
    const { data } = e;
    if (data?.type !== "mission-control:open" || typeof data.channel !== "string" || !/^\d+$/.test(data.channel)) return;
    const guild = typeof data.guild === "string" && /^\d+$/.test(data.guild) ? data.guild : ChannelStore.getChannel(data.channel)?.guild_id ?? "@me";
    // A card's icon names the exact message to look at (14 Oct): Discord jumps to it and
    // lights it up, in a thread too.
    const message = typeof data.message === "string" && /^\d+$/.test(data.message) ? `/${data.message}` : "";
    NavigationRouter.transitionTo(`/channels/${guild}/${data.channel}${message}`);
}

export function startBoard() {
    window.addEventListener("message", onMessage);
    loadBoard();
}

export function stopBoard() {
    window.removeEventListener("message", onMessage);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    frame?.remove();
    frame = null;
    loaded = false;
    shown = "";
    slot = null;
    last = "";
}
