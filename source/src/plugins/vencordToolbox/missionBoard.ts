/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { EXTENSION_BASE_URL, metaReady } from "@utils/web-metadata";
import { ChannelStore, MessageActions, NavigationRouter, SelectedChannelStore } from "@webpack/common";

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
//
// The board can grow to almost the whole window (Stephane, 20 Oct: "a pop-up that takes up
// almost all of the screen, where I would see the board in full"): its own button asks, the
// same frame moves over a dim layer and keeps following the channel he opens. A click on the
// dim layer, Esc, or opening a card's message puts it back over the panel.

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
let full = false;
let dim: HTMLElement | null = null;
// The space left free all round the big board.
const MARGIN = 24;

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
    // Big, the frame keeps its place whatever the panel does; the window's size follows by itself.
    if (full) {
        if (last !== "full") {
            last = "full";
            Object.assign(frame.style, {
                display: "block",
                left: `${MARGIN}px`,
                top: `${MARGIN}px`,
                width: `calc(100vw - ${2 * MARGIN}px)`,
                height: `calc(100vh - ${2 * MARGIN}px)`
            });
        }
        return;
    }
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

// The board's own button shows the real size only once it hears it from here.
function tellSize() {
    if (origin && frame?.contentWindow) frame.contentWindow.postMessage({ type: "mission-control:size", full }, origin);
}

function onEscape(e: KeyboardEvent) {
    if (e.key !== "Escape" || !full) return;
    e.preventDefault();
    e.stopPropagation();
    setFull(false);
}

function setFull(next: boolean) {
    if (!frame || full === next) {
        tellSize();
        return;
    }
    full = next;
    frame.classList.toggle("agentdisc-board-full", full);
    if (full) {
        if (!dim) {
            dim = document.createElement("div");
            dim.className = "agentdisc-board-dim";
            dim.addEventListener("click", () => setFull(false));
        }
        document.body.append(dim);
        document.addEventListener("keydown", onEscape, true);
    } else {
        dim?.remove();
        document.removeEventListener("keydown", onEscape, true);
    }
    last = "";
    if (!raf) raf = requestAnimationFrame(place);
    tellSize();
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
        // grow=1: the board offers its full-screen button, which this app answers.
        f.src = `${origin}/c/${channelId}?panel=1&grow=1${threadId ? `&thread=${threadId}` : ""}`;
        return;
    }
    f.contentWindow.postMessage({ type: "mission-control:show", channel: channelId, thread: threadId }, origin);
}

// A click on a card's thread or icon in the board opens that thread or message here.
function onMessage(e: MessageEvent) {
    if (!origin || e.origin !== origin || !frame || e.source !== frame.contentWindow) return;
    const { data } = e;
    if (data?.type === "mission-control:size") {
        setFull(data.full === true);
        return;
    }
    if (data?.type !== "mission-control:open" || typeof data.channel !== "string" || !/^\d+$/.test(data.channel)) return;
    // From the big board, back to the panel first, so he lands on the message.
    setFull(false);
    const guild = typeof data.guild === "string" && /^\d+$/.test(data.guild) ? data.guild : ChannelStore.getChannel(data.channel)?.guild_id ?? "@me";
    // A card's icon names the exact message to look at (14 Oct): Discord jumps to it and
    // lights it up, in a thread too. In the channel already open, going to the same address
    // does nothing, so Discord's own jump is used there.
    const message = typeof data.message === "string" && /^\d+$/.test(data.message) ? data.message : null;
    if (message && SelectedChannelStore.getChannelId() === data.channel) {
        MessageActions.jumpToMessage({ channelId: data.channel, messageId: message, flash: true, jumpType: "INSTANT" });
        return;
    }
    NavigationRouter.transitionTo(`/channels/${guild}/${data.channel}${message ? `/${message}` : ""}`);
}

export function startBoard() {
    window.addEventListener("message", onMessage);
    loadBoard();
}

export function stopBoard() {
    window.removeEventListener("message", onMessage);
    setFull(false);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    frame?.remove();
    frame = null;
    loaded = false;
    shown = "";
    slot = null;
    last = "";
}
