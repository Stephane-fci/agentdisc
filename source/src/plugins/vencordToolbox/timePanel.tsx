/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { openActivityChannels } from "@plugins/channelGroups/activityBox";
import { React, useEffect, useReducer, useState } from "@webpack/common";

import {
ACTIVITIES, type Activity, atTime, COLOURS, DAY, dayStart, LABELS, MEANING, type Piece, timeClick, timeCommand,
    timeOfDay, timeProblem, type TimeState, useClock, useTimeState
} from "./timeFocus";

// The Today part of the right panel. His words after the first version (9 Nov 2026): "What I want
// is simple: a few buttons, maybe seven, that I click. One click starts recording, one click stops
// it, and if I click another one, it changes. That's it: as smooth and minimalist as possible."
// "I want only one: Day. I want to see, maybe in a semi-transparent view, what we planned, and in
// the real view, what we did ... and I want to see the potential appointment I have." "Make sure
// the design is super simple and the panel stays the same at all times."
//
// So: seven buttons, one day line, and one small Channels button that opens a pop-up. Recording
// is still by hand only: nothing here starts, stops or moves time except his click on a button,
// or a correction he makes on a block of the day.

const stopKeys = (e: React.KeyboardEvent) => e.stopPropagation();

function useError(): [string, (e?: string) => void] {
    const [error, setError] = useState("");
    useEffect(() => {
        if (!error) return;
        const t = setTimeout(() => setError(""), 6000);
        return () => clearTimeout(t);
    }, [error]);
    return [error, (e?: string) => setError(e ?? "")];
}

const PLAIN: Record<string, string> = {
    stale: "Another Discord tab changed the timer just before. Click again.",
    "already running": "Something is already recording.",
    "nothing running": "Nothing is recording."
};

function plain(error?: string) {
    return PLAIN[error ?? ""] ?? error ?? "That did not work.";
}

// One click: on the button that records, it stops; on another, it switches (the running piece
// ends by this click and the new one starts); on any button while nothing records, it starts.
async function press(s: TimeState, a: Activity, fail: (e: string) => void) {
    const r = s.running;
    if (r && r.activity === a) {
        const done = await timeClick("stop");
        if (!done.ok) fail(plain(done.error));
        return;
    }
    if (s.selected !== a || r) {
        const chosen = await timeClick("select", { activity: a });
        if (!chosen.ok) return fail(plain(chosen.error));
    }
    const started = await timeClick("start", { activity: a });
    if (!started.ok) fail(plain(started.error));
}

function shortClock(ms: number) {
    const m = Math.max(0, Math.floor(ms / 60000));
    return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
}

function Buttons({ s, now, compact }: { s: TimeState; now: number; compact?: boolean; }) {
    const [error, fail] = useError();
    const { running } = s;
    return (
        <>
            <div className={"agentdisc-today-buttons" + (compact ? " agentdisc-today-buttons-compact" : "")} role="group" aria-label="Activities">
                {ACTIVITIES.map(a => {
                    const on = running?.activity === a;
                    return (
                        <button
                            key={a}
                            type="button"
                            className={"agentdisc-today-button" + (on ? " agentdisc-today-button-on" : "") + (a === "break" ? " agentdisc-today-button-break" : "")}
                            style={{ "--agentdisc-act": COLOURS[a] } as React.CSSProperties}
                            aria-pressed={on}
                            title={on ? `${LABELS[a]}: recording since ${timeOfDay(running!.start)}. Click to stop.` : `${MEANING[a]}. Click to ${running ? "switch to it" : "start recording"}.`}
                            onClick={() => press(s, a, fail)}
                        >
                            <span className="agentdisc-today-dot" aria-hidden="true" />
                            <span className="agentdisc-today-button-name">{LABELS[a]}</span>
                            {on && <span className="agentdisc-today-button-time">{shortClock(now - running!.start)}</span>}
                        </button>
                    );
                })}
            </div>
            {error && <div className="agentdisc-today-error" role="alert">{error}</div>}
        </>
    );
}

// The slim strip under the panel's buttons while another part fills the panel: only while
// something records, its name and time, a click stops it.
export function RunningStrip() {
    const s = useTimeState();
    const now = useClock(!!s?.running);
    const [error, fail] = useError();
    const r = s?.running;
    if (!r) return null;
    return (
        <button
            type="button"
            className="agentdisc-today-strip"
            style={{ "--agentdisc-act": COLOURS[r.activity] } as React.CSSProperties}
            title={`Recording ${LABELS[r.activity]} since ${timeOfDay(r.start)}. Click to stop.${error ? " " + error : ""}`}
            onClick={async () => { const a = await timeClick("stop"); if (!a.ok) fail(plain(a.error)); }}
        >
            <span className="agentdisc-today-dot" aria-hidden="true" />
            <span className="agentdisc-today-button-name">{LABELS[r.activity]}</span>
            <span className="agentdisc-today-button-time">{shortClock(now - r.start)}</span>
        </button>
    );
}

// ---- The day: appointments in full colour, the plan see-through, what he did solid ----

