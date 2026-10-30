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
// Two frames per board at most (24 Oct, his panel made of parts): one on the board's own page,
// one on its ideas page, where he drops an idea on the fly. Each is made the first time its part is
// switched on and is kept, hidden, while its part is off, so nothing he typed is lost. The
// address carries modes=1 (AgentDisc shows its own buttons, so the board hides its small
// Board/Ideas switch) and view=ideas for the ideas frame. A board from before the ideas page
// never says it offers it, so the Ideas part waits for that word.
//
// A frame can grow to almost the whole window (Stephane, 20 Oct: "a pop-up that takes up
// almost all of the screen, where I would see the board in full"): the board's own button
// asks, the frame moves over a dim layer and keeps following the channel he opens. A click on
// the dim layer, Esc, or opening a card's message puts it back over the panel.
//
// Each server its own board (Stephane, 30 Oct: "All boards, by themselves, should be built on
// their own Cloudflare account and they will only be seen by people using the Discord app"):
// the setup file may also name a board per server, { "board": "<default>", "boards":
// { "<guild id>": "<address>" } }. A server shows its own entry, else the default, else no
// board at all, so a person with the app and no entry gets nothing. An entry with an unusable
// address counts as no board, never as the default. The addresses stay in that file on the
// person's computer. A frame stays bound to one board's address for its whole life: nothing of
// one server goes to another server's board, and going back to a server reloads nothing.

export interface BoardSetup {
    main: string | null;
    boards: Map<string, string | null>;
}

const httpsOrigin = (address: unknown) => {
    try {
        const url = new URL(String(address ?? ""));
        return url.protocol === "https:" ? url.origin : null;
    } catch {
        return null;
    }
};

export function readSetup(file: any): BoardSetup {
    const boards = new Map<string, string | null>();
    if (file?.boards && typeof file.boards === "object" && !Array.isArray(file.boards)) {
        for (const [guild, address] of Object.entries(file.boards)) if (/^\d{15,21}$/.test(guild)) boards.set(guild, httpsOrigin(address));
    }
    return { main: httpsOrigin(file?.board), boards };
}

// The board of a server, or null. A private chat (no server) counts as the default.
export function chooseBoard(from: BoardSetup | null, guild: string | null | undefined) {
    if (!from) return null;
    return guild && from.boards.has(guild) ? from.boards.get(guild)! : from.main;
}

// Ideas is his own page and stays on the default board; with no default it follows the server.
export function chooseOrigin(from: BoardSetup | null, role: BoardRole, guild: string | null | undefined) {
    return role === "ideas" && from?.main ? from.main : chooseBoard(from, guild);
}

let setup: BoardSetup | null = null;
const listeners = new Set<() => void>();

export const hasBoard = (guild: string | null | undefined) => chooseBoard(setup, guild) != null;

const currentGuild = () => ChannelStore.getChannel(SelectedChannelStore.getChannelId())?.guild_id ?? null;

export const hasBoardHere = () => hasBoard(currentGuild());

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
        const next = readSetup(await res.json());
        if (!next.main && !next.boards.size) return;
        setup = next;
        listeners.forEach(fn => fn());
    } catch { }
}

export type BoardRole = "board" | "ideas";

// A board card's own link, the only kind a quote may carry: this board's address (from the
// setup file, never written here), then /c/<channel>?card=<card id>.
const CARD_PATH = /^\/c\/\d{15,21}\?card=c[0-9a-f]{6,12}$/;
const isCardLink = (link: string, origin: string) => link.startsWith(origin) && CARD_PATH.test(link.slice(origin.length));

