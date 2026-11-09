/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Today's day on FullCalendar's standard day view (6.1.22, MIT: core, timegrid, interaction), run
// with its plain constructor in a box the panel gives it, so no second React comes in. His words on
// 1.48.0 (9 Nov 2026): "When I click on an object, it zooms in a really weird way. When I zoom in or
// out with the mouse wheel, it's buggy and I can't properly move things ... I can't click on one
// that is too small. Maybe you can look into a library for [calendar]".
//
// The library draws the hours and does the dragging and stretching; what a block may do stays ours:
// what he recorded never overlaps other recorded time and never ends after now, what records moves
// only its start, planned blocks move freely, his appointments never move. A plain click selects;
// zoom is separate (− and +, or Ctrl and the wheel) and keeps the hour under the mouse. Every change
// goes to the panel (onChange), which sends it through the commands it always used and puts the
// block back if that fails.
import type { EventApi, EventInput } from "@fullcalendar/core";

export type DayKind = "plan" | "piece" | "running" | "appt";

export interface DayBlock {
    key: string; // unique across kinds: "plan:<id>", "piece:<id>", "running", "appt:<n>"
    kind: DayKind;
    id: string;
    start: number;
    end: number;
    title: string;
    colour?: string;
    activity?: string;
    sally?: boolean;
    free?: boolean;
}

export interface DayOptions {
    dayStart: number;
    now(): number;
    scale: number; // pixels an hour
    least: number;
    most: number;
    onScale(scale: number): void;
    onSelect(key: string | null): void;
    onChange(block: DayBlock, start: number, end: number): void;
    onTimes(block: DayBlock): void;
}

export interface DayHandle {
    update(blocks: DayBlock[], selected: string | null): void;
    zoomBy(factor: number): void;
    scale(): number;
    destroy(): void;
}

const HOUR = 3600000, MIN = 60000;
const GRIP = 16; // the least height of a block, so a short one can be hit; its real length is drawn inside

const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (t: number) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

// "#4f8cff" at a strength: the plan's see-through colour.
function faint(hex = "#888888", strength = 0.18) {
    const n = parseInt(hex.slice(1), 16);
    return `rgb(${n >> 16 & 255} ${n >> 8 & 255} ${n & 255} / ${Math.round(strength * 100)}%)`;
}

// The library is loaded the first time the day is shown, not with AgentDisc: on loading it adds its
// stylesheet to the page's head, and AgentDisc starts before the page has one (9 Nov 2026: loaded with
// AgentDisc, that stopped all of Vencord on Discord's page). Loaded once, kept for every later day.
let library: Promise<{ Calendar: typeof import("@fullcalendar/core").Calendar; plugins: any[]; }> | null = null;
function load() {
    return library ??= Promise.all([import("@fullcalendar/core"), import("@fullcalendar/timegrid"), import("@fullcalendar/interaction")])
        .then(([core, timeGrid, interaction]) => ({ Calendar: core.Calendar, plugins: [timeGrid.default, interaction.default] }));
}

