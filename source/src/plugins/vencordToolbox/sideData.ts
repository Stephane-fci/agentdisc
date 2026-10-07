/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { Logger } from "@utils/Logger";
import { ChannelStore, FluxDispatcher, GuildChannelStore, RestAPI, useEffect, UserStore, useState } from "@webpack/common";

import { placesOf } from "./links";

// What the right panel shows for a channel (Stephane, 7 Oct): the channels and threads it
// is linked with, both ways (a channel mention, a link to a channel, thread or message, a
// forwarded message, from this channel or from another one to it), and the days he wrote
// in it. Everything comes from reading channels and their threads once, newest first; what
// was read is kept in the browser, so later visits only read new messages. The open
// channel is read first; then the other channels of the server are read slowly in the
// background, so links made to this channel from elsewhere appear too.

const logger = new Logger("AgentDiscSidePanel");
const VERSION = 2;
const PAGE = 100;
const MAX_PAGES_MAIN = 300;
const MAX_PAGES_THREAD = 40;
const SELECTABLE = "SELECTABLE";

interface PlaceState {
    newest: string | null; // newest message read
    oldest: string | null; // oldest message read, to go on from when the start was not reached
    complete: boolean; // reached the first message
}

export interface DayInfo {
    mine: number; // his messages that day
    main?: string; // first message of the day in the channel itself
    any?: [string, string]; // first message of the day anywhere: [channel or thread, message]
}

export interface SideData {
    v: number;
    places: Record<string, PlaceState>;
    links: Record<string, number>; // channel or thread linked from here -> how many times
    days: Record<string, DayInfo>;
}

// A channel or thread named in a link, as far as it could be found out.
export interface PlaceName {
    name: string;
    thread: boolean;
    parent: string | null;
    guild: string | null;
}

const empty = (): SideData => ({ v: VERSION, places: {}, links: {}, days: {} });
const key = (channelId: string) => `agentdisc-side-${channelId}`;
const NAMES_KEY = "agentdisc-side-names";

const loaded = new Map<string, SideData>();
const running = new Set<string>();
const listeners = new Set<() => void>();
let names: Record<string, PlaceName | null> | null = null;
const naming = new Set<string>();
let crawling: string | null = null;
let crawlLeft = 0;

let notifyQueued = false;
function notify() {
    if (notifyQueued) return;
    notifyQueued = true;
    requestAnimationFrame(() => {
        notifyQueued = false;
        listeners.forEach(fn => fn());
    });
}

// Message ids grow with time; a shorter id is older.
export function older(a: string, b: string) {
    return a.length !== b.length ? a.length < b.length : a < b;
}