interface CalEvent { start: string; end: string; allDay?: boolean; title?: string; free?: boolean; }
interface PlanBlock { id: string; start: string; end: string; activity: Activity; sally?: boolean; }
interface DayAnswer { events: CalEvent[]; plan: PlanBlock[]; }

const ms = (iso: string) => Date.parse(iso);

// Today's appointments and plan, read again every five minutes; the last read stays on screen
// while a new one runs, so the day never blanks.
function useDay(from: number, to: number) {
    const [data, setData] = useState<{ day: DayAnswer | null; error: string; setup: boolean; }>({ day: null, error: "", setup: false });
    const [tick, bump] = useReducer((n: number) => n + 1, 0);
    useEffect(() => {
        let gone = false;
        timeCommand("day", { from, to }).then(a => {
            if (gone) return;
            setData(d => a.ok ? { day: a.day, error: "", setup: false } : { day: d.day, error: a.error ?? "", setup: !!a.setup });
        });
        const t = setInterval(bump, 5 * 60000);
        return () => {
            gone = true;
            clearInterval(t);
        };
    }, [from, to, tick]);
    return data;
}

const PX = 26; // one hour

type Editing = { kind: "piece"; piece: Piece; } | { kind: "running"; } | null;

function DayLine({ s, now }: { s: TimeState; now: number; }) {
    const from = dayStart(now);
    const to = dayStart(from + DAY + 3 * 3600000);
    const cal = useDay(from, to);
    const [editing, setEditing] = useState<Editing>(null);
    const pieces = s.intervals.filter(i => i.end > from && i.start < to).sort((a, b) => a.start - b.start);
    const { running } = s;
    const events = (cal.day?.events ?? []).filter(e => !e.allDay);
    const allDay = (cal.day?.events ?? []).filter(e => e.allDay);
    const plan = cal.day?.plan ?? [];

    const hourOf = (t: number) => (t - from) / 3600000;
    const starts = [7, ...events.map(e => hourOf(ms(e.start))), ...plan.map(b => hourOf(ms(b.start))), ...pieces.map(p => hourOf(p.start)), ...(running ? [hourOf(running.start)] : []), hourOf(now) - 1];
    const ends = [20, ...events.map(e => hourOf(ms(e.end))), ...plan.map(b => hourOf(ms(b.end))), ...pieces.map(p => hourOf(p.end)), hourOf(now) + 1];
    const first = Math.max(0, Math.floor(Math.min(...starts.filter(Number.isFinite))));
    const last = Math.min(24, Math.ceil(Math.max(...ends.filter(Number.isFinite))));
    const top = (t: number) => (Math.min(Math.max(hourOf(t), first), last) - first) * PX;
    const height = (a: number, b: number) => Math.max(4, top(b) - top(a));
    const hours: number[] = [];
    for (let h = first; h <= last; h++) hours.push(h);

    return (
        <div className="agentdisc-today-day">
            {allDay.length > 0 && <div className="agentdisc-today-allday">{allDay.map((e, i) => <span key={i}>{e.title || "Busy"}</span>)}</div>}
            <div className="agentdisc-today-line" style={{ height: (last - first) * PX }}>
                {hours.map(h => <div key={h} className="agentdisc-today-hour" style={{ top: (h - first) * PX }}><span>{String(h).padStart(2, "0")}</span></div>)}
                {plan.map(b => (
                    <div
                        key={b.id}
                        className="agentdisc-today-item agentdisc-today-plan"
                        style={{ top: top(ms(b.start)), height: height(ms(b.start), ms(b.end)), "--agentdisc-act": COLOURS[b.activity] ?? "#888" } as React.CSSProperties}
                        title={`Planned ${timeOfDay(ms(b.start))}–${timeOfDay(ms(b.end))}: ${LABELS[b.activity] ?? ""}`}
                    >
                        <span>{LABELS[b.activity] ?? ""}</span>
                    </div>
                ))}
                {pieces.map(p => (
                    <button
                        key={p.id}
                        type="button"
                        className="agentdisc-today-item agentdisc-today-done"
                        style={{ top: top(p.start), height: height(p.start, p.end), "--agentdisc-act": COLOURS[p.activity] } as React.CSSProperties}
                        title={`${timeOfDay(p.start)}–${timeOfDay(p.end)} ${LABELS[p.activity]}. Click to correct.`}
                        onClick={() => setEditing({ kind: "piece", piece: p })}
                    >
                        <span>{LABELS[p.activity]}</span>
                    </button>
                ))}
                {running && running.start < to && (
                    <button
                        type="button"
                        className="agentdisc-today-item agentdisc-today-done agentdisc-today-running"
                        style={{ top: top(running.start), height: height(running.start, now), "--agentdisc-act": COLOURS[running.activity] } as React.CSSProperties}
                        title={`Recording ${LABELS[running.activity]} since ${timeOfDay(running.start)}. Click to correct the start.`}
                        onClick={() => setEditing({ kind: "running" })}
                    >
                        <span>{LABELS[running.activity]}</span>
                    </button>
                )}
                {events.map((e, i) => (
                    <div
                        key={i}
                        className={"agentdisc-today-item agentdisc-today-appt" + (e.free ? " agentdisc-today-appt-free" : "")}
                        style={{ top: top(ms(e.start)), height: height(ms(e.start), ms(e.end)) }}
                        title={`${timeOfDay(ms(e.start))}–${timeOfDay(ms(e.end))} ${e.title ?? ""}`}
                    >
                        <span>{e.title || "Busy"}</span>
                    </div>
                ))}
                <div className="agentdisc-today-now" style={{ top: top(now) }} />
                {editing && <Corrector s={s} now={now} editing={editing} close={() => setEditing(null)} />}
            </div>
            {cal.error && !cal.setup && <div className="agentdisc-today-note">Calendar: {cal.error}</div>}
        </div>
    );
}

