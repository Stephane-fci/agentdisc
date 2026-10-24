/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { findStoreLazy } from "@webpack";
import { UserStore } from "@webpack/common";

// The Team view of the right panel (Stephane, 24 Oct: "the original pannel with only the
// people in the server"): Discord's own member list with the bots taken out.
//
// The list is filtered where Discord reads it, so it draws exactly as for a server without
// bots: each group keeps only its people and its count follows, a group left with nobody
// goes. A channel's list comes from ChannelMemberStore (one row per group heading, then its
// members); a thread's from ThreadMemberListStore (sections of user ids). Only while the
// Team view shows; otherwise Discord's own answers pass through untouched.

const ChannelMemberStore = findStoreLazy("ChannelMemberStore") as any;
const ThreadMemberListStore = findStoreLazy("ThreadMemberListStore") as any;

// Kept apart from Discord's own counter, so the list always draws again when the view changes.
const SHIFT = 1_000_000_000;

let on = false;
let installed = false;
let originals: { getProps?: Function; getSections?: Function; getVersion?: Function; } = {};
let lastLists = new Map<string, { version: number; rows: unknown; out: any; }>();
let lastThreads = new Map<string, { version: unknown; out: any; }>();

const isBot = (user: any) => user?.bot === true;

function people(props: any) {
    if (!props || !Array.isArray(props.groups) || !Array.isArray(props.rows)) return props;
    const hit = lastLists.get(props.listId);
    if (hit && hit.version === props.version && hit.rows === props.rows) return hit.out;
    const rows: any[] = [];
    const groups: any[] = [];
    for (const group of props.groups) {
        const start = typeof group?.index === "number" ? group.index : -1;
        const count = typeof group?.count === "number" ? group.count : 0;
        if (start < 0) continue;
        const members: any[] = [];
        for (let i = start + 1; i <= start + count; i++) {
            const row = props.rows[i];
            // A row not loaded yet stays: Discord draws it as a waiting line.
            if (row?.type === "MEMBER" && isBot(row.user)) continue;
            members.push(row);
        }
        if (!members.length) continue;
        const heading = props.rows[start] ?? group;
        groups.push({ ...group, count: members.length, index: rows.length });
        rows.push({ ...heading, count: members.length, index: rows.length }, ...members);
    }
    const out = { ...props, groups, rows, version: props.version + SHIFT };
    lastLists.set(props.listId, { version: props.version, rows: props.rows, out });
    return out;
}

// The store changes a thread's sections in place and counts its changes: the copy is kept
// for one count.
function threadPeople(threadId: string, sections: any, version: unknown) {
    if (!sections || typeof sections !== "object") return sections;
    const hit = lastThreads.get(threadId);
    if (hit && hit.version === version && version !== undefined) return hit.out;
    const out: Record<string, any> = {};
    for (const [id, section] of Object.entries<any>(sections)) {
        const ids = Array.isArray(section?.userIds) ? section.userIds.filter((u: string) => !isBot(UserStore.getUser(u))) : section?.userIds;
        if (Array.isArray(ids) && !ids.length) continue;
        out[id] = { ...section, userIds: ids };
    }
    lastThreads.set(threadId, { version, out });
    return out;
}

function install() {
    if (installed) return;
    try {
        const props = ChannelMemberStore.getProps;
        const sections = ThreadMemberListStore.getMemberListSections;
        const version = ThreadMemberListStore.getMemberListVersion;
        if (typeof props !== "function") return;
        originals = { getProps: props, getSections: sections, getVersion: version };
        ChannelMemberStore.getProps = function (...args: any[]) {
            const answer = props.apply(this, args);
            return on ? people(answer) : answer;
        };
        if (typeof sections === "function") ThreadMemberListStore.getMemberListSections = function (...args: any[]) {
            const answer = sections.apply(this, args);
            return on ? threadPeople(String(args[0]), answer, typeof version === "function" ? version.apply(this, args) : undefined) : answer;
        };
        if (typeof version === "function") ThreadMemberListStore.getMemberListVersion = function (...args: any[]) {
            const answer = version.apply(this, args);
            return on && typeof answer === "number" ? answer + SHIFT : answer;
        };
        installed = true;
    } catch { }
}

function redraw() {
    try {
        ChannelMemberStore.emitChange?.();
        ThreadMemberListStore.emitChange?.();
    } catch { }
}

// People only while the Team view shows.
export function setPeopleOnly(next: boolean) {
    if (next) install();
    if (on === next) return;
    on = next;
    lastLists = new Map();
    lastThreads = new Map();
    redraw();
}

export function stopTeamList() {
    on = false;
    if (installed) {
        // The instance's own copies go; Discord's methods on the store's class answer again.
        delete ChannelMemberStore.getProps;
        delete ThreadMemberListStore.getMemberListSections;
        delete ThreadMemberListStore.getMemberListVersion;
        if (ChannelMemberStore.getProps !== originals.getProps) ChannelMemberStore.getProps = originals.getProps;
        if (originals.getSections && ThreadMemberListStore.getMemberListSections !== originals.getSections) ThreadMemberListStore.getMemberListSections = originals.getSections;
        if (originals.getVersion && ThreadMemberListStore.getMemberListVersion !== originals.getVersion) ThreadMemberListStore.getMemberListVersion = originals.getVersion;
        installed = false;
        redraw();
    }
    lastLists = new Map();
    lastThreads = new Map();
}
