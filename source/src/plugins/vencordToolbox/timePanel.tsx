/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "@api/Settings";
import { openActivityChannels } from "@plugins/channelGroups/activityBox";
import { React, useEffect, useReducer, useRef, useState } from "@webpack/common";

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

// ---- The day: one line of hours, every block across its whole width ----
// His words on 1.47.0 (9 Nov 2026): "Make the scale bigger and zoomable ... I want the blocks to be
// full width. When I create one block, I want to be able to see it, zoom in on it, and manually
// adjust it: change the time, make it longer by dragging or expanding the block". So: a bigger hour,
// Ctrl and the mouse wheel (or a pinch) over the day zoom it around the mouse, a click on a block
// zooms to it, dragging a block moves it and dragging its top or bottom edge changes its start or
// end. What he did and what he planned can be adjusted; his appointments are only shown. What was
// planned lies faint behind, what he did is solid on top, appointments are an outline over both.

interface CalEvent { start: string; end: string; allDay?: boolean; title?: string; free?: boolean; }
interface PlanBlock { id: string; start: string; end: string; activity: Activity; sally?: boolean; }
interface DayAnswer { events: CalEvent[]; plan: PlanBlock[]; }

const ms = (iso: string) => Date.parse(iso);
const MIN = 60000, HOUR = 3600000;
const SNAP = 5 * MIN;
const SCALE = { normal: 72, least: 24, most: 480 }; // pixels per hour

// Today's appointments and plan, read again every five minutes and after a change of the plan; the
// last read stays on screen while a new one runs, so the day never blanks.
function useDay(from: number, to: number) {
    const [data, setData] = useState<{ day: DayAnswer | null; error: string; setup: boolean; version: number; }>({ day: null, error: "", setup: false, version: 0 });
    const [tick, bump] = useReducer((n: number) => n + 1, 0);
    useEffect(() => {
        let gone = false;
        timeCommand("day", { from, to }).then(a => {
            if (gone) return;
            setData(d => a.ok ? { day: a.day, error: "", setup: false, version: d.version + 1 } : { ...d, error: a.error ?? "", setup: !!a.setup });
        });
        const t = setInterval(bump, 5 * 60000);
        return () => {
            gone = true;
            clearInterval(t);
        };
    }, [from, to, tick]);
    return { ...data, reload: bump };
}

type Kind = "piece" | "running" | "plan" | "appt";
interface Box { key: string; kind: Kind; id: string; start: number; end: number; activity?: Activity; sally?: boolean; label: string; free?: boolean; }
type Mode = "move" | "top" | "bottom";
interface Drag { box: Box; mode: Mode; y0: number; start: number; end: number; moved: boolean; lo: number; hi: number; }

function readScale() {
    const n = Number(Settings.plugins.VencordToolbox?.timelineScale);
    return Number.isFinite(n) && n >= SCALE.least && n <= SCALE.most ? n : SCALE.normal;
}

const snap = (t: number) => Math.round(t / SNAP) * SNAP;

