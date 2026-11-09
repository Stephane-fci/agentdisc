/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { metaReady } from "@utils/web-metadata";
import { useEffect, useReducer } from "@webpack/common";

// AgentDisc time and focus (Stephane, 9 Nov 2026): one activity at a time, chosen and timed by
// hand ("actually I want manual tracking, this way it's really actively done"). This page part
// only shows the timer and passes his clicks on: the app's background part (time-worker.js) is
// the one owner for every Discord tab, keeps the time, and refuses a click made on an outdated
// view. Nothing here starts, stops or changes time by itself.

export type Activity = "clients" | "videos" | "made" | "workout" | "learning" | "hobbies" | "break";
export const ACTIVITIES: Activity[] = ["clients", "videos", "made", "workout", "learning", "hobbies", "break"];
export const WORK: Activity[] = ["clients", "videos", "made", "workout", "learning", "hobbies"];
export const LABELS: Record<Activity, string> = {
    clients: "Clients & leads",
    videos: "Videos & visibility",
    made: "Own business",
    workout: "Workout",
    learning: "Learning",
    hobbies: "Hobbies",
    break: "Break"
};
// What belongs where, in his words of 9 Nov (shown on hover).
export const MEANING: Record<Activity, string> = {
    clients: "Client work, new leads, offers and proposals",
    videos: "Videos, the content workflow and the consulting website",
    made: "Your own business, its research and tests",
    workout: "Workout, shower included",
    learning: "Robotics, local AI, 3D printing, agent tests, learning videos",
    hobbies: "Games and other pure hobbies",
    break: "A break: outside every allowance"
};
export const COLOURS: Record<Activity, string> = {
    clients: "#4f8cff",
    videos: "#e5484d",
    made: "#f5a524",
    workout: "#30a46c",
    learning: "#9b6cf0",
    hobbies: "#e45fa8",
    break: "#8b8d98"
};

export interface Piece { id: string; session: string; activity: Activity; start: number; end: number; }
export interface Block { id: string; day: number; start: string; end: string; activity: Activity; sally?: boolean; }
export interface TimeState {
    version: number;
    selected: Activity | null;
    running: { id: string; session: string; activity: Activity; start: number; } | null;
    paused: { session: string; activity: Activity; } | null;
    intervals: Piece[];
    allowances: Partial<Record<Activity, number>>;
    template: Block[];
    busy: string[] | null;
    check: { since: number; } | null;
    sync: { queue: { kind: string; id: string; op: string; tries: number; error?: string; }[]; error: string | null; at: number; };
    remind: { banner: { text: string; at: number; kind: string; activity: Activity | null; } | null; later: { at: number; } | null; };
}
export interface Answer { ok: boolean; error?: string; setup?: boolean; state?: TimeState; [k: string]: any; }

let state: TimeState | null = null;
let problem: string | null = null;
const listeners = new Set<() => void>();
let seq = 0;
const waiting = new Map<number, (a: Answer) => void>();
let started = false;
let alive: ReturnType<typeof setInterval> | null = null;

function changed() {
    listeners.forEach(fn => fn());
}

function take(next: TimeState | undefined) {
    if (!next || typeof next !== "object") return;
    // Saved states only move forward: an answer that arrives after a newer broadcast is older.
    if (state && (next.version ?? 0) < (state.version ?? 0)) return;
    state = next;
    problem = null;
    changed();
}

function onMessage(e: MessageEvent) {
    if (e.source !== window) return;
    const { data } = e;
    if (data?.type === "AGENTDISC_TIME_STATE") take(data.state);
    else if (data?.type === "AGENTDISC_TIME_ANSWER") {
        const done = waiting.get(data.seq);
        if (!done) return;
        waiting.delete(data.seq);
        done(data.answer ?? { ok: false, error: "No answer" });
    }
}

