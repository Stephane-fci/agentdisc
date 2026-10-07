/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { ChannelStore, NavigationRouter, useMemo, useState } from "@webpack/common";

import { type DayInfo, dayKey, useSideData } from "./sideData";

// The right panel (Stephane, 7 Oct), above the member list like Obsidian's side panel:
//   1. a map of the channels linked from this channel, this channel in the middle; a
//      click on a dot opens that channel;
//   2. a calendar marking the days he wrote in the channel or its threads; a click on a
//      marked day opens the channel at that day's first message.

const MAX_DOTS = 18;
// With many dots, only the most linked ones keep their name; the others show it on hover.
const LABELS = 8;
const WIDTH = 224;
const HEIGHT = 168;

function short(name: string, max = 16) {
    return name.length > max ? name.slice(0, max - 1) + "…" : name;
}

function LinkMap({ channel, links }: { channel: any; links: Record<string, number>; }) {
    const [hover, setHover] = useState<string | null>(null);
    const dots = useMemo(() => Object.entries(links)
        .map(([id, count]) => ({ id, count, channel: ChannelStore.getChannel(id) }))
        .filter(d => d.channel?.name)
        .sort((a, b) => b.count - a.count)
        .slice(0, MAX_DOTS), [links]);

    const cx = WIDTH / 2, cy = HEIGHT / 2;
    const rx = WIDTH / 2 - 34, ry = HEIGHT / 2 - 26;
    const most = Math.max(1, ...dots.map(d => d.count));
    const placed = dots.map((d, i) => {
        const angle = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(dots.length, 1);
        return { ...d, x: cx + rx * Math.cos(angle), y: cy + ry * Math.sin(angle), r: 3 + 3 * (d.count / most) };
    });
    const go = (c: any) => NavigationRouter.transitionTo(`/channels/${c.guild_id ?? "@me"}/${c.id}`);

    return (
        <div className="agentdisc-side-map">
            <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
                {placed.map(d => (
                    <line key={"l" + d.id} x1={cx} y1={cy} x2={d.x} y2={d.y} className={"agentdisc-side-line" + (hover === d.id ? " agentdisc-side-on" : "")} />
                ))}
                {placed.map((d, i) => (
                    <g
                        key={d.id}
                        className={"agentdisc-side-dot" + (hover === d.id ? " agentdisc-side-on" : "")}
                        onMouseEnter={() => setHover(d.id)}
                        onMouseLeave={() => setHover(null)}
                        onClick={() => go(d.channel)}
                    >
                        <title>{`${d.channel.name} (${d.count})`}</title>
                        <circle cx={d.x} cy={d.y} r={d.r + 6} fill="transparent" />
                        <circle cx={d.x} cy={d.y} r={d.r} />
                        {(i < LABELS || hover === d.id) && <text x={d.x} y={d.y + d.r + 11} textAnchor="middle">{short(d.channel.name)}</text>}
                    </g>
                ))}
                <circle cx={cx} cy={cy} r={8} className="agentdisc-side-centre">
                    <title>{channel.name}</title>
                </circle>
            </svg>
            {!dots.length && <div className="agentdisc-side-note">No other channel linked here yet.</div>}
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
                <span className="agentdisc-side-cal-title">{MONTHS[month]} <span className="agentdisc-side-cal-year">{first.getFullYear()}</span></span>
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

function SidePanel({ channel }: { channel: any; }) {
    const { data, reading } = useSideData(channel.id, channel.guild_id);
    return (
        <div className="agentdisc-side">
            <LinkMap channel={channel} links={data?.links ?? {}} />
            <Calendar channel={channel} days={data?.days ?? {}} />
            {reading && !data?.places[channel.id]?.complete && <div className="agentdisc-side-note agentdisc-side-reading">Reading the channel…</div>}
        </div>
    );
}

export function renderSidePanel(channel: any) {
    if (!channel?.id || !channel.guild_id || channel.isThread?.()) return null;
    return (
        <ErrorBoundary noop key="agentdisc-side">
            <SidePanel channel={channel} />
        </ErrorBoundary>
    );
}
