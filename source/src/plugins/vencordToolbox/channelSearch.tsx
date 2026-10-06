/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ActiveJoinedThreadsStore, ChannelStore, GuildChannelStore, GuildStore, NavigationRouter, ReactDOM, SelectedGuildStore, useEffect, useMemo, useRef, useState } from "@webpack/common";

// Channel search (Stephane, 2 Oct): a button in the top bar and Ctrl+O (Ctrl+M until 6 Oct)
// open one search box; as soon as he types, the matching channels and threads show, the
// best first, and a click or Enter takes him there. In a server it searches that server
// only, and each line shows its category and the day of its last message (6 Oct); outside
// a server (direct messages) it searches every server.

export interface Place {
    id: string;
    guildId: string;
    name: string;
    plain: string;
    where: string;
    parentName: string;
    lastDate: string;
    kind: "channel" | "thread" | "voice";
    recent: bigint;
}

const SHOWN = 30;

// Emoji, dashes and capitals do not count: "lifely po" finds "🦕-lifely-po-allocation".
export function plain(text: string) {
    return text.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "")
        .replace(/\p{Extended_Pictographic}|️|‍/gu, " ")
        .replace(/[-_.·|/]+/g, " ").replace(/\s+/g, " ").trim();
}

function recency(channel: any) {
    try {
        return BigInt(channel?.lastMessageId ?? channel?.last_message_id ?? channel?.id ?? 0);
    } catch {
        return 0n;
    }
}

const DISCORD_EPOCH = 1420070400000n;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"];

