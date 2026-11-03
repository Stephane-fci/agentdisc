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
import { onWorkingChange, workingIn } from "@plugins/vencordToolbox/busyBar";
import { allPlaces, find, ICONS, type Place } from "@plugins/vencordToolbox/channelSearch";
import { useInvite } from "@plugins/vencordToolbox/topBar";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { filters, findStoreLazy, mapMangledCssClasses, waitFor } from "@webpack";
import { ActiveJoinedThreadsStore, ChannelStore, ContextMenuApi, FluxDispatcher, GuildChannelStore, GuildStore, Menu, NavigationRouter, ReadStateStore, RestAPI, SelectedChannelStore, SelectedGuildStore, TypingStore, useEffect, useMemo, useReducer, UserStore, useState, useStateFromStores } from "@webpack/common";

import { categoryFamilies, type CategoryFamily, familyForName, moveAfterBookmarks, openNewChannel } from "./boxes";
import { buildGroupCss, buildPriorityCss, GAP_ABOVE, GROUP_SPACE, GroupClasses, PriorityItem, PriorityState, THREAD_TRIM } from "./css";
import { createThreadOrdering } from "./threadOrder";
import { askSoon, plannedChecks, startWaits, stopWaits } from "./waits";

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
    },
    pins: {
        type: OptionType.CUSTOM,
        default: {} as Record<string, true>
    },
    threadOrder: {
        type: OptionType.CUSTOM,
        default: {} as Record<string, string[]>
    },
    pinImport: {
        type: OptionType.CUSTOM,
        default: null as Record<string, true> | null
    },
    // Servers where a new bookmark keeps its place (the AgentDisc menu, 19 Oct).
    keepPlace: {
        type: OptionType.CUSTOM,
        default: {} as Record<string, true>
    },
    // Focus (1 Nov): per server, the category families it hides, and whether it is on.
    hiddenFamilies: {
        type: OptionType.CUSTOM,
        default: {} as Record<string, string[]>,
        onChange: () => focusChanged()
    },
    focusOn: {
        type: OptionType.CUSTOM,
        default: {} as Record<string, true>,
        onChange: () => focusChanged()
    }
});

function isPriority(id: string | null | undefined) {
    return !!id && settings.store.priority?.[id] === true;
}

export function isBookmarked(id: string | null | undefined) {
    return isPriority(id);
}

// Pins remember threads; bookmarks describe today's work. The import takes one snapshot,
// including IDs whose channel records have not arrived yet, and never runs again on new bookmarks.
let pinning = false;
let pinsStarted = false;
let pinsLoading = false;
let pinGeneration = 0;
const pinAttempts = new Set<string>();
let pinStyle: HTMLStyleElement | null = null;
const openThreadHeaders = new Map<string, number>();

// A sidebar header knows its thread even when Discord's main selection is its parent.
export function holdOpenThread(id: string) {
    openThreadHeaders.set(id, (openThreadHeaders.get(id) ?? 0) + 1);
    pinsChanged();
    return () => {
        const remaining = (openThreadHeaders.get(id) ?? 1) - 1;
        if (remaining) openThreadHeaders.set(id, remaining);
        else openThreadHeaders.delete(id);
        pinsChanged();
    };
}

function isPinned(id: string) {
    return settings.store.pins?.[id] === true;
}

function paintPins() {
    if (!pinStyle) return;
    const top = classes.line?.linkTop.split(" ").map(c => `.${c}`).join("");
    pinStyle.textContent = pinning && top ? Object.keys(settings.store.pins ?? {})
        .filter(id => /^\d+$/.test(id))
        .map(id => {
            const target = `[data-list-item-id="channels___${id}"] ${top}`;
            // This is Discord's visible horizontal name-and-accessories row. The outer
            // navigation element is not a reliable layout or colour owner.
            return `${target}::after{content:"";display:block;flex:0 0 12px;width:12px;height:12px;align-self:center;margin-inline-start:6px;pointer-events:none;background:var(--interactive-text-active,#dbdee1);mask:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='none' stroke='black' stroke-width='2' d='M9 3h6l-1 7 4 4v2H6v-2l4-4-1-7M12 16v6'/%3E%3C/svg%3E") center/contain no-repeat}`;
        })
        .join("\n") : "";
}

function pinsChanged() {
    keptOnly.clear();
    paintPins();
    rebuildList();
    notify();
}

function setPinning(on: boolean) {
    pinning = on;
    pinsChanged();
}

