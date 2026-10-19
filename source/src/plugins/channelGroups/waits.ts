/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { metaReady } from "@utils/web-metadata";

// Waiting bookmarks (Stephane, 18 Oct): a bookmarked line turns blue while an agent has
// planned its next check there, like the next run of something. The agents' planned checks
// are kept on the server; the mission board reads them, and the app's own background part
// asks the board for them with the board's key (service-worker.js), so the Discord page
// never holds the key. Without a mission board set up, nothing ever shows as waiting.
//
// The page asks through the app's small in-between script (content.js) with a window
// message, every two minutes while Discord is on screen, and at once when a bookmark
// changes or Discord comes back on screen.

const ASK = "AGENTDISC_WAITS";
const ANSWER = "AGENTDISC_WAITS_ANSWER";
// Each answer reads one board per bookmark on a small server; an agent at work shows green
// from its typing anyway, so two minutes is soon enough.
const EVERY_MS = 120_000;

// conversation id -> when its planned checks are due, soonest first
let waits = new Map<string, string[]>();
let ids: () => string[] = () => [];
let onChange: () => void = () => { };
let asked = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let soon: ReturnType<typeof setTimeout> | null = null;
let running = false;

export function plannedChecks(id: string) {
    return waits.get(id);
}

function ask() {
    const list = ids().filter(id => /^\d{15,21}$/.test(id));
    if (!list.length) {
        if (waits.size) {
            waits = new Map();
            onChange();
        }
        return;
    }
    asked++;
    window.postMessage({ type: ASK, seq: asked, ids: list }, location.origin);
}

function onMessage(e: MessageEvent) {
    if (e.source !== window || e.data?.type !== ANSWER || e.data.seq !== asked) return;
    const next = new Map<string, string[]>();
    for (const [id, times] of Object.entries(e.data.waits ?? {})) {
        if (!/^\d{15,21}$/.test(id) || !Array.isArray(times)) continue;
        const good = times.filter(t => typeof t === "string" && !isNaN(Date.parse(t))).sort((a, b) => Date.parse(a) - Date.parse(b));
        if (good.length) next.set(id, good);
    }
    waits = next;
    // Also when nothing changed: a due time can have become "any moment".
    onChange();
}

function onVisible() {
    if (!document.hidden) ask();
}

// Ask again shortly: several bookmark changes in a row make one question.
export function askSoon() {
    if (!running) return;
    if (soon) clearTimeout(soon);
    soon = setTimeout(() => {
        soon = null;
        ask();
    }, 300);
}

export async function startWaits(bookmarked: () => string[], changed: () => void) {
    ids = bookmarked;
    onChange = changed;
    running = true;
    window.addEventListener("message", onMessage);
    document.addEventListener("visibilitychange", onVisible);
    // The in-between script listens once the page has loaded.
    await metaReady;
    if (!running) return;
    ask();
    timer = setInterval(() => { if (!document.hidden) ask(); }, EVERY_MS);
}

export function stopWaits() {
    running = false;
    window.removeEventListener("message", onMessage);
    document.removeEventListener("visibilitychange", onVisible);
    if (timer) clearInterval(timer);
    if (soon) clearTimeout(soon);
    timer = null;
    soon = null;
    waits = new Map();
}
