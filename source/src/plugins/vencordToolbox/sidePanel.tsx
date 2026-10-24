/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings, useSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { showMembers } from "@plugins/panelSwitches";
import { ChannelStore, NavigationRouter, useEffect, useReducer, useRef, useState } from "@webpack/common";

import { attachSlot, type BoardRole, detachSlot, focusIdeas, hasBoard, onBoardFound, onBoardViews, setFrameLast, showBoard } from "./missionBoard";
import { type DayInfo, dayKey, linksOf, pairsAmong, type PlaceName, placeName, useSideData } from "./sideData";
import { setPeopleOnly, stopTeamList } from "./teamList";

// The right panel (Stephane, 7 Oct), above the member list like Obsidian's side panel:
//   1. a map of the channels linked from this channel, this channel in the middle; a
//      click on a dot opens that channel;
//   2. a calendar marking the days he wrote in the channel or its threads; a click on a
//      marked day opens the channel at that day's first message.

// The map is drawn with force-graph, the library of the Little Brain's map (Stephane,
// 7 Oct). Like Obsidian's graph, the dots float and pull on each other: the wheel zooms,
// dragging the background moves the view, dragging a dot moves it and the dots tied to it
// follow. Tick boxes show channels, threads and names (kept in the settings).
const MAX_DOTS = 60;
// Channels in Discord purple, threads in orange, the open channel in white (Stephane, 7 Oct).
const COLOURS = { centre: "#ffffff", channel: "#5865f2", thread: "#f0883e" };