export function dayKey(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const MENTION = /<#(\d{17,20})>/g;
const LINK = /https?:\/\/(?:[\w-]+\.)?discord(?:app)?\.com\/channels\/(?:\d+|@me)\/(\d{17,20})/gi;

// The channels and threads a message points to.
function targets(m: any): string[] {
    const out = new Set<string>();
    const text = [String(m?.content ?? ""), ...(m?.embeds ?? []).flatMap((e: any) => [e?.url ?? "", e?.description ?? ""])].join(" ");
    for (const x of text.matchAll(MENTION)) out.add(x[1]);
    for (const x of text.matchAll(LINK)) out.add(x[1]);
    // A forwarded message comes from another channel.
    if (m?.message_reference?.type === 1 && m.message_reference.channel_id) out.add(m.message_reference.channel_id);
    return [...out];
}

function take(data: SideData, channelId: string, place: string, m: any, me: string | undefined) {
    if (!m?.id || !m.timestamp) return;
    const d = dayKey(new Date(m.timestamp));
    const info = data.days[d] ??= { mine: 0 };
    if (me && m.author?.id === me) info.mine++;
    if (place === channelId && (!info.main || older(m.id, info.main))) info.main = m.id;
    if (!info.any || older(m.id, info.any[1])) info.any = [place, m.id];
    for (const t of targets(m)) {
        if (t === channelId || t === place) continue;
        data.links[t] = (data.links[t] ?? 0) + 1;
    }
}

// At most three pages are asked of Discord at once, whatever the number of channels read.
let inFlight = 0;
const waiting: (() => void)[] = [];

async function slot<T>(fn: () => Promise<T>): Promise<T> {
    if (inFlight >= 3) await new Promise<void>(resolve => waiting.push(resolve));
    inFlight++;
    try {
        return await fn();
    } finally {
        inFlight--;
        waiting.shift()?.();
    }
}

async function readPage(place: string, query: Record<string, string | number>) {
    return slot(async () => {
        const res: any = await RestAPI.get({ url: `/channels/${place}/messages`, query: { limit: PAGE, ...query } } as any);
        return Array.isArray(res?.body) ? res.body as any[] : [];
    });
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// The background reading of other channels goes at about one page a second, like a person
// scrolling, never in bursts.
async function readPlace(data: SideData, channelId: string, place: string, me: string | undefined, maxPages: number, archived: boolean, slow: boolean) {
    const state = data.places[place] ??= { newest: null, oldest: null, complete: false };
    const page = async (p: string, q: Record<string, string | number>) => {
        if (slow) await sleep(1000);
        return readPage(p, q);
    };

    // New messages since the last visit (an archived thread read to its start has none).
    if (state.newest && !(archived && state.complete)) {
        let after = state.newest;
        for (let i = 0; i < maxPages; i++) {
            const batch = await page(place, { after });
            for (const m of batch) take(data, channelId, place, m, me);
            for (const m of batch) if (older(after, m.id)) after = m.id;
            state.newest = after;
            notify();
            if (batch.length < PAGE) break;
        }
    }

    // Older messages, until the first one (or the page limit, going on next time).
    for (let i = 0; i < maxPages && !state.complete; i++) {
        const batch = await page(place, state.oldest ? { before: state.oldest } : {});
        for (const m of batch) {
            take(data, channelId, place, m, me);
            if (!state.newest || older(state.newest, m.id)) state.newest = m.id;
            if (!state.oldest || older(m.id, state.oldest)) state.oldest = m.id;
        }
        if (batch.length < PAGE) state.complete = true;
        notify();
        if (i % 5 === 4) await save(channelId, data);
    }
}

async function save(channelId: string, data: SideData) {
    try {
        await DataStore.set(key(channelId), data);
    } catch (e) {
        logger.warn("Could not keep the side panel data", e);
    }
}

async function load(channelId: string): Promise<SideData> {
    let data = loaded.get(channelId);
    if (data) return data;
    try {
        const kept = await DataStore.get<SideData>(key(channelId));
        data = kept?.v === VERSION ? kept : empty();
    } catch {
        data = empty();
    }
    if (!loaded.has(channelId)) loaded.set(channelId, data);
    return loaded.get(channelId)!;
}

// Reads what is new (and what is still unread) for a channel and its threads.
async function refresh(channelId: string, guildId: string, slow = false) {
    if (running.has(channelId)) return;
    running.add(channelId);
    notify();
    try {
        const data = await load(channelId);
        const me = UserStore.getCurrentUser()?.id;
        const { ids, names: archivedNames } = await placesOf(channelId, guildId);
        for (const [id, name] of archivedNames) rememberName(id, { name, thread: true, parent: channelId, guild: guildId });
        let next = 0;
        const worker = async () => {
            while (next < ids.length) {
                const place = ids[next++];
                try {
                    await readPlace(data, channelId, place, me, place === channelId ? MAX_PAGES_MAIN : MAX_PAGES_THREAD, archivedNames.has(place), slow);
                } catch (e) {
                    logger.warn("Could not read", place, e);
                }
            }
        };
        await Promise.all(slow ? [worker()] : [worker(), worker(), worker()]);
        await save(channelId, data);
    } finally {
        running.delete(channelId);
        notify();
    }
}

function textChannels(guildId: string): string[] {
    try {
        return ((GuildChannelStore.getChannels(guildId) as any)?.[SELECTABLE] ?? []).map((e: any) => e.channel?.id).filter(Boolean);
    } catch {
        return [];
    }
}

// The other channels of the server, read one after the other in the background, so
// links made from them to the open channel are found. Each is read once to its start;
// later only when it is opened, or as new messages come in.
async function crawl(guildId: string) {
    if (crawling === guildId) return;
    crawling = guildId;
    try {
        const ids = textChannels(guildId);
        const kept = await DataStore.getMany<SideData>(ids.map(key)).catch(() => [] as (SideData | undefined)[]);
        ids.forEach((id, i) => {
            const d = kept[i];
            if (d?.v === VERSION && !loaded.has(id)) loaded.set(id, d);
        });
        notify();
        const todo = ids.filter(id => !loaded.get(id)?.places[id]?.complete);
        crawlLeft = todo.length;
        for (const id of todo) {
            if (crawling !== guildId) return;
            await refresh(id, guildId, true);
            crawlLeft--;
            notify();
        }
    } catch (e) {
        logger.warn("Could not read the other channels", e);
    } finally {
        if (crawling === guildId) crawling = null;
        crawlLeft = 0;
        notify();
    }
}

// A message posted while its channel is known counts at once.
function onMessage({ message }: { message?: any; }) {
    const place = message?.channel_id;
    if (!place) return;
    const channel = ChannelStore.getChannel(place);
    const channelId = channel?.isThread?.() ? channel.parent_id : place;
    const data = loaded.get(channelId);
    if (!data || running.has(channelId)) return;
    const state = data.places[place];
    if (!state?.newest || !older(state.newest, message.id)) return;
    take(data, channelId, place, message, UserStore.getCurrentUser()?.id);
    state.newest = message.id;
    notify();
    save(channelId, data);
}

// Names of linked channels and threads Discord has not loaded (old threads, mostly), asked
// once and kept.
function rememberName(id: string, name: PlaceName | null) {
    if (!names) names = {};
    names[id] = name;
}

async function loadNames() {
    if (names) return;
    try {
        names = (await DataStore.get<Record<string, PlaceName | null>>(NAMES_KEY)) ?? {};
    } catch {
        names = {};
    }
}

let namesSaveTimer: ReturnType<typeof setTimeout> | null = null;
function saveNamesSoon() {
    if (namesSaveTimer) return;
    namesSaveTimer = setTimeout(() => {
        namesSaveTimer = null;
        DataStore.set(NAMES_KEY, names ?? {}).catch(() => { });
    }, 2000);
}

export function placeName(id: string): PlaceName | null | undefined {
    const c = ChannelStore.getChannel(id);
    if (c?.name) return { name: c.name, thread: !!c.isThread?.(), parent: c.parent_id ?? null, guild: c.guild_id ?? null };
    if (names && id in names) return names[id];
    if (names && !naming.has(id)) {
        naming.add(id);
        slot(() => RestAPI.get({ url: `/channels/${id}` }))
            .then((res: any) => {
                const b = res?.body;
                rememberName(id, b?.name ? { name: b.name, thread: [10, 11, 12].includes(b.type), parent: b.parent_id ?? null, guild: b.guild_id ?? null } : null);
            })
            .catch(() => rememberName(id, null))
            .finally(() => {
                saveNamesSoon();
                notify();
            });
    }
    return undefined;
}

// Every channel or thread linked with this channel, both ways, with how often.
export function linksOf(channelId: string): Map<string, number> {
    const out = new Map<string, number>();
    const own = loaded.get(channelId);
    for (const [id, n] of Object.entries(own?.links ?? {})) out.set(id, (out.get(id) ?? 0) + n);
    // This channel and its threads (every place read for it), as targets of other channels.
    const here = new Set([channelId, ...Object.keys(own?.places ?? {})]);
    for (const [other, data] of loaded) {
        if (other === channelId) continue;
        let n = 0;
        for (const [target, count] of Object.entries(data.links)) {
            if (here.has(target)) n += count;
        }
        if (n) out.set(other, (out.get(other) ?? 0) + n);
    }
    out.delete(channelId);
    return out;
}

export function startSideData() {
    FluxDispatcher.subscribe("MESSAGE_CREATE", onMessage);
}

export function stopSideData() {
    FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMessage);
    crawling = null;
}

export function useSideData(channelId: string, guildId: string | null | undefined) {
    const [, rerender] = useState(0);
    useEffect(() => {
        const fn = () => rerender(x => x + 1);
        listeners.add(fn);
        loadNames().then(async () => {
            if (!guildId) return load(channelId).then(fn);
            await refresh(channelId, guildId);
            crawl(guildId);
        });
        return () => void listeners.delete(fn);
    }, [channelId, guildId]);
    const data = loaded.get(channelId) ?? null;
    return {
        data,
        reading: running.has(channelId) && !data?.places[channelId]?.complete,
        crawlLeft: crawling === guildId ? crawlLeft : 0
    };
}
