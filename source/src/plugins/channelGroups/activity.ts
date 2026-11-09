/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Settings } from "@api/Settings";
import { ACTIVITIES, type Activity, focusActivity } from "@plugins/vencordToolbox/timeFocus";
import { ActiveJoinedThreadsStore, ChannelStore, GuildChannelStore, SelectedChannelStore } from "@webpack/common";

import { categoryFamilies, type CategoryFamily, familyForName } from "./boxes";

// Activities in the channel list (Stephane, 9 Nov 2026: "When I select one, by default, it only
// shows me the channels that are relevant to this category"). Each server, category, channel or
// thread can belong to one of his activities, or be "always visible". Saved by Discord's own
// ids, apart from the focus choices (hiddenFamilies, focusOn), which stay as they are.
//
// Which activity a place belongs to, the most precise answer first:
//   a thread set by itself, else its channel;
//   a channel set by itself;
//   outside its own family's categories, the family of the channel's emoji (its main
//   category's choice), so a channel marked with a family's emoji follows it wherever it sits,
//   as focus does;
//   its category; an archive category follows its family's main category unless set itself;
//   the whole server;
//   otherwise not assigned.
// Not assigned never counts as any activity: those places leave a filtered list and are listed
// in the Today part to be assigned. The view applies only in servers where something is
// assigned, and the open conversation and its channel always stay, marked as outside.

export type Place = Activity | "always";
export interface GuildMap { server?: Place; categories?: Record<string, Place>; channels?: Record<string, Place>; }

const CATEGORY = 4;
const isPlace = (p: unknown): p is Place => p === "always" || ACTIVITIES.includes(p as Activity);

function maps(): Record<string, GuildMap> {
    return (Settings.plugins.ChannelGroups?.activityMap ?? {}) as Record<string, GuildMap>;
}

export function guildMap(guildId: string): GuildMap {
    return maps()[guildId] ?? {};
}

const cache = new Map<string, Place | null>();
const families = new Map<string, CategoryFamily[]>();

export function clearActivityCache() {
    cache.clear();
    families.clear();
}

function familiesOf(guildId: string) {
    let list = families.get(guildId);
    if (!list) families.set(guildId, list = categoryFamilies(guildId));
    return list;
}

function familyOfCategory(guildId: string, categoryId: string) {
    return familiesOf(guildId).find(f => f.main?.id === categoryId || f.archives.some(a => a.id === categoryId)) ?? null;
}

function familyChoice(map: GuildMap, family: CategoryFamily | null): Place | null {
    if (!family) return null;
    const own = family.main && map.categories?.[family.main.id];
    return isPlace(own) ? own : null;
}

function categoryPlace(guildId: string, map: GuildMap, categoryId: string): Place | null {
    const own = map.categories?.[categoryId];
    if (isPlace(own)) return own;
    return familyChoice(map, familyOfCategory(guildId, categoryId));
}

export function activityOf(id: string | null | undefined): Place | null {
    if (!id) return null;
    const known = cache.get(id);
    if (known !== undefined) return known;
    let answer: Place | null = null;
    const channel = ChannelStore.getChannel(id);
    if (channel?.guild_id) {
        const map = guildMap(channel.guild_id);
        const own = map.channels?.[id];
        if (isPlace(own)) answer = own;
        else if (channel.isThread?.()) answer = activityOf(channel.parent_id);
        else if (channel.type === CATEGORY) answer = categoryPlace(channel.guild_id, map, id) ?? (isPlace(map.server) ? map.server : null);
        else {
            const family = familyForName(channel.name ?? "", familiesOf(channel.guild_id));
            const home = channel.parent_id ? familyOfCategory(channel.guild_id, channel.parent_id) : null;
            // In its own family's categories (an archive included) the category decides, so a
            // choice made for an archive holds; outside them, its emoji's family does.
            const byEmoji = family && family !== home ? familyChoice(map, family) : null;
            answer = byEmoji
                ?? (channel.parent_id ? categoryPlace(channel.guild_id, map, channel.parent_id) : null)
                ?? (isPlace(map.server) ? map.server : null);
        }
    }
    cache.set(id, answer);
    return answer;
}

export function hasAssignments(guildId: string | null | undefined) {
    if (!guildId) return false;
    const map = guildMap(guildId);
    return isPlace(map.server) || Object.values(map.categories ?? {}).some(isPlace) || Object.values(map.channels ?? {}).some(isPlace);
}

// Show all (the line above the list): kept for the activity it was chosen in; choosing another
// activity brings the filtered view back. The timer never changes with it.
export function showingAll() {
    const a = focusActivity();
    return !!a && Settings.plugins.ChannelGroups?.activityShowAll === a;
}

export function setShowAll(on: boolean) {
    Settings.plugins.ChannelGroups.activityShowAll = on ? focusActivity() : null;
}

// The activity the list is filtered to in this server, or null for the whole list.
export function filterIn(guildId: string | null | undefined): Activity | null {
    const a = focusActivity();
    if (!a || !guildId || showingAll() || !hasAssignments(guildId)) return null;
    return a;
}

const fits = (place: Place | null, a: Activity) => place === a || place === "always";

// The open conversation and its channel never leave the list.
export function isOpenLine(id: string) {
    const selected = SelectedChannelStore.getChannelId();
    if (!selected) return false;
    if (selected === id) return true;
    const open = ChannelStore.getChannel(selected);
    return !!open?.isThread?.() && open.parent_id === id;
}