function short(name: string, max = 22) {
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

interface MapNode {
    id: string;
    name: string;
    kind: "centre" | "channel" | "thread";
    count: number;
    guild: string | null;
    x?: number;
    y?: number;
}

// The library adds its own styles to the page as it loads, so it is loaded only when a map
// is first drawn, never while Discord starts (the page has no head yet then).
let library: Promise<any> | null = null;
function loadForceGraph() {
    // @ts-ignore: a plain browser bundle, used as it is
    return library ??= import("./vendor/force-graph.min.js").then(m => m.default ?? m);
}

type MapOption = "mapChannels" | "mapThreads" | "mapTitles";
function useMapOptions() {
    const read = () => {
        const s = Settings.plugins.VencordToolbox ?? {};
        return { mapChannels: s.mapChannels !== false, mapThreads: s.mapThreads !== false, mapTitles: s.mapTitles !== false };
    };
    const [options, setOptions] = useState(read);
    const flip = (k: MapOption) => {
        Settings.plugins.VencordToolbox[k] = !options[k];
        setOptions(read());
    };
    return { options, flip };
}

// The whole map in view, but never zoomed in further than a little: with one or two dots,
// fitting alone would blow them up to fill the box (Stephane, 7 Oct, on a new channel).
function fit(fg: any, ms: number) {
    if (!fg) return;
    fg.__wake?.(ms + 300);
    fg.zoomToFit(ms, 55);
    const cap = () => {
        if (fg.zoom() > 1.6) fg.zoom(1.6, ms ? 200 : 0);
    };
    if (ms) setTimeout(cap, ms + 50);
    else cap();
}

function LinkMap({ channel }: { channel: any; }) {
    const [ready, setReady] = useState(false);
    const box = useRef<HTMLDivElement>(null);
    const holder = useRef<HTMLDivElement>(null);
    const graph = useRef<any>(null);
    const hover = useRef<string | null>(null);
    const fitted = useRef("");
    const titles = useRef(true);
    const width = useWidth(box);
    const height = Math.round(Math.min(360, Math.max(190, width * 0.85)));
    const { options, flip } = useMapOptions();
    titles.current = options.mapTitles;

    const all = [...linksOf(channel.id)]
        .map(([id, count]) => ({ id, count, place: placeName(id) }))
        .filter(d => d.place)
        .sort((a, b) => b.count - a.count) as { id: string; count: number; place: PlaceName; }[];
    const dots = all
        .filter(d => d.place.thread ? options.mapThreads : options.mapChannels)
        .slice(0, MAX_DOTS);
    const most = Math.max(1, ...dots.map(d => d.count));
    const counts = new Map(dots.map(d => [d.id, d.count]));
    // The map is laid out again only when its dots or lines change, never for a new count,
    // so a dot being dragged is never pulled from under the mouse.
    const shape = channel.id + "|" + dots.map(d => `${d.id}:${d.place.thread ? 1 : 0}:${d.place.name}`).join("|");

    useEffect(() => {
        let fg: any = null;
        let gone = false;
        loadForceGraph().then(ForceGraph => {
            const el = holder.current;
            if (gone || !el) return;
            fg = makeGraph(ForceGraph, el);
            graph.current = fg;
            setReady(true);
        }).catch(() => { });
        return () => {
            gone = true;
            try {
                fg?._destructor?.();
            } catch { }
            if (holder.current) holder.current.innerHTML = "";
            graph.current = null;
        };
    }, []);

    function makeGraph(ForceGraph: any, el: HTMLDivElement) {
        const fg = ForceGraph()(el)
            .backgroundColor("rgba(0,0,0,0)")
            .nodeId("id")
            // No hover box (Stephane, 7 Oct); the hovered dot gets a ring and its name.
            .nodeLabel(() => "")
            .nodeCanvasObject((n: MapNode, ctx: CanvasRenderingContext2D, scale: number) => {
                // Small dots, like Obsidian (Stephane, 7 Oct: "make the circles smaller").
                const r = n.kind === "centre" ? 4.5 : 2 + 2.5 * (n.count / (fg.__most || 1));
                const on = hover.current === n.id;
                ctx.beginPath();
                ctx.arc(n.x!, n.y!, r, 0, 2 * Math.PI);
                ctx.fillStyle = COLOURS[n.kind];
                ctx.fill();
                if (on) {
                    ctx.lineWidth = 2 / scale;
                    ctx.strokeStyle = "#ffffff";
                    ctx.stroke();
                }
                if (titles.current || on || n.kind === "centre") {
                    const size = 12 / scale;
                    ctx.font = `600 ${size}px sans-serif`;
                    ctx.textAlign = "center";
                    ctx.textBaseline = "top";
                    ctx.lineWidth = 3 / scale;
                    ctx.strokeStyle = "rgba(0,0,0,0.85)";
                    const text = short(n.name);
                    const y = n.y! + r + 3 / scale;
                    ctx.strokeText(text, n.x!, y);
                    ctx.fillStyle = on ? "#ffffff" : "rgba(231,233,236,0.95)";
                    ctx.fillText(text, n.x!, y);
                }
            })
            .nodePointerAreaPaint((n: MapNode, color: string, ctx: CanvasRenderingContext2D) => {
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(n.x!, n.y!, 8, 0, 2 * Math.PI);
                ctx.fill();
            })
            .linkColor(() => "rgba(255,255,255,0.18)")
            .linkWidth(1)
            // The layout is worked out before it is shown, so a new channel's map appears in
            // place, with no zoom movement (Stephane, 7 Oct).
            .warmupTicks(150)
            .d3AlphaDecay(0.02)
            .d3VelocityDecay(0.3)
            .cooldownTime(20000)
            .onNodeHover((n: MapNode | null) => {
                hover.current = n?.id ?? null;
                el.style.cursor = n ? "pointer" : "grab";
            })
            .onNodeClick((n: MapNode) => {
                if (n.kind !== "centre") NavigationRouter.transitionTo(`/channels/${n.guild ?? channel.guild_id ?? "@me"}/${n.id}`);
            })
            .onNodeDrag(() => fg.d3ReheatSimulation?.())
            .onEngineStop(() => {
                moving = false;
                rest(0);
            });
        fg.d3Force("charge")?.strength(-80);
        fg.d3Force("link")?.distance(42).strength(0.6);
        // The map's library draws it again on every screen refresh for as long as it is
        // shown, even when nothing moves. It rests once the dots have settled and the mouse
        // is elsewhere, and wakes for the mouse, new dots, a new size or a fit (21 Oct, his
        // lag report).
        let inside = false;
        let moving = true;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const rest = (ms: number) => {
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
                timer = null;
                if (!inside && !moving) fg.pauseAnimation?.();
            }, ms + 600);
        };
        fg.__wake = (ms = 0) => {
            fg.resumeAnimation?.();
            rest(ms);
        };
        fg.__moved = () => {
            moving = true;
            fg.__wake();
        };
        el.addEventListener("pointerenter", () => {
            inside = true;
            fg.__wake();
        });
        el.addEventListener("pointerleave", () => {
            inside = false;
            rest(0);
        });
        return fg;
    }

    useEffect(() => {
        graph.current?.__wake?.();
        graph.current?.width(width).height(height);
    }, [width, height, ready]);

    // New counts change the dots' size without moving anything.
    const fg = graph.current;
    if (fg) {
        fg.__most = most;
        for (const n of fg.graphData().nodes as MapNode[]) if (counts.has(n.id)) n.count = counts.get(n.id)!;
    }

    useEffect(() => {
        const fg = graph.current;
        if (!fg) return;
        const before = new Map<string, MapNode>((fg.graphData().nodes as MapNode[]).map(n => [n.id, n]));
        const keep = (n: MapNode): MapNode => {
            const old = before.get(n.id);
            return old ? Object.assign(old, { name: n.name, kind: n.kind, count: n.count, guild: n.guild }) : n;
        };
        const nodes: MapNode[] = [
            keep({ id: channel.id, name: channel.name, kind: "centre", count: 0, guild: channel.guild_id }),
            ...dots.map(d => keep({ id: d.id, name: d.place.name, kind: d.place.thread ? "thread" : "channel", count: d.count, guild: d.place.guild }))
        ];
        const ids = nodes.map(n => n.id);
        const lines = new Map<string, { source: string; target: string; }>();
        for (const d of dots) lines.set(channel.id + "|" + d.id, { source: channel.id, target: d.id });
        for (const [a, b] of pairsAmong(ids)) {
            if (!lines.has(a + "|" + b) && !lines.has(b + "|" + a)) lines.set(a + "|" + b, { source: a, target: b });
        }
        fg.__most = most;
        fg.__moved?.();
        fg.graphData({ nodes, links: [...lines.values()] });
        // The whole map in view, at once and without movement: for a new channel, and when
        // its first dots arrive; later dots leave the view as he set it.
        const key = `${channel.id}:${dots.length > 0}`;
        if (fitted.current !== key) {
            fitted.current = key;
            const t1 = setTimeout(() => fit(graph.current, 0), 30);
            return () => clearTimeout(t1);
        }
    }, [shape, ready]);


    const hasThreads = all.some(d => d.place.thread);
    return (
        <div className="agentdisc-side-map" ref={box}>
            <div className="agentdisc-side-graph" ref={holder} style={{ height, display: dots.length ? undefined : "none" }} />
            {all.length > 0 && (
                <button type="button" className="agentdisc-side-fit" title="Fit the whole map" onClick={() => fit(graph.current, 400)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
                </button>
            )}
            {!all.length && <div className="agentdisc-side-note">No channel linked with this one yet.</div>}
            {all.length > 0 && !dots.length && <div className="agentdisc-side-note">Tick channels or threads to see them.</div>}
            {all.length > 0 && (
                <div className="agentdisc-side-options">
                    <label><input type="checkbox" checked={options.mapChannels} onChange={() => flip("mapChannels")} /><span className="agentdisc-side-key" />Channels</label>
                    {hasThreads && <label><input type="checkbox" checked={options.mapThreads} onChange={() => flip("mapThreads")} /><span className="agentdisc-side-key agentdisc-side-key-thread" />Threads</label>}
                    <label><input type="checkbox" checked={options.mapTitles} onChange={() => flip("mapTitles")} />Names</label>
                </div>
            )}
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

// The Discord column that holds the panel gets marks of its own, for the few rules that
// shape it. They first found it with :has(), which Chrome checks again for every element on
// every change of the page (21 Oct, part of the lag he reported). Without Team, Discord's
// member list steps aside; with Team, it takes its place and room in the stack.
function useHostMark(ref: React.RefObject<HTMLDivElement | null>, team: { order: number; grow: number; } | null) {
    useEffect(() => {
        const host = ref.current?.parentElement;
        if (!host) return;
        host.dataset.agentdiscSideHost = "";
        if (team) {
            host.dataset.agentdiscTeam = "";
            host.style.setProperty("--agentdisc-team-order", String(team.order));
            host.style.setProperty("--agentdisc-team-grow", String(team.grow));
        } else host.dataset.agentdiscPanelFull = "";
        return () => {
            delete host.dataset.agentdiscSideHost;
            delete host.dataset.agentdiscPanelFull;
            delete host.dataset.agentdiscTeam;
            host.style.removeProperty("--agentdisc-team-order");
            host.style.removeProperty("--agentdisc-team-grow");
        };
    }, [team?.order, team?.grow, team != null]);
}

// The handle on the panel's left edge: drag it to make the column wider or narrower, like
// the channel list (Stephane, 7 Oct). The width is kept.
function ResizeHandle() {
    const onDown = (e: React.MouseEvent) => {
        e.preventDefault();
        const aside = (e.currentTarget as HTMLElement).closest<HTMLElement>("[data-agentdisc-side-host]");
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

// The Calendar view: the map of linked channels and the calendar of his days (7 Oct).
function SideContent({ channel }: { channel: any; }) {
    const { data, reading, crawlLeft } = useSideData(channel.id, channel.guild_id);
    return (
        <div className="agentdisc-side">
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
    widthStyle.textContent = width > 0 ? `[data-agentdisc-side-host]{--custom-member-list-width:${width}px}` : "";
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

// A board part's place; the frame itself lives in missionBoard.ts and is laid over it, so it
// survives every channel switch and every change of the stack. The last part of the stack
// gets the round corner of the Ivory sheet.
function FrameSlot({ role, channelId, threadId, last }: { role: BoardRole; channelId: string; threadId: string | null; last: boolean; }) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const element = ref.current!;
        attachSlot(role, element);
        return () => detachSlot(role, element);
    }, []);
    useEffect(() => showBoard(role, channelId, threadId), [channelId, threadId]);
    useEffect(() => setFrameLast(role, last), [last]);
    return <div className="agentdisc-board-slot" ref={ref} />;
}

// The right panel made of parts (Stephane, 24 Oct: "I could decide to display each of them on
// their own or stack them, with the possibility of moving up and down to choose the room they
// take"). Four parts, each switched on or off by its button at the top of the panel:
//   Board     the channel's mission board (14 Oct)
//   Ideas     the board's page where he drops an idea on the fly; the board sends it to the
//             right channel and shows when that channel took it (its own frame)
//   Team      Discord's own member list, people only, no bots (teamList.ts)
//   Calendar  the map of linked channels and the calendar of his days (7 Oct)
// One part on fills the panel; several stack in the order of the buttons. Dragging a button
// moves its part up or down; dragging the line between two parts shares the room between
// them; a double click shows that part alone. All of it is kept. Board and Ideas show only
// where the board is set up, and Ideas only once the board says it has that page.
export type Part = "board" | "ideas" | "team" | "calendar";
const PARTS: Part[] = ["board", "ideas", "team", "calendar"];
const LABELS: Record<Part, string> = { board: "Board", ideas: "Ideas", team: "Team", calendar: "Calendar" };
const TITLES: Record<Part, string> = {
    board: "This channel's board",
    ideas: "Drop an idea (Ctrl+J)",
    team: "The people in this server",
    calendar: "Linked channels and your days"
};
const HINT = "Click: show or hide. Double click: only this one. Drag: move it up or down.";
const MIN_PART = 60;

interface Layout { order: Part[]; on: Part[]; sizes: Partial<Record<Part, number>>; }

const isPart = (p: unknown): p is Part => PARTS.includes(p as Part);
const list = (text: unknown) => [...new Set(String(text ?? "").split(",").filter(isPart))];

function readLayout(): Layout {
    const s = Settings.plugins.VencordToolbox ?? {};
    const order = list(s.rightPanelOrder);
    for (const p of PARTS) if (!order.includes(p)) order.push(p);
    // First time: the one view of 1.34, or the older board switch (on: Board, off: Calendar).
    const on = s.rightPanelOn ? list(s.rightPanelOn) : [isPart(s.rightPanelMode) ? s.rightPanelMode : s.rightPanelBoard !== false ? "board" : "calendar"];
    const sizes: Layout["sizes"] = {};
    for (const pair of String(s.rightPanelSizes ?? "").split(",")) {
        const [p, w] = pair.split(":");
        const n = Number(w);
        if (isPart(p) && n > 0.05 && n < 20) sizes[p] = n;
    }
    return { order, on, sizes };
}

function saveLayout(next: Layout) {
    const s = Settings.plugins.VencordToolbox;
    s.rightPanelOrder = next.order.join(",");
    s.rightPanelOn = next.on.join(",");
    s.rightPanelSizes = Object.entries(next.sizes).map(([p, w]) => `${p}:${Math.round(w! * 100) / 100}`).join(",");
}

const grow = (layout: Layout, p: Part) => layout.sizes[p] ?? 1;

function available(p: Part, board: boolean, ideas: boolean) {
    return p === "board" ? board : p === "ideas" ? ideas : true;
}

function shownParts(layout: Layout, board: boolean, ideas: boolean): Part[] {
    const shown = layout.order.filter(p => layout.on.includes(p) && available(p, board, ideas));
    // Nothing it can show (Ideas from a board that lacks it, or no board on this computer).
    return shown.length ? shown : [board ? "board" : "calendar"];
}

function boardOffersIdeas() {
    return String(Settings.plugins.VencordToolbox?.boardViews ?? "").split(",").includes("ideas");
}

// Ctrl+J: Ideas switched on (the other parts stay), the right panel opened if needed, and the
// cursor in the idea box.
export function openIdeas() {
    if (!hasBoard()) return false;
    showMembers();
    const layout = readLayout();
    if (!layout.on.includes("ideas")) saveLayout({ ...layout, on: [...layout.on, "ideas"] });
    focusIdeas();
    return true;
}

function ModeBar({ layout, shown, board, ideas }: { layout: Layout; shown: Part[]; board: boolean; ideas: boolean; }) {
    const [dragged, setDragged] = useState<Part | null>(null);
    const parts = layout.order.filter(p => available(p, board, ideas));
    const toggle = (p: Part) => {
        if (shown.includes(p)) {
            // The last part shown stays: the panel is never empty.
            if (shown.length === 1) return;
            saveLayout({ ...layout, on: layout.on.filter(x => x !== p) });
        } else {
            saveLayout({ ...layout, on: [...layout.on.filter(x => x !== p), p] });
            if (p === "ideas") focusIdeas();
        }
    };
    const alone = (p: Part) => {
        saveLayout({ ...layout, on: [p] });
        if (p === "ideas") focusIdeas();
    };
    const drop = (target: Part, after: boolean) => {
        if (!dragged || dragged === target) return;
        const order = layout.order.filter(p => p !== dragged);
        order.splice(order.indexOf(target) + (after ? 1 : 0), 0, dragged);
        saveLayout({ ...layout, order });
    };
    return (
        <div className="agentdisc-modes" role="toolbar" aria-label="Right panel">
            {parts.map(p => (
                <button
                    key={p}
                    type="button"
                    aria-pressed={shown.includes(p)}
                    title={`${TITLES[p]}. ${HINT}`}
                    draggable
                    className={"agentdisc-mode" + (shown.includes(p) ? " agentdisc-mode-on" : "") + (dragged === p ? " agentdisc-mode-dragged" : "")}
                    onClick={() => toggle(p)}
                    onDoubleClick={() => alone(p)}
                    onDragStart={e => {
                        setDragged(p);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", p);
                    }}
                    onDragEnd={() => setDragged(null)}
                    onDragOver={e => {
                        if (!dragged) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={e => {
                        e.preventDefault();
                        const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        drop(p, e.clientX > box.left + box.width / 2);
                        setDragged(null);
                    }}
                >
                    {LABELS[p]}
                </button>
            ))}
        </div>
    );
}

// The line between two stacked parts: dragged up or down, it shares their room.
function Divider({ order, above, below, layout }: { order: number; above: Part; below: Part; layout: Layout; }) {
    const onDown = (e: React.MouseEvent) => {
        e.preventDefault();
        const host = (e.currentTarget as HTMLElement).parentElement;
        if (!host) return;
        const element = (p: Part) => p === "team"
            ? host.querySelector<HTMLElement>(":scope > :not(.agentdisc-own)")
            : host.querySelector<HTMLElement>(`:scope > .agentdisc-part-${p}`);
        const top = element(above);
        const bottom = element(below);
        if (!top || !bottom) return;
        const h1 = top.getBoundingClientRect().height;
        const h2 = bottom.getBoundingClientRect().height;
        const total = h1 + h2;
        const weight = grow(layout, above) + grow(layout, below);
        if (total < 2 * MIN_PART) return;
        const start = e.clientY;
        let w1 = grow(layout, above);
        const apply = (p: Part, el: HTMLElement, w: number) => {
            if (p === "team") host.style.setProperty("--agentdisc-team-grow", String(w));
            else el.style.flexGrow = String(w);
        };
        const move = (ev: MouseEvent) => {
            const next = Math.min(total - MIN_PART, Math.max(MIN_PART, h1 + ev.clientY - start));
            w1 = weight * next / total;
            apply(above, top, w1);
            apply(below, bottom, weight - w1);
        };
        const up = () => {
            document.removeEventListener("mousemove", move);
            document.removeEventListener("mouseup", up);
            document.documentElement.classList.remove("agentdisc-row-resizing");
            const now = readLayout();
            saveLayout({ ...now, sizes: { ...now.sizes, [above]: w1, [below]: weight - w1 } });
        };
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", up);
        document.documentElement.classList.add("agentdisc-row-resizing");
    };
    return <div className="agentdisc-own agentdisc-divider" style={{ order }} onMouseDown={onDown} title="Drag to share the room" />;
}

function RightPanel({ channel, threadId }: { channel: any; threadId: string | null; }) {
    const [, redraw] = useReducer((n: number) => n + 1, 0);
    useEffect(() => onBoardFound(redraw), []);
    useSettings(["plugins.VencordToolbox.rightPanelOrder", "plugins.VencordToolbox.rightPanelOn", "plugins.VencordToolbox.rightPanelSizes", "plugins.VencordToolbox.rightPanelMode", "plugins.VencordToolbox.rightPanelBoard", "plugins.VencordToolbox.boardViews"]);
    const board = hasBoard();
    const ideas = board && boardOffersIdeas();
    const layout = readLayout();
    const shown = shownParts(layout, board, ideas);
    // Order: the buttons first, then each part with a line before it from the second on.
    const orderOf = (i: number) => 10 + 2 * i;
    const teamAt = shown.indexOf("team");
    const ref = useRef<HTMLDivElement>(null);
    useHostMark(ref, teamAt < 0 ? null : { order: orderOf(teamAt), grow: grow(layout, "team") });
    useEffect(() => setPeopleOnly(teamAt >= 0), [teamAt >= 0]);
    const last = shown[shown.length - 1];
    return (
        <>
            <div className="agentdisc-own agentdisc-panel-bar" ref={ref}>
                <ResizeHandle />
                <ModeBar layout={layout} shown={shown} board={board} ideas={ideas} />
            </div>
            {shown.flatMap((p, i) => [
                i > 0 ? <Divider key={`line-${p}`} order={orderOf(i) - 1} above={shown[i - 1]} below={p} layout={layout} /> : null,
                p === "team" ? null : (
                    <div key={p} className={`agentdisc-own agentdisc-part agentdisc-part-${p}`} style={{ order: orderOf(i), flexGrow: grow(layout, p) }}>
                        {p === "calendar"
                            ? <SideContent channel={channel} />
                            : <FrameSlot role={p} channelId={channel.id} threadId={threadId} last={p === last} />}
                    </div>
                )
            ])}
        </>
    );
}

// The board's word about its pages is kept, so the Ideas button shows from the start next time.
let unhook: (() => void)[] = [];

export function startPanelModes() {
    unhook = [
        onBoardViews(views => {
            const next = views.join(",");
            if (Settings.plugins.VencordToolbox.boardViews !== next) Settings.plugins.VencordToolbox.boardViews = next;
        })
    ];
}

export function stopPanelModes() {
    unhook.forEach(fn => fn());
    unhook = [];
    stopTeamList();
}

// In a thread, the panel shows its channel (Stephane, 7 Oct: the panel vanished in threads),
// and the board marks the thread's card.
export function renderSidePanel(channel: any) {
    let threadId: string | null = null;
    if (channel?.isThread?.()) {
        threadId = channel.id;
        channel = ChannelStore.getChannel(channel.parent_id);
    }
    if (!channel?.id || !channel.guild_id) return null;
    return (
        <ErrorBoundary noop key="agentdisc-side">
            <RightPanel channel={channel} threadId={threadId} />
        </ErrorBoundary>
    );
}
