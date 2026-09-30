/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { redrawChannelList } from "@plugins/channelGroups";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import { filters, findStoreLazy, mapMangledCssClasses, waitFor } from "@webpack";
import { ComponentDispatch, FluxDispatcher, Menu, useStateFromStores } from "@webpack/common";

// AgentDisc panel switches: hide Discord's panels one by one, from tick boxes in
// the AgentDisc button menu, and "chat only" on Ctrl+Alt+F. A hidden channel list
// slides back over the chat while the mouse is at the left edge. Everything is a style
// rule built from Discord's own class names, looked up by their readable part, so a
// renamed part only stops its own switch. The member list uses Discord's own switch
// (the people button, Ctrl+U), so both stay in step. The area above the message box
// is left alone for the play bar that comes later.

const logger = new Logger("PanelSwitches");

export const ChannelSectionStore = findStoreLazy("ChannelSectionStore") as {
    getState(): { isMembersOpen: boolean; };
};

const PARTS = {
    layout: ["guilds", "sidebar", "sidebarList", "panels", "base", "sidebarResizeHandle"],
    topBar: ["bar", "leading", "trailing", "systemBar"],
    chat: ["chat", "title", "chatContent", "threadSidebarOpen"],
    notice: ["notice", "colorDefault", "closeButton"],
    promoNotice: ["notice", "noticeContent", "noticeText", "closeButton"],
    serverHeader: ["container", "header", "headerContent", "guildDropdown", "inviteButton"],
    serverItems: ["listItem", "tutorialContainer", "iconBadge", "unavailableBadge"]
} as const;

// The buttons at the right of the message box, by Discord's own names for them. Send
// (shown only when Discord's send button setting is on) always stays.
const MESSAGE_BUTTONS = new Set(["gift", "gif", "sticker", "emoji", "expression", "appLauncher"]);

type Part = keyof typeof PARTS;
const classes: Partial<Record<Part, Record<string, string>>> = {};

export const settings = definePluginSettings({
    chatOnly: {
        type: OptionType.BOOLEAN,
        description: "Chat only: hide the panels below at once (Ctrl+Alt+F)",
        default: false,
        onChange: () => {
            apply();
            syncMembers();
        }
    },
    chatOnlyHides: {
        type: OptionType.SELECT,
        description: "What chat only hides",
        options: [
            { label: "Server list, channel list and member list", value: "sides", default: true },
            { label: "Everything except the chat", value: "all" }
        ],
        onChange: () => apply()
    },
    hideServerList: {
        type: OptionType.BOOLEAN,
        description: "Hide the server list",
        default: true,
        onChange: () => apply()
    },
    hideChannelList: {
        type: OptionType.BOOLEAN,
        description: "Hide the channel list and the account panel under it (they slide back while the mouse is at the left edge)",
        default: false,
        onChange: () => apply()
    },
    hideTopBar: {
        type: OptionType.BOOLEAN,
        description: "Hide the top bar (it slides back when the mouse touches the top edge)",
        default: false,
        onChange: () => apply()
    },
    hideChannelHeader: {
        type: OptionType.BOOLEAN,
        description: "Hide the channel header (channel name, threads, pins, search)",
        default: true,
        onChange: () => apply()
    },
    hideNotices: {
        type: OptionType.BOOLEAN,
        description: "Hide notice banners at the top",
        default: true,
        onChange: () => apply()
    },
    hideServerHeader: {
        type: OptionType.BOOLEAN,
        description: "Hide the server name bar at the top of the channel list",
        default: true,
        onChange: () => apply()
    },
    hideServerLines: {
        type: OptionType.BOOLEAN,
        description: "Hide the Events and Server Boosts lines above the channels",
        default: true,
        onChange: () => redrawChannelList()
    },
    hideAccountPanel: {
        type: OptionType.BOOLEAN,
        description: "Hide the account bar at the bottom (your name, mic, headset, settings, and the call buttons)",
        default: true,
        onChange: () => apply()
    },
    hideAddDiscover: {
        type: OptionType.BOOLEAN,
        description: "Hide the add server and Discover buttons in the server list",
        default: true,
        onChange: () => apply()
    },
    hideMessageButtons: {
        type: OptionType.BOOLEAN,
        description: "Hide the gift, GIF, sticker, emoji and apps buttons in the message box",
        default: true,
        onChange: () => apply()
    },
    membersClosedByChatOnly: {
        type: OptionType.BOOLEAN,
        description: "Chat only closed the member list and reopens it when switched off",
        default: false,
        hidden: true
    }
});

