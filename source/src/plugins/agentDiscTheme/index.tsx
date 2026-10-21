/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { channelHeaderSelector, serverHeaderSelector } from "@plugins/panelSwitches";
import { setBoardLook } from "@plugins/vencordToolbox/missionBoard";
import definePlugin, { OptionType } from "@utils/types";
import { FluxDispatcher, Menu, ThemeStore } from "@webpack/common";

// AgentDisc themes: a short list of Discord's current colour names (checked in
// Discord's live styles on 29 Sept 2026) set over its dark look. Midnight applies only
// while Discord itself is on a dark look (Dark, Darker or Midnight in its Appearance
// settings).
//
// Ivory (Stephane, 20 Oct: "a light theme that looks completely different ... elegant like
// a mix of wisperflow/anthropic branding"; he picked the Ivory picture) is a light look:
// Discord's own light look, switched on for this computer only (Discord's local theme
// override, never his account's setting, so his phone and other computers keep theirs),
// with Anthropic's ivory papers, clay orange and dark ink (read from anthropic.com's styles
// that day). Made neater on 21 Oct after his screenshots of the Claude app and Wispr Flow
// ("How can you make it more neat?", then "Yes, definitely better" to the picture): one paper
// for the whole frame, the chat and right panel on one white sheet with round corners, a
// centred reading column, a round message box, dots instead of stripes for bookmarks, plain
// tool icons and a slim busy line. Wispr Flow's fonts were tried for a morning and taken out.

type Colours = Record<string, string>;

const MIDNIGHT: Colours = {
    "--background-base-lowest": "#000",
    "--background-base-lower": "#050506",
    "--background-base-low": "#0a0a0c",
    "--background-surface-high": "#0e0e11",
    "--background-surface-higher": "#141418",
    "--background-surface-highest": "#1a1a1f",
    "--bg-surface-raised": "#141418",
    "--app-frame-background": "#000",
    "--app-frame-border": "hsla(240,4%,61%,.14)",
    // The chat is a little lighter than the channel list, so the two stand apart (Stephane, 29 Sept).
    "--chat-background": "#121216",
    // The message box keeps the channel list's dark colour, so it stands out from the chat (Stephane, 29 Sept).
    "--chat-background-default": "#050506",
    "--home-background": "#000",
    "--modal-background": "#0e0e11",
    "--modal-footer-background": "#0e0e11",
    "--card-background-default": "#0e0e11",
    "--border-subtle": "hsla(240,4%,61%,.14)",
    "--border-muted": "hsla(240,4%,61%,.08)",
    "--text-strong": "#e4e5e9",
    "--text-default": "#c7cad1",
    "--text-subtle": "#a0a3ab",
    "--text-muted": "#7b7e87",
    "--interactive-text-default": "#a0a3ab",
    "--interactive-text-hover": "#e4e5e9",
    "--interactive-text-active": "#e4e5e9",
    "--interactive-icon-default": "#a0a3ab",
    "--interactive-icon-hover": "#e4e5e9",
    "--interactive-icon-active": "#e4e5e9",
    "--icon-default": "#c7cad1",
    "--icon-strong": "#e4e5e9",
    "--icon-subtle": "#a0a3ab",
    "--icon-muted": "#7b7e87",
    "--channel-icon": "#6f727b"
};


