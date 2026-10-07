/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { Logger } from "@utils/Logger";
import { ChannelStore, FluxDispatcher, RestAPI, useEffect, UserStore, useState } from "@webpack/common";

import { placesOf } from "./links";

// What the right panel shows for a channel (Stephane, 7 Oct): the channels linked from it
// (a channel mention, a link to a channel or message, a forwarded message), and the days he
// wrote in it. Both come from reading the channel and its threads once, newest first; what
// was read is kept in the browser, so the next visit only reads the new messages. A long
// channel fills in while it is read.

const logger = new Logger("AgentDiscSidePanel");
const VERSION = 1;
const PAGE = 100;
const MAX_PAGES_MAIN = 300;
const MAX_PAGES_THREAD = 40;

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
    links: Record<string, number>;
    days: Record<string, DayInfo>;
}

const empty = (): SideData => ({ v: VERSION, places: {}, links: {}, days: {} });
const key = (channelId: string) => `agentdisc-side-${channelId}`;

const loaded = new Map<string, SideData>();
const running = new Set<string>();
const reading = new Set<string>();
const listeners = new Map<string, Set<() => void>>();

function notify(channelId: string) {
    listeners.get(channelId)?.forEach(fn => fn());
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
    const text = [String(m?.content ?? ""), ...(m?.embeds ?? []).map((e: any) => e?.url ?? "")].join(" ");
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
        // The channel's own threads are part of it, not another place.
        const target = ChannelStore.getChannel(t);
        if (target?.parent_id === channelId && target.isThread?.()) continue;
        data.links[t] = (data.links[t] ?? 0) + 1;
    }
}

// At most three pages are asked of Discord at once, whatever the number of channels read.
let inFlight = 0;
const waiting: (() => void)[] = [];

async function page(place: string, query: Record<string, string | number>) {
    if (inFlight >= 3) await new Promise<void>(resolve => waiting.push(resolve));
    inFlight++;
    try {
        const res: any = await RestAPI.get({ url: `/channels/${place}/messages`, query: { limit: PAGE, ...query } } as any);
        return Array.isArray(res?.body) ? res.body as any[] : [];
    } finally {
        inFlight--;
        waiting.shift()?.();
    }
}

async function readPlace(data: SideData, channelId: string, place: string, me: string | undefined, maxPages: number) {
    const state = data.places[place] ??= { newest: null, oldest: null, complete: false };

    // New messages since the last visit.
    if (state.newest) {
        let after = state.newest;
        for (let i = 0; i < maxPages; i++) {
            const batch = await page(place, { after });
            for (const m of batch) take(data, channelId, place, m, me);
            for (const m of batch) if (older(after, m.id)) after = m.id;
            state.newest = after;
            notify(channelId);
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
        notify(channelId);
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
    loaded.set(channelId, data);
    return data;
}

// Reads what is new (and what is still unread) for a channel and its threads, three
// places at a time. One reading per channel at once.
async function refresh(channelId: string, guildId: string) {
    if (running.has(channelId)) return;
    running.add(channelId);
    reading.add(channelId);
    notify(channelId);
    try {
        const data = await load(channelId);
        const me = UserStore.getCurrentUser()?.id;
        const { ids } = await placesOf(channelId, guildId);
        let next = 0;
        const worker = async () => {
            while (next < ids.length) {
                const place = ids[next++];
                try {
                    await readPlace(data, channelId, place, me, place === channelId ? MAX_PAGES_MAIN : MAX_PAGES_THREAD);
                } catch (e) {
                    logger.warn("Could not read", place, e);
                }
            }
        };
        await Promise.all([worker(), worker(), worker()]);
        await save(channelId, data);
    } finally {
        running.delete(channelId);
        reading.delete(channelId);
        notify(channelId);
    }
}

// A message posted while the panel knows the channel counts at once.
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
    notify(channelId);
    save(channelId, data);
}

export function startSideData() {
    FluxDispatcher.subscribe("MESSAGE_CREATE", onMessage);
}

export function stopSideData() {
    FluxDispatcher.unsubscribe("MESSAGE_CREATE", onMessage);
}

export function useSideData(channelId: string, guildId: string | null | undefined) {
    const [, rerender] = useState(0);
    useEffect(() => {
        let queued = false;
        const fn = () => {
            if (queued) return;
            queued = true;
            requestAnimationFrame(() => {
                queued = false;
                rerender(x => x + 1);
            });
        };
        const set = listeners.get(channelId) ?? new Set();
        set.add(fn);
        listeners.set(channelId, set);
        if (guildId) refresh(channelId, guildId);
        else load(channelId).then(fn);
        return () => void set.delete(fn);
    }, [channelId, guildId]);
    return { data: loaded.get(channelId) ?? null, reading: reading.has(channelId) };
}