// Every thread the list can show under a channel: its active threads, and the pinned and
// bookmarked ones, which stay listed even once archived.
function threadsUnder(guildId: string, id: string): string[] {
    const out = new Set(Object.keys(ActiveJoinedThreadsStore.getActiveJoinedThreadsForParent(guildId, id) ?? {}));
    const s = Settings.plugins.ChannelGroups ?? {};
    for (const t of [...Object.keys(s.pins ?? {}), ...Object.keys(s.priority ?? {})]) {
        const c = ChannelStore.getChannel(t);
        if (c?.isThread?.() && c.parent_id === id) out.add(t);
    }
    return [...out];
}

// A top-level channel line in the filtered list: its own activity, or a thread shown under it set
// to the activity (the channel then shows as the way to that thread), or the open conversation.
export function keepsChannel(id: string) {
    const channel = ChannelStore.getChannel(id);
    const a = filterIn(channel?.guild_id);
    if (!a) return true;
    if (fits(activityOf(id), a) || isOpenLine(id)) return true;
    return threadsUnder(channel.guild_id, id).some(t => fits(activityOf(t), a));
}

// A thread line under its channel in the filtered list.
export function keepsThread(id: string) {
    const thread = ChannelStore.getChannel(id);
    const a = filterIn(thread?.guild_id);
    if (!a) return true;
    return fits(activityOf(id), a) || SelectedChannelStore.getChannelId() === id;
}

// A category title in the filtered list: shown when the category belongs to the activity or
// still has a line to show.
export function hidesCategory(categoryId: string) {
    const category = ChannelStore.getChannel(categoryId);
    const a = filterIn(category?.guild_id);
    if (!a) return false;
    if (fits(activityOf(categoryId), a)) return false;
    return !channelsIn(category.guild_id, categoryId).some(keepsChannel);
}

function channelsIn(guildId: string, categoryId: string): string[] {
    try {
        const all = GuildChannelStore.getChannels(guildId) as any;
        const out: string[] = [];
        for (const key of Object.keys(all ?? {})) {
            const list = all[key];
            if (!Array.isArray(list)) continue;
            for (const e of list) if (e?.channel?.parent_id === categoryId && e.channel.type !== CATEGORY) out.push(e.channel.id);
        }
        return out;
    } catch {
        return [];
    }
}

// The lines kept only because they are open: marked "outside" in the list.
export function outsideLines(): string[] {
    const selected = SelectedChannelStore.getChannelId();
    const open = selected ? ChannelStore.getChannel(selected) : null;
    if (!open?.guild_id) return [];
    const a = filterIn(open.guild_id);
    if (!a) return [];
    const out: string[] = [];
    if (!fits(activityOf(open.id), a)) out.push(open.id);
    if (open.isThread?.() && !fits(activityOf(open.parent_id), a) && !keepsChannelByContent(open.parent_id, a)) out.push(open.parent_id);
    return out;
}

function keepsChannelByContent(id: string, a: Activity) {
    const channel = ChannelStore.getChannel(id);
    if (!channel?.guild_id) return false;
    return threadsUnder(channel.guild_id, id).some(t => fits(activityOf(t), a));
}

// ---- Changing the map ----

function write(guildId: string, edit: (m: GuildMap) => void) {
    const all = { ...maps() };
    const m: GuildMap = { server: all[guildId]?.server, categories: { ...all[guildId]?.categories }, channels: { ...all[guildId]?.channels } };
    edit(m);
    if (!isPlace(m.server)) delete m.server;
    if (!Object.keys(m.categories!).length) delete m.categories;
    if (!Object.keys(m.channels!).length) delete m.channels;
    if (Object.keys(m).length) all[guildId] = m;
    else delete all[guildId];
    Settings.plugins.ChannelGroups.activityMap = all;
}

export function setServerPlace(guildId: string, place: Place | null) {
    write(guildId, m => { m.server = place ?? undefined; });
}

export function setCategoryPlace(guildId: string, categoryId: string, place: Place | null) {
    write(guildId, m => {
        if (place) m.categories![categoryId] = place;
        else delete m.categories![categoryId];
    });
}

export function setChannelPlace(guildId: string, channelId: string, place: Place | null) {
    write(guildId, m => {
        if (place) m.channels![channelId] = place;
        else delete m.channels![channelId];
    });
}

// A place set by itself (not followed from above).
export function ownPlace(id: string): Place | null {
    const channel = ChannelStore.getChannel(id);
    if (!channel?.guild_id) return null;
    const m = guildMap(channel.guild_id);
    const own = channel.type === CATEGORY ? m.channels?.[id] ?? m.categories?.[id] : m.channels?.[id];
    return isPlace(own) ? own : null;
}

// Suggestions from the emoji of his server's families (the usual channel naming): offered in the
// Today part, applied only when he clicks "Use suggestions".
const SUGGEST: Record<string, Activity> = {
    "🦕": "clients", "🦐": "clients", "🐤": "clients", "🍍": "clients",
    "🐝": "made",
    "🧧": "videos", "🎥": "videos",
    "🔎": "learning", "🧪": "learning"
};

export function suggestionFor(family: CategoryFamily): Activity | null {
    const sign = (family.emoji ?? "").replace(/[︎️]/g, "");
    return SUGGEST[sign] ?? null;
}

export function familiesFor(guildId: string) {
    return categoryFamilies(guildId);
}

// The top-level channels of a server that belong to no activity yet.
export function unassignedChannels(guildId: string): string[] {
    try {
        const all = GuildChannelStore.getChannels(guildId) as any;
        const ids: string[] = [];
        for (const key of Object.keys(all ?? {})) {
            const list = all[key];
            if (!Array.isArray(list) || key === String(CATEGORY)) continue;
            for (const e of list) {
                const c = e?.channel;
                if (c?.id && c.type !== CATEGORY && !c.isThread?.() && activityOf(c.id) === null) ids.push(c.id);
            }
        }
        return [...new Set(ids)];
    } catch {
        return [];
    }
}