// The look AgentDisc shows ("ivory" or "dark", from the theme switch), so the board can match
// it (asked of the board on 20 Oct); a board that does not know the message ignores it.
let look = "dark";
// What each board said it offers, by its address.
const offered = new Map<string, Set<string>>();
let ideasFocus = false;
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
    bottom = false;

    constructor(readonly role: BoardRole, readonly origin: string) { }

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
        if (this.frame?.contentWindow && this.loaded) this.frame.contentWindow.postMessage(message, this.origin);
    }

    // What this app answers, so the board shows only buttons that work: quote a card (28 Oct).
    tellCan() {
        this.post({ type: "mission-control:can", can: ["quote"] });
    }

    // The cursor in the idea box, once the board is there and offers its ideas page.
    sendFocus() {
        if (this.role !== "ideas" || !ideasFocus || active.ideas !== this || !this.loaded || !offered.get(this.origin)?.has("ideas")) return;
        this.post({ type: "mission-control:view", view: "ideas", focus: true });
        ideasFocus = false;
    }

    display(on: boolean) {
        if (this.frame) this.frame.style.display = on ? "block" : "none";
    }

    setLast(bottom: boolean) {
        this.bottom = bottom;
        this.frame?.classList.toggle("agentdisc-board-last", bottom);
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
        if (this.frame?.contentWindow) this.frame.contentWindow.postMessage({ type: "mission-control:size", full: this.full }, this.origin);
    }

    setFull(next: boolean) {
        if (!this.frame || this.full === next) {
            this.tellSize();
            return;
        }
        // One big frame at a time.
        if (next) for (const other of frames.values()) if (other !== this && other.full) other.setFull(false);
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
    // the page; after that a message switches it with no reload. No channel: only the Ideas
    // frame on the default board in a server with its own board (30 Oct), which opens on its
    // ideas page knowing no channel and keeps the last channel it was told.
    show(channelId: string | null, threadId: string | null) {
        const f = this.element();
        if (!channelId && this.shown) return;
        const key = `${channelId}|${threadId ?? ""}`;
        if (key === this.shown) return;
        this.shown = key;
        if (!this.loaded || !f.contentWindow) {
            this.loaded = false;
            // grow=1: the board offers its full-screen button, which this app answers.
            f.src = `${this.origin}/${channelId ? `c/${channelId}` : ""}?panel=1&grow=1&modes=1&look=${look}${this.role === "ideas" ? "&view=ideas" : ""}${threadId ? `&thread=${threadId}` : ""}`;
            return;
        }
        if (channelId) f.contentWindow.postMessage({ type: "mission-control:show", channel: channelId, thread: threadId }, this.origin);
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
        this.shown = "";
        this.slot = null;
        this.last = "";
        this.seen = false;
    }
}

// One frame per part and board, made when first needed and kept, hidden, afterwards. Only the
// part's current one sits on the part's place.
const frames = new Map<string, BoardFrame>();
const active: Record<BoardRole, BoardFrame | null> = { board: null, ideas: null };
const places: Record<BoardRole, HTMLElement | null> = { board: null, ideas: null };
const lastPart: Record<BoardRole, boolean> = { board: false, ideas: false };

const bigFrame = () => [...frames.values()].find(f => f.full) ?? null;

function leaveFrame(role: BoardRole) {
    const f = active[role];
    if (!f) return;
    if (f.full) f.setFull(false);
    if (places[role]) f.detach(places[role]!);
    active[role] = null;
}

// The part's frame for this server's board, on the part's place.
function frameFor(role: BoardRole, guild: string) {
    const origin = chooseOrigin(setup, role, guild);
    if (active[role]?.origin !== origin) leaveFrame(role);
    if (!origin) return null;
    if (!active[role]) {
        const key = `${role}|${origin}`;
        const f = frames.get(key) ?? new BoardFrame(role, origin);
        frames.set(key, f);
        active[role] = f;
        f.setLast(lastPart[role]);
        if (places[role]) f.attach(places[role]!);
    }
    return active[role];
}

// Another server opened, whatever the panel does: a board that is not this server's goes away,
// big or not.
export function followServer(guild: string | null | undefined) {
    if (!setup?.boards.size) return;
    for (const role of ["board", "ideas"] as const) {
        // A private chat has no server: only his own board may stay big there, as it always could.
        const wanted = guild ? chooseOrigin(setup, role, guild) : setup.main;
        if (active[role] && active[role]!.origin !== wanted) leaveFrame(role);
    }
}

function onEscape(e: KeyboardEvent) {
    const big = bigFrame();
    if (e.key !== "Escape" || !big) return;
    e.preventDefault();
    e.stopPropagation();
    big.setFull(false);
}