type Panel = "serverList" | "channelList" | "topBar" | "channelHeader" | "notices";

export function isHidden(panel: Panel) {
    const s = settings.store;
    const own = {
        serverList: s.hideServerList,
        channelList: s.hideChannelList,
        topBar: s.hideTopBar,
        channelHeader: s.hideChannelHeader,
        notices: s.hideNotices
    }[panel];
    if (own) return true;
    if (!s.chatOnly) return false;
    return panel === "serverList" || panel === "channelList" || s.chatOnlyHides === "all";
}

function buildCss() {
    const rules: string[] = [];
    const { layout: L, topBar: T, chat: C, notice: N, promoNotice: P, serverHeader: H, serverItems: S } = classes;
    const sel = (cls: string | undefined) => cls?.split(" ").map(c => "." + c).join("") ?? null;

    if (L) {
        const servers = isHidden("serverList");
        const channels = isHidden("channelList");
        if (channels) {
            // A hidden channel list slides back over the chat while the mouse is at the
            // left edge (on the server list, or on a thin strip when that is hidden too),
            // and goes away again a moment after the mouse leaves.
            const sidebar = sel(L.sidebar);
            const away = [sel(L.sidebarList), sel(L.panels)];
            if (servers) away.unshift(sel(L.guilds));
            const hidden = away.join(",");
            const shown = away.map(s => `${sidebar}:hover ${s}`).join(",");
            // The lifted parts leave Discord's grid (grid-area auto), so they are placed
            // from the left edge of the side panel, not from their old grid cell.
            rules.push(
                `${sidebar}{width:${servers ? "0" : "var(--custom-guild-list-width)"}!important;min-width:0!important;overflow:visible!important;z-index:1002}`,
                `${sidebar}:after,${sel(L.sidebarResizeHandle)}{display:none!important}`,
                `${sel(L.sidebarList)}{position:absolute!important;grid-area:auto!important;top:0;bottom:0;inset-inline-start:var(--custom-guild-list-width);width:calc(var(--custom-guild-sidebar-width) - var(--custom-guild-list-width) - 1px)!important;background:var(--background-base-lower);border-start-end-radius:var(--radius-md,8px)}`,
                `${sel(L.panels)}{width:calc(var(--custom-guild-sidebar-width) - var(--custom-panels-spacing,8px)*2)!important}`,
                `${hidden}{visibility:hidden;opacity:0;transform:translateX(-12px);transition:opacity .12s ease .3s,transform .12s ease .3s,visibility 0s linear .42s}`,
                `${shown}{visibility:visible;opacity:1;transform:none;transition-delay:.08s,.08s,0s}`,
                `${sel(L.sidebarList)}{box-shadow:4px 0 16px rgba(0,0,0,.4)}`
            );
            if (servers) {
                // Both lists hidden: a thin invisible strip at the left edge brings both back.
                rules.push(
                    `${sel(L.guilds)}{position:absolute!important;grid-area:auto!important;top:0;bottom:0;inset-inline-start:0;background:var(--background-base-lowest);box-shadow:4px 0 16px rgba(0,0,0,.4)}`,
                    `${sidebar}:before{content:"";position:absolute;grid-area:auto;top:0;bottom:0;inset-inline-start:0;width:6px}`
                );
            } else {
                // Discord keeps room under the server list for the account bar; it is given
                // back only while the channel list and the account bar are out.
                rules.push(`${sidebar}:not(:hover) ${sel(L.guilds)}{margin-bottom:0!important}`);
            }
        } else if (servers) {
            rules.push(`${sel(L.guilds)}{display:none!important}`, `${sel(L.sidebar)}{width:auto!important}`);
        }
    }

    if (L && T && isHidden("topBar")) {
        rules.push(
            `${sel(L.base)}{grid-template-rows:[top] 0 [titleBarEnd] min-content [noticeEnd] 1fr [end]!important}`,
            `${sel(T.bar)}{position:absolute!important;inset-inline:0;top:0;z-index:1001;background:var(--background-base-lowest);box-shadow:0 2px 8px rgba(0,0,0,.35);transform:translateY(calc(6px - 100%));transition:transform .12s ease .3s}`,
            `${sel(T.bar)}:hover,${sel(T.bar)}:focus-within{transform:none;transition-delay:0s}`
        );
    }

    if (C && isHidden("channelHeader")) {
        rules.push(`html:not(.agentdisc-searching) ${sel(C.chat)} ${sel(C.title)}{display:none!important}`);
    }

    if (isHidden("notices")) {
        for (const cls of [N?.notice, P?.notice]) if (cls) rules.push(`${sel(cls)}{display:none!important}`);
    }

    const s = settings.store;
    if (s.hideServerHeader && H) rules.push(`${sel(H.container)}{display:none!important}`);
    if (s.hideAccountPanel && L) rules.push(`${sel(L.panels)}{display:none!important}`);
    if (s.hideAddDiscover && S) {
        const item = sel(S.listItem);
        rules.push(`${item}:has([data-list-item-id="guildsnav___create-join-button"]),${item}:has([data-list-item-id="guildsnav___guild-discover-button"]){display:none!important}`);
    }
    if (s.hideMessageButtons) rules.push(".vc-message-button{display:none!important}");

    return rules.join("\n");
}