// Light, warm: the papers go from the darkest (the server column) to the lightest (cards).
const IVORY: Colours = {
    "--app-frame-background": "#F0EEE6",
    "--app-frame-border": "#E8E6DC",
    "--background-base-lowest": "#F0EEE6",
    "--background-base-lower": "#F0EEE6",
    "--background-base-low": "#F5F4ED",
    "--background-surface-high": "#FFFFFF",
    "--background-surface-higher": "#FFFFFF",
    "--background-surface-highest": "#FFFFFF",
    "--bg-surface-raised": "#FFFFFF",
    "--chat-background": "#FAF9F5",
    // The message box: a white card on the ivory chat, like the picture.
    "--chat-background-default": "#FFFFFF",
    "--chat-border": "#DEDCD1",
    "--chat-text-muted": "#87867F",
    "--home-background": "#F0EEE6",
    "--modal-background": "#FAF9F5",
    "--modal-footer-background": "#F5F4ED",
    "--card-background-default": "#FFFFFF",
    "--card-border-default": "#DEDCD1",
    "--border-subtle": "#DEDCD1",
    "--border-muted": "#E8E6DC",
    "--border-normal": "#D1CFC5",
    "--border-strong": "#B0AEA5",
    "--text-strong": "#141413",
    "--text-default": "#1F1E1D",
    "--text-subtle": "#5E5D59",
    "--text-muted": "#87867F",
    "--text-link": "#C6613F",
    "--text-brand": "#D97757",
    "--icon-link": "#C6613F",
    "--icon-brand": "#D97757",
    "--control-brand-foreground": "#D97757",
    "--control-brand-foreground-new": "#D97757",
    "--mention-background": "rgb(217 119 87 / 18%)",
    "--mention-foreground": "#A8492B",
    "--interactive-text-default": "#5E5D59",
    "--interactive-text-hover": "#141413",
    "--interactive-text-active": "#141413",
    "--interactive-icon-default": "#73726C",
    "--interactive-icon-hover": "#141413",
    "--interactive-icon-active": "#141413",
    "--interactive-background-default": "rgb(20 20 19 / 4%)",
    "--interactive-background-hover": "rgb(20 20 19 / 6%)",
    "--interactive-background-active": "rgb(20 20 19 / 10%)",
    "--interactive-background-selected": "rgb(20 20 19 / 9%)",
    "--background-mod-subtle": "rgb(20 20 19 / 6%)",
    "--background-mod-normal": "rgb(20 20 19 / 9%)",
    "--background-mod-strong": "rgb(20 20 19 / 13%)",
    "--background-mod-muted": "rgb(20 20 19 / 4%)",
    "--icon-default": "#3D3D3A",
    "--icon-strong": "#141413",
    "--icon-subtle": "#73726C",
    "--icon-muted": "#87867F",
    "--channel-icon": "#A3A199",
    "--input-background-default": "#FFFFFF",
    "--input-border-default": "#DEDCD1",
    "--scrollbar-thin-thumb": "#D1CFC5",
    "--scrollbar-auto-thumb": "#D1CFC5",
    "--scrollbar-auto-track": "transparent",
    "--font-primary": "Inter,\"gg sans\",\"Noto Sans\",\"Helvetica Neue\",Helvetica,Arial,sans-serif",
    // AgentDisc's own colours on light paper (channelGroups, typingIndicator, the toolbox).
    "--agentdisc-selected": "#E3E0D6",
    "--agentdisc-selected-text": "#141413",
    "--agentdisc-selected-glow": "transparent",
    "--agentdisc-selected-ring": "transparent",
    "--agentdisc-card": "#E8E6DC",
    "--agentdisc-bookmark-text": "#141413",
    "--agentdisc-tint": "9%",
    "--agentdisc-bar": "0px",
    "--agentdisc-bar-selected": "0px",
    "--agentdisc-hairline": "1px",
    "--agentdisc-green": "#4E8B60",
    "--agentdisc-red": "#C4473B",
    "--agentdisc-blue": "#2C84DB",
    "--agentdisc-yellow": "#C69A4A",
    "--agentdisc-pill-text": "#2C84DB",
    "--agentdisc-pill-mix": "0%",
    "--agentdisc-feedback-text": "#141413",
    "--agentdisc-map-on": "#141413"
};

// Back to the first fonts on 21 Oct ("The font is actually shitty ... Going back to the
// previous one was better"): Source Serif 4 titles and Inter text.
const IVORY_FONTS = "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,500;8..60,600&display=swap');";
const SERIF = "'Source Serif 4',Georgia,serif";

