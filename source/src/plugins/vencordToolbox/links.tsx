/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { findStoreLazy } from "@webpack";
import { ActiveJoinedThreadsStore, ChannelStore, NavigationRouter, RestAPI, useEffect, useState } from "@webpack/common";

// The links panel (Stephane, 2 Oct): every link posted in the channel or thread being
// read, newest first, with its date and a button that jumps to the message, so a Figma
// or dashboard link is found in a second. The links come from Discord's own search
// ("has: link"), 25 messages at a time, so even old ones are found. Opened on a channel,
// it also covers every thread of that channel, open or archived; opened on a thread, only
// that thread (Stephane, 2 Oct).

const logger = new Logger("AgentDiscLinks");
const URL_RE = /https?:\/\/[^\s<>()[\]"'`|]+/g;
const PAGE = 25;
const MAX_THREADS = 150;
const ActiveThreadsStore = findStoreLazy("ActiveThreadsStore") as { getThreadsForParent?(guildId: string, parentId: string): Record<string, unknown>; };

interface Found {
    url: string;
    messageId: string;
    channelId: string;
    when: string;
    author: string;
}

// The channel itself plus all its threads, with their names: the open ones Discord already
// knows, and the archived ones from Discord's list of past threads.
async function placesOf(channelId: string, guildId: string | null) {
    const names = new Map<string, string>();
    const channel = ChannelStore.getChannel(channelId);
    if (!guildId || channel?.isThread?.()) return { ids: [channelId], names };
    const ids = new Set([channelId]);
    try {
        for (const id of Object.keys(ActiveThreadsStore.getThreadsForParent?.(guildId, channelId) ?? {})) ids.add(id);
    } catch { }
    try {
        for (const id of Object.keys(ActiveJoinedThreadsStore.getActiveJoinedThreadsForParent(guildId, channelId) ?? {})) ids.add(id);
    } catch { }
    try {
        let before: string | undefined;
        for (let round = 0; round < 3 && ids.size < MAX_THREADS; round++) {
            const res: any = await RestAPI.get({ url: `/channels/${channelId}/threads/archived/public`, query: before ? { limit: 100, before } : { limit: 100 } } as any);
            const threads: any[] = res?.body?.threads ?? [];
            for (const t of threads) {
                ids.add(t.id);
                if (t.name) names.set(t.id, t.name);
            }
            if (!res?.body?.has_more || !threads.length) break;
            before = threads[threads.length - 1]?.thread_metadata?.archive_timestamp;
            if (!before) break;
        }
    } catch (e) {
        logger.warn("Could not list the archived threads", e);
    }
    return { ids: [...ids].slice(0, MAX_THREADS), names };
}

function trimUrl(url: string) {
    return url.replace(/[.,;:!?*_~>]+$/, "");
}

function linksOf(message: any): string[] {
    const urls = (String(message?.content ?? "").match(URL_RE) ?? []).map(trimUrl);
    for (const e of message?.embeds ?? []) if (e?.url && !urls.includes(e.url)) urls.push(e.url);
    return urls;
}

function parts(url: string) {
    try {
        const u = new URL(url);
        return { site: u.hostname.replace(/^www\./, ""), rest: (u.pathname + u.search).replace(/\/$/, "") };
    } catch {
        return { site: url, rest: "" };
    }
}

function day(iso: string) {
    const d = new Date(iso);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: sameYear ? undefined : "numeric" })
        + ", " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

async function search(channelIds: string[], guildId: string | null, offset: number) {
    const res: any = await RestAPI.get({
        url: guildId ? `/guilds/${guildId}/messages/search` : `/channels/${channelIds[0]}/messages/search`,
        query: guildId ? { channel_id: channelIds, has: "link", offset, include_nsfw: true } : { has: "link", offset },
        retries: 2
    } as any);
    if (res?.status === 202) return { waiting: true as const, retryAfter: Number(res.body?.retry_after ?? 2) };
    const groups: any[][] = res?.body?.messages ?? [];
    return { waiting: false as const, total: Number(res?.body?.total_results ?? 0), messages: groups.map(g => g.find(m => m.hit) ?? g[0]).filter(Boolean) };
}