let style: HTMLStyleElement | null = null;

function membersOpen() {
    try {
        return ChannelSectionStore.getState().isMembersOpen;
    } catch {
        return null;
    }
}

// Discord's member switch first closes whatever else sits in the right panel
// (a side thread, search results), so press it until the member list really moved.
function setMembersOpen(want: boolean) {
    for (let i = 0; i < 2 && membersOpen() === !want; i++) {
        FluxDispatcher.dispatch({ type: "CHANNEL_TOGGLE_MEMBERS_SECTION" });
    }
    return membersOpen() === want;
}

function syncMembers() {
    const s = settings.store;
    const open = membersOpen();
    if (open == null) return;

    if (s.chatOnly && open) {
        s.membersClosedByChatOnly = setMembersOpen(false);
    } else if (!s.chatOnly && s.membersClosedByChatOnly) {
        setMembersOpen(true);
        s.membersClosedByChatOnly = false;
    }
}

function apply() {
    if (style) style.textContent = buildCss();
}

// Some of Discord's modules throw when their values are read while they are still
// loading. A lookup that trips on one retries a little later instead of stopping
// every switch.
function lookUp(part: Part, attempt = 1) {
    const names = PARTS[part];
    const matches = filters.byClassNames(...names);
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
                classes[part] = mapMangledCssClasses(mod, names);
                apply();
            } catch (e) {
                logger.warn(`Could not read the ${part} class names`, e);
            }
        });
    } catch (e) {
        if (attempt < 5) setTimeout(() => lookUp(part, attempt + 1), 3000);
        else logger.warn(`Could not look up the ${part} class names`, e);
    }
}

// Search lives in the channel header. When the header is hidden, it comes back while a
// search is going on (the search box has the focus or search results are open) and goes
// away again a moment after (Stephane, 30 Sept: a search button in the top bar).
let searchTimer: ReturnType<typeof setInterval> | null = null;

function setSearching(on: boolean) {
    document.documentElement.classList.toggle("agentdisc-searching", on);
    if (searchTimer) clearInterval(searchTimer);
    searchTimer = null;
    if (!on) return;
    let quiet = 0;
    searchTimer = setInterval(() => {
        const title = classes.chat?.title?.split(" ").map(c => "." + c).join("");
        const inHeader = title && document.activeElement?.closest(title);
        const results = document.querySelector('[class*="searchResultsWrap_"]');
        if (inHeader || results) quiet = 0;
        else if (++quiet >= 3) setSearching(false);
    }, 500);
}

export function startSearch() {
    if (isHidden("channelHeader")) setSearching(true);
    requestAnimationFrame(() => ComponentDispatch?.dispatch("FOCUS_SEARCH", { prefillCurrentChannel: true }));
}

// The server list button: shows the list when it is hidden (also when chat only hid
// it), hides it when it is shown.
export function toggleServerList() {
    const s = settings.store;
    if (isHidden("serverList")) {
        s.hideServerList = false;
        if (s.chatOnly) s.chatOnly = false;
    } else {
        s.hideServerList = true;
    }
}

function onKeyDown(e: KeyboardEvent) {
    // Discord's own search shortcut also brings a hidden channel header back.
    if (e.code === "KeyF" && (e.ctrlKey || e.metaKey) && !e.altKey && isHidden("channelHeader")) setSearching(true);
    if (e.code !== "KeyF" || !e.ctrlKey || !e.altKey || e.shiftKey || e.metaKey || e.repeat) return;
    e.preventDefault();
    e.stopPropagation();
    settings.store.chatOnly = !settings.store.chatOnly;
}

export function toggleMembers() {
    FluxDispatcher.dispatch({ type: "CHANNEL_TOGGLE_MEMBERS_SECTION" });
}

