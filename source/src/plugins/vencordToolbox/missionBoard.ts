/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { EXTENSION_BASE_URL, metaReady } from "@utils/web-metadata";
import { ChannelStore, MessageActions, NavigationRouter, SelectedChannelStore } from "@webpack/common";

import { quoteCard } from "./feedback";

// The mission board in the right panel (Stephane, 14 Oct): one Kanban board per channel. It
// follows the channel he opens and marks the open thread's card; a click on a card's thread
// opens that thread.
//
// The board's address comes from a setup file beside the app on his computer
// (dist/mission-board.json); the browser's own background part adds the board's key to the
// board's requests (service-worker.js). Without the setup file the panel stays as it was.
//
// Each frame lives for the whole session, laid over its place in the panel, so switching
// channels never reloads it: the board is told which channel to show by a message.
//
// Two frames at most (24 Oct, his panel made of parts): one on the board's own page, one on
// its ideas page, where he drops an idea on the fly. Each is made the first time its part is
// switched on and is kept, hidden, while its part is off, so nothing he typed is lost. The
// address carries modes=1 (AgentDisc shows its own buttons, so the board hides its small
// Board/Ideas switch) and view=ideas for the ideas frame. A board from before the ideas page
// never says it offers it, so the Ideas part waits for that word.
//
// A frame can grow to almost the whole window (Stephane, 20 Oct: "a pop-up that takes up
// almost all of the screen, where I would see the board in full"): the board's own button
// asks, the frame moves over a dim layer and keeps following the channel he opens. A click on
// the dim layer, Esc, or opening a card's message puts it back over the panel.

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

export type BoardRole = "board" | "ideas";

// A board card's own link, the only kind a quote may carry: this board's address (from the
// setup file, never written here), then /c/<channel>?card=<card id>.
const CARD_PATH = /^\/c\/\d{15,21}\?card=c[0-9a-f]{6,12}$/;
const isCardLink = (link: string) => !!origin && link.startsWith(origin) && CARD_PATH.test(link.slice(origin.length));

// The look AgentDisc shows ("ivory" or "dark", from the theme switch), so the board can match
// it (asked of the board on 20 Oct); a board that does not know the message ignores it.
let look = "dark";
let offered = new Set<string>(["board"]);
const offerListeners = new Set<(views: string[]) => void>();

export function onBoardViews(fn: (views: string[]) => void) {
    offerListeners.add(fn);
    return () => void offerListeners.delete(fn);
}

// The panel's resize handle sits on its left edge; the frame leaves it free (styles.css).
//
// Chrome itself keeps a frame on its place (CSS anchor positioning, 21 Oct): the place is the
// anchor and the frame follows it through every resize with no script running. Before, a
// script measured the place on every screen refresh, all day long, which kept the computer
// busy for nothing (his lag report, 21 Oct). A watcher on the place's size only hides the
// frame when the place is gone or too small. A browser without anchors keeps the old way.
const ANCHORS = typeof CSS !== "undefined" && CSS.supports?.("anchor-name: --agentdisc-board") === true;
const HANDLE = 4;

let dim: HTMLElement | null = null;

class BoardFrame {
    frame: HTMLIFrameElement | null = null;
    loaded = false;
    shown = "";
    slot: HTMLElement | null = null;
    seen = false;
    watcher: ResizeObserver | null = null;
    raf = 0;
    last = "";
    full = false;
    focus = false;
    bottom = false;

    constructor(readonly role: BoardRole) { }

    get anchor() {
        return `--agentdisc-${this.role}`;
    }

    element() {
        if (this.frame) return this.frame;
        const f = this.frame = document.createElement("iframe");
        f.className = "agentdisc-board-frame" + (ANCHORS ? " agentdisc-board-anchored" : "");
        f.title = this.role === "ideas" ? "Ideas" : "Mission board";
        // The card's link button copies through the clipboard straight away (28 Oct).
        f.setAttribute("allow", "clipboard-write");
        if (ANCHORS) f.style.setProperty("position-anchor", this.anchor);
        f.classList.toggle("agentdisc-board-last", this.bottom);
        // Chrome fires a load for the empty frame the moment it is added; only the board's own
        // page counts.
        f.addEventListener("load", () => {
            if (!f.getAttribute("src")) return;
            this.loaded = true;
            this.tellCan();
            this.sendFocus();
        });
        document.body.append(f);
        return f;
    }