export function LinksPanel({ channelId, guildId, onClose }: { channelId: string; guildId: string | null; onClose(): void; }) {
    const [found, setFound] = useState<Found[]>([]);
    const [next, setNext] = useState(0);
    const [total, setTotal] = useState<number | null>(null);
    const [state, setState] = useState<"loading" | "ready" | "waiting" | "failed">("loading");
    const [filter, setFilter] = useState("");
    const [places, setPlaces] = useState<{ ids: string[]; names: Map<string, string>; } | null>(null);

    async function load(offset: number, tries = 0) {
        setState("loading");
        try {
            let where = places ?? await placesOf(channelId, guildId);
            let r;
            try {
                r = await search(where.ids, guildId, offset);
            } catch (e) {
                // If the search refuses the list of threads, the channel alone still works.
                if (where.ids.length === 1) throw e;
                logger.warn("Search over the threads refused; channel only", e);
                where = { ids: [channelId], names: where.names };
                r = await search(where.ids, guildId, offset);
            }
            if (places !== where) setPlaces(where);
            if (r.waiting) {
                // Discord is still building its search for this channel: try again shortly.
                setState("waiting");
                if (tries < 5) setTimeout(() => void load(offset, tries + 1), Math.max(1, r.retryAfter) * 1000);
                return;
            }
            setTotal(r.total);
            setNext(offset + PAGE);
            setFound(prev => {
                const list = offset === 0 ? [] : [...prev];
                for (const m of r.messages) {
                    for (const url of linksOf(m)) {
                        if (list.some(f => f.url === url)) continue;
                        list.push({ url, messageId: m.id, channelId: m.channel_id ?? channelId, when: m.timestamp, author: m.author?.global_name ?? m.author?.username ?? "" });
                    }
                }
                return list;
            });
            setState("ready");
        } catch (e) {
            logger.warn("Link search failed", e);
            setState("failed");
        }
    }

    useEffect(() => { void load(0); }, [channelId]);

    const words = filter.trim().toLowerCase();
    const shown = words ? found.filter(f => f.url.toLowerCase().includes(words) || f.author.toLowerCase().includes(words)) : found;

    function jump(f: Found) {
        NavigationRouter.transitionTo(`/channels/${guildId ?? "@me"}/${f.channelId}/${f.messageId}`);
        onClose();
    }

    // Where a link was posted, when it was in one of the channel's threads.
    function threadName(f: Found) {
        if (f.channelId === channelId) return "";
        return places?.names.get(f.channelId) ?? ChannelStore.getChannel(f.channelId)?.name ?? "a thread";
    }

    const inThread = !!ChannelStore.getChannel(channelId)?.isThread?.();

    return (
        <div className="agentdisc-links" role="dialog" aria-label="Links in this channel">
            <div className="agentdisc-links-head">
                <span>{inThread ? "Links in this thread" : "Links in this channel and its threads"}</span>
                {total != null && <span className="agentdisc-links-count">{found.length}</span>}
            </div>
            <input className="agentdisc-links-filter" placeholder="Filter: figma, dashboard…" value={filter} onChange={e => setFilter(e.currentTarget.value)} autoFocus />
            <div className="agentdisc-links-list">
                {shown.map(f => {
                    const { site, rest } = parts(f.url);
                    return (
                        <div className="agentdisc-links-item" key={f.url}>
                            <a className="agentdisc-links-url" href={f.url} target="_blank" rel="noreferrer noopener" title={f.url}>
                                <span className="agentdisc-links-site">{site}</span>
                                {rest && <span className="agentdisc-links-path">{rest}</span>}
                            </a>
                            <div className="agentdisc-links-meta">
                                <span>{day(f.when)}{f.author ? " · " + f.author : ""}{threadName(f) ? " · in " + threadName(f) : ""}</span>
                                <button type="button" className="agentdisc-links-jump" onClick={() => jump(f)}>Jump</button>
                            </div>
                        </div>
                    );
                })}
                {state === "ready" && shown.length === 0 && <div className="agentdisc-links-note">{found.length ? "No link matches." : inThread ? "No links in this thread yet." : "No links in this channel or its threads yet."}</div>}
                {state === "loading" && <div className="agentdisc-links-note">Looking for links…</div>}
                {state === "waiting" && <div className="agentdisc-links-note">Discord is still indexing this channel, trying again…</div>}
                {state === "failed" && <div className="agentdisc-links-note">The search did not answer. <button type="button" className="agentdisc-links-jump" onClick={() => void load(0)}>Try again</button></div>}
                {state === "ready" && total != null && next < total && (
                    <button type="button" className="agentdisc-links-more" onClick={() => void load(next)}>Load older links</button>
                )}
            </div>
        </div>
    );
}