// Ivory's shape (21 Oct): the parts that only colours cannot change. The white sheet is the
// area right of the channel list, found through panelSwitches; the rest by Discord's stable
// name starts and by AgentDisc's own classes.
// The chat area: an element of Discord's whose class starts with chat_, and not one inside
// another (a thread open beside the channel has its own).
const CHAT_PART = ':is([class^="chat_"],[class*=" chat_"])';
const CHAT = `${CHAT_PART}:not(${CHAT_PART} *)`;
// The paper left around the sheet: top, right, bottom, left.
const SHEET_INSET = "6px 12px 12px 4px";

function ivoryShape(header: string, server: string) {
    const L = ".theme-light";
    const within = (root: string, inner: string) => root.split(",").map(r => `${L} ${r} ${inner}`).join(",");
    const titleFont = `font-family:${SERIF},"Noto Color Emoji"!important;font-weight:600!important;letter-spacing:0!important`;
    return [
        // The white sheet (his "nice white frame with the borders ... gives the whole feeling"):
        // the chat area (header, messages and right panel), not a chat inside it, drawn inset
        // from its own edges with round corners, so the ivory paper shows all round. Its
        // content moves in by the same space, so nothing is cut off and no scrollbar appears.
        `${L} ${CHAT}{padding:${SHEET_INSET}!important;box-sizing:border-box!important;clip-path:inset(${SHEET_INSET} round 18px)!important;background:#FFFFFF!important;--background-base-lowest:#FFFFFF!important;--background-base-lower:#FFFFFF!important;--background-base-low:#FFFFFF!important;--chat-background:#FFFFFF!important;--background-gradient-chat:#FFFFFF!important;--background-gradient-lowest:#FFFFFF!important;--background-gradient-lower:#FFFFFF!important;--background-gradient-low:#FFFFFF!important;--__header-bar-background:#FFFFFF!important;border:none!important;border-radius:0!important}`,
        `${L} ${CHAT}::after{content:"";position:absolute;inset:${SHEET_INSET};border:1px solid #DEDCD1;border-radius:18px;pointer-events:none;z-index:200}`,
        // The channel name bar is part of the sheet: Discord paints it with its own two colours.
        `${L} ${CHAT} [class*="themed_"]{background:#FFFFFF!important}`,
        // The board laid over the panel keeps the sheet's round corner at the bottom right.
        ".agentdisc-board-frame:not(.agentdisc-board-full){border-end-end-radius:17px}",
        // The channel's name above the messages: a Garamond title, no # before it, no line under it.
        header && `${within(header, '[class*="titleWrapper_"]')},${within(header, '[class*="titleWrapper_"] *')}{${titleFont};font-size:19px!important}`,
        header && `${within(header, '[class*="children_"]>[class*="iconWrapper_"]:first-child')}{display:none!important}`,
        header && `${header.split(",").map(h => `${L} ${h}`).join(",")}{box-shadow:none!important;border-bottom:none!important}`,
        // The server's name above the channels, in the same title font.
        server && `${server.split(",").map(h => `${L} ${h}`).join(",")},${within(server, "*")}{${titleFont}}`,
        server && `${within(server, "h1")},${within(server, "h2")},${within(server, '[class*="name_"]')}{font-size:19px!important}`,
        // A reading column in the middle, and the message box under it.
        `${L} ol[data-list-id="chat-messages"]{max-width:860px!important;margin-inline:auto!important;width:100%!important}`,
        `${L} [class*="chatContent_"]>form{max-width:860px!important;margin-inline:auto!important;width:100%!important}`,
        `${L} [class*="channelTextArea_"]{border-radius:24px!important;border:1px solid #E8E6DC!important;box-shadow:0 2px 8px rgb(20 20 19 / 5%)!important;background:#FFFFFF!important}`,
        `${L} [class*="channelTextArea_"]>[class*="scrollableContainer_"]{border-radius:24px!important;background:#FFFFFF!important}`,
        // The tools above the channels: plain grey line icons, no squares.
        ".vc-list-icon{background:transparent!important;color:#87867F!important}",
        ".vc-list-icon:hover:not(:disabled),.vc-list-icon-on{background:rgb(20 20 19 / 6%)!important;color:#141413!important}",
        ".vc-list-icon-warn{background:transparent!important;color:#C4473B!important}",
        // The busy bar: a slim line along the top, its words in quiet grey.
        ".agentdisc-busy{background:transparent!important}",
        ".agentdisc-busy-fill{height:3px!important;background:var(--busy)!important;overflow:visible!important}",
        ".agentdisc-busy-fill::after,.agentdisc-busy-flames{display:none!important}",
        ".agentdisc-busy-label{color:#87867F!important;text-shadow:none!important;font-weight:500!important}",
        ".agentdisc-busy-count{background:rgb(20 20 19 / 7%)!important;color:#141413!important}"
    ].filter(Boolean).join("");
}