// One question to the background part; the answer carries the state as it is now.
export async function timeCommand(cmd: string, args: Record<string, any> = {}): Promise<Answer> {
    start();
    await metaReady;
    const id = ++seq;
    const answer = await new Promise<Answer>(resolve => {
        waiting.set(id, resolve);
        window.postMessage({ type: "AGENTDISC_TIME", seq: id, cmd, args }, location.origin);
        setTimeout(() => {
            if (waiting.delete(id)) resolve({ ok: false, error: "AgentDisc's background part did not answer. Reload AgentDisc, then refresh Discord." });
        }, cmd === "day" || cmd === "calendars" || cmd === "plan" ? 30000 : 8000);
    });
    if (answer.state) take(answer.state);
    if (!answer.ok && cmd === "get") {
        problem = answer.error ?? "The timer is not available.";
        changed();
    }
    return answer;
}

// A click: sent with what this tab shows (the running session, the chosen activity, the paused
// session), so an outdated tab can neither end the wrong session nor start the wrong activity.
export function timeClick(cmd: string, args: Record<string, any> = {}) {
    return timeCommand(cmd, { ...args, seen: state?.running?.id ?? null, view: { selected: state?.selected ?? null, paused: state?.paused?.session ?? null } });
}

function start() {
    if (started) return;
    started = true;
    window.addEventListener("message", onMessage);
    void metaReady.then(() => {
        void timeCommand("get");
        // A tab is alive: lets the background part notice a long gap (computer asleep, browser
        // closed) while time ran, and ask him about it once. It never changes time itself.
        alive = setInterval(() => void timeCommand("alive"), 4 * 60000);
        document.addEventListener("visibilitychange", onVisible);
    });
}

function onVisible() {
    if (!document.hidden) void timeCommand("get");
}

export function startTime() {
    start();
}

export function stopTime() {
    if (!started) return;
    started = false;
    window.removeEventListener("message", onMessage);
    document.removeEventListener("visibilitychange", onVisible);
    if (alive) clearInterval(alive);
    alive = null;
    waiting.clear();
}

export function timeState() {
    return state;
}

export function timeProblem() {
    return problem;
}

// The activity whose channels the list shows: the chosen one, never Break.
export function focusActivity(): Activity | null {
    const a = state?.selected ?? null;
    return a && a !== "break" ? a : null;
}

export function onTimeChange(fn: () => void) {
    start();
    listeners.add(fn);
    return () => void listeners.delete(fn);
}

export function useTimeState() {
    const [, redraw] = useReducer((n: number) => n + 1, 0);
    useEffect(() => onTimeChange(redraw), []);
    return state;
}

// A clock for the elapsed time on screen: one redraw a second while something shows it.
export function useClock(on: boolean) {
    const [, redraw] = useReducer((n: number) => n + 1, 0);
    useEffect(() => {
        if (!on) return;
        const t = setInterval(redraw, 1000);
        return () => clearInterval(t);
    }, [on]);
    return Date.now();
}

export const DAY = 86400000;

export function dayStart(t: number) {
    const d = new Date(t);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function weekStart(t: number) {
    const d = new Date(t);
    const back = (d.getDay() + 6) % 7;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime();
}

// Recorded time of one activity between two moments, the running piece up to now included.
export function recorded(s: TimeState | null, activity: Activity, from: number, to: number, now: number) {
    if (!s) return 0;
    let ms = 0;
    for (const i of s.intervals) if (i.activity === activity) ms += Math.max(0, Math.min(i.end, to) - Math.max(i.start, from));
    const r = s.running;
    if (r && r.activity === activity) ms += Math.max(0, Math.min(now, to) - Math.max(r.start, from));
    return ms;
}

export function hm(ms: number) {
    if (ms > 0 && ms < 60000) return "under 1 min";
    const m = Math.round(ms / 60000);
    const h = Math.floor(m / 60);
    return h ? `${h} h ${String(m % 60).padStart(2, "0")}` : `${m} min`;
}

export function clock(ms: number) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    return `${h}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function timeOfDay(t: number) {
    const d = new Date(t);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// "07:30" on the day of `base` -> a moment.
export function atTime(base: number, text: string) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
    if (!m) return NaN;
    const h = Number(m[1]), min = Number(m[2]);
    if (h > 24 || min > 59) return NaN;
    const d = new Date(base);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, min).getTime();
}

const ID_CHARS = "0123456789abcdefghijklmnopqrstuv";
export function newId(n = 12) {
    const bytes = new Uint8Array(n);
    crypto.getRandomValues(bytes);
    return [...bytes].map(b => ID_CHARS[b & 31]).join("");
}