    post(message: object) {
        if (origin && this.frame?.contentWindow && this.loaded) this.frame.contentWindow.postMessage(message, origin);
    }

    // What this app answers, so the board shows only buttons that work: quote a card (28 Oct).
    tellCan() {
        this.post({ type: "mission-control:can", can: ["quote"] });
    }

    // The cursor in the idea box, once the board is there and offers its ideas page.
    sendFocus() {
        if (this.role !== "ideas" || !this.focus || !this.loaded || !offered.has("ideas")) return;
        this.post({ type: "mission-control:view", view: "ideas", focus: true });
        this.focus = false;
    }

    display(on: boolean) {
        if (this.frame) this.frame.style.display = on ? "block" : "none";
    }

    place() {
        this.raf = 0;
        const f = this.frame;
        if (!f) return;
        // Big, the frame keeps its place whatever the panel does (styles.css, agentdisc-board-full).
        if (this.full || ANCHORS) {
            const next = this.full ? "full" : this.seen && this.slot ? "shown" : "hidden";
            if (next !== this.last) {
                this.last = next;
                if (!ANCHORS) Object.assign(f.style, { left: "", top: "", width: "", height: "" });
                this.display(next !== "hidden");
            }
            return;
        }
        const rect = this.slot?.isConnected ? this.slot.getBoundingClientRect() : null;
        const visible = !!rect && rect.width > 40 && rect.height > 40;
        const next = visible ? `${rect!.left + HANDLE}|${rect!.top}|${rect!.width - HANDLE}|${rect!.height}` : "hidden";
        if (next !== this.last) {
            this.last = next;
            if (!visible) this.display(false);
            else Object.assign(f.style, {
                display: "block",
                left: `${rect!.left + HANDLE}px`,
                top: `${rect!.top}px`,
                width: `${rect!.width - HANDLE}px`,
                height: `${rect!.height}px`
            });
        }
        if (this.slot) this.raf = requestAnimationFrame(() => this.place());
    }

    schedule() {
        if (!this.raf) this.raf = requestAnimationFrame(() => this.place());
    }

    attach(element: HTMLElement) {
        if (this.slot && this.slot !== element) this.slot.style.removeProperty("anchor-name");
        this.slot = element;
        this.element();
        if (ANCHORS) {
            element.style.setProperty("anchor-name", this.anchor);
            this.seen = false;
            this.watcher ??= new ResizeObserver(entries => {
                const box = entries[entries.length - 1]?.contentRect;
                this.seen = !!box && box.width > 40 && box.height > 40;
                this.schedule();
            });
            this.watcher.disconnect();
            this.watcher.observe(element);
        }
        this.schedule();
    }

    detach(element: HTMLElement) {
        if (this.slot !== element) return;
        element.style.removeProperty("anchor-name");
        this.watcher?.disconnect();
        this.seen = false;
        this.slot = null;
        this.schedule();
    }

    // The board's own button shows the real size only once it hears it from here.
    tellSize() {
        if (origin && this.frame?.contentWindow) this.frame.contentWindow.postMessage({ type: "mission-control:size", full: this.full }, origin);
    }

    setFull(next: boolean) {
        if (!this.frame || this.full === next) {
            this.tellSize();
            return;
        }
        // One big frame at a time.
        if (next) for (const other of Object.values(frames)) if (other !== this && other.full) other.setFull(false);
        this.full = next;
        this.frame.classList.toggle("agentdisc-board-full", next);
        if (next) {
            if (!dim) {
                dim = document.createElement("div");
                dim.className = "agentdisc-board-dim";
                dim.addEventListener("click", () => bigFrame()?.setFull(false));
            }
            document.body.append(dim);
            document.addEventListener("keydown", onEscape, true);
        } else if (!bigFrame()) {
            dim?.remove();
            document.removeEventListener("keydown", onEscape, true);
        }
        this.last = "";
        this.schedule();
        this.tellSize();
    }

