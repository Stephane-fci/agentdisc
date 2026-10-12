/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChannelStore, createRoot, FluxDispatcher, SelectedGuildStore, useEffect, useRef, UserStore, useState } from "@webpack/common";
import type { Root } from "react-dom/client";

// The busy bar (Stephane, 12 Oct): a bar across the top of the screen that fills with the
// number of conversations where an agent is working right now, in the server he is in.
// A conversation is a channel or thread where an agent (Claude Code, Codex, any bot) is
// typing; agents keep typing for as long as they work. Green with a few, then yellow,
// orange and red, burning at 20, purple beyond. Each step has a few phrases, one picked
// at random when the step is reached.

export const BUSY_BAR_HEIGHT = 20;

// Typing lasts about 10 seconds and is renewed while the agent works; a conversation still
// counts this long after its last signal, so a pause between two messages does not drop it.
const GRACE_MS = 25_000;
const FULL = 20;

interface Step { key: string; from: number; phrases: string[]; }

const STEPS: Step[] = [
    { key: "quiet", from: 0, phrases: ["All quiet", "Nobody at work right now"] },
    { key: "green", from: 1, phrases: ["Easy mode", "I'm cheating", "Cheat code on", "Barely trying"] },
    { key: "yellow", from: 4, phrases: ["Okay, now we're getting into it", "Warming up", "Getting busy"] },
    { key: "orange", from: 8, phrases: ["Okay, this is serious work", "Full focus", "Real work now"] },
    { key: "red", from: 13, phrases: ["Things are heating up", "Hands full", "Running hot"] },
    { key: "fire", from: FULL, phrases: ["The system is burning", "Everything is on fire", "Send help"] },
    { key: "purple", from: FULL + 1, phrases: ["Beyond burning", "Off the charts", "Pure overdrive"] }
];

const stepOf = (count: number) => [...STEPS].reverse().find(s => count >= s.from)!;

// channel or thread id -> agent id -> when its typing was last seen
const typing = new Map<string, Map<string, number>>();
const listeners = new Set<() => void>();

function isAgent(userId: string) {
    if (userId === UserStore.getCurrentUser()?.id) return false;
    const user = UserStore.getUser(userId) as any;
    // A user Discord has not loaded yet still counts: in his servers that is an agent.
    return !user || !!user.bot;
}

function onTyping({ channelId, userId }: { channelId?: string; userId?: string; }) {
    if (!channelId || !userId || !isAgent(userId)) return;
    let agents = typing.get(channelId);
    if (!agents) typing.set(channelId, agents = new Map());
    agents.set(userId, Date.now());
    listeners.forEach(l => l());
}

function countNow() {
    const guildId = SelectedGuildStore.getGuildId() ?? null;
    const since = Date.now() - GRACE_MS;
    let count = 0;
    for (const [channelId, agents] of typing) {
        for (const [userId, at] of agents) if (at < since) agents.delete(userId);
        if (!agents.size) {
            typing.delete(channelId);
            continue;
        }
        if ((ChannelStore.getChannel(channelId)?.guild_id ?? null) === guildId) count++;
    }
    return count;
}

function useCount() {
    const [count, setCount] = useState(countNow);
    useEffect(() => {
        const update = () => setCount(countNow());
        listeners.add(update);
        const timer = setInterval(update, 1000);
        const onGuild = () => update();
        SelectedGuildStore.addChangeListener(onGuild);
        return () => {
            listeners.delete(update);
            clearInterval(timer);
            SelectedGuildStore.removeChangeListener(onGuild);
        };
    }, []);
    return count;
}

const pick = (list: string[], not?: string) => {
    const choices = list.length > 1 ? list.filter(p => p !== not) : list;
    return choices[Math.floor(Math.random() * choices.length)];
};

function BusyBar() {
    const count = useCount();
    const step = stepOf(count);
    const [phrase, setPhrase] = useState(() => pick(step.phrases));
    const shownStep = useRef(step.key);
    const last = useRef(count);
    const [pops, setPops] = useState<{ id: number; text: string; }[]>([]);
    const [bump, setBump] = useState(0);

    useEffect(() => {
        if (shownStep.current !== step.key) {
            shownStep.current = step.key;
            setPhrase(p => pick(step.phrases, p));
        }
    }, [step.key]);

    useEffect(() => {
        const change = count - last.current;
        last.current = count;
        if (change <= 0) return;
        // A new conversation: the bar jumps, flashes and a "+1" pops out of its end.
        const id = Date.now() + Math.random();
        setPops(p => [...p, { id, text: `+${change}` }]);
        setBump(b => b + 1);
        setTimeout(() => setPops(p => p.filter(x => x.id !== id)), 1400);
    }, [count]);

    const filled = Math.min(count, FULL) / FULL * 100;
    return (
        <div className={`agentdisc-busy agentdisc-busy-${step.key}`} title="Conversations where an agent is working in this server">
            <div className="agentdisc-busy-fill" style={{ width: `${filled}%` }}>
                {bump > 0 && <div key={bump} className="agentdisc-busy-flash" />}
                {(step.key === "fire" || step.key === "purple") && <div className="agentdisc-busy-flames" />}
            </div>
            <div className="agentdisc-busy-label">
                <span className="agentdisc-busy-count">{count}</span>
                <span className="agentdisc-busy-phrase">{phrase}</span>
            </div>
            {pops.map(p => (
                <span key={p.id} className="agentdisc-busy-pop" style={{ left: `clamp(24px, ${filled}%, calc(100% - 24px))` }}>{p.text}</span>
            ))}
        </div>
    );
}

let root: Root | null = null;
let host: HTMLElement | null = null;

export function startBusyBar() {
    FluxDispatcher.subscribe("TYPING_START", onTyping);
    if (!document.body) {
        document.addEventListener("DOMContentLoaded", mount, { once: true });
        return;
    }
    mount();
}

function mount() {
    if (host) return;
    host = document.createElement("div");
    host.id = "agentdisc-busy-host";
    document.body.append(host);
    root = createRoot(host);
    root.render(<BusyBar />);
}

export function stopBusyBar() {
    FluxDispatcher.unsubscribe("TYPING_START", onTyping);
    document.removeEventListener("DOMContentLoaded", mount);
    root?.unmount();
    host?.remove();
    root = null;
    host = null;
    typing.clear();
}
