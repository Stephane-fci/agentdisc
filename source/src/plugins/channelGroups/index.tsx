/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { definePluginSettings, Settings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { filters, mapMangledCssClasses, waitFor } from "@webpack";
import { ChannelStore, ReadStateStore, SelectedChannelStore, useEffect, useReducer, useStateFromStores } from "@webpack/common";

import { buildGroupCss, GROUP_SPACE, GroupClasses, THREAD_TRIM } from "./css";

// AgentDisc channel groups (Stephane, 29 Sept): a channel's threads sit closer together
// on a soft card under it, and a small arrow where Discord's white unread mark was
// folds them away or opens them again, remembered after reload.
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
    }
});

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

// Only the thread being read stays under a folded channel, like Discord's folded categories.
const selectedOnly = new Map<string, string[]>();
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
        if (!ids.includes(selected)) return NONE;
        let one = selectedOnly.get(selected);
        if (!one) selectedOnly.set(selected, one = [selected]);
        return one;
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

// One button above the channel list (Stephane, 29 Sept): "Show threads" while some
// channels are folded, "Hide threads" when all are open. It stays in place while the
// list scrolls, and only shows in a server where some channel has threads.
function ThreadsButton({ guildId }: { guildId: string; }) {
    useListedChanges();
    const { folded } = settings.use(["folded"]);

    const withThreads: string[] = [];
    for (const [id, threads] of listed) {
        if (threads.length > 0 && ChannelStore.getChannel(id)?.guild_id === guildId) withThreads.push(id);
    }
    if (withThreads.length === 0) return null;

    const someFolded = withThreads.some(id => folded?.[id]);
    return (
        <div className="vc-threads-all-row">
            <button type="button" className={"vc-threads-all" + (someFolded ? " vc-threads-all-closed" : "")} onClick={() => setAllFolded(withThreads, !someFolded)}>
                <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d={CHEVRON} /></svg>
                {someFolded ? "Show threads" : "Hide threads"}
            </button>
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
    line: ["wrapper", "typeThread", "link", "unread"],
    group: ["container", "spine", "spineBorder", "invertedSpine"]
} as const;

const classes: GroupClasses = {};
let style: HTMLStyleElement | null = null;

function apply() {
    if (style) style.textContent = buildGroupCss(classes);
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
    description: "A channel's threads sit closer together on a soft card under it; the arrow at the left of the channel folds them away or opens them again.",
    authors: [{ name: "Steph", id: 0n }],
    enabledByDefault: true,
    settings,

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
        }
    ],

    shownThreads,
    rowHeight,
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
            <ThreadsButton guildId={guildId} />
        </ErrorBoundary>
    ),

    FoldArrow: (channel: { id: string; }) => (
        <ErrorBoundary noop key="vc-channel-fold">
            <FoldArrow channelId={channel.id} />
        </ErrorBoundary>
    ),

    start() {
        style = document.createElement("style");
        style.id = "agentdisc-channel-groups";
        (document.head ?? document.documentElement).append(style);
        for (const part of Object.keys(LOOKUPS) as (keyof typeof LOOKUPS)[]) lookUp(part);
        apply();
    },

    stop() {
        style?.remove();
        style = null;
        redrawList();
    }
});
