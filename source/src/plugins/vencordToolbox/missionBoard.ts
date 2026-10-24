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
// The look AgentDisc shows ("ivory" or "dark", from the theme switch), so the board can match
// it (asked of the board on 20 Oct); a board that does not know the message ignores it.
let look = "dark";
let dim: HTMLElement | null = null;

// The board's pages in the same frame (24 Oct, his "switch pannels"): the board and the ideas
// page. AgentDisc shows its own Board and Ideas buttons (modes=1 in the address hides the
// board's own small switch) and tells the board which page to show; the board answers with
// the page it shows after every change, and on load with the pages it offers. A board from
// before the ideas page never says it offers them, so the Ideas button waits for that word.
export type BoardView = "board" | "ideas";
let wantView: BoardView = "board";
let wantFocus = false;
let offered = new Set<string>(["board"]);
const viewListeners = new Set<(view: BoardView) => void>();
const offerListeners = new Set<(views: string[]) => void>();

export function onBoardView(fn: (view: BoardView) => void) {
    viewListeners.add(fn);
    return () => void viewListeners.delete(fn);
}

export function onBoardViews(fn: (views: string[]) => void) {
    offerListeners.add(fn);
    return () => void offerListeners.delete(fn);
}

function sendView() {
    if (!origin || !frame?.contentWindow || !loaded) return;
    if (wantView !== "board" && !offered.has(wantView)) return;
    frame.contentWindow.postMessage({ type: "mission-control:view", view: wantView, focus: wantFocus }, origin);
    wantFocus = false;
}

// The page to show; focus puts the cursor in the idea box. Before the board has loaded, the
// wish waits and goes out when the board says what it offers.
export function setBoardView(view: BoardView, focus = false) {
    wantView = view;
    if (focus) wantFocus = true;
    sendView();
}
// The panel's resize handle sits on its left edge; the frame leaves it free (styles.css).
//
// Chrome itself keeps the frame on the panel's place (CSS anchor positioning, 21 Oct): the
// place is the anchor and the frame follows it through every resize with no script running.
// Before, a script measured the place on every screen refresh, all day long, which kept the
// computer busy for nothing (his lag report, 21 Oct). A watcher on the place's size only
// hides the frame when the place is gone or too small. A browser without anchors keeps the
// old way.
const ANCHORS = typeof CSS !== "undefined" && CSS.supports?.("anchor-name: --agentdisc-board") === true;
const ANCHOR = "--agentdisc-board";
const HANDLE = 4;
let seen = false;
let watcher: ResizeObserver | null = null;

function boardFrame() {
    if (frame) return frame;
    frame = document.createElement("iframe");
    frame.className = "agentdisc-board-frame" + (ANCHORS ? " agentdisc-board-anchored" : "");
    frame.title = "Mission board";
    // Chrome fires a load for the empty frame the moment it is added; only the board's own
    // page counts.
    frame.addEventListener("load", () => {
        if (!frame?.getAttribute("src")) return;
        loaded = true;
        sendView();
    });
    document.body.append(frame);
    return frame;
}

function show(on: boolean) {
    if (frame) frame.style.display = on ? "block" : "none";
}

function place() {
    raf = 0;
    if (!frame) return;
    // Big, the frame keeps its place whatever the panel does (styles.css, agentdisc-board-full).
    if (full || ANCHORS) {
        const next = full ? "full" : seen && slot ? "shown" : "hidden";
        if (next !== last) {
            last = next;
            if (!ANCHORS) Object.assign(frame.style, { left: "", top: "", width: "", height: "" });
            show(next !== "hidden");
        }
        return;
    }
    const rect = slot?.isConnected ? slot.getBoundingClientRect() : null;
    const visible = !!rect && rect.width > 40 && rect.height > 40;
    const next = visible ? `${rect!.left + HANDLE}|${rect!.top}|${rect!.width - HANDLE}|${rect!.height}` : "hidden";
    if (next !== last) {
        last = next;
        if (!visible) show(false);
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

function schedule() {
    if (!raf) raf = requestAnimationFrame(place);
}

// The panel's place is on screen: lay the frame over it and keep it there.
export function attachSlot(element: HTMLElement) {
    if (slot && slot !== element) slot.style.removeProperty("anchor-name");
    slot = element;
    boardFrame();
    if (ANCHORS) {
        element.style.setProperty("anchor-name", ANCHOR);
        seen = false;
        watcher ??= new ResizeObserver(entries => {
            const box = entries[entries.length - 1]?.contentRect;
            seen = !!box && box.width > 40 && box.height > 40;
            schedule();
        });
        watcher.disconnect();
        watcher.observe(element);
    }
    schedule();
}

export function detachSlot(element: HTMLElement) {
    if (slot !== element) return;
    element.style.removeProperty("anchor-name");
    watcher?.disconnect();
    seen = false;
    slot = null;
    schedule();
}

export function setBoardLook(next: string) {
    if (next === look) return;
    look = next;
    if (origin && frame?.contentWindow && loaded) frame.contentWindow.postMessage({ type: "mission-control:look", look }, origin);
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
    schedule();
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
        f.src = `${origin}/c/${channelId}?panel=1&grow=1&modes=1&look=${look}${wantView === "ideas" ? "&view=ideas" : ""}${threadId ? `&thread=${threadId}` : ""}`;
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
    if (data?.type === "mission-control:views" && Array.isArray(data.views)) {
        const views = data.views.filter((v: unknown): v is string => typeof v === "string" && /^[a-z]{1,20}$/.test(v)).slice(0, 10);
        offered = new Set(["board", ...views]);
        // The board speaks, so its page is there, even before the frame's own load event.
        loaded = true;
        offerListeners.forEach(fn => fn(views));
        sendView();
        return;
    }
    if (data?.type === "mission-control:view" && (data.view === "board" || data.view === "ideas")) {
        wantView = data.view;
        viewListeners.forEach(fn => fn(data.view));
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
    watcher?.disconnect();
    watcher = null;
    seen = false;
    slot?.style.removeProperty("anchor-name");
    frame?.remove();
    frame = null;
    loaded = false;
    offered = new Set(["board"]);
    wantFocus = false;
    shown = "";
    slot = null;
    last = "";
}
