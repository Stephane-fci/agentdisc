/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { isPluginEnabled } from "@api/PluginManager";
import { definePluginSettings, Settings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { allPlaces, find, ICONS, type Place } from "@plugins/vencordToolbox/channelSearch";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { filters, findStoreLazy, mapMangledCssClasses, waitFor } from "@webpack";
import { ActiveJoinedThreadsStore, ChannelStore, FluxDispatcher, GuildChannelStore, Menu, NavigationRouter, ReadStateStore, SelectedChannelStore, TypingStore, useEffect, useMemo, useReducer, UserStore, useState, useStateFromStores } from "@webpack/common";

import { openNewChannel } from "./boxes";
import { buildGroupCss, buildPriorityCss, GROUP_SPACE, GroupClasses, PriorityState, THREAD_TRIM } from "./css";

// AgentDisc channel groups (Stephane, 29 Sept): a channel's threads sit closer together
// under it, and a small arrow where Discord's white unread mark was folds them away or
// opens them again, remembered after reload. A channel with open threads sits on one
// soft blue card with them, and the open channel stands out in solid purple (1 Oct).
//
// Discord's channel list places every line from heights it computes itself (its
// getRowHeight). Hiding thread lines or changing their size with styles alone would
// leave gaps or overlaps, so the list itself is told which threads show and how tall
// they are, and redraws when a channel is folded. The same goes for the Events and
// Server Boosts lines above the channels, which the panel switches can hide.

const logger = new Logger("ChannelGroups");

const settings = definePluginSettings({
    folded: {
        type: OptionType.CUSTOM,
        default: {} as Record<string, true>
    },
    // Channels and threads marked as priority, until he removes the mark.
    priority: {
        type: OptionType.CUSTOM,
        default: {} as Record<string, true>
    }
});

function isPriority(id: string | null | undefined) {
    return !!id && settings.store.priority?.[id] === true;
}

export function isBookmarked(id: string | null | undefined) {
    return isPriority(id);
}

export function togglePriority(id: string) {
    const priority = { ...settings.store.priority };
    if (priority[id]) delete priority[id];
    else priority[id] = true;
    settings.store.priority = priority;
    priorityKey = "";
    updatePriority();
    refreshLists([id]);
    redrawList();
}

// One click puts every marked channel and thread back to normal (Stephane, 1 Oct).
export function clearPriorities() {
    const before = Object.keys(settings.store.priority ?? {});
    settings.store.priority = {};
    priorityKey = "";
    updatePriority();
    refreshLists(before);
    redrawList();
}

// A bookmark only colours its line; the channel keeps its place in the list (Stephane,
// 6 Oct: the Bookmarks section at the top was tried and taken out the same evening). The
// list is built again when a bookmark changes, because a closed category keeps bookmarked
// channels in view.
const ChannelListStore = findStoreLazy("ChannelListStore") as { agentdiscRefresh?(guildId: string): boolean; agentdiscUpdate?(channelId: string): boolean; emitChange(): void; };
const CATEGORY = 4;

function isChannelBookmark(id: string) {
    if (!isPriority(id) || !isPluginEnabled("ChannelGroups")) return false;
    const channel = ChannelStore.getChannel(id);
    return !!channel && !channel.isThread() && channel.type !== CATEGORY;
}

// In a closed category, a bookmarked channel and a channel where someone is typing (in it
// or in one of its threads) stay visible, like an unread one (Stephane, 6 Oct).
const typingShown = new Set<string>();
const typingCandidates = new Set<string>();
let typingQueued = false;

function keepVisible(id: string) {
    return isChannelBookmark(id) || (isPluginEnabled("ChannelGroups") && typingShown.has(id));
}

function someoneTyping(channelId: string, guildId: string, me: string | undefined) {
    const lines = [channelId, ...Object.keys(ActiveJoinedThreadsStore.getActiveJoinedThreadsForParent(guildId, channelId) ?? {})];
    return lines.some(l => Object.keys(TypingStore.getTypingUsers(l) ?? {}).some(u => u !== me));
}

function checkTyping() {
    typingQueued = false;
    try {
        const me = UserStore.getCurrentUser()?.id;
        let changed = false;
        for (const id of typingCandidates) {
            const channel = ChannelStore.getChannel(id);
            const typing = !!channel?.guild_id && someoneTyping(id, channel.guild_id, me);
            if (typing === typingShown.has(id)) {
                if (!typing) typingCandidates.delete(id);
                continue;
            }
            if (typing) typingShown.add(id);
            else {
                typingShown.delete(id);
                typingCandidates.delete(id);
            }
            if (ChannelListStore.agentdiscUpdate?.(id)) changed = true;
        }
        if (changed) ChannelListStore.emitChange();
    } catch (e) {
        logger.warn("Could not show the channels where someone is typing", e);
    }
}

function queueTypingCheck() {
    if (typingQueued || !typingCandidates.size) return;
    typingQueued = true;
    requestAnimationFrame(checkTyping);
}

// Someone starts typing: their channel (a thread's channel) is checked on the next frame.
function onTypingStart({ channelId }: { channelId?: string; }) {
    const channel = channelId ? ChannelStore.getChannel(channelId) : null;
    if (!channel?.guild_id) return;
    typingCandidates.add(channel.isThread() ? channel.parent_id : channel.id);
    queueTypingCheck();
}

function refreshLists(ids: string[]) {
    try {
        const guilds = new Set(ids.map(id => ChannelStore.getChannel(id)?.guild_id).filter(Boolean) as string[]);
        for (const guildId of guilds) ChannelListStore.agentdiscRefresh?.(guildId);
        ChannelListStore.emitChange();
    } catch (e) {
        logger.warn("Could not redraw the channel list after a bookmark", e);
    }
}

// What is happening in a marked line: an agent typing there (or, for a folded channel, in
// one of its hidden threads, whose dots show on the channel line), else unread or not.
function priorityState(id: string): PriorityState {
    const me = UserStore.getCurrentUser()?.id;
    const channel = ChannelStore.getChannel(id);
    const lines = [id];
    if (channel?.guild_id && isFolded(id)) {
        const selected = SelectedChannelStore.getChannelId();
        for (const t of Object.keys(ActiveJoinedThreadsStore.getActiveJoinedThreadsForParent(channel.guild_id, id) ?? {})) {
            if (t !== selected) lines.push(t);
        }
    }
    if (lines.some(l => Object.keys(TypingStore.getTypingUsers(l) ?? {}).some(u => u !== me))) return "green";
    return lines.some(l => ReadStateStore.hasUnread(l)) ? "red" : "yellow";
}

let priorityStyle: HTMLStyleElement | null = null;
let priorityKey = "";
let priorityQueued = false;

function updatePriority() {
    if (!priorityStyle) return;
    let items: { id: string; state: PriorityState; }[] = [];
    try {
        items = Object.keys(settings.store.priority ?? {}).map(id => ({ id, state: priorityState(id) }));
    } catch (e) {
        logger.warn("Could not read the priority lines", e);
    }
    const key = items.map(i => i.id + i.state).join() + "|" + (classes.line ? "1" : "0");
    if (key === priorityKey) return;
    priorityKey = key;
    priorityStyle.textContent = buildPriorityCss(items, classes.line);
}

// Typing and reading change often; the colours are worked out again at most once a frame.
function queuePriority() {
    if (priorityQueued || !Object.keys(settings.store.priority ?? {}).length) return;
    priorityQueued = true;
    requestAnimationFrame(() => {
        priorityQueued = false;
        updatePriority();
    });
}

const PRIORITY_STORES = () => [TypingStore, ReadStateStore, SelectedChannelStore, ActiveJoinedThreadsStore] as any[];

export function usePriority(id: string | null | undefined) {
    const { priority } = settings.use(["priority"]);
    return !!id && priority?.[id] === true;
}

const priorityMenu: NavContextMenuPatchCallback = (children, { channel }: { channel?: { id: string; }; }) => {
    if (!channel) return;
    children.push(
        <Menu.MenuGroup>
            <Menu.MenuItem
                id="agentdisc-priority"
                label={isPriority(channel.id) ? "Remove bookmark" : "Bookmark"}
                action={() => togglePriority(channel.id)}
            />
        </Menu.MenuGroup>
    );
};

interface ChannelRow {
    id: string;
    threadIds: string[];
    threadCount: number;
}

const NONE: string[] = [];

// What the channel list last listed under each channel, for the arrows.
const listed = new Map<string, string[]>();
const listeners = new Set<() => void>();
let notifyQueued = false;

function notify() {
    if (notifyQueued) return;
    notifyQueued = true;
    queueMicrotask(() => {
        notifyQueued = false;
        listeners.forEach(l => l());
    });
}

function isFolded(channelId: string) {
    return settings.store.folded?.[channelId] === true;
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);

// The open threads of a channel that its fold hides right now (all but the thread being
// read). The channel line shows who is typing in them, so a folded channel still says
// which agents are at work (Stephane, 30 Sept).
export function useHiddenThreads(channelId: string, guildId: string | null | undefined): string[] {
    const { folded } = settings.use(["folded"]);
    const selected = useStateFromStores([SelectedChannelStore], () => SelectedChannelStore.getChannelId());
    const threads = useStateFromStores(
        [ActiveJoinedThreadsStore],
        () => guildId ? Object.keys(ActiveJoinedThreadsStore.getActiveJoinedThreadsForParent(guildId, channelId) ?? {}).sort() : NONE,
        [guildId, channelId],
        sameIds
    );
    if (!folded?.[channelId] || !isPluginEnabled("ChannelGroups")) return NONE;
    return threads.filter(id => id !== selected);
}

// Under a folded channel only the thread being read and priority threads stay, like
// Discord's folded categories.
const keptOnly = new Map<string, string[]>();
function shownThreads(row: ChannelRow): string[] {
    try {
        const ids = row.threadIds ?? NONE;
        const before = listed.get(row.id);
        if (before !== ids && (before?.length ?? 0) + ids.length > 0) {
            listed.set(row.id, ids);
            notify();
        }
        if (ids.length === 0 || !isFolded(row.id)) return ids;

        const selected = SelectedChannelStore.getChannelId();
        const kept = ids.filter(id => id === selected || isPriority(id));
        if (!kept.length) return NONE;
        const key = kept.join();
        let same = keptOnly.get(key);
        if (!same) keptOnly.set(key, same = kept);
        return same;
    } catch (e) {
        logger.error("Could not work out the threads of a channel", e);
        return row.threadIds;
    }
}

// The list keeps its computed layout until one of its inputs changes. A new height
// function (same answers, new identity) makes it measure again after a fold, when the
// Events lines are hidden or shown, or when the thread being read under a folded
// channel changes.
let layoutVersion = 0;
let list: { forceUpdate(): void; } | null = null;
const heightFns = new WeakMap<Function, { key: string; fn: Function; }>();

function rowHeight(getRowHeight: Function) {
    try {
        const selected = ChannelStore.getChannel(SelectedChannelStore.getChannelId());
        const parent = selected?.isThread?.() ? selected.parent_id : null;
        const key = `${layoutVersion}:${parent && isFolded(parent) ? selected!.id : ""}`;
        let entry = heightFns.get(getRowHeight);
        if (entry?.key !== key) {
            entry = { key, fn: (section: number, row: number) => getRowHeight(section, row) };
            heightFns.set(getRowHeight, entry);
        }
        return entry.fn;
    } catch {
        return getRowHeight;
    }
}

function redrawList() {
    layoutVersion++;
    try {
        list?.forceUpdate();
    } catch (e) {
        logger.warn("Could not redraw the channel list", e);
    }
}

// The threads the channel list shows under a channel (the links panel reads them too).
export function listedThreads(channelId: string): string[] {
    return listed.get(channelId) ?? NONE;
}

export function redrawChannelList() {
    redrawList();
}

// The panel switch "Hide Events and Boosts" (PanelSwitches), read here because these
// lines live inside the channel list. Only these lines go; others Discord shows above
// the channels in some servers (Server Guide, Channels & Roles, Shop) stay.
const TOP_LINES = new Set(["guild-scheduled-events", "guild-boosts", "guild-premium-progress-bar"]);

function hideTopLine(row: unknown) {
    const panel = Settings.plugins.PanelSwitches as { enabled?: boolean; hideServerLines?: boolean; } | undefined;
    return panel?.enabled !== false && panel?.hideServerLines === true && TOP_LINES.has(row as string);
}

// With every line above the channels hidden, the divider under them goes too.
function onlyHiddenTopLines(rows: unknown) {
    return Array.isArray(rows) && rows.length > 0 && rows.every(hideTopLine);
}

function toggleFold(channelId: string) {
    const folded = { ...settings.store.folded };
    if (folded[channelId]) delete folded[channelId];
    else folded[channelId] = true;
    settings.store.folded = folded;
    redrawList();
    notify();
}

// Fold or open every channel with threads in one server at once.
function setAllFolded(channelIds: string[], fold: boolean) {
    const folded = { ...settings.store.folded };
    for (const id of channelIds) {
        if (fold) folded[id] = true;
        else delete folded[id];
    }
    settings.store.folded = folded;
    redrawList();
    notify();
}

function useListedChanges() {
    const [, rerender] = useReducer(x => x + 1, 0);
    useEffect(() => {
        listeners.add(rerender);
        return () => void listeners.delete(rerender);
    }, []);
}

function useListed(channelId: string) {
    useListedChanges();
    return listed.get(channelId) ?? NONE;
}

const CHEVRON = "M5.3 8.3a1 1 0 0 1 1.4 0L12 13.6l5.3-5.3a1 1 0 1 1 1.4 1.4l-6 6a1 1 0 0 1-1.4 0l-6-6a1 1 0 0 1 0-1.4Z";

const SEARCH = "M15.62 17.03a9 9 0 1 1 1.41-1.41l4.68 4.67a1 1 0 0 1-1.42 1.42l-4.67-4.68ZM17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z";
const PLUS = "M13 5a1 1 0 1 0-2 0v6H5a1 1 0 1 0 0 2h6v6a1 1 0 1 0 2 0v-6h6a1 1 0 1 0 0-2h-6V5Z";
const CLOSE = "M17.3 18.7a1 1 0 0 0 1.4-1.4L13.42 12l5.3-5.3a1 1 0 0 0-1.42-1.4L12 10.58l-5.3-5.3a1 1 0 0 0-1.4 1.42L10.58 12l-5.3 5.3a1 1 0 1 0 1.42 1.4L12 13.42l5.3 5.3Z";
const FLAG = "M5 21V4m0 0h11.5l-2 4 2 4H5";

const CategoryCollapseStore = findStoreLazy("CategoryCollapseStore") as { isCollapsed(id: string): boolean; };

function categoryIds(guildId: string): string[] {
    try {
        // Discord's list of categories starts with a made-up "Uncategorized" one; only real ones count.
        return ((GuildChannelStore.getChannels(guildId) as any)?.[CATEGORY] ?? [])
            .map((c: any) => c.channel?.id)
            .filter((id: string) => id && ChannelStore.getChannel(id)?.type === CATEGORY);
    } catch {
        return NONE;
    }
}

// The channel filter (Stephane, 6 Oct): while he types, only the matching channels and
// threads of this server stay in the panel; the arrows move, Enter opens, Esc clears.
function ChannelFilter({ guildId, onClose }: { guildId: string; onClose(): void; }) {
    const [query, setQuery] = useState("");
    const [active, setActive] = useState(0);
    const places = useMemo(() => allPlaces(guildId), [guildId]);
    const results = useMemo(() => find(places, query, 80), [places, query]);
    const selected = useStateFromStores([SelectedChannelStore], () => SelectedChannelStore.getChannelId());
    const unread = useStateFromStores([ReadStateStore], () => results.filter(p => ReadStateStore.hasUnread(p.id)).map(p => p.id).join(), [results]);
    const filtering = query.trim().length > 0;

    useEffect(() => setActive(0), [query]);
    useEffect(() => {
        document.documentElement.classList.toggle("agentdisc-channel-filter", filtering);
        return () => document.documentElement.classList.remove("agentdisc-channel-filter");
    }, [filtering]);

    const go = (p: Place | undefined) => p && NavigationRouter.transitionTo(`/channels/${p.guildId}/${p.id}`);
    const unreadIds = new Set(unread.split(","));

    return (
        <div className="vc-filter">
            <div className="vc-filter-box">
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fillRule="evenodd" d={SEARCH} /></svg>
                <input
                    className="vc-filter-input"
                    placeholder="Filter channels…"
                    value={query}
                    autoFocus
                    onChange={e => setQuery(e.currentTarget.value)}
                    onKeyDown={e => {
                        if (e.key === "Escape") { e.preventDefault(); if (query) setQuery(""); else onClose(); }
                        else if (e.key === "ArrowDown") { e.preventDefault(); setActive(i => Math.min(i + 1, results.length - 1)); }
                        else if (e.key === "ArrowUp") { e.preventDefault(); setActive(i => Math.max(i - 1, 0)); }
                        else if (e.key === "Enter") { e.preventDefault(); go(results[active]); }
                        e.stopPropagation();
                    }}
                />
                <button type="button" className="vc-filter-close" title="Close the filter" onClick={onClose}>
                    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d={CLOSE} /></svg>
                </button>
            </div>
            {filtering && (
                <div className="vc-filter-list">
                    {results.map((p, i) => (
                        <div
                            key={p.id}
                            className={"vc-filter-item" + (p.id === selected ? " vc-filter-selected" : "") + (i === active ? " vc-filter-active" : "") + (unreadIds.has(p.id) ? " vc-filter-unread" : "") + (p.kind === "thread" ? " vc-filter-thread" : "")}
                            onMouseEnter={() => setActive(i)}
                            onClick={() => go(p)}
                        >
                            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fillRule="evenodd" d={ICONS[p.kind]} /></svg>
                            <span className="vc-filter-name">{p.name}</span>
                            {p.parentName && <span className="vc-filter-where">{p.parentName}</span>}
                        </div>
                    ))}
                    {!results.length && <div className="vc-filter-none">No channel matches.</div>}
                </div>
            )}
        </div>
    );
}

// The buttons above the channel list (Stephane, 29 Sept, then 1 and 6 Oct): show or hide
// every thread, clear every bookmark, close or open every category, filter the channels and
// create a channel. They stay in place while the list scrolls.
function ListTools({ guildId }: { guildId: string; }) {
    useListedChanges();
    const { folded, priority } = settings.use(["folded", "priority"]);
    const [filterOpen, setFilterOpen] = useState(false);

    const withThreads: string[] = [];
    for (const [id, threads] of listed) {
        if (threads.length > 0 && ChannelStore.getChannel(id)?.guild_id === guildId) withThreads.push(id);
    }

    const categories = useStateFromStores([GuildChannelStore], () => categoryIds(guildId), [guildId], sameIds);
    const anyOpen = useStateFromStores([CategoryCollapseStore as any], () => categories.some(id => !CategoryCollapseStore.isCollapsed(id)), [categories]);

    const someFolded = withThreads.some(id => folded?.[id]);
    const marks = Object.keys(priority ?? {}).length;
    return (
        <div className="vc-list-tools">
            <div className="vc-threads-all-row">
                {withThreads.length > 0 && (
                    <button type="button" className={"vc-threads-all" + (someFolded ? " vc-threads-all-closed" : "")} onClick={() => setAllFolded(withThreads, !someFolded)}>
                        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d={CHEVRON} /></svg>
                        {someFolded ? "Show threads" : "Hide threads"}
                    </button>
                )}
                {marks > 0 && (
                    <button type="button" className="vc-priority-clear" title="Remove every bookmark" onClick={clearPriorities}>
                        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d={FLAG} fill="#f23f43" stroke="#f23f43" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /></svg>
                        Clear {marks}
                    </button>
                )}
                {categories.length > 0 && (
                    <button
                        type="button"
                        className={"vc-threads-all" + (anyOpen ? "" : " vc-threads-all-closed")}
                        title={anyOpen ? "Close every category" : "Open every category"}
                        onClick={() => FluxDispatcher.dispatch({ type: anyOpen ? "CATEGORY_COLLAPSE_ALL" : "CATEGORY_EXPAND_ALL", guildId })}
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d={CHEVRON} /></svg>
                        {anyOpen ? "Close categories" : "Open categories"}
                    </button>
                )}
                <span className="vc-list-tools-gap" />
                <button type="button" className={"vc-list-icon" + (filterOpen ? " vc-list-icon-on" : "")} title="Filter channels" aria-label="Filter channels" onClick={() => setFilterOpen(v => !v)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fillRule="evenodd" d={SEARCH} /></svg>
                </button>
                <button type="button" className="vc-list-icon" title="New channel (Ctrl+P)" aria-label="New channel" onClick={openNewChannel}>
                    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d={PLUS} /></svg>
                </button>
            </div>
            {filterOpen && <ChannelFilter key={guildId} guildId={guildId} onClose={() => setFilterOpen(false)} />}
        </div>
    );
}

function FoldArrow({ channelId }: { channelId: string; }) {
    const threads = useListed(channelId);
    const folded = isFolded(channelId);
    // A folded channel shows a brighter arrow while one of its hidden threads is unread.
    const hiddenUnread = useStateFromStores(
        [ReadStateStore],
        () => folded && threads.some(id => ReadStateStore.hasUnread(id)),
        [folded, threads]
    );

    if (threads.length === 0) return null;

    const label = folded ? "Show threads" : "Hide threads";
    const stop = (e: React.SyntheticEvent) => {
        e.stopPropagation();
        e.preventDefault();
    };

    return (
        <div
            className={"vc-channel-fold" + (folded ? " vc-channel-fold-closed" : "") + (hiddenUnread ? " vc-channel-fold-unread" : "")}
            role="button"
            aria-label={label}
            aria-expanded={!folded}
            title={label}
            onMouseDown={stop}
            onMouseUp={stop}
            onContextMenu={e => e.stopPropagation()}
            onClick={e => {
                stop(e);
                toggleFold(channelId);
            }}
        >
            <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d={CHEVRON} />
            </svg>
        </div>
    );
}

// Discord's class names, looked up by their readable part. Some of Discord's modules
// throw when read at start, so a lookup that trips retries a little later.
const LOOKUPS = {
    line: ["wrapper", "typeThread", "link", "unread", "linkTop", "modeUnreadImportant"],
    group: ["container", "spine", "spineBorder", "invertedSpine"]
} as const;
const USED = {
    line: ["wrapper", "typeThread", "link", "unread", "modeSelected", "name", "icon"],
    group: ["container", "spine", "spineBorder", "invertedSpine"]
} as const;

const classes: GroupClasses = {};
let style: HTMLStyleElement | null = null;

function apply() {
    if (style) style.textContent = buildGroupCss(classes);
    priorityKey = "";
    updatePriority();
}

function lookUp(part: keyof typeof LOOKUPS, attempt = 1) {
    const matches = filters.byClassNames(...LOOKUPS[part]);
    const safeFilter = (m: any) => {
        try {
            return matches(m);
        } catch {
            return false;
        }
    };
    try {
        waitFor(safeFilter, mod => {
            try {
                classes[part] = mapMangledCssClasses(mod, USED[part]) as any;
                apply();
                // The list's heights depend on these styles being in place.
                redrawList();
            } catch (e) {
                logger.warn(`Could not read the ${part} class names`, e);
            }
        });
    } catch (e) {
        if (attempt < 5) setTimeout(() => lookUp(part, attempt + 1), 3000);
        else logger.warn(`Could not look up the ${part} class names`, e);
    }
}

export default definePlugin({
    name: "ChannelGroups",
    description: "A channel with open threads sits on one soft blue card with them; the open channel stands out in purple; the arrow at the left of a channel folds its threads away or opens them again.",
    authors: [{ name: "Steph", id: 0n }],
    enabledByDefault: true,
    settings,

    contextMenus: {
        "channel-context": priorityMenu,
        "thread-context": priorityMenu
    },

    patches: [
        {
            // The channel list: which threads show under a channel, and how tall they are.
            find: "countInVoice:",
            replacement: [
                {
                    match: /(\i)\.threadCount>0\?(\(0,\i\.jsx\)\(\i,\{withGuildIcon:\i,channel:\i,sortedThreadIds:)\1\.threadIds,/,
                    replace: "$self.shownThreads($1).length>0?$2$self.shownThreads($1),"
                },
                {
                    match: /for\(let (\i) of (\i)\.threadIds\)\{let\{density:(\i)="default"\}=this\.props;(\i)\+=(\i)\(\3\);/,
                    replace: "$4+=$self.groupSpace($2);for(let $1 of $self.shownThreads($2)){let{density:$3=\"default\"}=this.props;$4+=$5($3)-$self.threadTrim();"
                },
                {
                    // The Events and Server Boosts lines: no height, not drawn, and no divider when nothing is left above the channels.
                    match: /let (\i)=(\i)\.getGuildActionSection\(\);return \1\.isEmpty\(\)\?0:(?=\1\.getRow\((\i)\))/,
                    replace: "let $1=$2.getGuildActionSection();return $self.hideTopLine($1.getRow($3))||$1.isEmpty()?0:"
                },
                {
                    match: /let (\i)=\i\.getGuildActionSection\(\),(\i)=\1\.getRow\(\i\);if\(null==\2\)return null;/,
                    replace: "$&if($self.hideTopLine($2))return null;"
                },
                {
                    match: /(let (\i)=\i\.getGuildActionSection\(\)\.getRows\(\);return )(1===\2\.length)/,
                    replace: "$1$self.onlyHiddenTopLines($2)||$3"
                },
                {
                    match: /renderList\(\)\{/,
                    replace: "renderList(){$self.setList(this);"
                },
                {
                    match: /rowHeight:this\.getRowHeight,/,
                    replace: "rowHeight:$self.rowHeight(this.getRowHeight),"
                },
                {
                    // The show or hide all threads button, above the list and outside its
                    // scrolling; Discord's "new unreads" bars keep their own places.
                    match: /children:\[(?=\(0,\i\.jsx\)\("div",\{className:\i\.\i,children:\(0,\i\.jsx\)\(\i,\{position:"top")/,
                    replace: "children:[$self.ThreadsButton(this.props.guildId),"
                },
                {
                    match: /children:\[this\.renderTopUnread\(\),/,
                    replace: "children:[$self.ThreadsButton(this.props.guildId),this.renderTopUnread(),"
                }
            ]
        },
        {
            // The channel line: the fold arrow goes where the white unread mark was.
            find: "UNREAD_IMPORTANT:",
            replacement: {
                match: /(?<=,channel:(\i),.+?)children:\[(?=\i\|\|!\i\?null:\(0,\i\.jsx\)\("div",\{className:)/,
                replace: "children:[$self.FoldArrow($1),"
            }
        },
        {
            // A closed category keeps a bookmarked channel, and one where someone is typing,
            // in view, like the open, unread or mentioned ones.
            find: "suggestedFavoriteChannelId;",
            replacement: {
                match: /(\i\|\|\i\|\|!\i\(\)\.isEmpty\(\i\)\|\|\i\.\i\.getMentionCount\(this\.id\)>0)(?=\?\{renderLevel:4)/,
                replace: "$1||$self.keepVisible(this.id)"
            }
        },
        {
            // A way to have the list built again when a bookmark changes.
            find: 'displayName="ChannelListStore"',
            replacement: {
                match: /getGuildWithoutChangingGuildActionRows\((\i)\)\{let \i=(\i)\.getGuildChannelRowsOnly\(\1\)/,
                replace: "agentdiscRefresh(id){return $2.clearGuildId(id)}agentdiscUpdate(id){return $2.nonPositionalChannelIdUpdate(id)}$&"
            }
        }
    ],

    shownThreads,
    rowHeight,
    keepVisible,
    hideTopLine,
    onlyHiddenTopLines,

    // Space and trim only once the matching styles are in place, so heights and
    // looks never disagree.
    groupSpace(row: ChannelRow) {
        return classes.group && shownThreads(row).length > 0 ? GROUP_SPACE : 0;
    },
    threadTrim() {
        return classes.line ? THREAD_TRIM : 0;
    },

    setList(instance: any) {
        list = instance;
    },

    ThreadsButton: (guildId: string) => (
        <ErrorBoundary noop key="vc-threads-all">
            <ListTools guildId={guildId} />
        </ErrorBoundary>
    ),

    FoldArrow: (channel: { id: string; }) => (
        <ErrorBoundary noop key="vc-channel-fold">
            <FoldArrow channelId={channel.id} />
        </ErrorBoundary>
    ),

    start() {
        refreshLists(Object.keys(settings.store.priority ?? {}));
        style = document.createElement("style");
        style.id = "agentdisc-channel-groups";
        priorityStyle = document.createElement("style");
        priorityStyle.id = "agentdisc-priority";
        (document.head ?? document.documentElement).append(style, priorityStyle);
        for (const store of PRIORITY_STORES()) store?.addChangeListener?.(queuePriority);
        TypingStore.addChangeListener(queueTypingCheck);
        FluxDispatcher.subscribe("TYPING_START", onTypingStart);
        for (const part of Object.keys(LOOKUPS) as (keyof typeof LOOKUPS)[]) lookUp(part);
        apply();
    },

    stop() {
        for (const store of PRIORITY_STORES()) store?.removeChangeListener?.(queuePriority);
        TypingStore.removeChangeListener(queueTypingCheck);
        FluxDispatcher.unsubscribe("TYPING_START", onTypingStart);
        typingCandidates.clear();
        const shown = [...typingShown];
        typingShown.clear();
        for (const id of shown) ChannelListStore.agentdiscUpdate?.(id);
        style?.remove();
        style = null;
        priorityStyle?.remove();
        priorityStyle = null;
        priorityKey = "";
        refreshLists(Object.keys(settings.store.priority ?? {}));
        redrawList();
    }
});