export default definePlugin({
    name: "PanelSwitches",
    description: "Hide Discord's panels one by one from the AgentDisc button menu, or all side panels at once with Ctrl+Alt+F (chat only).",
    authors: [{ name: "Steph", id: 0n }],
    enabledByDefault: true,
    // The tick boxes live in the AgentDisc button menu, so the button must be on.
    dependencies: ["VencordToolbox"],
    settings,

    patches: [{
        // Each message box button sits in a wrapper that takes no room of its own, so one
        // style rule can hide them the moment the tick box changes.
        find: '},"appLauncher")',
        replacement: {
            match: /(?<=\?null:\(0,\i\.jsx\)\("div",\{className:\i\.\i,children:)(\i)(?=\}\))/,
            replace: "$self.wrapMessageButtons($1)"
        }
    }],

    wrapMessageButtons(buttons: any) {
        if (!Array.isArray(buttons)) return buttons;
        return buttons.map(b => MESSAGE_BUTTONS.has(b?.key)
            ? <div className="vc-message-button" key={b.key} style={{ display: "contents" }}>{b}</div>
            : b);
    },

    toolboxActions() {
        const s = settings.use(["chatOnly", "hideServerList", "hideChannelList", "hideTopBar", "hideChannelHeader", "hideNotices", "hideServerHeader", "hideServerLines", "hideAccountPanel", "hideAddDiscover", "hideMessageButtons"]);
        const membersHidden = useStateFromStores([ChannelSectionStore as any], () => !ChannelSectionStore.getState().isMembersOpen);
        const flip = (key: keyof typeof s) => () => { settings.store[key] = !settings.store[key]; };

        return [
            <Menu.MenuCheckboxItem key="chat-only" id="agentdisc-chat-only" label="Chat only (Ctrl+Alt+F)" checked={s.chatOnly} action={flip("chatOnly")} />,
            <Menu.MenuCheckboxItem key="servers" id="agentdisc-hide-servers" label="Hide server list" checked={s.hideServerList} action={flip("hideServerList")} />,
            <Menu.MenuCheckboxItem key="channels" id="agentdisc-hide-channels" label="Hide channel list" checked={s.hideChannelList} action={flip("hideChannelList")} />,
            <Menu.MenuCheckboxItem key="members" id="agentdisc-hide-members" label="Hide member list (Ctrl+U)" checked={membersHidden} action={toggleMembers} />,
            <Menu.MenuCheckboxItem key="top-bar" id="agentdisc-hide-top-bar" label="Hide top bar" checked={s.hideTopBar} action={flip("hideTopBar")} />,
            <Menu.MenuCheckboxItem key="header" id="agentdisc-hide-header" label="Hide channel header" checked={s.hideChannelHeader} action={flip("hideChannelHeader")} />,
            <Menu.MenuCheckboxItem key="notices" id="agentdisc-hide-notices" label="Hide notice banners" checked={s.hideNotices} action={flip("hideNotices")} />,
            <Menu.MenuCheckboxItem key="server-name" id="agentdisc-hide-server-name" label="Hide server name bar" checked={s.hideServerHeader} action={flip("hideServerHeader")} />,
            <Menu.MenuCheckboxItem key="server-lines" id="agentdisc-hide-server-lines" label="Hide Events and Boosts" checked={s.hideServerLines} action={flip("hideServerLines")} />,
            <Menu.MenuCheckboxItem key="account" id="agentdisc-hide-account" label="Hide account bar (and call buttons)" checked={s.hideAccountPanel} action={flip("hideAccountPanel")} />,
            <Menu.MenuCheckboxItem key="add-discover" id="agentdisc-hide-add-discover" label="Hide add server and Discover" checked={s.hideAddDiscover} action={flip("hideAddDiscover")} />,
            <Menu.MenuCheckboxItem key="message-buttons" id="agentdisc-hide-message-buttons" label="Hide message box buttons" checked={s.hideMessageButtons} action={flip("hideMessageButtons")} />
        ];
    },

    start() {
        style = document.createElement("style");
        style.id = "agentdisc-panel-switches";
        (document.head ?? document.documentElement).append(style);

        // The shortcut first, so it works even if a lookup below trips.
        document.addEventListener("keydown", onKeyDown, true);

        for (const part of Object.keys(PARTS) as Part[]) lookUp(part);

        apply();
        // After a reload, give the member list back if chat only was switched off meanwhile.
        if (!settings.store.chatOnly) syncMembers();
    },

    stop() {
        document.removeEventListener("keydown", onKeyDown, true);
        setSearching(false);
        style?.remove();
        style = null;
    }
});
