/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { activityOf, familiesFor, guildMap, hasAssignments, type Place, setCategoryPlace, setChannelPlace, setServerPlace, suggestionFor, unassignedChannels } from "@plugins/channelGroups/activity";
import { ChannelStore, GuildStore, NavigationRouter, React, useEffect, useMemo, useReducer, useRef, useState } from "@webpack/common";

import {
ACTIVITIES, type Activity, atTime, type Block, clock, COLOURS, DAY, dayStart, hm, LABELS, MEANING, newId, type Piece, recorded, timeClick, timeCommand,
    timeOfDay, timeProblem, type TimeState, useClock, useTimeState, weekStart, WORK
} from "./timeFocus";

// The Today part of the right panel (Stephane, 9 Nov 2026): "On the right tab, I want to add a
// time tracker so I will be able to see it right on the side of my screen ... I would see those
// categories, and I can only select one at a time ... I should also see my day, which should be
// related to my Google Calendar ... we should always think about creating the ideal week ...
// after work, the calendar should be updated with what I have been working on".
//
// Tracking is by hand only (his correction the same morning): choosing an activity changes the
// channel list; Start, Pause, Stop and a deliberate switch are the only things that change
// recorded time. Plan and recorded time stay apart: planned blocks on his AgentDisc Plan
// calendar, recorded pieces on his AgentDisc Actual time calendar, his own appointments only read.

type Section = "day" | "week" | "plan" | "channels";
let section: Section = "day";
const sectionListeners = new Set<() => void>();
export function showTodaySection(next: Section) {
    section = next;
    sectionListeners.forEach(fn => fn());
}
function useSection(): [Section, (s: Section) => void] {
    const [, redraw] = useReducer((n: number) => n + 1, 0);
    useEffect(() => {
        sectionListeners.add(redraw);
        return () => void sectionListeners.delete(redraw);
    }, []);
    return [section, showTodaySection];
}

const stopKeys = (e: React.KeyboardEvent) => e.stopPropagation();

function Dot({ activity, live }: { activity: Activity; live?: boolean; }) {
    return <span className={"agentdisc-today-dot" + (live ? " agentdisc-today-live" : "")} style={{ background: COLOURS[activity] }} aria-hidden="true" />;
}

function TimeInput({ value, onChange, label }: { value: string; onChange(v: string): void; label: string; }) {
    return <input className="agentdisc-today-time" aria-label={label} value={value} placeholder="hh:mm" maxLength={5} onKeyDown={stopKeys} onChange={e => onChange(e.currentTarget.value)} />;
}

function ActivitySelect({ value, onChange, withBreak = true, extra }: { value: string; onChange(v: string): void; withBreak?: boolean; extra?: [string, string][]; }) {
    return (
        <select className="agentdisc-today-select" value={value} onKeyDown={stopKeys} onChange={e => onChange(e.currentTarget.value)}>
            {extra?.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            {(withBreak ? ACTIVITIES : WORK).map(a => <option key={a} value={a}>{LABELS[a]}</option>)}
        </select>
    );
}

// ---- The running control: shown at the top of Today, and as a strip above other parts ----

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
    stale: "Another Discord tab changed the timer just before; this view is up to date now.",
    "already running": "Time is already running.",
    "nothing running": "Nothing is running.",
    "choose an activity first": "Choose an activity first."
};

async function click(cmd: string, args: Record<string, any>, fail: (e: string) => void) {
    const a = await timeClick(cmd, args);
    if (!a.ok) fail(PLAIN[a.error ?? ""] ?? a.error ?? "That did not work.");
    return a.ok;
}

export function RunningControl({ compact = false }: { compact?: boolean; }) {
    const s = useTimeState();
    const now = useClock(!!s?.running);
    const [error, fail] = useError();
    const [edit, setEdit] = useState<"" | "start" | "stop">("");
    const [at, setAt] = useState("");
    const problem = timeProblem();
    if (!s) return <div className="agentdisc-today-run agentdisc-today-muted">{problem ?? "Reading the timer…"}</div>;
    const r = s.running;
    const chosen = r?.activity ?? s.selected;
    const openEdit = (kind: "start" | "stop") => {
        setEdit(kind);
        setAt(timeOfDay(kind === "start" ? r!.start : now));
    };
    // A typed hh:mm means the latest such moment that fits: inside the running session for its end,
    // before now for its start, today or the day before (a session started last evening).
    const resolve = (text: string, after: number, upTo: number) => {
        for (let d = 0; d <= 2; d++) {
            const t = atTime(now - d * DAY, text);
            if (Number.isFinite(t) && t > after && t <= upTo) return t;
        }
        return NaN;
    };
    const saveEdit = async () => {
        if (!r) return setEdit("");
        if (!Number.isFinite(atTime(now, at))) return fail("Write the time as hh:mm.");
        const t = edit === "start" ? resolve(at, now - 2 * DAY, now - 1000) : resolve(at, r.start, now);
        if (!Number.isFinite(t)) return fail(edit === "start" ? "Pick a time in the last two days." : "That time is not inside this session.");
        if (await click(edit === "start" ? "startedAt" : "stop", { at: t }, fail)) setEdit("");
    };
    const name = r ? LABELS[r.activity] : s.paused ? `Paused · ${LABELS[s.paused.activity]}` : chosen ? LABELS[chosen] : "Choose an activity";
    const pause = () => click("pause", {}, fail), stop = () => click("stop", {}, fail), go = () => click("start", {}, fail);
    return (
        <div className={"agentdisc-today-run" + (compact ? " agentdisc-today-run-compact" : "")} style={chosen ? { "--agentdisc-act": COLOURS[chosen] } as React.CSSProperties : undefined}>
            <div className="agentdisc-today-run-row">
                {chosen ? <Dot activity={chosen} live={!!r} /> : <span className="agentdisc-today-dot agentdisc-today-dot-empty" aria-hidden="true" />}
                <span className="agentdisc-today-run-name" title={chosen ? MEANING[chosen] : undefined}>{name}</span>
                {r && <span className="agentdisc-today-clock">{clock(now - r.start)}</span>}
                {compact && (
                    <span className="agentdisc-today-run-buttons">
                        {r ? (
                            <>
                                <IconButton label="Pause" onClick={pause} path="M8 5v14M16 5v14" />
                                <IconButton label="Stop" onClick={stop} path="M6 6h12v12H6z" />
                            </>
                        ) : chosen ? <IconButton label={s.paused ? "Resume" : "Start"} onClick={go} path="M7 5l12 7-12 7z" go /> : null}
                    </span>
                )}
            </div>
            {!compact && (
                <div className="agentdisc-today-run-sub">
                    {r ? (
                        <>
                            <button type="button" className="agentdisc-today-btn" onClick={pause} title="Pause: this piece ends; Resume continues the session">Pause</button>
                            <button type="button" className="agentdisc-today-btn" onClick={stop} title="Stop the session">Stop</button>
                            {edit ? (
                                <span className="agentdisc-today-run-edit">
                                    <span>{edit === "start" ? "Started at" : "Stopped at"}</span>
                                    <TimeInput value={at} onChange={setAt} label={edit === "start" ? "Start time" : "Stop time"} />
                                    <button type="button" className="agentdisc-today-link" onClick={saveEdit}>Save</button>
                                    <button type="button" className="agentdisc-today-link" onClick={() => setEdit("")}>Cancel</button>
                                </span>
                            ) : (
                                <span className="agentdisc-today-run-edit">
                                    <span>since {timeOfDay(r.start)}</span>
                                    <button type="button" className="agentdisc-today-link" onClick={() => openEdit("start")} title="Forgot to press Start? Set when it really began">change start</button>
                                    <button type="button" className="agentdisc-today-link" onClick={() => openEdit("stop")} title="Forgot to press Stop? Set when it really ended">it ended earlier</button>
                                </span>
                            )}
                        </>
                    ) : chosen ? (
                        <button type="button" className="agentdisc-today-btn agentdisc-today-btn-go" onClick={go}>{s.paused ? "Resume" : "Start"}</button>
                    ) : (
                        <span>Choose one below, then press Start. Nothing is recorded until you do.</span>
                    )}
                </div>
            )}
            {!compact && s.check && r && <GapCheck s={s} fail={fail} />}
            {error && <div className="agentdisc-today-error" role="alert">{error}</div>}
        </div>
    );
}