// A part's place is on screen: lay its frame over it and keep it there.
export function attachSlot(role: BoardRole, element: HTMLElement) {
    places[role] = element;
    active[role]?.attach(element);
}

export function detachSlot(role: BoardRole, element: HTMLElement) {
    if (places[role] === element) places[role] = null;
    active[role]?.detach(element);
}

export function showBoard(role: BoardRole, guild: string, channelId: string, threadId: string | null) {
    const f = frameFor(role, guild);
    if (!f) return;
    // A server with its own board: its channels are never told to the default board's Ideas.
    if (f.origin === chooseBoard(setup, guild)) f.show(channelId, threadId);
    else f.show(null, null);
}

// The frame of the stack's last part takes the sheet's round corner (Ivory).
export function setFrameLast(role: BoardRole, bottom: boolean) {
    lastPart[role] = bottom;
    active[role]?.setLast(bottom);
}

// Ctrl+J and a click that switches Ideas on: the cursor in the idea box.
export function focusIdeas() {
    ideasFocus = true;
    active.ideas?.sendFocus();
}

export function setBoardLook(next: string) {
    if (next === look) return;
    look = next;
    for (const f of frames.values()) f.post({ type: "mission-control:look", look });
}

// Where a card's click opens. The default board goes anywhere, as before. A server's own board
// stays inside its server (30 Oct): a channel the page places elsewhere is refused, and one it
// does not know opens in this server.
function openGuild(origin: string, data: any) {
    const said = typeof data.guild === "string" && /^\d+$/.test(data.guild) ? data.guild : null;
    const known = ChannelStore.getChannel(data.channel)?.guild_id ?? null;
    if (!setup || origin === setup.main) return said ?? known ?? "@me";
    const own = [...setup.boards].filter(([, board]) => board === origin).map(([guild]) => guild);
    if ((said && !own.includes(said)) || (known && !own.includes(known))) return null;
    const here = currentGuild();
    return said ?? known ?? (here && own.includes(here) ? here : null);
}

// A click on a card's thread or icon in the board opens that thread or message here.
function onMessage(e: MessageEvent) {
    const from = [...frames.values()].find(f => f.frame && e.source === f.frame.contentWindow);
    if (!from || e.origin !== from.origin) return;
    const { data } = e;
    if (data?.type === "mission-control:size") {
        if (active[from.role] !== from) return;
        from.setFull(data.full === true);
        return;
    }
    if (data?.type === "mission-control:views" && Array.isArray(data.views)) {
        const views = data.views.filter((v: unknown): v is string => typeof v === "string" && /^[a-z]{1,20}$/.test(v)).slice(0, 10);
        offered.set(from.origin, new Set(["board", ...views]));
        // The board speaks, so its page is there, even before the frame's own load event.
        from.loaded = true;
        // The kept word is about the board Ideas uses here, not a client's board in its server.
        if (from.origin === chooseOrigin(setup, "ideas", currentGuild())) offerListeners.forEach(fn => fn(views));
        from.tellCan();
        from.sendFocus();
        return;
    }
    // A card quoted from its window: into the open channel's message box, from the big board
    // back to the panel first (28 Oct).
    if (data?.type === "mission-control:quote") {
        const link = typeof data.link === "string" ? data.link : "";
        const title = typeof data.title === "string" ? data.title.replace(/\s+/g, " ").trim() : "";
        if (!isCardLink(link, from.origin) || !title || title.length > 300) return;
        from.setFull(false);
        quoteCard(title, link);
        return;
    }
    if (data?.type !== "mission-control:open" || typeof data.channel !== "string" || !/^\d+$/.test(data.channel)) return;
    const guild = openGuild(from.origin, data);
    if (!guild) return;
    // From the big board, back to the panel first, so he lands on the message.
    from.setFull(false);
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
    for (const f of frames.values()) {
        f.setFull(false);
        f.remove();
    }
    frames.clear();
    active.board = active.ideas = null;
    places.board = places.ideas = null;
    dim?.remove();
    document.removeEventListener("keydown", onEscape, true);
    offered.clear();
    ideasFocus = false;
}
