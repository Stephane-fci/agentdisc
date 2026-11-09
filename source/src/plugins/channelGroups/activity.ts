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
// shows me the channels that are relevant to this category"; later the same day: "I also want to
// be able to add one category to different categories ... Agents ... and researchers are things I
// want to see potentially when I work with clients and also when I work for my researchers").
// Each server, category, channel or thread can belong to one or several of his activities, or be
// "always visible". Saved by Discord's own ids, apart from the focus choices (hiddenFamilies,
// focusOn), which stay as they are. While an activity records, the list shows only the places
// that belong to it; while nothing records (or Break), the whole list.
//
// Which activities a place belongs to, the most precise answer first:
//   a thread set by itself, else its channel;
//   a channel set by itself;
//   outside its own family's categories, the family of the channel's emoji (its main category's
//   choice), so a channel marked with a family's emoji follows it wherever it sits, as focus does;
//   its category; an archive category follows its family's main category unless set itself;
//   the whole server;
//   otherwise none: such places leave a filtered list.
// The view applies only in servers where something is assigned, and the open conversation and
// its channel always stay.

export type Place = Activity | "always";
type Stored = Place | Place[];
export interface GuildMap { server?: Stored; categories?: Record<string, Stored>; channels?: Record<string, Stored>; }

const CATEGORY = 4;
const NONE: Place[] = [];
const isPlace = (p: unknown): p is Place => p === "always" || ACTIVITIES.includes(p as Activity);

// A saved choice as a list: one activity (saved before several were possible) or several.
export function places(value: unknown): Place[] {
    if (Array.isArray(value)) return [...new Set(value.filter(isPlace))];
    return isPlace(value) ? [value] : NONE;
}

function maps(): Record<string, GuildMap> {
    return (Settings.plugins.ChannelGroups?.activityMap ?? {}) as Record<string, GuildMap>;
}

export function guildMap(guildId: string): GuildMap {
    return maps()[guildId] ?? {};
}

const cache = new Map<string, Place[]>();
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

function familyChoice(map: GuildMap, family: CategoryFamily | null): Place[] {
    return family?.main ? places(map.categories?.[family.main.id]) : NONE;
}

function categoryPlaces(guildId: string, map: GuildMap, categoryId: string): Place[] {
    const own = places(map.categories?.[categoryId]);
    return own.length ? own : familyChoice(map, familyOfCategory(guildId, categoryId));
}

const or = (...lists: Place[][]) => lists.find(l => l.length) ?? NONE;

export function activitiesOf(id: string | null | undefined): Place[] {
    if (!id) return NONE;
    const known = cache.get(id);
    if (known) return known;
    let answer = NONE;
    const channel = ChannelStore.getChannel(id);
    if (channel?.guild_id) {
        const map = guildMap(channel.guild_id);
        const own = places(map.channels?.[id]);
        const server = places(map.server);
        if (own.length) answer = own;
        else if (channel.isThread?.()) answer = activitiesOf(channel.parent_id);
        else if (channel.type === CATEGORY) answer = or(categoryPlaces(channel.guild_id, map, id), server);
        else {
            const family = familyForName(channel.name ?? "", familiesOf(channel.guild_id));
            const home = channel.parent_id ? familyOfCategory(channel.guild_id, channel.parent_id) : null;
            // In its own family's categories (an archive included) the category decides, so a
            // choice made for an archive holds; outside them, its emoji's family does.
            const byEmoji = family && family !== home ? familyChoice(map, family) : NONE;
            answer = or(byEmoji, channel.parent_id ? categoryPlaces(channel.guild_id, map, channel.parent_id) : NONE, server);
        }
    }
    cache.set(id, answer);
    return answer;
}

export function hasAssignments(guildId: string | null | undefined) {
    if (!guildId) return false;
    const map = guildMap(guildId);
    return places(map.server).length > 0
        || Object.values(map.categories ?? {}).some(v => places(v).length > 0)
        || Object.values(map.channels ?? {}).some(v => places(v).length > 0);
}

// The activity the list is filtered to in this server, or null for the whole list.
export function filterIn(guildId: string | null | undefined): Activity | null {
    const a = focusActivity();
    if (!a || !guildId || !hasAssignments(guildId)) return null;
    return a;
}

const fits = (list: Place[], a: Activity) => list.includes(a) || list.includes("always");

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
    if (fits(activitiesOf(id), a) || isOpenLine(id)) return true;
    return threadsUnder(channel.guild_id, id).some(t => fits(activitiesOf(t), a));
}

// A thread line under its channel in the filtered list.
export function keepsThread(id: string) {
    const thread = ChannelStore.getChannel(id);
    const a = filterIn(thread?.guild_id);
    if (!a) return true;
    return fits(activitiesOf(id), a) || SelectedChannelStore.getChannelId() === id;
}

// A category title in the filtered list: shown when the category belongs to the activity or
// still has a line to show.
export function hidesCategory(categoryId: string) {
    const category = ChannelStore.getChannel(categoryId);
    const a = filterIn(category?.guild_id);
    if (!a) return false;
    if (fits(activitiesOf(categoryId), a)) return false;
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

// ---- Changing the map ----

function write(guildId: string, edit: (m: GuildMap) => void) {
    const all = { ...maps() };
    const m: GuildMap = { server: all[guildId]?.server, categories: { ...all[guildId]?.categories }, channels: { ...all[guildId]?.channels } };
    edit(m);
    if (!places(m.server).length) delete m.server;
    for (const key of ["categories", "channels"] as const) {
        for (const [id, v] of Object.entries(m[key]!)) if (!places(v).length) delete m[key]![id];
        if (!Object.keys(m[key]!).length) delete m[key];
    }
    if (Object.keys(m).length) all[guildId] = m;
    else delete all[guildId];
    Settings.plugins.ChannelGroups.activityMap = all;
}

export function setServerPlaces(guildId: string, list: Place[]) {
    write(guildId, m => { m.server = places(list); });
}

export function setCategoryPlaces(guildId: string, categoryId: string, list: Place[]) {
    write(guildId, m => { m.categories![categoryId] = places(list); });
}

export function setChannelPlaces(guildId: string, channelId: string, list: Place[]) {
    write(guildId, m => { m.channels![channelId] = places(list); });
}

// What a place was given by itself (not followed from above).
export function ownPlaces(id: string): Place[] {
    const channel = ChannelStore.getChannel(id);
    if (!channel?.guild_id) return NONE;
    const m = guildMap(channel.guild_id);
    return places(channel.type === CATEGORY ? m.categories?.[id] : m.channels?.[id]);
}

export function familiesFor(guildId: string) {
    return categoryFamilies(guildId);
}