export const THEMES = { midnight: MIDNIGHT, ivory: IVORY } as const;

// Where each theme's colours go: Discord's dark looks, or its light look.
const LOOKS: Record<keyof typeof THEMES, string[]> = {
    midnight: [".theme-dark", ".theme-darker", ".theme-midnight"],
    ivory: [".theme-light"]
};

// Colours set only inside the chat, so it can be lighter than the channel list: Discord
// paints both with the same colour setting (Stephane, 29 Sept: "a little bit less black").
const CHAT_ONLY: Partial<Record<keyof typeof THEMES, Colours>> = {
    midnight: { "--background-base-lower": "#121216" },
    ivory: { "--background-base-lower": "#FAF9F5" }
};

const DARK_LOOKS = [".theme-dark", ".theme-darker", ".theme-midnight"];

const settings = definePluginSettings({
    theme: {
        type: OptionType.SELECT,
        description: "Colours over Discord's dark look",
        options: [
            { label: "Discord's normal dark", value: "discord" },
            { label: "Midnight (true black, calm)", value: "midnight", default: true },
            { label: "Ivory (light, warm paper)", value: "ivory" }
        ],
        onChange: () => apply()
    }
});

// Messages keep the same background when the mouse is over them (Stephane, 29 Sept).
// Discord paints that hover through these colour settings; each hover colour is set to
// its normal colour, so mentions and highlighted messages keep their own background.
const NO_HOVER_BACKGROUND = `${DARK_LOOKS.join(",")},.theme-light{`
    + "--message-background-hover:transparent!important;"
    + "--message-mentioned-background-hover:var(--message-mentioned-background-default)!important;"
    + "--message-highlight-background-hover:var(--message-highlight-background-default)!important;"
    + "--message-automod-background-hover:var(--message-automod-background-default)!important}";

let style: HTMLStyleElement | null = null;
let noHover: HTMLStyleElement | null = null;

// Ivory needs Discord's light look. It is asked for on this computer only and asked for
// again if Discord drops it (a change of his appearance settings clears the override).
let lightAsked = false;

function wantLight() {
    return style != null && settings.store.theme === "ivory";
}

// A mark on the page for the parts of AgentDisc drawn elsewhere (the dots of the channel list).
// An attribute, not a class: Discord rewrites the page's classes when its look changes, which
// wiped the first mark (21 Oct, his screenshot: no dots, squares and the big bar still there).
function markLook() {
    const want = style != null && settings.store.theme === "ivory";
    if (want) document.documentElement.dataset.agentdiscLook = "ivory";
    else delete document.documentElement.dataset.agentdiscLook;
}

