/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { NavigationRouter, useEffect, useRef, useState } from "@webpack/common";

import { type DayInfo, dayKey, linksOf, type PlaceName, placeName, useSideData } from "./sideData";

// The right panel (Stephane, 7 Oct), above the member list like Obsidian's side panel:
//   1. a map of the channels linked from this channel, this channel in the middle; a
//      click on a dot opens that channel;
//   2. a calendar marking the days he wrote in the channel or its threads; a click on a
//      marked day opens the channel at that day's first message.

const MAX_DOTS = 18;
// With many dots, only the most linked ones keep their name; the others show it on hover.
const LABELS = 8;

function short(name: string, max = 16) {
    return name.length > max ? name.slice(0, max - 1) + "…" : name;
}

// The panel's own width, to draw the map across it.
function useWidth(ref: React.RefObject<HTMLDivElement | null>) {
    const [width, setWidth] = useState(224);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        // The map follows the column's width and never sets it.
        const ro = new ResizeObserver(() => setWidth(Math.max(160, Math.round(el.getBoundingClientRect().width))));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    return width;
}

function LinkMap({ channel }: { channel: any; }) {
    const [hover, setHover] = useState<string | null>(null);
    const ref = useRef<HTMLDivElement>(null);
    const width = useWidth(ref);
    const height = Math.round(Math.min(300, Math.max(150, width * 0.75)));

    const dots = [...linksOf(channel.id)]
        .map(([id, count]) => ({ id, count, place: placeName(id) }))
        .filter(d => d.place)
        .sort((a, b) => b.count - a.count)
        .slice(0, MAX_DOTS) as { id: string; count: number; place: PlaceName; }[];

    const cx = width / 2, cy = height / 2;
    const rx = width / 2 - 34, ry = height / 2 - 26;
    const most = Math.max(1, ...dots.map(d => d.count));
    const placed = dots.map((d, i) => {
        const angle = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(dots.length, 1);
        return { ...d, x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle), r: 3 + 3 * (d.count / most) };
    });
    const go = (d: { id: string; place: PlaceName; }) => NavigationRouter.transitionTo(`/channels/${d.place.guild ?? channel.guild_id ?? "@me"}/${d.id}`);
    const threads = dots.some(d => d.place.thread);

    return (
        <div className="agentdisc-side-map" ref={ref}>
            <svg viewBox={`0 0 ${width} ${height}`} className="agentdisc-side-svg">
                {placed.map(d => (
                    <line key={"l" + d.id} x1={cx} y1={cy} x2={d.x} y2={d.y} className={"agentdisc-side-line" + (hover === d.id ? " agentdisc-side-on" : "")} />
                ))}
                {placed.map((d, i) => (
                    <g
                        key={d.id}
                        className={"agentdisc-side-dot" + (d.place.thread ? " agentdisc-side-thread" : "") + (hover === d.id ? " agentdisc-side-on" : "")}
                        onMouseEnter={() => setHover(d.id)}
                        onMouseLeave={() => setHover(null)}
                        onClick={() => go(d)}
                    >
                        <title>{`${d.place.thread ? "Thread" : "Channel"}: ${d.place.name} (${d.count} link${d.count > 1 ? "s" : ""})`}</title>
                        <circle cx={d.x} cy={d.y} r={d.r + 6} fill="transparent" />
                        <circle cx={d.x} cy={d.y} r={d.r} />
                        {(i < LABELS || hover === d.id) && <text x={d.x} y={d.y + d.r + 11} textAnchor="middle">{short(d.place.name, Math.round(Math.min(28, Math.max(14, width / 14))))}</text>}
                    </g>
                ))}
                <circle cx={cx} cy={cy} r={8} className="agentdisc-side-centre">
                    <title>{channel.name}</title>
                </circle>
            </svg>
            {!dots.length && <div className="agentdisc-side-note">No channel linked with this one yet.</div>}
            {threads && <div className="agentdisc-side-legend"><span className="agentdisc-side-key" /> channel <span className="agentdisc-side-key agentdisc-side-key-thread" /> thread</div>}
        </div>
    );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