export async function mountDay(el: HTMLElement, o: DayOptions): Promise<DayHandle> {
    const { Calendar, plugins } = await load();
    let { scale } = o;
    let blocks: DayBlock[] = [];
    let selected: string | null = null;
    let dragging = false;
    let pending: { blocks: DayBlock[]; selected: string | null; } | null = null;
    let lastClick: { x: number; y: number; } | null = null;
    let gone = false;
    const byKey = () => new Map(blocks.map(b => [b.key, b]));
    const kindOf = (e: EventApi) => e.extendedProps.kind as DayKind;
    const recorded = (e: EventApi) => kindOf(e) === "piece" || kindOf(e) === "running";

    el.classList.add("agentdisc-day");
    el.style.setProperty("--agentdisc-day-slot", `${scale / 4}px`);

    const input = (b: DayBlock): EventInput => ({
        id: b.key,
        title: b.title,
        start: new Date(b.start),
        end: new Date(b.end),
        editable: b.kind !== "appt",
        startEditable: b.kind === "plan" || b.kind === "piece",
        durationEditable: b.kind !== "appt",
        backgroundColor: b.kind === "plan" ? faint(b.colour) : b.kind === "appt" ? "transparent" : b.colour,
        borderColor: b.colour ?? "transparent",
        extendedProps: { kind: b.kind, selected: b.key === selected, free: !!b.free, colour: b.colour }
    });

    const cal = new Calendar(el, {
        plugins,
        initialView: "timeGridDay",
        initialDate: new Date(o.dayStart),
        now: () => new Date(o.now()),
        headerToolbar: false,
        dayHeaders: false,
        allDaySlot: false,
        height: "100%",
        nowIndicator: true,
        slotDuration: "00:15:00",
        snapDuration: "00:05:00",
        slotLabelInterval: "01:00",
        slotLabelFormat: { hour: "2-digit", hour12: false },
        scrollTime: hhmm(Math.max(o.dayStart, o.now() - 2 * HOUR)) + ":00",
        scrollTimeReset: false,
        editable: true,
        eventResizableFromStart: true,
        eventDragMinDistance: 4,
        dragScroll: true,
        eventMinHeight: GRIP,
        eventShortHeight: 0,
        slotEventOverlap: true,
        // His time never overlaps itself; plan and appointments may lie over anything.
        eventOverlap: (still, moving) => !(still && moving && recorded(still) && recorded(moving)),
        eventAllow: (span, ev) => {
            if (!ev) return false;
            const k = kindOf(ev), t = o.now(), start = span.start.getTime(), end = span.end.getTime();
            // Nothing moves into the day before, except a block that began then keeping its own start.
            if (start < o.dayStart && start !== ev.start?.getTime()) return false;
            if (k === "piece") return end <= t;
            if (k === "running") return end === ev.end?.getTime() && start <= t - MIN;
            return k === "plan";
        },
        eventClassNames: a => [`agentdisc-day-${kindOf(a.event)}`, ...(a.event.extendedProps.selected ? ["agentdisc-day-selected"] : []), ...(a.event.extendedProps.free ? ["agentdisc-day-free"] : [])],
        eventContent: a => {
            const e = a.event, k = kindOf(e);
            const wrap = document.createElement("div");
            wrap.className = "agentdisc-day-inner";
            const len = (e.end?.getTime() ?? e.start!.getTime()) - e.start!.getTime();
            if (k !== "appt" && len / HOUR * scale < GRIP) {
                // Short: the solid bar is its real length; the faint rest is only there to be grabbed.
                const bar = document.createElement("div");
                bar.className = "agentdisc-day-true";
                bar.style.height = `${Math.max(len / HOUR * scale, 1)}px`;
                bar.style.background = e.extendedProps.colour ?? "#fff";
                wrap.append(bar);
                wrap.classList.add("agentdisc-day-short");
            }
            const name = document.createElement("span");
            name.className = k === "appt" ? "agentdisc-day-tab" : "agentdisc-day-name";
            name.textContent = e.title;
            wrap.append(name);
            // The times: on the selected block a button that opens the typed times, and on the
            // moving copy while dragging, so what will be saved is what is shown.
            if (a.isMirror || (e.extendedProps.selected && k !== "appt")) {
                const times = document.createElement(a.isMirror ? "span" : "button");
                times.className = "agentdisc-day-times";
                times.textContent = `${hhmm(e.start!.getTime())}–${e.end ? hhmm(e.end.getTime()) : ""}`;
                if (!a.isMirror) { (times as HTMLButtonElement).type = "button"; times.title = "Type the times"; }
                wrap.append(times);
            }
            return { domNodes: [wrap] };
        },
        eventDidMount: a => {
            a.el.dataset.key = a.event.id;
            a.el.closest(".fc-timegrid-event-harness")?.setAttribute("data-kind", kindOf(a.event));
            a.el.title = kindOf(a.event) === "appt" ? `${a.event.title}, ${hhmm(a.event.start!.getTime())}–${hhmm(a.event.end!.getTime())}` : "";
        },
        // A plain click selects, nothing else: no zoom, no scroll. A click again on the same spot picks
        // the next block underneath, so a plan under recorded time stays reachable.
        eventClick: a => {
            const b = byKey().get(a.event.id);
            if (!b) return;
            if ((a.jsEvent.target as Element).closest?.(".agentdisc-day-times")) return o.onTimes(b);
            const { clientX: x, clientY: y } = a.jsEvent;
            const stack = [...new Set(document.elementsFromPoint(x, y).map(n => (n.closest?.(".fc-event") as HTMLElement | null)?.dataset.key).filter((k): k is string => !!k))];
            const again = lastClick && Math.abs(lastClick.x - x) < 4 && Math.abs(lastClick.y - y) < 4 && selected && stack.includes(selected);
            lastClick = { x, y };
            o.onSelect(again ? stack[(stack.indexOf(selected!) + 1) % stack.length] : b.key);
        },
        eventDragStart: () => { dragging = true; },
        eventResizeStart: () => { dragging = true; },
        eventDragStop: () => settle(),
        eventResizeStop: () => settle(),
        eventDrop: a => changed(a.event),
        eventResize: a => changed(a.event),
        events: []
    });

    function changed(e: EventApi) {
        const b = byKey().get(e.id);
        if (!b || !e.start || !e.end) return;
        o.onChange(b, e.start.getTime(), e.end.getTime());
    }

    // Changes that came in while a block was in the hand wait until it is let go.
    function settle() {
        dragging = false;
        setTimeout(() => { if (!gone && pending) { const p = pending; pending = null; apply(p.blocks, p.selected); } }, 0);
    }

    function apply(next: DayBlock[], sel: string | null) {
        blocks = next;
        selected = sel;
        el.dataset.selected = sel ?? "";
        const want = new Map(next.map(b => [b.key, b]));
        cal.batchRendering(() => {
            for (const ev of cal.getEvents()) {
                const b = want.get(ev.id);
                if (!b) { ev.remove(); continue; }
                want.delete(ev.id);
                const i = input(b);
                if (ev.start?.getTime() !== b.start || ev.end?.getTime() !== b.end) ev.setDates(new Date(b.start), new Date(b.end));
                if (ev.title !== b.title) ev.setProp("title", b.title);
                if (ev.backgroundColor !== i.backgroundColor) ev.setProp("backgroundColor", i.backgroundColor);
                if (ev.extendedProps.selected !== (b.key === sel)) ev.setExtendedProp("selected", b.key === sel);
                if (ev.extendedProps.free !== !!b.free) ev.setExtendedProp("free", !!b.free);
            }
            for (const b of want.values()) cal.addEvent(input(b));
        });
    }

    const scroller = () => el.querySelector(".fc-timegrid-body")?.closest(".fc-scroller") as HTMLElement | null;
    const perHour = () => (el.querySelector(".fc-timegrid-slots table") as HTMLElement | null)?.offsetHeight ?? 24 * scale;

    // Zoom around a point (the mouse, or the middle): the hour under it stays under it, measured on
    // the new layout. Never while a block is in the hand.
    function zoomTo(next: number, clientY?: number) {
        const s = scroller();
        if (!s || dragging) return;
        const box = s.getBoundingClientRect();
        const ratio = box.height / s.clientHeight || 1;
        const at = clientY == null ? s.clientHeight / 2 : (clientY - box.top) / ratio;
        const hours = (s.scrollTop + at) / (perHour() / 24);
        const was = scale;
        scale = Math.min(o.most, Math.max(o.least, next));
        if (scale === was) return;
        el.style.setProperty("--agentdisc-day-slot", `${scale / 4}px`);
        cal.updateSize();
        cal.render(); // short blocks redraw their real length at the new scale
        s.scrollTop = hours * (perHour() / 24) - at;
        o.onScale(scale);
    }
    // A mouse notch is one 15% step whatever the page zoom; a touchpad pinch's many small steps add
    // up by how far it moved. The wheel alone scrolls the day as usual.
    const onWheel = (e: WheelEvent) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        e.stopPropagation();
        const d = -e.deltaY;
        const steps = Math.abs(d) >= 50 ? Math.sign(d) * Math.max(1, Math.min(3, Math.round(Math.abs(d) / 100))) : d / 100;
        zoomTo(scale * Math.pow(1.15, steps), e.clientY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    // A click on an empty part of the day lets go of the selection. Judged before the library handles
    // the click (capture), while the clicked element is still in place: selecting redraws the block.
    const onClick = (e: MouseEvent) => {
        const t = e.target as Element;
        if (!t.closest(".fc-event") && !t.closest(".agentdisc-day-zoom") && selected) o.onSelect(null);
    };
    el.addEventListener("click", onClick, true);

    const zoom = document.createElement("div");
    zoom.className = "agentdisc-day-zoom";
    for (const [label, f, title] of [["+", 1.25, "Bigger hours"], ["−", 1 / 1.25, "Smaller hours"]] as const) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.title = title;
        b.addEventListener("click", () => zoomTo(scale * f));
        zoom.append(b);
    }

    cal.render();
    el.append(zoom);

    return {
        update(next, sel) {
            if (gone) return;
            if (dragging) { pending = { blocks: next, selected: sel }; return; }
            apply(next, sel);
        },
        zoomBy: f => zoomTo(scale * f),
        scale: () => scale,
        destroy() {
            gone = true;
            el.removeEventListener("wheel", onWheel);
            el.removeEventListener("click", onClick, true);
            cal.destroy();
            zoom.remove();
            el.classList.remove("agentdisc-day");
        }
    };
}