// When the last message was posted: the time today, "Yesterday", the day and month this
// year, the full date before. Message ids carry their own time.
export function lastMessageDate(channel: any): string {
    const id = channel?.lastMessageId ?? channel?.last_message_id;
    if (!id) return "";
    let when: Date;
    try {
        when = new Date(Number((BigInt(id) >> 22n) + DISCORD_EPOCH));
    } catch {
        return "";
    }
    const now = new Date();
    const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((day(now) - day(when)) / 86400000);
    if (days <= 0) return `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
    if (days === 1) return "Yesterday";
    const date = `${when.getDate()} ${MONTHS[when.getMonth()]}`;
    return when.getFullYear() === now.getFullYear() ? date : `${date} ${when.getFullYear()}`;
}

// Every channel, voice channel and joined thread, of every server or of one.
export function allPlaces(guildId?: string | null): Place[] {
    const places: Place[] = [];
    const all = Object.values(GuildStore.getGuilds() ?? {}) as any[];
    const guilds = guildId ? all.filter(g => g.id === guildId) : all;
    for (const guild of guilds) {
        let lists: any;
        try {
            lists = GuildChannelStore.getChannels(guild.id);
        } catch {
            continue;
        }
        const add = (channel: any, kind: Place["kind"]) => {
            if (!channel?.id || !channel.name) return;
            const parent = channel.parent_id ? ChannelStore.getChannel(channel.parent_id) : null;
            places.push({
                id: channel.id,
                guildId: guild.id,
                name: channel.name,
                plain: plain(channel.name),
                where: [guild.name, parent?.name].filter(Boolean).join(" · "),
                parentName: parent?.name ?? "",
                lastDate: lastMessageDate(channel),
                kind,
                recent: recency(channel)
            });
        };
        for (const { channel } of lists?.SELECTABLE ?? []) add(channel, "channel");
        for (const { channel } of lists?.VOCAL ?? []) add(channel, "voice");
        try {
            const threads = ActiveJoinedThreadsStore.getActiveJoinedThreadsForGuild(guild.id) ?? {};
            for (const byParent of Object.values(threads)) {
                for (const { channel } of Object.values(byParent as any) as any[]) add(channel, "thread");
            }
        } catch { }
    }
    return places;
}

// Best first: names that start with what is typed, then a word that starts with it, then
// any name containing every word typed; the most recently active first within each.
export function find(places: Place[], query: string, limit = SHOWN): Place[] {
    const q = plain(query);
    if (!q) return [];
    const words = q.split(" ");
    const scored: { p: Place; score: number; }[] = [];
    for (const p of places) {
        const hay = p.plain;
        if (!words.every(w => hay.includes(w))) continue;
        const score = hay.startsWith(q) ? 0 : (" " + hay).includes(" " + q) ? 1 : hay.includes(q) ? 2 : 3;
        scored.push({ p, score });
    }
    scored.sort((a, b) => a.score - b.score || (b.p.recent > a.p.recent ? 1 : b.p.recent < a.p.recent ? -1 : 0));
    return scored.slice(0, limit).map(s => s.p);
}

export const ICONS: Record<Place["kind"], string> = {
    channel: "M10.99 3.16A1 1 0 1 0 9 2.84L8.15 8H4a1 1 0 0 0 0 2h3.82l-.67 4H3a1 1 0 1 0 0 2h3.82l-.8 4.84a1 1 0 0 0 1.97.32L8.85 16h4.97l-.8 4.84a1 1 0 0 0 1.97.32l.86-5.16H20a1 1 0 1 0 0-2h-3.82l.67-4H21a1 1 0 1 0 0-2h-3.82l.8-4.84a1 1 0 1 0-1.97-.32L15.15 8h-4.97l.8-4.84ZM14.15 14l.67-4H9.85l-.67 4h4.97Z",
    thread: "M4 3a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h1v3.5a.5.5 0 0 0 .85.35L9.7 16H14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H4Zm14 5v6a4 4 0 0 1-4 4h-3.1l-1.55 1.55A2 2 0 0 0 11 20h3.3l3.85 3.85a.5.5 0 0 0 .85-.35V20h1a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2Z",
    voice: "M12 3a1 1 0 0 0-1.7-.7L6.6 6H4a2 2 0 0 0-2 2v8c0 1.1.9 2 2 2h2.6l3.7 3.7A1 1 0 0 0 12 21V3Zm3.1 5.3a1 1 0 0 1 1.4 0 5 5 0 0 1 0 7.4 1 1 0 1 1-1.4-1.4 3 3 0 0 0 0-4.6 1 1 0 0 1 0-1.4Z"
};

function SearchBox({ onClose }: { onClose(): void; }) {
    const places = useMemo(() => allPlaces(SelectedGuildStore.getGuildId()), []);
    const [query, setQuery] = useState("");
    const [active, setActive] = useState(0);
    const results = useMemo(() => find(places, query), [places, query]);
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => setActive(0), [query]);
    useEffect(() => {
        listRef.current?.querySelector<HTMLElement>(".agentdisc-find-on")?.scrollIntoView({ block: "nearest" });
    }, [active]);

    function go(p: Place | undefined) {
        if (!p) return;
        NavigationRouter.transitionTo(`/channels/${p.guildId}/${p.id}`);
        onClose();
    }

    return (
        <div className="agentdisc-find-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="agentdisc-find" role="dialog" aria-label="Find a channel">
                <input
                    className="agentdisc-find-input"
                    placeholder={SelectedGuildStore.getGuildId() ? "Find a channel or thread in this server…" : "Find a channel or thread…"}
                    value={query}
                    autoFocus
                    onChange={e => setQuery(e.currentTarget.value)}
                    onKeyDown={e => {
                        if (e.key === "Escape") { e.preventDefault(); onClose(); }
                        else if (e.key === "ArrowDown") { e.preventDefault(); setActive(i => Math.min(i + 1, results.length - 1)); }
                        else if (e.key === "ArrowUp") { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
                        else if (e.key === "Enter") { e.preventDefault(); go(results[active]); }
                        e.stopPropagation();
                    }}
                />
                <div className="agentdisc-find-list" ref={listRef}>
                    {results.map((p, i) => (
                        <div
                            key={p.id}
                            className={"agentdisc-find-item" + (i === active ? " agentdisc-find-on" : "")}
                            onMouseEnter={() => setActive(i)}
                            onClick={() => go(p)}
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d={ICONS[p.kind]} /></svg>
                            <span className="agentdisc-find-name">{p.name}</span>
                            <span className="agentdisc-find-where">{p.guildId === SelectedGuildStore.getGuildId() ? p.parentName : p.where}</span>
                            <span className="agentdisc-find-date">{p.lastDate}</span>
                        </div>
                    ))}
                    {query.trim() && !results.length && <div className="agentdisc-find-note">No channel or thread matches.</div>}
                    {!query.trim() && <div className="agentdisc-find-note">Start typing a channel or thread name. Enter opens the first one, the arrows move, Esc closes.</div>}
                </div>
            </div>
        </div>
    );
}

let toggleFind: (() => void) | null = null;

// Ctrl+O (the O key, whatever the keyboard) opens or closes the search box.
function onKey(e: KeyboardEvent) {
    if (!e.ctrlKey || e.altKey || e.shiftKey || e.metaKey || e.repeat) return;
    if (e.key.toLowerCase() !== "o" || !toggleFind) return;
    e.preventDefault();
    e.stopPropagation();
    toggleFind();
}

export function startFindShortcut() {
    document.addEventListener("keydown", onKey, true);
}

export function stopFindShortcut() {
    document.removeEventListener("keydown", onKey, true);
}

export function useFind() {
    const [open, setOpen] = useState(false);
    useEffect(() => {
        toggleFind = () => setOpen(v => !v);
        return () => { toggleFind = null; };
    }, []);
    const box = open ? ReactDOM.createPortal(<SearchBox onClose={() => setOpen(false)} />, document.body) : null;
    return { open, toggle: () => setOpen(v => !v), box };
}