// The ISO week number of a date (the week of its Monday).
function isoWeek(d: Date) {
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function Calendar({ channel, days }: { channel: any; days: Record<string, DayInfo>; }) {
    const today = new Date();
    const [shift, setShift] = useState(0);
    const first = new Date(today.getFullYear(), today.getMonth() + shift, 1);
    const month = first.getMonth();
    const start = new Date(first);
    start.setDate(1 - first.getDay());

    const weeks: Date[][] = [];
    for (let w = 0; w < 6; w++) {
        const row: Date[] = [];
        for (let i = 0; i < 7; i++) row.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + w * 7 + i));
        weeks.push(row);
    }
    const todayKey = dayKey(today);

    const open = (info: DayInfo) => {
        const guild = channel.guild_id ?? "@me";
        if (info.main) NavigationRouter.transitionTo(`/channels/${guild}/${channel.id}/${info.main}`);
        else if (info.any) NavigationRouter.transitionTo(`/channels/${guild}/${info.any[0]}/${info.any[1]}`);
    };

    return (
        <div className="agentdisc-side-cal">
            <div className="agentdisc-side-cal-head">
                <span className="agentdisc-side-cal-title">{MONTHS[month]} {first.getFullYear()}</span>
                <span className="agentdisc-side-cal-nav">
                    <button type="button" aria-label="Previous month" onClick={() => setShift(s => s - 1)}>‹</button>
                    <button type="button" onClick={() => setShift(0)}>TODAY</button>
                    <button type="button" aria-label="Next month" onClick={() => setShift(s => s + 1)}>›</button>
                </span>
            </div>
            <div className="agentdisc-side-cal-grid">
                <span className="agentdisc-side-cal-wk">W</span>
                {WEEKDAYS.map(d => <span key={d} className="agentdisc-side-cal-wd">{d}</span>)}
                {weeks.map(row => [
                    <span key={"w" + row[1].getTime()} className="agentdisc-side-cal-wk">{isoWeek(row[1])}</span>,
                    ...row.map(d => {
                        const k = dayKey(d);
                        const info = days[k];
                        const marked = !!info && info.mine > 0;
                        const cls = "agentdisc-side-cal-day"
                            + (d.getMonth() !== month ? " agentdisc-side-cal-out" : "")
                            + (k === todayKey ? " agentdisc-side-cal-today" : "")
                            + (marked ? " agentdisc-side-cal-marked" : "");
                        return (
                            <span
                                key={k}
                                className={cls}
                                title={marked ? `${info.mine} message${info.mine > 1 ? "s" : ""} from you` : undefined}
                                onClick={marked ? () => open(info) : undefined}
                            >
                                {d.getDate()}
                            </span>
                        );
                    })
                ])}
            </div>
        </div>
    );
}

// The handle on the panel's left edge: drag it to make the column wider or narrower, like
// the channel list (Stephane, 7 Oct). The width is kept.
function ResizeHandle() {
    const onDown = (e: React.MouseEvent) => {
        e.preventDefault();
        const aside = (e.currentTarget as HTMLElement).closest<HTMLElement>('[class*="membersWrap_"]');
        const start = e.clientX;
        const startWidth = aside?.getBoundingClientRect().width ?? 240;
        let width = startWidth;
        const move = (ev: MouseEvent) => {
            width = Math.round(Math.min(640, Math.max(200, startWidth + start - ev.clientX)));
            setRightPanelWidth(width, false);
        };
        const up = () => {
            document.removeEventListener("mousemove", move);
            document.removeEventListener("mouseup", up);
            document.documentElement.classList.remove("agentdisc-resizing");
            setRightPanelWidth(width, true);
        };
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", up);
        document.documentElement.classList.add("agentdisc-resizing");
    };
    return <div className="agentdisc-side-resize" onMouseDown={onDown} title="Drag to resize" />;
}

function SidePanel({ channel }: { channel: any; }) {
    const { data, reading, crawlLeft } = useSideData(channel.id, channel.guild_id);
    return (
        <div className="agentdisc-side">
            <ResizeHandle />
            <LinkMap channel={channel} />
            <Calendar channel={channel} days={data?.days ?? {}} />
            {reading && <div className="agentdisc-side-note agentdisc-side-reading">Reading the channel…</div>}
            {!reading && crawlLeft > 0 && <div className="agentdisc-side-note agentdisc-side-reading">Looking for links in other channels ({crawlLeft} left)…</div>}
        </div>
    );
}

// The column's width, kept in the AgentDisc settings; Discord sizes the member list from
// one width value, which is set here.
let widthStyle: HTMLStyleElement | null = null;

export function setRightPanelWidth(width: number, keep: boolean) {
    widthStyle ??= document.head.appendChild(Object.assign(document.createElement("style"), { id: "agentdisc-right-width" }));
    widthStyle.textContent = width > 0 ? `[class*="membersWrap_"]:has(> .agentdisc-side){--custom-member-list-width:${width}px}` : "";
    if (keep) Settings.plugins.VencordToolbox.rightPanelWidth = width;
}

export function startRightPanelWidth() {
    const width = Settings.plugins.VencordToolbox?.rightPanelWidth;
    if (typeof width === "number" && width > 0) setRightPanelWidth(width, false);
}

export function stopRightPanelWidth() {
    widthStyle?.remove();
    widthStyle = null;
}

export function renderSidePanel(channel: any) {
    if (!channel?.id || !channel.guild_id || channel.isThread?.()) return null;
    return (
        <ErrorBoundary noop key="agentdisc-side">
            <SidePanel channel={channel} />
        </ErrorBoundary>
    );
}