// Asked a moment later, never from inside Discord's own change of look.
function keepLook() {
    setTimeout(() => {
        markLook();
        if (wantLight()) {
            if (ThemeStore && ThemeStore.theme !== "light") {
                lightAsked = true;
                FluxDispatcher.dispatch({ type: "SET_THEME_OVERRIDE", theme: "light" } as any);
            }
        } else if (lightAsked) {
            lightAsked = false;
            FluxDispatcher.dispatch({ type: "CLEAR_THEME_OVERRIDE" } as any);
        }
    }, 0);
}

// Discord's store of looks can arrive after the start.
let listening = false;
let listenTimer: ReturnType<typeof setTimeout> | null = null;

function listen() {
    listenTimer = null;
    if (!style || listening) return;
    if (!ThemeStore?.addChangeListener) {
        listenTimer = setTimeout(listen, 1000);
        return;
    }
    ThemeStore.addChangeListener(keepLook);
    listening = true;
    keepLook();
}

// The serif titles need Discord's class names, found a moment after start.
let titleTimer: ReturnType<typeof setTimeout> | null = null;

function apply() {
    if (!style) return;
    const key = settings.store.theme as keyof typeof THEMES;
    const colours = THEMES[key];
    const looks = LOOKS[key] ?? DARK_LOOKS;
    const rule = (selector: string, set: Colours) => `${selector}{${Object.entries(set).map(([name, value]) => `${name}:${value}!important`).join(";")}}`;
    const chat = CHAT_ONLY[key];
    const inChat = looks.flatMap(look => [`${look} [class^="chat_"]`, `${look} [class*=" chat_"]`]).join(",");
    let text = colours ? rule(looks.join(","), colours) + (chat ? rule(inChat, chat) : "") : "";
    if (key === "ivory") {
        const header = channelHeaderSelector() ?? "";
        const server = serverHeaderSelector();
        if ((!header || !server) && !titleTimer) titleTimer = setTimeout(() => { titleTimer = null; apply(); }, 2000);
        text = IVORY_FONTS + text + ivoryShape(header, server);
    }
    style.textContent = text;
    markLook();
    setBoardLook(key === "ivory" ? "ivory" : "dark");
    keepLook();
}

export default definePlugin({
    name: "AgentDiscTheme",
    description: "A theme choice: Discord's normal dark, Midnight (true black) or Ivory (light, warm paper).",
    authors: [{ name: "Steph", id: 0n }],
    enabledByDefault: true,
    // The theme choice lives in the AgentDisc button menu, so the button must be on.
    dependencies: ["VencordToolbox"],
    settings,

    // Shown inline in the AgentDisc menu, no submenu (Stephane, 29 Sept: one simple frame).
    toolboxActions() {
        const { theme } = settings.use(["theme"]);
        const options = [["discord", "Discord's normal dark"], ["midnight", "Midnight"], ["ivory", "Ivory (light)"]];

        return options.map(([value, label]) => (
            <Menu.MenuRadioItem
                key={value}
                id={`agentdisc-theme-${value}`}
                group="agentdisc-theme"
                label={label}
                checked={(theme === "warm" ? "discord" : theme) === value}
                action={() => { settings.store.theme = value; }}
            />
        ));
    },

    start() {
        if (settings.store.theme === "warm") settings.store.theme = "discord";
        noHover = document.createElement("style");
        noHover.id = "agentdisc-no-message-hover";
        noHover.textContent = NO_HOVER_BACKGROUND;
        (document.head ?? document.documentElement).append(noHover);
        style = document.createElement("style");
        style.id = "agentdisc-theme";
        (document.head ?? document.documentElement).append(style);
        apply();
        listen();
    },

    stop() {
        if (listening) ThemeStore?.removeChangeListener?.(keepLook);
        listening = false;
        if (listenTimer) clearTimeout(listenTimer);
        listenTimer = null;
        if (titleTimer) clearTimeout(titleTimer);
        titleTimer = null;
        style?.remove();
        style = null;
        delete document.documentElement.dataset.agentdiscLook;
        keepLook();
    }
});
