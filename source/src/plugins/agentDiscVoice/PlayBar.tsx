/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ReactDOM, useEffect, useState } from "@webpack/common";

import { close, getView, nextRate, PlayerView, skip, subscribe, togglePlay,userSeek } from "./player";

// The play bar: one bar floating just above the message box, drawn outside Discord's
// screens so it stays when the channel changes and whatever panels are hidden.

function usePlayer(): PlayerView {
    const [v, setV] = useState(getView());
    useEffect(() => subscribe(() => setV(getView())), []);
    return v;
}

// Sits inside the channel's top bar as one of its parts, between the channel name and its
// buttons, so it never covers them (Stephane, 2 Oct: "embedded inside because sometimes it
// hides buttons that are behind it"). When the top bar is hidden or too narrow, it floats
// over the message box; bottom centre when there is neither.
const MIN_WIDTH = 300;
const SLOT = "agentdisc-voice-slot";

function topBarSlot(): HTMLElement | null {
    const bars = [...document.querySelectorAll<HTMLElement>('section[class*="title_"]')]
        .map(el => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 300 && r.height > 24)
        .sort((x, y) => y.r.width - x.r.width);
    const bar = bars[0]?.el;
    if (!bar) return null;
    const tools = bar.querySelector<HTMLElement>('[class*="toolbar_"]');
    const row = tools?.parentElement ?? bar;
    let slot = row.querySelector<HTMLElement>(`:scope > .${SLOT}`);
    if (!slot) {
        slot = document.createElement("div");
        slot.className = SLOT;
        row.insertBefore(slot, tools ?? null);
    }
    return slot;
}

function removeSlots(keep?: HTMLElement | null) {
    for (const el of document.querySelectorAll<HTMLElement>(`.${SLOT}`)) if (el !== keep) el.remove();
}

function overMessageBox(): React.CSSProperties {
    const boxes = [...document.querySelectorAll<HTMLElement>('[class*="channelTextArea_"]')]
        .map(b => b.getBoundingClientRect())
        .filter(r => r.width > 200 && r.height > 0);
    const r = boxes.sort((a, b) => b.width - a.width)[0];
    return r
        ? { left: r.left, width: r.width, bottom: window.innerHeight - r.top + 6 }
        : { left: "50%", width: "min(640px, 90vw)", bottom: 90, transform: "translateX(-50%)" };
}

interface Place { slot: HTMLElement | null; style: React.CSSProperties; }

function usePlace() {
    const [place, setPlace] = useState<Place>({ slot: null, style: {} });
    useEffect(() => {
        const update = () => {
            let slot = topBarSlot();
            // Too little room once inside: give the space back and float instead.
            if (slot && slot.getBoundingClientRect().width < MIN_WIDTH) slot = null;
            removeSlots(slot);
            const style = slot ? {} : overMessageBox();
            setPlace(prev => prev.slot === slot && JSON.stringify(prev.style) === JSON.stringify(style) ? prev : { slot, style });
        };
        update();
        const timer = setInterval(update, 500);
        window.addEventListener("resize", update);
        return () => {
            clearInterval(timer);
            window.removeEventListener("resize", update);
            removeSlots();
        };
    }, []);
    return place;
}

function clock(s: number) {
    const t = Math.max(0, Math.round(s));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

const Icon = ({ d }: { d: string; }) => (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d={d} /></svg>
);
const PLAY = "M8 5v14l11-7z";

// A small turning ring while the voice is being made.
export function Spinner({ size = 16 }: { size?: number; }) {
    return (
        <svg className="agentdisc-voice-spin" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="42 16" />
        </svg>
    );
}
const PAUSE = "M6 5h4v14H6zm8 0h4v14h-4z";
const BACK = "M11 18V6l-8.5 6 8.5 6zm.5-6 8.5 6V6l-8.5 6z";
const FORWARD = "M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z";
const CLOSE = "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z";

function Bar({ v }: { v: PlayerView; }) {
    const place = usePlace();
    const [drag, setDrag] = useState<number | null>(null);
    const shown = drag ?? v.position;
    const status = v.waiting && v.playing ? "Making the voice…" : v.note;

    const bar = (
        <div className={"agentdisc-voice-bar" + (place.slot ? " agentdisc-voice-inline" : "")} style={place.style} role="region" aria-label="Read aloud">
            <div className="agentdisc-voice-row">
                <span className="agentdisc-voice-agent" title={v.agent}>🔊 {v.agent}</span>
                <button className="agentdisc-voice-btn" title="Back 10 seconds" onClick={() => skip(-10)} disabled={v.browserOnly}><Icon d={BACK} /><span>10</span></button>
                <button className="agentdisc-voice-btn agentdisc-voice-main" title={v.waiting && v.playing ? "Loading the voice…" : v.playing ? "Pause" : "Play"} onClick={togglePlay}>{v.waiting && v.playing ? <Spinner /> : <Icon d={v.playing ? PAUSE : PLAY} />}</button>
                <button className="agentdisc-voice-btn" title="Forward 10 seconds" onClick={() => skip(10)} disabled={v.browserOnly}><span>10</span><Icon d={FORWARD} /></button>
                <input
                    className="agentdisc-voice-line"
                    type="range"
                    min={0}
                    max={Math.max(v.total, 0.1)}
                    step={0.1}
                    value={Math.min(shown, v.total)}
                    disabled={v.browserOnly}
                    onChange={e => setDrag(Number(e.currentTarget.value))}
                    onPointerUp={e => { userSeek(Number(e.currentTarget.value)); setDrag(null); }}
                    onKeyUp={e => { userSeek(Number(e.currentTarget.value)); setDrag(null); }}
                    aria-label="Timeline"
                />
                <span className="agentdisc-voice-time">{clock(shown)} / {clock(v.total)}</span>
                <button className="agentdisc-voice-btn agentdisc-voice-rate" title="Speed" onClick={nextRate}>{v.rate}×</button>
                <button className="agentdisc-voice-btn" title="Close" onClick={close}><Icon d={CLOSE} /></button>
            </div>
            {status && <div className="agentdisc-voice-note">{status}</div>}
        </div>
    );
    return place.slot ? ReactDOM.createPortal(bar, place.slot) : bar;
}

export function PlayBar() {
    const v = usePlayer();
    return v.open ? <Bar v={v} /> : null;
}