// A correction, only after a click on a block of the day: a forgotten start or stop, or a piece
// to change or remove. Nothing of it shows otherwise.
function Corrector({ s, now, editing, close }: { s: TimeState; now: number; editing: NonNullable<Editing>; close(): void; }) {
    const piece = editing.kind === "piece" ? editing.piece : null;
    const r = s.running;
    const [start, setStart] = useState(timeOfDay(piece ? piece.start : r?.start ?? now));
    const [end, setEnd] = useState(piece ? timeOfDay(piece.end) : "");
    const [error, fail] = useError();
    if (editing.kind === "running" && !r) return null;
    // A typed hh:mm is the latest such moment that fits, today or the day before.
    const resolve = (text: string, after: number, upTo: number) => {
        for (let d = 0; d <= 2; d++) {
            const t = atTime(now - d * DAY, text);
            if (Number.isFinite(t) && t > after && t <= upTo) return t;
        }
        return NaN;
    };
    const save = async () => {
        if (piece) {
            const a = atTime(piece.start, start);
            let b = atTime(a, end);
            if (Number.isFinite(b) && b <= a) b += DAY;
            if (!Number.isFinite(a) || !Number.isFinite(b)) return fail("Write the times as hh:mm.");
            const res = await timeCommand("edit", { id: piece.id, activity: piece.activity, start: a, end: b });
            if (!res.ok) return fail(plain(res.error));
            return close();
        }
        if (start !== timeOfDay(r!.start)) {
            const t = resolve(start, now - 2 * DAY, now - 1000);
            if (!Number.isFinite(t)) return fail("Pick a start in the last two days, as hh:mm.");
            const res = await timeClick("startedAt", { at: t });
            if (!res.ok) return fail(plain(res.error));
        }
        if (end.trim()) {
            const t = resolve(end, r!.start, now);
            if (!Number.isFinite(t)) return fail("That end is not inside this session.");
            const res = await timeClick("stop", { at: t });
            if (!res.ok) return fail(plain(res.error));
        }
        close();
    };
    const remove = async () => {
        const res = await timeCommand("remove", { id: piece!.id });
        if (!res.ok) return fail(plain(res.error));
        close();
    };
    const input = (value: string, set: (v: string) => void, label: string, placeholder = "hh:mm") => (
        <input className="agentdisc-today-time" aria-label={label} value={value} placeholder={placeholder} maxLength={5} onKeyDown={e => { stopKeys(e); if (e.key === "Enter") void save(); if (e.key === "Escape") close(); }} onChange={e => set(e.currentTarget.value)} />
    );
    return (
        <div className="agentdisc-today-corrector" role="dialog" aria-label="Correct this time">
            <div className="agentdisc-today-corrector-row">
                <span>{piece ? "From" : "Started"}</span>{input(start, setStart, "Start")}
                <span>{piece ? "to" : "ended"}</span>{input(end, setEnd, "End", piece ? "hh:mm" : "still on")}
            </div>
            <div className="agentdisc-today-corrector-row">
                <button type="button" className="agentdisc-today-link" onClick={save}>Save</button>
                {piece && <button type="button" className="agentdisc-today-link" onClick={remove}>Remove</button>}
                <button type="button" className="agentdisc-today-link" onClick={close}>Cancel</button>
            </div>
            {error && <div className="agentdisc-today-error">{error}</div>}
        </div>
    );
}

// ---- The part ----

export function TodayContent({ guildId }: { guildId: string; }) {
    const s = useTimeState();
    const now = useClock(true);
    const pending = s?.sync?.queue?.length ?? 0;
    if (!s) return <div className="agentdisc-side agentdisc-today"><div className="agentdisc-today-note">{timeProblem() ?? "Reading the timer…"}</div></div>;
    return (
        <div className="agentdisc-side agentdisc-today">
            <Buttons s={s} now={now} />
            <DayLine s={s} now={now} />
            <div className="agentdisc-today-foot">
                <span className="agentdisc-today-note">
                    {pending ? `${pending} piece${pending > 1 ? "s" : ""} waiting for Google Calendar${s.sync.error ? ": " + s.sync.error : ""}` : ""}
                </span>
                <button type="button" className="agentdisc-today-channels" title="Which channels each activity shows" onClick={() => openActivityChannels(guildId)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                    Channels
                </button>
            </div>
        </div>
    );
}