export function togglePin(id: string) {
    if (!ChannelStore.getChannel(id)?.isThread?.()) return;
    const pins = { ...settings.store.pins };
    if (pins[id]) delete pins[id];
    else pins[id] = true;
    settings.store.pins = pins;
    // A manual choice wins over an import still waiting for its other records.
    const pending = { ...settings.store.pinImport };
    delete pending[id];
    settings.store.pinImport = pending;
    pinsChanged();
}

function pinContextMenu(e: MouseEvent) {
    if (!pinning || !(e.target instanceof Element)) return;
    const selector = '[data-list-item-id^="channels___"]';
    const wrapper = classes.line?.wrapper.split(" ").map(c => `.${c}`).join("");
    const row = e.target.closest(selector) ?? (wrapper ? e.target.closest(wrapper)?.querySelector(selector) : null);
    const id = row?.getAttribute("data-list-item-id")?.slice("channels___".length);
    if (!id || !ChannelStore.getChannel(id)?.isThread?.()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    togglePin(id);
}

// Archived threads disappear from Discord's active-thread list after a reload. Fetch only
// saved IDs missing from its channel store, through the signed-in user's normal read access.
// Errors keep the pin/import for the next connection; they never erase a user's choice.
async function restorePins() {
    if (!pinsStarted || pinsLoading || !UserStore.getCurrentUser()) return;
    pinsLoading = true;
    const generation = pinGeneration;
    let changed = false;
    try {
        if (settings.store.pinImport == null) settings.store.pinImport = { ...settings.store.priority };
        const ids = new Set([...Object.keys(settings.store.pinImport), ...Object.keys(settings.store.pins ?? {})]);
        for (const id of ids) {
            if (!pinsStarted || generation !== pinGeneration) break;
            let channel = ChannelStore.getChannel(id);
            if (!channel && !pinAttempts.has(id)) {
                pinAttempts.add(id);
                try {
                    const response = await RestAPI.get({ url: `/channels/${id}` });
                    if (!pinsStarted || generation !== pinGeneration) break;
                    if (response.body?.id === id) {
                        FluxDispatcher.dispatch({ type: "LOAD_THREADS_SUCCESS", threads: [response.body] });
                        channel = ChannelStore.getChannel(id);
                        changed = true;
                    }
                } catch {
                    logger.warn("Could not restore a saved thread; keeping it for the next connection", id);
                }
            }
            if (channel && settings.store.pinImport?.[id]) {
                if (channel.isThread()) settings.store.pins = { ...settings.store.pins, [id]: true };
                const pending = { ...settings.store.pinImport };
                delete pending[id];
                settings.store.pinImport = pending;
                changed = true;
            }
        }
    } finally {
        pinsLoading = false;
        if (changed && pinsStarted && generation === pinGeneration) pinsChanged();
    }
}

function queueRestorePins() {
    // Stores can emit while Flux is dispatching; defer the read and any restoration dispatch.
    queueMicrotask(() => void restorePins());
}

function reconnectPins() {
    pinAttempts.clear();
    queueRestorePins();
}

function pinnedThreads(parentId: string): string[] {
    return Object.keys(settings.store.pins ?? {}).filter(id => {
        const c = ChannelStore.getChannel(id);
        return c?.isThread?.() && c.parent_id === parentId;
    });
}

function bookmarksChanged(ids: string[]) {
    priorityKey = "";
    updatePriority();
    refreshLists(ids);
    redrawList();
    askSoon();
}

// A channel he bookmarks moves to the end of the bookmarked channels of its list (19 Oct).
export function togglePriority(id: string) {
    const priority = { ...settings.store.priority };
    const adding = !priority[id];
    if (adding) priority[id] = true;
    else delete priority[id];
    settings.store.priority = priority;
    bookmarksChanged([id]);
    const guildId = ChannelStore.getChannel(id)?.guild_id;
    if (adding && guildId && !settings.store.keepPlace?.[guildId]) moveAfterBookmarks(id, isPriority);
}

// One click puts every marked channel and thread back to normal (Stephane, 1 Oct).
export function clearPriorities() {
    const before = Object.keys(settings.store.priority ?? {});
    settings.store.priority = {};
    bookmarksChanged(before);
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
    return isChannelBookmark(id) || (isPluginEnabled("ChannelGroups") && (typingShown.has(id) || workingOnly && workingTop.has(id)));
}

// Where agents work now (Stephane, 1 Nov: "I just want to have a clear view of what's going
// on", then "the look should be exactly the same"): the last square leaves in the channel list
// only the channels where an agent is working or that hold a thread where one is, and under each
// only its working threads, the ones the busy bar counts. The lines keep their look: bookmark
// colours, the agents' photos and dots. Kept for this visit only.
let workingOnly = false;
let workingTop = new Set<string>();
let workingThreads = new Set<string>();
let workingKey = "";
let stopWorkingWatch: (() => void) | null = null;
const workingListeners = new Set<() => void>();

function readWorking() {
    const guildId = SelectedGuildStore.getGuildId();
    const top = new Set<string>();
    const threads = new Set<string>();
    for (const id of guildId ? workingIn(guildId) : NONE) {
        const channel = ChannelStore.getChannel(id);
        if (!channel) continue;
        if (channel.isThread?.()) {
            threads.add(id);
            top.add(channel.parent_id);
        } else top.add(id);
    }
    const key = `${[...top].sort()}|${[...threads].sort()}`;
    if (key === workingKey) return false;
    workingTop = top;
    workingThreads = threads;
    workingKey = key;
    return true;
}

function rebuildList() {
    focusCache.clear();
    try {
        const guildId = SelectedGuildStore.getGuildId();
        if (guildId) ChannelListStore.agentdiscRefresh?.(guildId);
        ChannelListStore.emitChange();
    } catch (e) {
        logger.warn("Could not redraw the channel list for the working view", e);
    }
    redrawList();
}

function refreshWorking() {
    if (readWorking()) rebuildList();
}

function setWorkingOnly(on: boolean) {
    if (on === workingOnly) return;
    workingOnly = on;
    workingKey = "";
    stopWorkingWatch?.();
    stopWorkingWatch = null;
    if (on) {
        const off = onWorkingChange(refreshWorking);
        // Work ends without a signal: a line leaves once its agent's typing has gone quiet.
        const timer = setInterval(refreshWorking, 2000);
        const onGuild = () => {
            workingKey = "";
            refreshWorking();
        };
        SelectedGuildStore.addChangeListener(onGuild);
        stopWorkingWatch = () => {
            off();
            clearInterval(timer);
            SelectedGuildStore.removeChangeListener(onGuild);
        };
        refreshWorking();
    } else {
        workingTop = new Set();
        workingThreads = new Set();
        rebuildList();
    }
    workingListeners.forEach(fn => fn());
}

// Focus (Stephane, 1 Nov: "everything from my client is hidden ... I will finally be able to
// look at my own stuff"): the square after the working one hides the category families he
// chose in its menu (a right-click on it), with every channel of theirs and its threads: the
// channels in their categories, archives included, and any channel marked with their emoji,
// wherever it sits. Nothing else changes. Per server, and kept after a reload.
interface Focus { categories: Set<string>; keys: Set<string>; families: CategoryFamily[]; }
// One more choice in the menu (1 Nov: "hide 'Archived Categories' basically every category that
// has the word archive in it"): every family's archive categories, with their channels.
const ARCHIVES = "agentdisc:archives";
const focusCache = new Map<string, Focus | null>();

function focusOf(guildId: string) {
    if (!settings.store.focusOn?.[guildId]) return null;
    const known = focusCache.get(guildId);
    if (known !== undefined) return known;
    const keys = new Set(settings.store.hiddenFamilies?.[guildId] ?? NONE);
    let focus: Focus | null = null;
    if (keys.size) {
        const families = categoryFamilies(guildId);
        const categories = new Set<string>();
        for (const family of families) {
            if (keys.has(ARCHIVES)) for (const c of family.archives) categories.add(c.id);
            if (!keys.has(family.key)) continue;
            for (const c of [family.main, ...family.archives]) if (c) categories.add(c.id);
        }
        focus = { categories, keys, families };
    }
    focusCache.set(guildId, focus);
    return focus;
}

function hiddenByFocus(id: string) {
    const channel = ChannelStore.getChannel(id);
    if (!channel?.guild_id) return false;
    const focus = focusOf(channel.guild_id);
    if (!focus) return false;
    if (channel.type === CATEGORY) return focus.categories.has(id);
    if (channel.parent_id && focus.categories.has(channel.parent_id)) return true;
    const family = familyForName(channel.name ?? "", focus.families);
    return !!family && focus.keys.has(family.key);
}

function focusChanged() {
    focusCache.clear();
    rebuildList();
}

function FocusMenu({ guildId, families }: { guildId: string; families: CategoryFamily[]; }) {
    const { hiddenFamilies } = settings.use(["hiddenFamilies"]);
    const chosen = new Set(hiddenFamilies?.[guildId] ?? NONE);
    const flip = (key: string) => {
        const next = new Set(chosen);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        settings.store.hiddenFamilies = { ...settings.store.hiddenFamilies, [guildId]: [...next] };
    };
    return (
        <Menu.Menu navId="agentdisc-focus" onClose={ContextMenuApi.closeContextMenu} aria-label="Categories to hide">
            <Menu.MenuGroup label="Hide while focusing">
                {families.map((f, i) => (
                    <Menu.MenuCheckboxItem key={f.key} id={`agentdisc-focus-${i}`} label={f.label} checked={chosen.has(f.key)} action={() => flip(f.key)} />
                ))}
            </Menu.MenuGroup>
            <Menu.MenuGroup>
                <Menu.MenuCheckboxItem id="agentdisc-focus-archives" label="Every archive category" checked={chosen.has(ARCHIVES)} action={() => flip(ARCHIVES)} />
            </Menu.MenuGroup>
        </Menu.Menu>
    );
}

function openFocusMenu(event: React.MouseEvent, guildId: string) {
    const families = categoryFamilies(guildId);
    ContextMenuApi.openContextMenu(event as any, () => <FocusMenu guildId={guildId} families={families} />);
}

function useWorkingOnly() {
    const [, bump] = useReducer((n: number) => n + 1, 0);
    useEffect(() => {
        workingListeners.add(bump);
        return () => void workingListeners.delete(bump);
    }, []);
    return workingOnly;
}

// A category with nothing left to show has no title in the working view, and a category
// focus hides has none either.
function hideSection(guildChannels: any, section: number) {
    try {
        const category = guildChannels?.getCategoryFromSection?.(section);
        if (!category) return false;
        if (workingOnly && typeof category.isEmpty === "function" && category.isEmpty()) return true;
        return typeof category.id === "string" && hiddenByFocus(category.id);
    } catch {
        return false;
    }
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

// What is happening in a marked line, the strongest first (css.ts): an agent typing there
// (or, for a folded channel, in one of its hidden threads, whose dots show on the channel
// line), something unread (for a waiting line, in the line itself only), a check an agent
// has planned there or in a hidden thread, else quiet.
function priorityState(id: string): PriorityItem {
    const me = UserStore.getCurrentUser()?.id;
    const channel = ChannelStore.getChannel(id);
    const lines = [id];
    if (channel?.guild_id && isFolded(id)) {
        const selected = SelectedChannelStore.getChannelId();
        for (const t of Object.keys(ActiveJoinedThreadsStore.getActiveJoinedThreadsForParent(channel.guild_id, id) ?? {})) {
            if (t !== selected) lines.push(t);
        }
    }
    const item = (state: PriorityState, next?: string): PriorityItem => ({ id, state, next });
    if (lines.some(l => Object.keys(TypingStore.getTypingUsers(l) ?? {}).some(u => u !== me))) return item("green");
    const planned = lines.flatMap(l => plannedChecks(l) ?? []);
    // A waiting line turns red only for new messages in itself: the folded threads of a busy
    // channel are nearly always partly unread and held it red for good (Stephane, 18 Oct:
    // "I see no blue ... and Business to Build is still orange").
    if ((planned.length ? [id] : lines).some(l => ReadStateStore.hasUnread(l))) return item("red");
    if (planned.length) return item("blue", planned.reduce((a, b) => Date.parse(a) <= Date.parse(b) ? a : b));
    return item("yellow");
}

let priorityStyle: HTMLStyleElement | null = null;
let priorityKey = "";
let priorityQueued = false;

function updatePriority() {
    if (!priorityStyle) return;
    let items: PriorityItem[] = [];
    try {
        items = Object.keys(settings.store.priority ?? {}).map(priorityState);
    } catch (e) {
        logger.warn("Could not read the priority lines", e);
    }
    const key = items.map(i => i.id + i.state + (i.next ?? "")).join() + "|" + (classes.line ? "1" : "0");
    if (key === priorityKey) return;
    priorityKey = key;
    priorityStyle.textContent = buildPriorityCss(items, classes.line);
    setNextChecks(new Map(items.filter(i => i.next).map(i => [i.id, i.next!])));
}

// A blue line shows a small clock with the time of its next check where the agent's photo
// and dots go while one works (Stephane, 19 Oct: "a clock that shows the time of the next
// check so I still know that something is going on here"). The channel list asks here.
let nextChecks = new Map<string, string>();
const nextListeners = new Set<() => void>();

function setNextChecks(next: Map<string, string>) {
    if (next.size === nextChecks.size && [...next].every(([id, at]) => nextChecks.get(id) === at)) return;
    nextChecks = next;
    nextListeners.forEach(l => l());
}

export function useNextCheck(id: string | null | undefined) {
    const [, redraw] = useReducer((n: number) => n + 1, 0);
    useEffect(() => {
        nextListeners.add(redraw);
        return () => void nextListeners.delete(redraw);
    }, []);
    return id ? nextChecks.get(id) ?? null : null;
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

// The lines whose planned checks are asked for: the bookmarks only. A folded channel's
// threads need no question of their own: the board asked for a thread answers with its
// channel's whole board, which the channel's own question already brings, cards' threads
// included (21 Oct, fewer and smaller reads after his lag report).
function bookmarkedLines() {
    return Object.keys(settings.store.priority ?? {});
}

const PRIORITY_STORES = () => [TypingStore, ReadStateStore, SelectedChannelStore, ActiveJoinedThreadsStore] as any[];

export function usePriority(id: string | null | undefined) {
    const { priority } = settings.use(["priority"]);
    return !!id && priority?.[id] === true;
}

export function usePinned(id: string) {
    const { pins } = settings.use(["pins"]);
    return pins?.[id] === true;
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

// Hidden thread agents stay visible on their parent, both when folded and when pins
// keep the open dropdown short. The working-only view shows its agents on their rows.
export function useHiddenThreads(channelId: string, guildId: string | null | undefined): string[] {
    settings.use(["folded", "pins", "priority"]);
    useListedChanges();
    const working = useWorkingOnly();
    const selected = useStateFromStores([SelectedChannelStore], () => SelectedChannelStore.getChannelId());
    const threads = useStateFromStores(
        [ActiveJoinedThreadsStore],
        () => guildId ? Object.keys(ActiveJoinedThreadsStore.getActiveJoinedThreadsForParent(guildId, channelId) ?? {}).sort() : NONE,
        [guildId, channelId],
        sameIds
    );
    // In the working view the working threads show under the channel, so their agents stay on
    // their own lines and the channel line shows only who works in the channel itself (1 Nov:
    // "The agent icon should be only on the threads that actually have some work done").
    if (working || !isPluginEnabled("ChannelGroups")) return NONE;
    const hasPins = pinnedThreads(channelId).length > 0;
    return threads.filter(id => !normalThreadVisible(id, channelId, hasPins, selected));
}

function normalThreadVisible(id: string, parentId: string, hasPins: boolean, selected: string | null | undefined) {
    // While editing pins, a closed dropdown keeps its pins available to unpin.
    // Normal mode keeps only the existing bookmark/selection exceptions.
    if (isFolded(parentId)) return id === selected || isPriority(id) || pinning && isPinned(id);
    return pinning || !hasPins || id === selected || openThreadHeaders.has(id) || isPinned(id) || isPriority(id);
}

// Under a folded channel only the thread being read and priority threads stay, like
// Discord's folded categories.
const keptOnly = new Map<string, string[]>();
const threadOrdering = createThreadOrdering({
    read: () => settings.store.threadOrder,
    write: value => { settings.store.threadOrder = value; },
    channel: id => ChannelStore.getChannel(id),
    changed: pinsChanged
});

function allThreads(row: ChannelRow): string[] {
    const pins = pinnedThreads(row.id);
    const selected = ChannelStore.getChannel(SelectedChannelStore.getChannelId());
    if (selected?.isThread?.() && selected.parent_id === row.id) pins.push(selected.id);
    for (const id of openThreadHeaders.keys()) {
        if (ChannelStore.getChannel(id)?.parent_id === row.id) pins.push(id);
    }
    return threadOrdering.sort(row.id, [...new Set([...(row.threadIds ?? NONE), ...pins])]);
}

function shownThreads(row: ChannelRow): string[] {
    try {
        const pins = pinnedThreads(row.id);
        const ids = allThreads(row);
        const before = listed.get(row.id);
        if (!sameIds(before ?? NONE, ids)) {
            listed.set(row.id, ids);
            notify();
        }
        if (workingOnly) {
            const working = ids.filter(id => workingThreads.has(id));
            const key = `working:${working.join()}`;
            let same = keptOnly.get(key);
            if (!same) keptOnly.set(key, same = working);
            return same;
        }
        const selected = SelectedChannelStore.getChannelId();
        const kept = ids.filter(id => normalThreadVisible(id, row.id, pins.length > 0, selected));
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
        const key = `${layoutVersion}:${parent ? selected!.id : ""}:${workingOnly ? workingKey : ""}`;
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

// The channels and threads Alt+Up and Alt+Down go through, as the list shows them: the
// threads under a folded channel are left out, except the one being read and bookmarked ones.
function visibleOnly(_guildId: string, ids: string[]) {
    try {
        if (!isPluginEnabled("ChannelGroups") || !Array.isArray(ids)) return ids;
        const selected = SelectedChannelStore.getChannelId();
        const withPins = [...new Set(ids)];
        for (const id of new Set([...Object.keys(settings.store.pins ?? {}), ...openThreadHeaders.keys(), ...(selected ? [selected] : [])])) {
            const pin = ChannelStore.getChannel(id);
            if (!pin?.isThread?.() || withPins.includes(id)) continue;
            const parentIndex = withPins.indexOf(pin.parent_id);
            if (parentIndex < 0) continue;
            let at = parentIndex + 1;
            while (at < withPins.length && ChannelStore.getChannel(withPins[at])?.parent_id === pin.parent_id) at++;
            withPins.splice(at, 0, id);
        }
        const siblings = new Map<string, string[]>();
        for (const id of withPins) {
            const channel = ChannelStore.getChannel(id);
            if (!channel?.isThread?.()) continue;
            const ids = siblings.get(channel.parent_id) ?? [];
            ids.push(id);
            siblings.set(channel.parent_id, ids);
        }
        const positions = new Map<string, number>();
        for (const [parent, ids] of siblings) siblings.set(parent, threadOrdering.sort(parent, ids));
        const ordered = withPins.map(id => {
            const channel = ChannelStore.getChannel(id);
            if (!channel?.isThread?.()) return id;
            const at = positions.get(channel.parent_id) ?? 0;
            positions.set(channel.parent_id, at + 1);
            return siblings.get(channel.parent_id)![at];
        });
        return ordered.filter(id => {
            const c = ChannelStore.getChannel(id);
            if (hiddenByFocus(c?.isThread?.() ? c.parent_id : id)) return false;
            if (!c?.isThread?.()) return true;
            if (workingOnly) return workingThreads.has(id);
            return normalThreadVisible(id, c.parent_id, pinnedThreads(c.parent_id).length > 0, selected);
        });
    } catch (e) {
        logger.warn("Could not leave out folded threads", e);
        return ids;
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
const PULSE = "M3 12h4l3-7 4 14 3-7h4";
const EYE_OFF = "M3 3l18 18M10.6 6.1A9.8 9.8 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-2.6 3.3M6.6 6.6C3.9 8.3 2.5 12 2.5 12S6 18 12 18a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2";
const PIN = "M9 3h6l-1 7 4 4v2H6v-2l4-4-1-7M12 16v6";

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

// The buttons above the channel list (Stephane, 29 Sept, then 1 and 6 Oct; one line of
// squares since 12 Oct): show or hide every thread, clear every bookmark, close or open every
// category, filter the channels, create a channel, add people, and since 1 Nov where agents work
// now. Every square keeps its place,
// greyed out when there is nothing to do, so the hand learns where each one is.
function ToolSquare({ label, on, disabled, warn, onClick, onContextMenu, children }: { label: string; on?: boolean; disabled?: boolean; warn?: boolean; onClick(e: React.MouseEvent): void; onContextMenu?(e: React.MouseEvent): void; children: React.ReactNode; }) {
    return (
        <button
            type="button"
            className={"vc-list-icon" + (on ? " vc-list-icon-on" : "") + (warn ? " vc-list-icon-warn" : "")}
            title={label}
            aria-label={label}
            aria-pressed={on}
            disabled={disabled}
            onClick={onClick}
            onContextMenu={onContextMenu}
        >
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">{children}</svg>
        </button>
    );
}

const line = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

function ListTools({ guildId }: { guildId: string; }) {
    useListedChanges();
    const { folded, priority, hiddenFamilies, focusOn } = settings.use(["folded", "priority", "hiddenFamilies", "focusOn"]);
    const chosen = hiddenFamilies?.[guildId]?.length ?? 0;
    const focusing = !!focusOn?.[guildId] && chosen > 0;
    const setFocus = (on: boolean) => {
        const next = { ...settings.store.focusOn };
        if (on) next[guildId] = true;
        else delete next[guildId];
        settings.store.focusOn = next;
    };
    const [filterOpen, setFilterOpen] = useState(false);
    const working = useWorkingOnly();
    const invite = useInvite(guildId);

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
            <div className="vc-list-tools-row">
                <ToolSquare label={someFolded ? "Show threads" : "Hide threads"} on={withThreads.length > 0 && !someFolded} disabled={!withThreads.length} onClick={() => setAllFolded(withThreads, !someFolded)}>
                    <path d="M6 3v12a4 4 0 0 0 4 4h4M6 7.5a4 4 0 0 0 4 4h4" {...line} />
                    <circle cx="17" cy="11.5" r="2.3" {...line} />
                    <circle cx="17" cy="19" r="2.3" {...line} />
                </ToolSquare>
                <ToolSquare label={marks ? "Remove every bookmark" : "No bookmark to remove"} warn={marks > 0} disabled={!marks} onClick={clearPriorities}>
                    <path d={FLAG} {...line} fill={marks ? "currentColor" : "none"} />
                </ToolSquare>
                <ToolSquare label={anyOpen ? "Close every category" : "Open every category"} on={categories.length > 0 && anyOpen} disabled={!categories.length} onClick={() => FluxDispatcher.dispatch({ type: anyOpen ? "CATEGORY_COLLAPSE_ALL" : "CATEGORY_EXPAND_ALL", guildId })}>
                    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" {...line} />
                </ToolSquare>
                <ToolSquare label="Filter channels" on={filterOpen} onClick={() => setFilterOpen(v => !v)}>
                    <path fill="currentColor" fillRule="evenodd" d={SEARCH} />
                </ToolSquare>
                <ToolSquare label="New channel (Ctrl+P)" onClick={() => openNewChannel()}>
                    <path fill="currentColor" d={PLUS} />
                </ToolSquare>
                <ToolSquare label={invite ? "Add people" : "You cannot add people here"} disabled={!invite} onClick={() => invite?.()}>
                    <circle cx="9" cy="8" r="3.5" {...line} />
                    <path d="M2.5 20a6.5 6.5 0 0 1 13 0M19 8v6M16 11h6" {...line} />
                </ToolSquare>
                <ToolSquare label={working ? "Back to every channel" : "Only where agents work now"} on={working} onClick={() => setWorkingOnly(!working)}>
                    <path d={PULSE} {...line} />
                </ToolSquare>
                <ToolSquare
                    label={focusing ? "Show the hidden categories again (right-click to choose)" : chosen ? "Hide the chosen categories (right-click to choose)" : "Choose categories to hide"}
                    on={focusing}
                    onClick={e => chosen ? setFocus(!focusing) : openFocusMenu(e, guildId)}
                    onContextMenu={e => {
                        e.preventDefault();
                        openFocusMenu(e, guildId);
                    }}
                >
                    <path d={EYE_OFF} {...line} />
                </ToolSquare>
                <ToolSquare label={pinning ? "Finish pinning threads (right-click a thread to pin or unpin)" : "Pin threads"} on={pinning} onClick={() => setPinning(!pinning)}>
                    <path d={PIN} {...line} />
                </ToolSquare>
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
    line: ["wrapper", "typeThread", "link", "linkTop", "unread", "modeSelected", "name", "icon"],
    group: ["container", "spine", "spineBorder", "invertedSpine"]
} as const;

const classes: GroupClasses = {};
let style: HTMLStyleElement | null = null;

function apply() {
    if (style) style.textContent = buildGroupCss(classes);
    paintPins();
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

    // The "Bookmarks" group of the AgentDisc menu: in a server he owns, whether a channel he
    // bookmarks moves under the other bookmarked ones. In a client's server (he owns Lifely's
    // too) that changes the order everyone there sees, so it can be switched off per server.
    toolboxActions() {
        const { keepPlace } = settings.use(["keepPlace"]);
        const guildId = useStateFromStores([SelectedGuildStore], () => SelectedGuildStore.getGuildId());
        const owned = useStateFromStores([GuildStore], () => !!guildId && GuildStore.getGuild(guildId)?.ownerId === UserStore.getCurrentUser()?.id, [guildId]);
        if (!guildId || !owned) return [];
        const moves = !keepPlace?.[guildId];
        return [
            <Menu.MenuCheckboxItem key="move" id="agentdisc-bookmark-move" label="Move a new bookmark under the others in this server" checked={moves}
                action={() => {
                    const next = { ...settings.store.keepPlace };
                    if (moves) next[guildId] = true;
                    else delete next[guildId];
                    settings.store.keepPlace = next;
                }} />
        ];
    },

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
                    // The working view: a category left empty loses its title and its divider.
                    match: /(?<=(getSectionHeight|getSectionFooterHeight)=(\i)=>\{)/g,
                    replace: "if($self.hideSection(this.props.guildChannels,$2))return 0;"
                },
                {
                    match: /(?<=(renderSection|renderSectionFooter)=(\i)=>\{)/g,
                    replace: "if($self.hideSection(this.props.guildChannels,$2.section))return null;"
                },
                {
                    // Opening a thread scrolls the list to it: Discord places it by its rank
                    // among all the channel's threads, folded ones included.
                    match: /(\i)=(\i)\.threadOffset\*(\i)\((\i)\)/,
                    replace: "$1=$self.threadTop(this.props.guildChannels,$2,$3($4))"
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
            // Alt with the arrows (and Alt+Z / Alt+S) moves through the channel list as it
            // is shown: the threads of a folded channel are skipped (Stephane, 7 Oct).
            find: 'binds:["alt+down"],comboKeysBindGlobal',
            replacement: {
                match: /\(0,\i\.\i\)\((\i),\{withCurrentVoiceChannel:!0\}\)\.map\((\i)=>\2\.id\)/,
                replace: "$self.visibleOnly($1,$&)"
            }
        },
        {
            // A closed category keeps a bookmarked channel, and one where someone is typing,
            // in view, like the open, unread or mentioned ones. Unread threads no longer keep
            // their channel in view in a closed category (Stephane, 7 Oct): with its threads
            // folded, the channel looked visible for no reason.
            find: "suggestedFavoriteChannelId;",
            replacement: [
                {
                    // Include restored pins in the offset used when Discord scrolls to a thread.
                    match: /(\i)\.channels\[(\i)\.id\]\.threadIds\.indexOf\((\i)\)/,
                    replace: "$self.allThreads($1.channels[$2.id]).indexOf($3)"
                },
                {
                    match: /(\i)\|\|(\i)\|\|(!\i\(\)\.isEmpty\(\i\))\|\|(\i\.\i\.getMentionCount\(this\.id\)>0)(?=\?\{renderLevel:4)/,
                    replace: "$1||$2||(!this.category.isCollapsed&&$3)||$4||$self.keepVisible(this.id)"
                },
                {
                    // The working view keeps only the channels where agents work (or their threads
                    // do), and focus leaves out the categories he chose to hide.
                    match: /(getShownChannelIds\(\)\{return null==this\.shownChannelIds&&\(this\.shownChannelIds=\i\(\)\(this\.channels\)\.values\(\)\.filter\((\i)=>4===\2\.renderLevel)/,
                    replace: "$1&&$self.keepInList($2.id)"
                }
            ]
        },
        {
            // No "More Active Threads" box when the mouse is on a channel line (Stephane, 19 Oct:
            // "remove ... the one that shows the threads"): Discord opened it beside every
            // channel whose threads are folded away. The one place that opens it, when the mouse
            // rests on the line, does nothing now (the first hook, on the line's drawing, broke
            // with Discord's 20 Oct update). The box for a channel's activities stays.
            find: "shouldShowThreadsPopout:",
            replacement: {
                match: /this\.setState\(\{shouldShowThreadsPopout:!0\}\)/,
                replace: "void 0"
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
    allThreads,
    rowHeight,
    visibleOnly,
    keepVisible,
    hideSection,
    keepInList: (id: string) => (!workingOnly || workingTop.has(id)) && !hiddenByFocus(id),
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

    // Where a thread starts inside its channel's line, as the list draws it: Discord counts
    // every thread of the channel, so under a folded channel it aimed below the thread and
    // scrolled the whole list away from it (Stephane, 29 Oct: "Suddenly the whole list of
    // channels switches and I'm completely lost").
    threadTop(guildChannels: any, place: { section: number; row: number; threadOffset: number; }, line: number) {
        try {
            const row: ChannelRow | undefined = guildChannels.getChannelFromSectionRow(place.section, place.row)?.channel;
            const shown = row ? shownThreads(row) : NONE;
            const rank = row ? shown.indexOf(allThreads(row)[place.threadOffset]) : -1;
            if (rank < 0) return place.threadOffset * line;
            return (classes.group ? GAP_ABOVE : 0) + line + rank * (line - (classes.line ? THREAD_TRIM : 0));
        } catch {
            return place.threadOffset * line;
        }
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
        threadOrdering.start();
        pinsStarted = true;
        pinGeneration++;
        if (settings.store.pinImport == null) settings.store.pinImport = { ...settings.store.priority };
        pinStyle = document.createElement("style");
        pinStyle.id = "agentdisc-thread-pins";
        (document.head ?? document.documentElement).append(pinStyle);
        document.addEventListener("contextmenu", pinContextMenu, true);
        ChannelStore.addChangeListener(queueRestorePins);
        UserStore.addChangeListener(queueRestorePins);
        FluxDispatcher.subscribe("CONNECTION_OPEN", reconnectPins);
        queueRestorePins();
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
        startWaits(bookmarkedLines, queuePriority);
    },

    stop() {
        threadOrdering.stop();
        pinsStarted = false;
        openThreadHeaders.clear();
        pinGeneration++;
        pinning = false;
        pinAttempts.clear();
        document.removeEventListener("contextmenu", pinContextMenu, true);
        ChannelStore.removeChangeListener(queueRestorePins);
        UserStore.removeChangeListener(queueRestorePins);
        FluxDispatcher.unsubscribe("CONNECTION_OPEN", reconnectPins);
        pinStyle?.remove();
        pinStyle = null;
        setWorkingOnly(false);
        stopWaits();
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
        setNextChecks(new Map());
        refreshLists(Object.keys(settings.store.priority ?? {}));
        redrawList();
    }
});