function IconButton({ label, onClick, path, go }: { label: string; onClick(): void; path: string; go?: boolean; }) {
    return (
        <button type="button" className={"agentdisc-today-icon" + (go ? " agentdisc-today-icon-go" : "")} aria-label={label} title={label} onClick={onClick}>
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d={path} fill={go ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" /></svg>
        </button>
    );
}

// After a long gap with no Discord open while time ran: he decides, nothing is guessed.
function GapCheck({ s, fail }: { s: TimeState; fail(e: string): void; }) {
    const { since } = (s.check!);
    return (
        <div className="agentdisc-today-banner">
            <div>Discord was closed from {timeOfDay(since)} while {LABELS[s.running!.activity]} ran. Did it go on?</div>
            <div className="agentdisc-today-banner-buttons">
                <button type="button" className="agentdisc-today-btn" onClick={() => click("keep", {}, fail)}>Yes, keep it</button>
                <button type="button" className="agentdisc-today-btn" onClick={() => click("stop", { at: since }, fail)}>It ended at {timeOfDay(since)}</button>
            </div>
        </div>
    );
}

function Reminder({ s }: { s: TimeState; }) {
    const b = s.remind?.banner;
    const [error, fail] = useError();
    if (!b) return null;
    return (
        <div className="agentdisc-today-banner agentdisc-today-reminder" style={b.activity ? { "--agentdisc-act": COLOURS[b.activity] } as React.CSSProperties : undefined}>
            <div>{b.text}</div>
            <div className="agentdisc-today-banner-buttons">
                <button type="button" className="agentdisc-today-btn" onClick={() => timeCommand("snooze", { minutes: 5 })}>5 more min</button>
                <button type="button" className="agentdisc-today-btn" onClick={() => timeCommand("snooze", { minutes: 30 })}>30 more min</button>
                {b.activity && b.activity !== (s.running?.activity ?? s.selected) && (
                    <button type="button" className="agentdisc-today-btn" title="Choose it; press Start when you begin" onClick={() => click("select", { activity: b.activity }, fail)}>Switch to {LABELS[b.activity]}</button>
                )}
                <button type="button" className="agentdisc-today-link" onClick={() => timeCommand("dismiss")}>OK</button>
            </div>
            {error && <div className="agentdisc-today-error">{error}</div>}
        </div>
    );
}

function Tiles({ s, now }: { s: TimeState; now: number; }) {
    const [error, fail] = useError();
    const today = dayStart(now), week = weekStart(now);
    return (
        <>
            <div className="agentdisc-today-tiles">
                {ACTIVITIES.map(a => {
                    const day = recorded(s, a, today, today + DAY, now);
                    const used = recorded(s, a, week, week + 7 * DAY, now);
                    const allow = s.allowances?.[a];
                    const on = (s.running?.activity ?? s.selected) === a;
                    return (
                        <button
                            key={a}
                            type="button"
                            className={"agentdisc-today-tile" + (on ? " agentdisc-today-tile-on" : "") + (a === "break" ? " agentdisc-today-tile-break" : "")}
                            style={{ "--agentdisc-act": COLOURS[a] } as React.CSSProperties}
                            title={`${MEANING[a]}. Click to choose it${s.running && s.running.activity !== a ? ` (ends the ${LABELS[s.running.activity]} piece now)` : ""}; press Start when you begin.`}
                            aria-pressed={on}
                            onClick={() => click("select", { activity: a }, fail)}
                        >
                            <span className="agentdisc-today-tile-name"><Dot activity={a} live={s.running?.activity === a} />{LABELS[a]}</span>
                            <span className="agentdisc-today-tile-numbers">
                                {day ? hm(day) : "—"}
                                {a !== "break" && <span className="agentdisc-today-tile-left">{allow == null ? "" : used >= allow * 3600000 ? "allowance used" : `${hm(allow * 3600000 - used)} left`}</span>}
                            </span>
                        </button>
                    );
                })}
            </div>
            {error && <div className="agentdisc-today-error">{error}</div>}
        </>
    );
}

// ---- Calendar reads ----

interface CalEvent { id?: string; calendar?: string; start: string; end: string; allDay?: boolean; title?: string; free?: boolean; }
interface PlanBlock { id: string; start: string; end: string; activity: Activity; sally?: boolean; }
interface DayAnswer { events: CalEvent[]; plan: PlanBlock[]; }

function useCalendar(from: number, to: number, on: boolean, busy: TimeState["busy"]) {
    const [data, setData] = useState<{ key: string; base: string; day: DayAnswer | null; error: string; setup: boolean; loading: boolean; }>({ key: "", base: "", day: null, error: "", setup: false, loading: true });
    const [tick, bump] = useReducer((n: number) => n + 1, 0);
    // A read belongs to its range and calendar selection. Invalidate it during render, before
    // the effect runs, so changing calendars never leaves the old appointments usable for planning.
    const base = JSON.stringify([from, to, busy]);
    const key = base + "|" + tick;
    useEffect(() => {
        if (!on) return;
        let gone = false;
        setData(d => ({ ...d, loading: true }));
        timeCommand("day", { from, to }).then(a => {
            if (gone) return;
            setData({ key, base, day: a.ok ? a.day : null, error: a.ok ? "" : a.error ?? "", setup: !!a.setup, loading: false });
        });
        const t = setInterval(bump, 5 * 60000);
        return () => {
            gone = true;
            clearInterval(t);
        };
    }, [from, to, on, key]);
    // `day` is only a fresh read of this range and choice (placement uses it). `shown` keeps the last
    // read of the same range and choice on screen while a refresh runs, so the day never blanks.
    return { ...(data.key === key ? data : { day: null, error: "", setup: false, loading: true }), shown: data.base === base ? data.day : null, reload: bump };
}

const ms = (iso: string) => Date.parse(iso);

// ---- Day: the timeline and the corrections ----

function DaySection({ s, now }: { s: TimeState; now: number; }) {
    const [shift, setShift] = useState(0);
    const from = dayStart(now) + shift * DAY;
    // A day boundary moved with daylight saving: the next midnight, read again.
    const to = dayStart(from + DAY + 3 * 3600000);
    const cal = useCalendar(from, to, true, s.busy);
    const pieces = s.intervals.filter(i => i.end > from && i.start < to).sort((a, b) => a.start - b.start);
    const running = s.running && s.running.start < to && now > from ? s.running : null;
    const label = shift === 0 ? "Today" : shift === -1 ? "Yesterday" : new Date(from).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
    return (
        <div className="agentdisc-today-section">
            <div className="agentdisc-today-head">
                <button type="button" className="agentdisc-today-link" aria-label="Previous day" onClick={() => setShift(n => n - 1)}>‹</button>
                <span className="agentdisc-today-head-title">{label}</span>
                <button type="button" className="agentdisc-today-link" aria-label="Next day" disabled={shift >= 0} onClick={() => setShift(n => Math.min(0, n + 1))}>›</button>
                {shift !== 0 && <button type="button" className="agentdisc-today-link" onClick={() => setShift(0)}>today</button>}
            </div>
            <Timeline from={from} to={to} now={now} cal={cal.day ?? cal.shown} pieces={pieces} running={running} />
            <CalendarNote cal={cal} />
            <Corrections from={from} to={to} now={now} pieces={pieces} />
        </div>
    );
}

function CalendarNote({ cal }: { cal: { error: string; setup: boolean; loading: boolean; }; }) {
    if (cal.setup) return <div className="agentdisc-today-note">Google Calendar is not connected on this computer yet. Recorded time is kept here and goes to the calendar once it is.</div>;
    if (cal.error) return <div className="agentdisc-today-note agentdisc-today-warn">Calendar: {cal.error}</div>;
    return null;
}

function Timeline({ from, to, now, cal, pieces, running }: { from: number; to: number; now: number; cal: DayAnswer | null; pieces: Piece[]; running: TimeState["running"]; }) {
    const timed = (cal?.events ?? []).filter(e => !e.allDay);
    const allDay = (cal?.events ?? []).filter(e => e.allDay);
    const plan = cal?.plan ?? [];
    const hourOf = (t: number) => (t - from) / 3600000;
    const starts = [5, ...timed.map(e => hourOf(ms(e.start))), ...plan.map(b => hourOf(ms(b.start))), ...pieces.map(p => hourOf(p.start)), ...(running ? [hourOf(running.start)] : [])].filter(Number.isFinite);
    const ends = [22, ...timed.map(e => hourOf(ms(e.end))), ...plan.map(b => hourOf(ms(b.end))), ...pieces.map(p => hourOf(p.end)), running ? hourOf(now) : 0].filter(Number.isFinite);
    const first = Math.max(0, Math.floor(Math.min(...starts)));
    const last = Math.min(24, Math.ceil(Math.max(...ends)));
    const PX = 30;
    const top = (t: number) => Math.max(0, (hourOf(t) - first) * PX);
    const height = (a: number, b: number) => Math.max(3, (Math.min(hourOf(b), last) - Math.max(hourOf(a), first)) * PX);
    const hours: number[] = [];
    for (let h = first; h <= last; h++) hours.push(h);
    const nowShown = now >= from && now < to;
    return (
        <div className="agentdisc-today-timeline">
            {allDay.length > 0 && <div className="agentdisc-today-allday">{allDay.map((e, i) => <span key={i}>{e.title || "Busy"}</span>)}</div>}
            <div className="agentdisc-today-lanes-head"><span /><span>Calendar</span><span>Plan</span><span>Recorded</span></div>
            <div className="agentdisc-today-lanes" style={{ height: (last - first) * PX }}>
                {hours.map(h => <div key={h} className="agentdisc-today-hour" style={{ top: (h - first) * PX }}><span>{String(h).padStart(2, "0")}</span></div>)}
                <div className="agentdisc-today-lane agentdisc-today-lane-1">
                    {timed.map((e, i) => (
                        <div key={i} className="agentdisc-today-item agentdisc-today-appt" style={{ top: top(ms(e.start)), height: height(ms(e.start), ms(e.end)) }} title={`${timeOfDay(ms(e.start))}–${timeOfDay(ms(e.end))} ${e.title ?? ""}`}>
                            {e.title || "Busy"}
                        </div>
                    ))}
                </div>
                <div className="agentdisc-today-lane agentdisc-today-lane-2">
                    {plan.map(b => (
                        <div key={b.id} className="agentdisc-today-item agentdisc-today-plan" style={{ top: top(ms(b.start)), height: height(ms(b.start), ms(b.end)), "--agentdisc-act": COLOURS[b.activity] ?? "#888" } as React.CSSProperties} title={`${timeOfDay(ms(b.start))}–${timeOfDay(ms(b.end))} ${LABELS[b.activity] ?? ""}${b.sally ? " with your partner" : ""}`}>
                            {LABELS[b.activity] ?? "Block"}{b.sally ? " · partner" : ""}
                        </div>
                    ))}
                </div>
                <div className="agentdisc-today-lane agentdisc-today-lane-3">
                    {pieces.map(p => (
                        <div key={p.id} className="agentdisc-today-item agentdisc-today-done" style={{ top: top(Math.max(p.start, from)), height: height(Math.max(p.start, from), Math.min(p.end, to)), "--agentdisc-act": COLOURS[p.activity] } as React.CSSProperties} title={`${timeOfDay(p.start)}–${timeOfDay(p.end)} ${LABELS[p.activity]}`}>
                            {LABELS[p.activity]}
                        </div>
                    ))}
                    {running && (
                        <div className="agentdisc-today-item agentdisc-today-done agentdisc-today-running" style={{ top: top(Math.max(running.start, from)), height: height(Math.max(running.start, from), Math.min(now, to)), "--agentdisc-act": COLOURS[running.activity] } as React.CSSProperties}>
                            {LABELS[running.activity]}
                        </div>
                    )}
                </div>
                {nowShown && <div className="agentdisc-today-now" style={{ top: top(now) }} />}
            </div>
        </div>
    );
}

function Corrections({ from, to, now, pieces }: { from: number; to: number; now: number; pieces: Piece[]; }) {
    const [editing, setEditing] = useState<string | null>(null);
    const [form, setForm] = useState({ activity: "clients", start: "", end: "" });
    const [error, fail] = useError();
    const open = (p: Piece | null) => {
        setEditing(p ? p.id : "new");
        setForm(p ? { activity: p.activity, start: timeOfDay(p.start), end: timeOfDay(p.end) } : { activity: "clients", start: "", end: "" });
    };
    const save = async () => {
        // A piece keeps its own day (an overnight piece edited from the next day stays where it
        // was); its end is the first such hour after its start, so past midnight works.
        const piece = pieces.find(p => p.id === editing);
        const start = atTime(piece ? piece.start : from, form.start);
        let end = atTime(start, form.end);
        if (Number.isFinite(end) && end <= start) end += DAY;
        if (!Number.isFinite(start) || !Number.isFinite(end)) return fail("Write the times as hh:mm.");
        const a = editing === "new"
            ? await timeCommand("add", { activity: form.activity, start, end })
            : await timeCommand("edit", { id: editing, activity: form.activity, start, end });
        if (!a.ok) return fail(a.error ?? "That did not work.");
        setEditing(null);
    };
    const remove = async (id: string) => {
        const a = await timeCommand("remove", { id });
        if (!a.ok) fail(a.error ?? "That did not work.");
    };
    const formRow = (
        <div className="agentdisc-today-form">
            <ActivitySelect value={form.activity} onChange={v => setForm(f => ({ ...f, activity: v }))} />
            <TimeInput value={form.start} onChange={v => setForm(f => ({ ...f, start: v }))} label="From" />
            <span>–</span>
            <TimeInput value={form.end} onChange={v => setForm(f => ({ ...f, end: v }))} label="To" />
            <button type="button" className="agentdisc-today-link" onClick={save}>Save</button>
            <button type="button" className="agentdisc-today-link" onClick={() => setEditing(null)}>Cancel</button>
        </div>
    );
    return (
        <div className="agentdisc-today-pieces">
            <div className="agentdisc-today-subhead">Recorded pieces</div>
            {!pieces.length && editing !== "new" && <div className="agentdisc-today-muted">Nothing recorded this day.</div>}
            {pieces.map(p => editing === p.id ? <div key={p.id}>{formRow}</div> : (
                <div key={p.id} className="agentdisc-today-piece">
                    <Dot activity={p.activity} />
                    <span className="agentdisc-today-piece-time">{timeOfDay(p.start)}–{timeOfDay(p.end)}</span>
                    <span className="agentdisc-today-piece-name">{LABELS[p.activity]}</span>
                    <span className="agentdisc-today-piece-len">{hm(p.end - p.start)}</span>
                    <button type="button" className="agentdisc-today-link" onClick={() => open(p)}>edit</button>
                    <button type="button" className="agentdisc-today-link" aria-label="Remove this piece" onClick={() => remove(p.id)}>×</button>
                </div>
            ))}
            {editing === "new" ? formRow : <button type="button" className="agentdisc-today-link" onClick={() => open(null)} disabled={from > now}>+ Add time you forgot to record</button>}
            {error && <div className="agentdisc-today-error">{error}</div>}
        </div>
    );
}

// ---- Week: totals and allowances ----

function WeekSection({ s, now }: { s: TimeState; now: number; }) {
    const [error, fail] = useError();
    const week = weekStart(now), today = dayStart(now);
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const save = async (a: Activity) => {
        const text = (drafts[a] ?? "").trim().replace(",", ".");
        const res = await timeCommand("allowance", { activity: a, hours: text === "" ? null : Number(text) });
        if (!res.ok) fail(res.error ?? "That did not work.");
        setDrafts(d => { const n = { ...d }; delete n[a]; return n; });
    };
    let workWeek = 0, workDay = 0;
    for (const a of WORK) {
        workWeek += recorded(s, a, week, week + 7 * DAY, now);
        workDay += recorded(s, a, today, today + DAY, now);
    }
    return (
        <div className="agentdisc-today-section">
            <div className="agentdisc-today-subhead">This week · {hm(workWeek)} recorded, {hm(workDay)} today (Break left out)</div>
            <div className="agentdisc-today-week">
                <span className="agentdisc-today-week-h">Activity</span><span className="agentdisc-today-week-h">Today</span><span className="agentdisc-today-week-h">Week</span><span className="agentdisc-today-week-h" title="Hours per week; empty means not set">Allowance</span><span className="agentdisc-today-week-h">Left</span>
                {ACTIVITIES.map(a => {
                    const used = recorded(s, a, week, week + 7 * DAY, now);
                    const allow = s.allowances?.[a];
                    return [
                        <span key={a + "n"} className="agentdisc-today-week-name"><Dot activity={a} />{LABELS[a]}</span>,
                        <span key={a + "d"}>{hm(recorded(s, a, today, today + DAY, now))}</span>,
                        <span key={a + "w"}>{hm(used)}</span>,
                        a === "break" ? <span key={a + "a"} className="agentdisc-today-muted">—</span> : (
                            <span key={a + "a"}>
                                <input
                                    className="agentdisc-today-hours"
                                    aria-label={`${LABELS[a]} hours per week`}
                                    placeholder="not set"
                                    value={drafts[a] ?? (allow == null ? "" : String(allow))}
                                    onKeyDown={e => { stopKeys(e); if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }}
                                    onChange={e => { const v = e.currentTarget.value; setDrafts(d => ({ ...d, [a]: v })); }}
                                    onBlur={() => a in drafts && save(a)}
                                />
                                {allow != null && "h"}
                            </span>
                        ),
                        <span key={a + "l"} className={allow != null && used > allow * 3600000 ? "agentdisc-today-warn" : undefined}>
                            {a === "break" || allow == null ? "" : used >= allow * 3600000 ? `over ${hm(used - allow * 3600000)}` : hm(allow * 3600000 - used)}
                        </span>
                    ];
                })}
            </div>
            <div className="agentdisc-today-note">An allowance is your own weekly aim: when it is used you get a reminder, nothing stops. Empty means not set.</div>
            {error && <div className="agentdisc-today-error">{error}</div>}
        </div>
    );
}

// ---- Plan: the ideal week, and this week on the Plan calendar ----

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function PlanSection({ s, now }: { s: TimeState; now: number; }) {
    const [day, setDay] = useState(((new Date(now).getDay() + 6) % 7) + 1);
    const [error, fail] = useError();
    const template = s.template ?? [];
    // Edits being typed are kept as drafts; every save starts from the saved week with all drafts
    // in it, so adding, removing or copying a block never brings back an older time. A draft
    // leaves once a save that held it went through.
    const [draft, setDraft] = useState<Record<string, Partial<Block>>>({});
    const draftNow = useRef(draft);
    draftNow.current = draft;
    const saveQueue = useRef<Promise<void>>(Promise.resolve());
    const save = (edit: (blocks: Block[]) => Block[]) => {
        const held = draftNow.current;
        const run = async () => {
            // Read after the preceding save has answered, never from the render that queued this
            // click. A failed or lost answer is resolved by this read before another edit is sent.
            const current = await timeCommand("get");
            if (!current.ok || !current.state) return fail(current.error ?? "Could not read the ideal week. Try again.");
            const merged = current.state.template.map(b => held[b.id] ? { ...b, ...held[b.id] } : b);
            const a = await timeCommand("template", { template: edit(merged) });
            if (!a.ok) return fail(a.error === "a block is not valid" ? "Each block needs a start before its end, as hh:mm." : a.error ?? "That did not work.");
            setDraft(d => {
                const n = { ...d };
                for (const [k, v] of Object.entries(held)) if (n[k] === v) delete n[k];
                return n;
            });
        };
        const next = saveQueue.current.then(run, run);
        saveQueue.current = next;
        return next;
    };
    const blocks = template.filter(b => b.day === day).sort((a, b) => a.start.localeCompare(b.start));
    const field = (b: Block, k: keyof Block) => (draft[b.id]?.[k] ?? b[k]) as any;
    const change = (b: Block, patch: Partial<Block>) => {
        const next = { ...draftNow.current, [b.id]: { ...draftNow.current[b.id], ...patch } };
        draftNow.current = next;
        setDraft(next);
    };
    const commit = (b: Block) => {
        if (draftNow.current[b.id]) void save(list => list);
    };
    return (
        <div className="agentdisc-today-section">
            <div className="agentdisc-today-subhead">Ideal week</div>
            <div className="agentdisc-today-days">
                {DAYS.map((d, i) => (
                    <button key={d} type="button" className={"agentdisc-today-day" + (day === i + 1 ? " agentdisc-today-day-on" : "")} onClick={() => setDay(i + 1)}>
                        {d}{template.some(b => b.day === i + 1) && <span className="agentdisc-today-day-mark" aria-hidden="true" />}
                    </button>
                ))}
            </div>
            {!blocks.length && <div className="agentdisc-today-muted">No block on {DAYS[day - 1]} yet.</div>}
            {blocks.map(b => (
                <div key={b.id} className="agentdisc-today-form" onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) commit(b); }}>
                    <TimeInput value={field(b, "start")} onChange={v => change(b, { start: v })} label="From" />
                    <span>–</span>
                    <TimeInput value={field(b, "end")} onChange={v => change(b, { end: v })} label="To" />
                    <ActivitySelect value={field(b, "activity")} onChange={v => { change(b, { activity: v as Activity }); void save(list => list); }} />
                    <label className="agentdisc-today-check" title="A block with your partner">
                        <input type="checkbox" checked={!!field(b, "sally")} onChange={() => { change(b, { sally: !field(b, "sally") }); void save(list => list); }} />Partner
                    </label>
                    <button type="button" className="agentdisc-today-link" aria-label="Remove this block" onClick={() => void save(list => list.filter(x => x.id !== b.id))}>×</button>
                </div>
            ))}
            <div className="agentdisc-today-actions">
                <button type="button" className="agentdisc-today-link" onClick={() => void save(list => {
                    const last = list.filter(b => b.day === day).sort((a, b) => a.start.localeCompare(b.start)).pop();
                    const start = last && /^\d\d:\d\d$/.test(last.end) ? last.end : "09:00";
                    const [h, m] = start.split(":").map(Number);
                    const end = `${String(Math.min(23, h + 1)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
                    return [...list, { id: newId(), day, start, end: end > start ? end : "23:59", activity: "clients" }];
                })}>+ Add a block</button>
                {blocks.length > 0 && <CopyDay day={day} save={save} />}
            </div>
            <ThisWeek s={s} now={now} />
            <Calendars s={s} />
            {error && <div className="agentdisc-today-error">{error}</div>}
        </div>
    );
}

function CopyDay({ day, save }: { day: number; save(edit: (blocks: Block[]) => Block[]): void; }) {
    const [to, setTo] = useState("");
    return (
        <span className="agentdisc-today-copy">
            <select className="agentdisc-today-select" value={to} onKeyDown={stopKeys} onChange={e => setTo(e.currentTarget.value)}>
                <option value="">Copy this day to…</option>
                {DAYS.map((d, i) => i + 1 !== day && <option key={d} value={i + 1}>{d}</option>)}
                <option value="weekdays">every weekday</option>
            </select>
            {to && <button type="button" className="agentdisc-today-link" onClick={() => {
                const targets = to === "weekdays" ? [1, 2, 3, 4, 5].filter(d => d !== day) : [Number(to)];
                save(list => [...list.filter(b => !targets.includes(b.day)), ...targets.flatMap(t => list.filter(b => b.day === day).map(b => ({ ...b, id: newId(), day: t })))]);
                setTo("");
            }}>Copy (replaces that day)</button>}
        </span>
    );
}

// Block ids on the Plan calendar: the week and the template block (only Google's id letters, a to
// v and digits), so putting the week on the calendar twice never doubles a block, a block he
// moved in Google stays where he put it, and one he deleted there does not come back.
function weekKey(t: number) {
    const d = new Date(weekStart(t));
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function ThisWeek({ s, now }: { s: TimeState; now: number; }) {
    const week = weekStart(now);
    const cal = useCalendar(week, week + 7 * DAY, true, s.busy);
    const [result, setResult] = useState<{ placed: number; kept: number; clashes: { id: string; start: number; end: number; activity: Activity; sally: boolean; with: string; }[]; failed: string; } | null>(null);
    const [placing, setPlacing] = useState(false);
    const plan = (cal.day?.plan ?? []).slice().sort((a, b) => ms(a.start) - ms(b.start));
    // Appointments marked free in Google clash with nothing; a busy all-day one (a trip, a day off)
    // covers its whole days.
    const localDay = (date: string) => {
        const [y, m, d] = date.slice(0, 10).split("-").map(Number);
        return new Date(y, m - 1, d).getTime();
    };
    const busy = (cal.day?.events ?? []).filter(e => !e.free).map(e => e.allDay
        ? { start: localDay(e.start), end: localDay(e.end), label: `${e.title ?? "busy"} (all day)` }
        : { start: ms(e.start), end: ms(e.end), label: `${timeOfDay(ms(e.start))}–${timeOfDay(ms(e.end))} ${e.title ?? "busy"}` });
    const clashWith = (start: number, end: number) => busy.find(e => e.start < end && e.end > start);
    // Blocks are placed only against a fresh, complete read of this week's appointments.
    const readOk = !!cal.day && !cal.loading && !cal.error;
    const selection = JSON.stringify(s.busy);
    const latestSelection = useRef(selection);
    latestSelection.current = selection;
    const put = async (id: string, start: number, end: number, activity: Activity, sally: boolean, onlyIfMissing: boolean) =>
        timeCommand("plan", { id, start: new Date(start).toISOString(), end: new Date(end).toISOString(), activity, sally, onlyIfMissing });
    const fill = async () => {
        if (!readOk) return;
        setPlacing(true);
        const out = { placed: 0, kept: 0, clashes: [] as ClashInfo[], failed: "" };
        for (const b of s.template ?? []) {
            if (latestSelection.current !== selection) {
                out.failed = "Your appointment calendars changed. Read them again before placing more blocks.";
                break;
            }
            const dayBase = week + (b.day - 1) * DAY + 3 * 3600000; // a safe hour inside that day
            const start = atTime(dayBase, b.start), end = atTime(dayBase, b.end);
            if (!Number.isFinite(start) || !Number.isFinite(end) || end <= now) continue;
            const id = `p${weekKey(now)}${b.id}`;
            if (plan.some(p => p.id === id)) { out.kept++; continue; }
            const clash = clashWith(start, end);
            if (clash) { out.clashes.push({ id, start, end, activity: b.activity, sally: !!b.sally, with: clash.label }); continue; }
            const a: { ok: boolean; kept?: boolean; error?: string; } = await put(id, start, end, b.activity, !!b.sally, true);
            if (a.ok && a.kept) out.kept++;
            else if (a.ok) out.placed++;
            else { out.failed = a.error ?? "failed"; break; }
        }
        setResult(out);
        setPlacing(false);
        cal.reload();
    };
    return (
        <div className="agentdisc-today-thisweek">
            <div className="agentdisc-today-subhead">This week on your Plan calendar</div>
            {cal.setup ? <CalendarNote cal={cal} /> : (
                <>
                    <button type="button" className="agentdisc-today-btn" disabled={placing || !readOk || !(s.template ?? []).length} onClick={fill} title="Puts the ideal week's blocks from now to Sunday on your AgentDisc Plan calendar; a block that clashes with an appointment is not placed, and blocks already there stay as they are">
                        {placing ? "Placing…" : cal.loading ? "Reading your appointments…" : "Put the ideal week on this week"}
                    </button>
                    {result && (
                        <div className="agentdisc-today-note">
                            {result.placed} placed, {result.kept} already there{result.clashes.length ? `, ${result.clashes.length} clash with an appointment:` : "."}{result.failed && ` Stopped: ${result.failed}`}
                        </div>
                    )}
                    {result?.clashes.map(c => <Clash key={c.id} c={c} put={put} done={placed => {
                        setResult(r => r && { ...r, placed: r.placed + (placed ? 1 : 0), clashes: r.clashes.filter(x => x.id !== c.id) });
                        cal.reload();
                    }} />)}
                    <PlanList plan={plan} reload={cal.reload} />
                    <CalendarNote cal={{ ...cal, setup: false }} />
                </>
            )}
        </div>
    );
}

// A planned block that clashes with an appointment: he moves it, places it anyway, or skips it.
interface ClashInfo { id: string; start: number; end: number; activity: Activity; sally: boolean; with: string; }
function Clash({ c, put, done }: { c: ClashInfo; put(id: string, start: number, end: number, a: Activity, sally: boolean, onlyIfMissing: boolean): Promise<{ ok: boolean; error?: string; }>; done(placed: boolean): void; }) {
    const [moving, setMoving] = useState(false);
    const [form, setForm] = useState({ start: timeOfDay(c.start), end: timeOfDay(c.end) });
    const [error, fail] = useError();
    const place = async (start: number, end: number) => {
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return fail("Write the times as hh:mm, the start first.");
        const a = await put(c.id, start, end, c.activity, c.sally, true);
        if (!a.ok) return fail(a.error ?? "That did not work.");
        done(true);
    };
    return (
        <div className="agentdisc-today-clash">
            <div className="agentdisc-today-piece">
                <Dot activity={c.activity} />
                <span className="agentdisc-today-piece-time">{DAYS[(new Date(c.start).getDay() + 6) % 7]} {timeOfDay(c.start)}–{timeOfDay(c.end)}</span>
                <span className="agentdisc-today-piece-name" title={c.with}>clashes with {c.with}</span>
            </div>
            {moving ? (
                <div className="agentdisc-today-form">
                    <TimeInput value={form.start} onChange={v => setForm(f => ({ ...f, start: v }))} label="From" />
                    <span>–</span>
                    <TimeInput value={form.end} onChange={v => setForm(f => ({ ...f, end: v }))} label="To" />
                    <button type="button" className="agentdisc-today-link" onClick={() => place(atTime(c.start, form.start), atTime(c.start, form.end))}>Place here</button>
                    <button type="button" className="agentdisc-today-link" onClick={() => setMoving(false)}>Cancel</button>
                </div>
            ) : (
                <div className="agentdisc-today-actions">
                    <button type="button" className="agentdisc-today-link" onClick={() => setMoving(true)}>move</button>
                    <button type="button" className="agentdisc-today-link" onClick={() => place(c.start, c.end)}>place anyway</button>
                    <button type="button" className="agentdisc-today-link" onClick={() => done(false)}>skip this week</button>
                </div>
            )}
            {error && <div className="agentdisc-today-error">{error}</div>}
        </div>
    );
}

function PlanList({ plan, reload }: { plan: PlanBlock[]; reload(): void; }) {
    const [editing, setEditing] = useState<string | null>(null);
    const [form, setForm] = useState({ start: "", end: "", activity: "clients", sally: false });
    const [error, fail] = useError();
    if (!plan.length) return <div className="agentdisc-today-muted">No planned block this week yet.</div>;
    return (
        <div className="agentdisc-today-planlist">
            {plan.map(b => {
                const start = ms(b.start), end = ms(b.end);
                if (editing === b.id) return (
                    <div key={b.id} className="agentdisc-today-form">
                        <span>{DAYS[(new Date(start).getDay() + 6) % 7]}</span>
                        <TimeInput value={form.start} onChange={v => setForm(f => ({ ...f, start: v }))} label="From" />
                        <span>–</span>
                        <TimeInput value={form.end} onChange={v => setForm(f => ({ ...f, end: v }))} label="To" />
                        <ActivitySelect value={form.activity} onChange={v => setForm(f => ({ ...f, activity: v }))} />
                        <button type="button" className="agentdisc-today-link" onClick={async () => {
                            const s2 = atTime(start, form.start), e2 = atTime(start, form.end);
                            if (!Number.isFinite(s2) || !Number.isFinite(e2) || e2 <= s2) return fail("Each block needs a start before its end, as hh:mm.");
                            const a = await timeCommand("plan", { id: b.id, start: new Date(s2).toISOString(), end: new Date(e2).toISOString(), activity: form.activity, sally: form.sally });
                            if (!a.ok) return fail(a.error ?? "That did not work.");
                            setEditing(null);
                            reload();
                        }}>Save</button>
                        <button type="button" className="agentdisc-today-link" onClick={() => setEditing(null)}>Cancel</button>
                    </div>
                );
                return (
                    <div key={b.id} className="agentdisc-today-piece">
                        <Dot activity={b.activity} />
                        <span className="agentdisc-today-piece-time">{DAYS[(new Date(start).getDay() + 6) % 7]} {timeOfDay(start)}–{timeOfDay(end)}</span>
                        <span className="agentdisc-today-piece-name">{LABELS[b.activity] ?? "Block"}{b.sally ? " · partner" : ""}</span>
                        <button type="button" className="agentdisc-today-link" onClick={() => { setEditing(b.id); setForm({ start: timeOfDay(start), end: timeOfDay(end), activity: b.activity, sally: !!b.sally }); }}>edit</button>
                        <button type="button" className="agentdisc-today-link" aria-label="Remove this block" onClick={async () => {
                            const a = await timeCommand("plan", { id: b.id, op: "delete" });
                            if (!a.ok) fail(a.error ?? "That did not work.");
                            reload();
                        }}>×</button>
                    </div>
                );
            })}
            {error && <div className="agentdisc-today-error">{error}</div>}
        </div>
    );
}

interface CalendarInfo { id: string; summary: string; primary?: boolean; own?: boolean; }

// Which of his calendars count as appointments in the day and for clashes (read only).
function Calendars({ s }: { s: TimeState; }) {
    const [open, setOpen] = useState(false);
    const [list, setList] = useState<CalendarInfo[] | null>(null);
    const [error, setError] = useState("");
    useEffect(() => {
        if (!open || list) return;
        timeCommand("calendars").then(a => a.ok ? setList(a.calendars) : setError(a.error ?? ""));
    }, [open]);
    const chosen = s.busy;
    const isOn = (c: CalendarInfo) => chosen ? chosen.includes(c.id) : !!c.primary;
    const flip = (c: CalendarInfo) => {
        const now = (list ?? []).filter(x => !x.own && isOn(x)).map(x => x.id);
        const next = now.includes(c.id) ? now.filter(x => x !== c.id) : [...now, c.id];
        void timeCommand("busy", { ids: next });
    };
    return (
        <div className="agentdisc-today-cals">
            <button type="button" className="agentdisc-today-link" onClick={() => setOpen(o => !o)}>{open ? "▾" : "▸"} Calendars that count as appointments</button>
            {open && (list ? list.filter(c => !c.own).map(c => (
                <label key={c.id} className="agentdisc-today-check agentdisc-today-cal">
                    <input type="checkbox" checked={isOn(c)} onChange={() => flip(c)} />{c.summary}{c.primary ? " (main)" : ""}
                </label>
            )) : <div className="agentdisc-today-muted">{error || "Reading your calendars…"}</div>)}
        </div>
    );
}

// ---- Channels: which activity each place of this server belongs to ----

const PLACE_OPTIONS: [string, string][] = [["", "Not assigned"]];
function PlaceSelect({ value, onChange, follow }: { value: Place | null; onChange(p: Place | null): void; follow?: string; }) {
    return (
        <select className="agentdisc-today-select" value={value ?? ""} onKeyDown={stopKeys} onChange={e => onChange((e.currentTarget.value || null) as Place | null)}>
            <option value="">{follow ?? PLACE_OPTIONS[0][1]}</option>
            {WORK.map(a => <option key={a} value={a}>{LABELS[a]}</option>)}
            <option value="always">Always visible</option>
        </select>
    );
}

function ChannelsSection({ guildId }: { guildId: string; }) {
    const [, redraw] = useReducer((n: number) => n + 1, 0);
    const families = useMemo(() => familiesFor(guildId), [guildId]);
    const map = guildMap(guildId);
    const guild = GuildStore.getGuild(guildId);
    const loose = unassignedChannels(guildId);
    const [showLoose, setShowLoose] = useState(false);
    const suggestions = families.filter(f => f.main && !map.categories?.[f.main.id] && suggestionFor(f));
    const after = (fn: () => void) => { fn(); redraw(); };
    return (
        <div className="agentdisc-today-section">
            <div className="agentdisc-today-subhead">Channels of {guild?.name ?? "this server"}</div>
            <div className="agentdisc-today-note">Choosing an activity shows only its channels. Show all, above the channel list, brings the rest back without touching the timer. Right-click any channel, thread or category for its own choice.</div>
            <div className="agentdisc-today-map">
                <span className="agentdisc-today-map-name">Whole server</span>
                <PlaceSelect value={map.server ?? null} onChange={p => after(() => setServerPlace(guildId, p))} />
                {families.map(f => (
                    <React.Fragment key={f.key}>
                        <span className="agentdisc-today-map-name" title={f.archives.length ? `With ${f.archives.length} archive categor${f.archives.length > 1 ? "ies" : "y"}` : undefined}>
                            {f.label}{f.archives.length ? ` +${f.archives.length}` : ""}
                        </span>
                        {f.main ? <PlaceSelect value={map.categories?.[f.main.id] ?? null} follow={map.server ? "Follow the server" : undefined} onChange={p => after(() => setCategoryPlace(guildId, f.main.id, p))} />
                            : <span className="agentdisc-today-muted">archive only</span>}
                    </React.Fragment>
                ))}
            </div>
            {suggestions.length > 0 && (
                <button type="button" className="agentdisc-today-btn" title={suggestions.map(f => `${f.label} → ${LABELS[suggestionFor(f)!]}`).join("\n")} onClick={() => after(() => {
                    for (const f of suggestions) setCategoryPlace(guildId, f.main.id, suggestionFor(f));
                })}>
                    Use suggestions for {suggestions.length} categor{suggestions.length > 1 ? "ies" : "y"}
                </button>
            )}
            {hasAssignments(guildId) && (
                <div className="agentdisc-today-loose">
                    <button type="button" className="agentdisc-today-link" onClick={() => setShowLoose(v => !v)}>
                        {showLoose ? "▾" : "▸"} {loose.length} channel{loose.length === 1 ? "" : "s"} not assigned
                    </button>
                    {showLoose && loose.slice(0, 80).map(id => {
                        const c = ChannelStore.getChannel(id);
                        return (
                            <div key={id} className="agentdisc-today-map agentdisc-today-map-one">
                                <button type="button" className="agentdisc-today-map-name agentdisc-today-link" onClick={() => NavigationRouter.transitionTo(`/channels/${guildId}/${id}`)}>#{c?.name ?? id}</button>
                                <PlaceSelect value={activityOf(id)} onChange={p => after(() => setChannelPlace(guildId, id, p))} />
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// ---- The part ----

export function TodayContent({ guildId }: { guildId: string; }) {
    const s = useTimeState();
    const now = useClock(true);
    const [part, setPart] = useSection();
    const pending = s?.sync?.queue?.length ?? 0;
    return (
        <div className="agentdisc-side agentdisc-today">
            <RunningControl />
            {s && <Reminder s={s} />}
            {s && <Tiles s={s} now={now} />}
            <div className="agentdisc-today-tabs" role="tablist">
                {(["day", "week", "plan", "channels"] as Section[]).map(p => (
                    <button key={p} type="button" role="tab" aria-selected={part === p} className={"agentdisc-today-tab" + (part === p ? " agentdisc-today-tab-on" : "")} onClick={() => setPart(p)}>
                        {p === "day" ? "Day" : p === "week" ? "Week" : p === "plan" ? "Plan" : "Channels"}
                    </button>
                ))}
            </div>
            {s && part === "day" && <DaySection s={s} now={now} />}
            {s && part === "week" && <WeekSection s={s} now={now} />}
            {s && part === "plan" && <PlanSection s={s} now={now} />}
            {part === "channels" && <ChannelsSection guildId={guildId} />}
            {s && (
                <div className={"agentdisc-today-sync" + (s.sync?.error ? " agentdisc-today-warn" : "")}>
                    {pending
                        ? <>{pending} recorded piece{pending > 1 ? "s" : ""} waiting for Google Calendar{s.sync.error ? `: ${s.sync.error}` : ""} <button type="button" className="agentdisc-today-link" onClick={() => timeCommand("sync")}>send now</button></>
                        : s.sync?.at ? "Recorded time is in Google Calendar." : null}
                </div>
            )}
        </div>
    );
}
