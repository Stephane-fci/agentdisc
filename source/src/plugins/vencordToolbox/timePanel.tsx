/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "@api/Settings";
import { openActivityChannels } from "@plugins/channelGroups/activityBox";
import { React, useEffect, useReducer, useRef, useState } from "@webpack/common";

import { type DayBlock, type DayHandle, mountDay } from "./dayCalendar";
import {
    ACTIVITIES, type Activity, atTime, COLOURS, DAY, dayStart, LABELS, MEANING, timeClick, timeCommand,
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
    return PLAIN[error ?? ""] ?? (error || "That did not work.");
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

// ---- The day: FullCalendar's standard day view, every block across its whole width ----
// His words on 1.47.0 (9 Nov 2026): "Make the scale bigger and zoomable ... I want the blocks to be
// full width ... see it, zoom in on it, and manually adjust it: change the time, make it longer by
// dragging or expanding the block". On 1.48.0: "When I click on an object, it zooms in a really weird
// way ... I can't click on one that is too small. Maybe you can look into a library for [calendar]".
// So the day is the calendar library's day view (dayCalendar.ts): a click selects, − and + or Ctrl
// and the wheel zoom, blocks move and stretch by dragging. What was planned lies faint behind, what
// he did is solid on top, his appointments are an outline over both, never moved.

interface CalEvent { start: string; end: string; allDay?: boolean; title?: string; free?: boolean; }
interface PlanBlock { id: string; start: string; end: string; activity: Activity; sally?: boolean; }
interface DayAnswer { events: CalEvent[]; plan: PlanBlock[]; }

const ms = (iso: string) => Date.parse(iso);
const MIN = 60000, HOUR = 3600000;
const SCALE = { normal: 72, least: 24, most: 480 }; // pixels per hour

// Today's appointments and plan, read again every five minutes and after a change of the plan; the
// last read stays on screen while a new one runs, so the day never blanks. Each read has a number,
// and an answer older than the one on screen is dropped.
function useDay(from: number, to: number) {
    const [data, setData] = useState<{ day: DayAnswer | null; error: string; setup: boolean; version: number; }>({ day: null, error: "", setup: false, version: 0 });
    const [tick, bump] = useReducer((n: number) => n + 1, 0);
    const asked = useRef(0);
    useEffect(() => {
        let gone = false;
        const id = ++asked.current;
        timeCommand("day", { from, to }).then(a => {
            if (gone) return;
            setData(d => id < d.version ? d : a?.ok ? { day: a.day, error: "", setup: false, version: id } : { ...d, error: a?.error ?? "", setup: !!a?.setup });
        });
        const t = setInterval(bump, 5 * 60000);
        return () => {
            gone = true;
            clearInterval(t);
        };
    }, [from, to, tick]);
    return { ...data, asked, reload: bump };
}

function readScale() {
    const n = Number(Settings.plugins.VencordToolbox?.timelineScale);
    return Number.isFinite(n) && n >= SCALE.least && n <= SCALE.most ? n : SCALE.normal;
}

// Where a block he moved is shown while its change is on its way, and after it went through until
// the timer's next state (what he did) or a fresh read of the plan carries it. A change that fails
// puts the block back, with one message.
interface Hold { start: number; end: number; waiting: boolean; state?: TimeState; read?: number; }

function DayLine({ s, now }: { s: TimeState; now: number; }) {
    const from = dayStart(now);
    const to = dayStart(from + DAY + 3 * HOUR);
    const cal = useDay(from, to);
    const box = useRef<HTMLDivElement>(null);
    const day = useRef<DayHandle | null>(null);
    const [selected, setSelected] = useState<string | null>(null);
    const [typing, setTyping] = useState<DayBlock | null>(null);
    const [holds, setHolds] = useState<Record<string, Hold>>({});
    const [error, fail] = useError();
    const latest = useRef({ s, cal });
    latest.current = { s, cal };
    const saving = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const held = (key: string, start: number, end: number) => {
        const h = holds[key];
        if (!h) return [start, end];
        const keep = h.waiting || (h.state !== undefined ? h.state === s : (h.read ?? 0) >= cal.version);
        return keep ? [h.start, h.end] : [start, end];
    };
    const blocks: DayBlock[] = [
        ...(cal.day?.plan ?? []).map(b => {
            const [start, end] = held("plan:" + b.id, ms(b.start), ms(b.end));
            return { key: "plan:" + b.id, kind: "plan" as const, id: b.id, start, end, activity: b.activity, sally: b.sally, colour: COLOURS[b.activity], title: LABELS[b.activity] ?? "Planned" };
        }),
        ...s.intervals.map(p => {
            const [start, end] = held("piece:" + p.id, p.start, p.end);
            return { key: "piece:" + p.id, kind: "piece" as const, id: p.id, start, end, activity: p.activity, colour: COLOURS[p.activity], title: LABELS[p.activity] };
        }).filter(p => p.end > from && p.start < to),
        // What records ends at now, drawn to the minute so the day is not redrawn every second.
        ...(s.running && s.running.start < to ? [(() => {
            const r = s.running!;
            const [start] = held("running", r.start, now);
            return { key: "running", kind: "running" as const, id: r.id, start, end: Math.max(start + 1000, Math.floor(now / MIN) * MIN), activity: r.activity, colour: COLOURS[r.activity], title: LABELS[r.activity] };
        })()] : []),
        ...(cal.day?.events ?? []).filter(e => !e.allDay).map((e, i) => ({ key: "appt:" + i, kind: "appt" as const, id: String(i), start: ms(e.start), end: ms(e.end), title: e.title || "Busy", colour: "#f2f3f5", free: e.free }))
    ].filter(b => Number.isFinite(b.start) && Number.isFinite(b.end) && b.end > b.start);
    const allDay = (cal.day?.events ?? []).filter(e => e.allDay);

    // One change per drop or stretch, through the commands the panel always used: a recorded piece is
    // corrected (AgentDisc Actual time), what records gets a new start, a planned block is placed again
    // (AgentDisc Plan). Anything but a clear yes, a thrown error included, puts the block back.
    const change = async (b: DayBlock, start: number, end: number) => {
        setHolds(h => ({ ...h, [b.key]: { start, end, waiting: true } }));
        let ok = false, why = "";
        try {
            const a = b.kind === "piece" ? await timeCommand("edit", { id: b.id, activity: b.activity, start, end })
                : b.kind === "running" ? await timeClick("startedAt", { at: start })
                    : b.kind === "plan" ? await timeCommand("plan", { id: b.id, start: new Date(start).toISOString(), end: new Date(end).toISOString(), activity: b.activity, sally: !!b.sally })
                        : null;
            ok = a?.ok === true;
            why = a?.error ?? "";
        } catch (e) {
            why = String((e as Error)?.message ?? e);
        }
        if (!day.current) return; // the day closed meanwhile: nothing left on screen to put back
        if (!ok) {
            setHolds(h => { const n = { ...h }; delete n[b.key]; return n; });
            fail(plain(why));
            return;
        }
        const { s: state, cal: c } = latest.current;
        setHolds(h => ({ ...h, [b.key]: b.kind === "plan" ? { start, end, waiting: false, read: c.asked.current } : { start, end, waiting: false, state } }));
        if (b.kind === "plan") c.reload();
    };
    const changeNow = useRef(change);
    changeNow.current = change;
    const blocksNow = useRef(blocks);
    blocksNow.current = blocks;

    const selectedNow = useRef(selected);
    selectedNow.current = selected;
    useEffect(() => {
        if (!box.current) return;
        let handle: DayHandle | null = null, gone = false;
        mountDay(box.current, {
            dayStart: from,
            now: () => Date.now(),
            scale: readScale(),
            least: SCALE.least,
            most: SCALE.most,
            onScale: n => {
                clearTimeout(saving.current);
                saving.current = setTimeout(() => { saving.current = undefined; Settings.plugins.VencordToolbox.timelineScale = n; }, 400);
            },
            onSelect: key => { setSelected(key); setTyping(null); },
            onChange: (b, start, end) => void changeNow.current(b, start, end),
            onTimes: b => setTyping(blocksNow.current.find(x => x.key === b.key) ?? b)
        }).then(h => {
            if (gone) return h.destroy();
            handle = h;
            day.current = h;
            h.update(blocksNow.current, selectedNow.current);
        }, e => fail(`The day could not be drawn: ${String((e as Error)?.message ?? e)}`));
        return () => {
            gone = true;
            day.current = null;
            if (!handle) return;
            if (saving.current !== undefined) {
                clearTimeout(saving.current);
                saving.current = undefined;
                Settings.plugins.VencordToolbox.timelineScale = handle.scale();
            }
            handle.destroy();
        };
    }, [from]);

    useEffect(() => { day.current?.update(blocks, selected); });

    return (
        <div className="agentdisc-today-day" onPointerDown={e => { if (!(e.target as Element).closest?.(".fc-event, .agentdisc-today-corrector, .agentdisc-day-zoom")) setTyping(null); }}>
            {allDay.length > 0 && <div className="agentdisc-today-allday">{allDay.map((e, i) => <span key={i}>{e.title || "Busy"}</span>)}</div>}
            <div className="agentdisc-today-calendar" ref={box} />
            {typing && <Corrector s={s} now={now} box={typing} close={() => setTyping(null)} reload={cal.reload} />}
            {(error || (cal.error && !cal.setup)) && <div className="agentdisc-today-note agentdisc-today-day-note" role="alert">{error || `Calendar: ${cal.error}`}</div>}
        </div>
    );
}

// Typed times for a selected block: start and end (or only the start of what records now), save,
// and remove for a recorded piece or a planned block.
function Corrector({ s, now, box, close, reload }: { s: TimeState; now: number; box: DayBlock; close(): void; reload(): void; }) {
    const [start, setStart] = useState(timeOfDay(box.start));
    const [end, setEnd] = useState(box.kind === "running" ? "" : timeOfDay(box.end));
    const [error, fail] = useError();
    const r = s.running;
    // A typed hh:mm is the latest such moment that fits, today or the day before.
    const resolve = (text: string, after: number, upTo: number) => {
        for (let d = 0; d <= 2; d++) {
            const t = atTime(now - d * DAY, text);
            if (Number.isFinite(t) && t > after && t <= upTo) return t;
        }
        return NaN;
    };
    // A time left as it was keeps its exact value (seconds included); only a typed one is read again.
    const span = () => {
        const a = start === timeOfDay(box.start) ? box.start : atTime(box.start, start);
        if (end === timeOfDay(box.end) && box.end > a) return [a, box.end];
        let b = atTime(a, end);
        if (Number.isFinite(b) && b <= a) b += DAY;
        return [a, b];
    };
    const save = async () => {
        if (box.kind === "running") {
            if (!r) return close();
            if (start !== timeOfDay(r.start)) {
                const t = resolve(start, now - 2 * DAY, now - 1000);
                if (!Number.isFinite(t)) return fail("Pick a start in the last two days, as hh:mm.");
                const res = await timeClick("startedAt", { at: t });
                if (!res.ok) return fail(plain(res.error));
            }
            if (end.trim()) {
                const t = resolve(end, r.start, now);
                if (!Number.isFinite(t)) return fail("That end is not inside this session.");
                const res = await timeClick("stop", { at: t });
                if (!res.ok) return fail(plain(res.error));
            }
            return close();
        }
        const [a, b] = span();
        if (!Number.isFinite(a) || !Number.isFinite(b)) return fail("Write the times as hh:mm.");
        const res = box.kind === "piece"
            ? await timeCommand("edit", { id: box.id, activity: box.activity, start: a, end: b })
            : await timeCommand("plan", { id: box.id, start: new Date(a).toISOString(), end: new Date(b).toISOString(), activity: box.activity, sally: !!box.sally });
        if (!res.ok) return fail(plain(res.error));
        if (box.kind === "plan") reload();
        close();
    };
    const remove = async () => {
        const res = box.kind === "piece" ? await timeCommand("remove", { id: box.id }) : await timeCommand("plan", { id: box.id, op: "delete" });
        if (!res.ok) return fail(plain(res.error));
        if (box.kind === "plan") reload();
        close();
    };
    const input = (value: string, set: (v: string) => void, label: string, placeholder = "hh:mm") => (
        <input className="agentdisc-today-time" aria-label={label} value={value} placeholder={placeholder} maxLength={5} onKeyDown={e => { stopKeys(e); if (e.key === "Enter") void save(); if (e.key === "Escape") close(); }} onChange={e => set(e.currentTarget.value)} />
    );
    return (
        <div className="agentdisc-today-corrector" role="dialog" aria-label="Type the times" onPointerDown={e => e.stopPropagation()}>
            <div className="agentdisc-today-corrector-row">
                <span>{box.kind === "running" ? "Started" : "From"}</span>{input(start, setStart, "Start")}
                <span>{box.kind === "running" ? "ended" : "to"}</span>{input(end, setEnd, "End", box.kind === "running" ? "still on" : "hh:mm")}
            </div>
            <div className="agentdisc-today-corrector-row">
                <button type="button" className="agentdisc-today-link" onClick={save}>Save</button>
                {box.kind !== "running" && <button type="button" className="agentdisc-today-link" onClick={remove}>Remove</button>}
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