    // Show a channel's board, marking the open thread's card. The first time the frame loads
    // the page; after that a message switches it with no reload.
    show(channelId: string, threadId: string | null) {
        if (!origin) return;
        const f = this.element();
        const key = `${channelId}|${threadId ?? ""}`;
        if (key === this.shown) return;
        this.shown = key;
        if (!this.loaded || !f.contentWindow) {
            this.loaded = false;
            // grow=1: the board offers its full-screen button, which this app answers.
            f.src = `${origin}/c/${channelId}?panel=1&grow=1&modes=1&look=${look}${this.role === "ideas" ? "&view=ideas" : ""}${threadId ? `&thread=${threadId}` : ""}`;
            return;
        }
        f.contentWindow.postMessage({ type: "mission-control:show", channel: channelId, thread: threadId }, origin);
    }

    remove() {
        if (this.raf) cancelAnimationFrame(this.raf);
        this.raf = 0;
        this.watcher?.disconnect();
        this.watcher = null;
        this.slot?.style.removeProperty("anchor-name");
        this.frame?.remove();
        this.frame = null;
        this.loaded = false;
        this.full = false;
        this.focus = false;
        this.shown = "";
        this.slot = null;
        this.last = "";
        this.seen = false;
    }
}

const frames: Record<BoardRole, BoardFrame> = { board: new BoardFrame("board"), ideas: new BoardFrame("ideas") };

const bigFrame = () => Object.values(frames).find(f => f.full) ?? null;

function onEscape(e: KeyboardEvent) {
    const big = bigFrame();
    if (e.key !== "Escape" || !big) return;
    e.preventDefault();
    e.stopPropagation();
    big.setFull(false);
}

// A part's place is on screen: lay its frame over it and keep it there.
export function attachSlot(role: BoardRole, element: HTMLElement) {
    frames[role].attach(element);
}

export function detachSlot(role: BoardRole, element: HTMLElement) {
    frames[role].detach(element);
}

export function showBoard(role: BoardRole, channelId: string, threadId: string | null) {
    frames[role].show(channelId, threadId);
}

// The frame of the stack's last part takes the sheet's round corner (Ivory).
export function setFrameLast(role: BoardRole, bottom: boolean) {
    const f = frames[role];
    f.bottom = bottom;
    f.frame?.classList.toggle("agentdisc-board-last", bottom);
}

// Ctrl+J and a click that switches Ideas on: the cursor in the idea box.
export function focusIdeas() {
    frames.ideas.focus = true;
    frames.ideas.sendFocus();
}

export function setBoardLook(next: string) {
    if (next === look) return;
    look = next;
    for (const f of Object.values(frames)) f.post({ type: "mission-control:look", look });
}

// A click on a card's thread or icon in the board opens that thread or message here.
function onMessage(e: MessageEvent) {
    if (!origin || e.origin !== origin) return;
    const from = Object.values(frames).find(f => f.frame && e.source === f.frame.contentWindow);
    if (!from) return;
    const { data } = e;
    if (data?.type === "mission-control:size") {
        from.setFull(data.full === true);
        return;
    }
    if (data?.type === "mission-control:views" && Array.isArray(data.views)) {
        const views = data.views.filter((v: unknown): v is string => typeof v === "string" && /^[a-z]{1,20}$/.test(v)).slice(0, 10);
        offered = new Set(["board", ...views]);
        // The board speaks, so its page is there, even before the frame's own load event.
        from.loaded = true;
        offerListeners.forEach(fn => fn(views));
        from.tellCan();
        from.sendFocus();
        return;
    }
    // A card quoted from its window: into the open channel's message box, from the big board
    // back to the panel first (28 Oct).
    if (data?.type === "mission-control:quote") {
        const link = typeof data.link === "string" ? data.link : "";
        const title = typeof data.title === "string" ? data.title.replace(/\s+/g, " ").trim() : "";
        if (!isCardLink(link) || !title || title.length > 300) return;
        from.setFull(false);
        quoteCard(title, link);
        return;
    }
    if (data?.type !== "mission-control:open" || typeof data.channel !== "string" || !/^\d+$/.test(data.channel)) return;
    // From the big board, back to the panel first, so he lands on the message.
    from.setFull(false);
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
    for (const f of Object.values(frames)) {
        f.setFull(false);
        f.remove();
    }
    dim?.remove();
    document.removeEventListener("keydown", onEscape, true);
    offered = new Set(["board"]);
}