function DayLine({ s, now }: { s: TimeState; now: number; }) {
    const from = dayStart(now);
    const to = dayStart(from + DAY + 3 * HOUR);
    const cal = useDay(from, to);
    const [scale, setScaleState] = useState(readScale);
    const [selected, setSelected] = useState<string | null>(null);
    const [typing, setTyping] = useState<Box | null>(null);
    // The block being dragged: kept in a ref as well, so a release right after the last move still
    // lands where the mouse let go, not where the last drawing had it.
    const [drag, setDragState] = useState<Drag | null>(null);
    const dragNow = useRef<Drag | null>(null);
    const setDrag = (d: Drag | null) => {
        dragNow.current = d;
        setDragState(d);
    };
    // Where a block he moved now is, until the next read of the plan (or the timer's next state, for
    // what he did) carries it: no jump back between the drop and the answer.
    const [moved, setMoved] = useState<Record<string, { start: number; end: number; version?: number; state?: TimeState; }>>({});
    const [error, fail] = useError();
    const scroller = useRef<HTMLDivElement>(null);
    const scaleNow = useRef(scale);
    scaleNow.current = scale;
    const saving = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const setScale = (n: number) => {
        const next = Math.min(SCALE.most, Math.max(SCALE.least, Math.round(n)));
        scaleNow.current = next;
        setScaleState(next);
        clearTimeout(saving.current);
        saving.current = setTimeout(() => { Settings.plugins.VencordToolbox.timelineScale = next; }, 400);
        return next;
    };
    useEffect(() => () => {
        if (saving.current === undefined) return;
        clearTimeout(saving.current);
        Settings.plugins.VencordToolbox.timelineScale = scaleNow.current;
    }, []);

    // A planned block he moved keeps its new place until a fresh read of the plan carries it.
    const plan = (cal.day?.plan ?? []).map(b => {
        const m = moved["plan:" + b.id];
        return m && m.version === cal.version ? { ...b, start: new Date(m.start).toISOString(), end: new Date(m.end).toISOString() } : b;
    });
    const pieces = s.intervals.map(p => {
        const m = moved["piece:" + p.id];
        return m && m.state === s ? { ...p, start: m.start, end: m.end } : p;
    });
    const boxes: Box[] = [
        ...plan.map(b => ({ key: "plan:" + b.id, kind: "plan" as const, id: b.id, start: ms(b.start), end: ms(b.end), activity: b.activity, sally: b.sally, label: LABELS[b.activity] ?? "Planned" })),
        ...pieces.filter(i => i.end > from && i.start < to).map(p => ({ key: "piece:" + p.id, kind: "piece" as const, id: p.id, start: p.start, end: p.end, activity: p.activity, label: LABELS[p.activity] })),
        ...(s.running && s.running.start < to ? [{ key: "running", kind: "running" as const, id: s.running.id, start: s.running.start, end: now, activity: s.running.activity, label: LABELS[s.running.activity] }] : []),
        ...(cal.day?.events ?? []).filter(e => !e.allDay).map((e, i) => ({ key: "appt:" + i, kind: "appt" as const, id: String(i), start: ms(e.start), end: ms(e.end), label: e.title || "Busy", free: e.free }))
    ].filter(b => Number.isFinite(b.start) && Number.isFinite(b.end) && b.end > b.start);
    const allDay = (cal.day?.events ?? []).filter(e => e.allDay);

    const y = (t: number, k = scale) => (Math.min(Math.max(t, from), to) - from) / HOUR * k;
    const shown = (b: Box) => drag && drag.box.key === b.key ? { ...b, start: drag.start, end: drag.end } : b;

    // Open on now, a third of the way down.
    useEffect(() => {
        const el = scroller.current;
        if (el) el.scrollTop = Math.max(0, y(now) - el.clientHeight / 3);
    }, []);

    // Ctrl and the wheel (a pinch on a touchpad sends the same) zoom the day around the mouse; the
    // panel keeps its size, only the hours grow or shrink.
    useEffect(() => {
        const el = scroller.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            if (!e.ctrlKey) return;
            e.preventDefault();
            e.stopPropagation();
            const box = el.getBoundingClientRect();
            const at = e.clientY - box.top;
            const hours = (el.scrollTop + at) / scaleNow.current;
            const next = setScale(scaleNow.current * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
            el.scrollTop = hours * next - at;
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, []);

    // A click on a block brings it into view and zooms to it (a third of the view at most).
    const zoomTo = (b: Box) => {
        const el = scroller.current;
        if (!el) return;
        const hours = Math.max((b.end - b.start) / HOUR, 0.1);
        const next = setScale(Math.max(scaleNow.current, Math.min(SCALE.most, el.clientHeight / 3 / hours)));
        requestAnimationFrame(() => {
            el.scrollTop = Math.max(0, (Math.max(b.start, from) - from) / HOUR * next - el.clientHeight / 3);
        });
    };

    const canDrag = (b: Box, mode: Mode) => b.kind === "plan" || b.kind === "piece" || (b.kind === "running" && mode === "top");

    const begin = (e: React.PointerEvent, b: Box, mode: Mode) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        setTyping(null);
        // How far it may go: what he did stops at the pieces next to it (his time never overlaps) and
        // at now; a plan block anywhere in the day; nothing goes before the start of the day, unless it
        // began the day before, and then not before its own start.
        const others = b.kind === "plan" ? [] : s.intervals.filter(i => i.id !== b.id);
        const before = Math.max(-Infinity, ...others.filter(i => i.end <= b.start).map(i => i.end));
        const after = Math.min(Infinity, ...others.filter(i => i.start >= b.end).map(i => i.start), ...(b.kind === "piece" && s.running ? [s.running.start] : []));
        const lo = Math.max(Math.min(b.start, from), before);
        const hi = b.kind === "piece" ? Math.min(to, now, after) : to;
        setDrag({ box: b, mode: canDrag(b, mode) ? mode : "move", y0: e.clientY, start: b.start, end: b.end, moved: false, lo, hi });
    };

    // Moving or stretching, in five-minute steps, inside the limits set when it was grabbed; a block
    // never shrinks below five minutes (or below its own length, if shorter).
    const place = (drag: Drag, clientY: number): Drag => {
        const dy = clientY - drag.y0;
        if (!drag.moved && Math.abs(dy) < 4) return drag;
        const b = drag.box;
        if (!canDrag(b, drag.mode)) return drag.moved ? drag : { ...drag, moved: true };
        const dt = snap(dy / scaleNow.current * HOUR);
        let { start, end } = b;
        const least = Math.min(SNAP, b.end - b.start); // a shorter block may stay as short as it is
        const { lo, hi } = drag;
        if (drag.mode === "move") {
            start = b.start + dt;
            end = b.end + dt;
            if (end > hi) { start -= end - hi; end = hi; }
            if (start < lo) { end += lo - start; start = lo; }
        } else if (drag.mode === "top") {
            start = Math.min(snap(b.start + dt), end - least, b.kind === "running" ? now - MIN : Infinity);
            start = Math.max(start, lo);
        } else {
            end = Math.max(snap(b.end + dt), start + least);
            end = Math.min(end, hi);
        }
        return drag.moved && start === drag.start && end === drag.end ? drag : { ...drag, start, end, moved: true };
    };

    const move = (e: React.PointerEvent) => {
        const d = dragNow.current;
        if (!d) return;
        const next = place(d, e.clientY);
        if (next !== d) setDrag(next);
    };

    const finish = async (e: React.PointerEvent) => {
        const grabbed = dragNow.current;
        setDrag(null);
        if (!grabbed) return;
        const d = place(grabbed, e.clientY);
        const b = d.box;
        if (!d.moved) {
            setSelected(b.key);
            zoomTo(b);
            return;
        }
        if (!canDrag(b, d.mode) || (d.start === b.start && d.end === b.end)) return;
        if (b.kind === "piece") {
            setMoved(m => ({ ...m, [b.key]: { start: d.start, end: d.end, state: s } }));
            const a = await timeCommand("edit", { id: b.id, activity: b.activity, start: d.start, end: d.end });
            if (!a.ok) {
                fail(plain(a.error));
                setMoved(m => { const n = { ...m }; delete n[b.key]; return n; });
            }
        } else if (b.kind === "running") {
            const a = await timeClick("startedAt", { at: d.start });
            if (!a.ok) fail(plain(a.error));
        } else if (b.kind === "plan") {
            setMoved(m => ({ ...m, [b.key]: { start: d.start, end: d.end, version: cal.version } }));
            const a = await timeCommand("plan", { id: b.id, start: new Date(d.start).toISOString(), end: new Date(d.end).toISOString(), activity: b.activity, sally: !!b.sally });
            if (!a.ok) {
                fail(plain(a.error));
                setMoved(m => { const n = { ...m }; delete n[b.key]; return n; });
            }
            cal.reload();
        }
    };

    const hours: number[] = [];
    for (let h = 0; h <= 24; h++) hours.push(h);
    const label = (b: Box) => `${timeOfDay(b.start)}–${timeOfDay(b.end)}`;

    return (
        <div className="agentdisc-today-day" ref={scroller} onPointerDown={() => { setSelected(null); setTyping(null); }}>
            {allDay.length > 0 && <div className="agentdisc-today-allday">{allDay.map((e, i) => <span key={i}>{e.title || "Busy"}</span>)}</div>}
            <div className={"agentdisc-today-line" + (drag?.moved ? " agentdisc-today-dragging" : "")} style={{ height: 24 * scale }} onPointerMove={move} onPointerUp={finish} onPointerCancel={() => setDrag(null)}>
                {hours.map(h => <div key={h} className="agentdisc-today-hour" style={{ top: h * scale }}><span>{String(h % 24).padStart(2, "0")}</span></div>)}
                {boxes.map(raw => {
                    const b = shown(raw);
                    const editable = b.kind !== "appt";
                    const h = Math.max(y(b.end) - y(b.start), 3);
                    return (
                        <div
                            key={b.key}
                            className={`agentdisc-today-item agentdisc-today-${b.kind === "piece" || b.kind === "running" ? "done" : b.kind}` + (b.kind === "running" ? " agentdisc-today-running" : "") + (b.free ? " agentdisc-today-appt-free" : "") + (selected === b.key ? " agentdisc-today-selected" : "")}
                            style={{ top: y(b.start), height: h, ...(b.activity ? { "--agentdisc-act": COLOURS[b.activity] } : {}) } as React.CSSProperties}
                            title={`${b.kind === "plan" ? "Planned " : b.kind === "appt" ? "" : b.kind === "running" ? "Recording since " : ""}${label(b)} ${b.label}${editable ? ". Drag to move, drag an edge to change the time, click to zoom to it." : ""}`}
                            data-kind={b.kind}
                            data-key={b.key}
                            onPointerDown={e => begin(e, b, "move")}
                        >
                            <span className="agentdisc-today-item-name">{b.label}</span>
                            {(selected === b.key || drag?.box.key === b.key) && editable && (
                                <button type="button" className="agentdisc-today-item-times" title="Type the times" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); setTyping(raw); }}>{label(b)}</button>
                            )}
                            {editable && canDrag(b, "top") && <div className="agentdisc-today-edge agentdisc-today-edge-top" onPointerDown={e => begin(e, b, "top")} />}
                            {editable && canDrag(b, "bottom") && <div className="agentdisc-today-edge agentdisc-today-edge-bottom" onPointerDown={e => begin(e, b, "bottom")} />}
                        </div>
                    );
                })}
                <div className="agentdisc-today-now" style={{ top: y(now) }} />
                {typing && <Corrector s={s} now={now} box={typing} top={Math.max(0, y(typing.start) - 4)} close={() => setTyping(null)} reload={cal.reload} />}
            </div>
            {(error || (cal.error && !cal.setup)) && <div className="agentdisc-today-note agentdisc-today-day-note">{error || `Calendar: ${cal.error}`}</div>}
        </div>
    );
}

// Typed times for a selected block: start and end (or only the start of what records now), save,
// and remove for a recorded piece or a planned block.
function Corrector({ s, now, box, top, close, reload }: { s: TimeState; now: number; box: Box; top: number; close(): void; reload(): void; }) {
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
        <div className="agentdisc-today-corrector" role="dialog" aria-label="Type the times" style={{ top }} onPointerDown={e => e.stopPropagation()}>
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
