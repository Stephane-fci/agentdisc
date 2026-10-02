/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { listedThreads } from "@plugins/channelGroups";
import { Logger } from "@utils/Logger";
import { findStoreLazy } from "@webpack";
import { ActiveJoinedThreadsStore, ChannelStore, NavigationRouter, RestAPI, useEffect, useState } from "@webpack/common";

// The links panel (Stephane, 2 Oct): every link posted in the channel or thread being
// read, newest first, with its date and a button that jumps to the message, so a Figma
// or dashboard link is found in a second. The links come from Discord's own search
// ("has: link"), 25 messages at a time, so even old ones are found. Opened on a channel,
// it also covers every thread of that channel, open or archived, read straight from each
// thread's messages (Discord's search did not return thread messages); opened on a
// thread, only that thread (Stephane, 2 Oct).

const logger = new Logger("AgentDiscLinks");
const URL_RE = /https?:\/\/[^\s<>()[\]"'`|]+/g;
const PAGE = 25;
// Links to Discord itself (a channel or a message), which the options can hide.
const DISCORD_LINK = /^https?:\/\/(?:[\w-]+\.)?discord(?:app)?\.com\/channels\//i;
// Links to Slack (a workspace's messages and channels), which the options can hide.
const SLACK_LINK = /^(?:https?:\/\/(?:[\w-]+\.)*slack\.com\/|slack:\/\/)/i;

// With "different tracking codes" on, links count as the same page when they differ only
// after the "?" or "#" (utm and the like); a Figma file counts once whatever its frame or
// name in the address (Stephane, 2 Oct).
function groupKey(url: string, variants: boolean) {
    if (!variants) return url.replace(/\/+$/, "");
    try {
        const u = new URL(url);
        let path = u.pathname.replace(/\/+$/, "");
        const figma = /^\/(design|file|board|proto|slides)\/([^/]+)/.exec(path);
        if (/(^|\.)figma\.com$/i.test(u.hostname) && figma) path = `/${figma[1]}/${figma[2]}`;
        return (u.hostname.replace(/^www\./, "") + path).toLowerCase();
    } catch {
        return url.replace(/[?#].*$/, "").replace(/\/+$/, "");
    }
}
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
    const ids = new Set([channelId, ...listedThreads(channelId)]);
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

function foundIn(m: any, channelId: string, url: string): Found {
    return { url, messageId: m.id, channelId: m.channel_id ?? channelId, when: m.timestamp, author: m.author?.global_name ?? m.author?.username ?? "" };
}

// Each thread's own messages, newest first, up to 300 per thread, three threads at a time.
async function threadLinks(ids: string[]): Promise<Found[]> {
    const out: Found[] = [];
    let next = 0;
    const worker = async () => {
        while (next < ids.length) {
            const id = ids[next++];
            let before: string | undefined;
            for (let page = 0; page < 3; page++) {
                let res: any;
                try {
                    res = await RestAPI.get({ url: `/channels/${id}/messages`, query: before ? { limit: 100, before } : { limit: 100 } } as any);
                } catch (e) {
                    logger.warn("Could not read a thread", id, e);
                    break;
                }
                const messages: any[] = Array.isArray(res?.body) ? res.body : [];
                for (const m of messages) for (const url of linksOf(m)) out.push(foundIn(m, id, url));
                if (messages.length < 100) break;
                before = messages[messages.length - 1]?.id;
            }
        }
    };
    await Promise.all([worker(), worker(), worker()]);
    return out;
}

// Newest first; every post of a link is kept (the options can group them).
function merge(lists: Found[][]): Found[] {
    const all = lists.flat().sort((a, b) => Date.parse(b.when) - Date.parse(a.when));
    const seen = new Set<string>();
    return all.filter(f => {
        const key = f.messageId + " " + f.url;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
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

export interface LinkOptions { hideDiscord: boolean; hideSlack: boolean; group: boolean; groupVariants: boolean; }

export function LinksPanel({ channelId, guildId, onClose, options, setOption }: { channelId: string; guildId: string | null; onClose(): void; options: LinkOptions; setOption(key: keyof LinkOptions, value: boolean): void; }) {
    const [showOptions, setShowOptions] = useState(false);
    const [found, setFound] = useState<Found[]>([]);
    const [next, setNext] = useState(0);
    const [total, setTotal] = useState<number | null>(null);
    const [state, setState] = useState<"loading" | "ready" | "waiting" | "failed">("loading");
    const [filter, setFilter] = useState("");
    const [places, setPlaces] = useState<{ ids: string[]; names: Map<string, string>; } | null>(null);

    async function load(offset: number, tries = 0) {
        setState("loading");
        try {
            const where = places ?? await placesOf(channelId, guildId);
            if (!places) setPlaces(where);
            // The channel's own links come from Discord's search; its threads are read directly.
            const threads = offset === 0 ? threadLinks(where.ids.filter(id => id !== channelId)) : Promise.resolve([] as Found[]);
            const r = await search([channelId], guildId, offset);
            if (r.waiting) {
                // Discord is still building its search for this channel: try again shortly.
                setState("waiting");
                if (tries < 5) setTimeout(() => void load(offset, tries + 1), Math.max(1, r.retryAfter) * 1000);
                return;
            }
            const fromChannel: Found[] = [];
            for (const m of r.messages) for (const url of linksOf(m)) fromChannel.push(foundIn(m, channelId, url));
            const fromThreads = await threads;
            setTotal(r.total);
            setNext(offset + PAGE);
            setFound(prev => merge([offset === 0 ? [] : prev, fromChannel, fromThreads]));
            setState("ready");
        } catch (e) {
            logger.warn("Link search failed", e);
            setState("failed");
        }
    }

    useEffect(() => { void load(0); }, [channelId]);

    const words = filter.trim().toLowerCase();
    const kept = found
        .filter(f => !options.hideDiscord || !DISCORD_LINK.test(f.url))
        .filter(f => !options.hideSlack || !SLACK_LINK.test(f.url))
        .filter(f => !words || f.url.toLowerCase().includes(words) || f.author.toLowerCase().includes(words));

    // Grouped: one line per link, how many times and when last; no jump, since it was posted more than once.
    const groups: { url: string; count: number; when: string; }[] = [];
    if (options.group) {
        const byUrl = new Map<string, { url: string; count: number; when: string; }>();
        for (const f of kept) {
            const key = groupKey(f.url, options.groupVariants);
            const g = byUrl.get(key);
            if (g) g.count++;
            else byUrl.set(key, { url: f.url, count: 1, when: f.when });
        }
        groups.push(...byUrl.values());
    }

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
    const count = options.group ? groups.length : kept.length;

    const Url = ({ url }: { url: string; }) => {
        const { site, rest } = parts(url);
        return (
            <a className="agentdisc-links-url" href={url} target="_blank" rel="noreferrer noopener" title={url}>
                <span className="agentdisc-links-site">{site}</span>
                {rest && <span className="agentdisc-links-path">{rest}</span>}
            </a>
        );
    };

    return (
        <div className="agentdisc-links" role="dialog" aria-label="Links in this channel">
            <div className="agentdisc-links-head">
                <span>{inThread ? "Links in this thread" : "Links in this channel and its threads"}</span>
                <span className="agentdisc-links-head-right">
                    {total != null && <span className="agentdisc-links-count">{count}</span>}
                    <button type="button" className={"agentdisc-links-gear" + (showOptions ? " agentdisc-links-gear-on" : "")} title="Options" aria-label="Options" onClick={() => setShowOptions(v => !v)}>
                        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19.4 13a7.6 7.6 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3h-4l-.4 2.9a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.6 7.6 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1a7.4 7.4 0 0 0 1.7 1L11 21h4l.4-2.9a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" transform="translate(-1 0)" /></svg>
                    </button>
                </span>
            </div>
            {showOptions && (
                <div className="agentdisc-links-options">
                    <label><input type="checkbox" checked={options.hideDiscord} onChange={() => setOption("hideDiscord", !options.hideDiscord)} /> Hide links to Discord channels and messages</label>
                    <label><input type="checkbox" checked={options.hideSlack} onChange={() => setOption("hideSlack", !options.hideSlack)} /> Hide Slack links</label>
                    <label><input type="checkbox" checked={options.group} onChange={() => setOption("group", !options.group)} /> Group the same link posted several times</label>
                    <label className={options.group ? "" : "agentdisc-links-option-off"}><input type="checkbox" disabled={!options.group} checked={options.groupVariants} onChange={() => setOption("groupVariants", !options.groupVariants)} /> Also group links that only differ by tracking codes</label>
                </div>
            )}
            <input className="agentdisc-links-filter" placeholder="Filter: figma, dashboard…" value={filter} onChange={e => setFilter(e.currentTarget.value)} autoFocus />
            <div className="agentdisc-links-list">
                {options.group
                    ? groups.map(g => (
                        <div className="agentdisc-links-item" key={g.url}>
                            <Url url={g.url} />
                            <div className="agentdisc-links-meta">
                                <span>{g.count > 1 ? `Posted ${g.count} times, last ` : ""}{day(g.when)}</span>
                            </div>
                        </div>
                    ))
                    : kept.map(f => (
                        <div className="agentdisc-links-item" key={f.messageId + f.url}>
                            <Url url={f.url} />
                            <div className="agentdisc-links-meta">
                                <span className="agentdisc-links-when">{day(f.when)}{f.author ? " · " + f.author : ""}</span>
                                {threadName(f) && <span className="agentdisc-links-thread" title={threadName(f)}>{threadName(f)}</span>}
                                <button type="button" className="agentdisc-links-jump" onClick={() => jump(f)}>Jump</button>
                            </div>
                        </div>
                    ))}
                {state === "ready" && count === 0 && <div className="agentdisc-links-note">{found.length ? "No link matches." : inThread ? "No links in this thread yet." : "No links in this channel or its threads yet."}</div>}
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
