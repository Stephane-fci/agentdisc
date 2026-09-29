/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";
import { Menu } from "@webpack/common";

// AgentDisc themes: a short list of Discord's current colour names (checked in
// Discord's live styles on 29 Sept 2026) set over its dark look. They apply only
// while Discord itself is on a dark look (Dark, Darker or Midnight in its
// Appearance settings); on the light look nothing changes.

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


export const THEMES = { midnight: MIDNIGHT } as const;

// Colours set only inside the chat, so it can be lighter than the channel list: Discord
// paints both with the same colour setting (Stephane, 29 Sept: "a little bit less black").
const CHAT_ONLY: Partial<Record<keyof typeof THEMES, Colours>> = {
    midnight: { "--background-base-lower": "#121216" }
};

const DARK_LOOKS = [".theme-dark", ".theme-darker", ".theme-midnight"];

const settings = definePluginSettings({
    theme: {
        type: OptionType.SELECT,
        description: "Colours over Discord's dark look",
        options: [
            { label: "Discord's normal dark", value: "discord" },
            { label: "Midnight (true black, calm)", value: "midnight", default: true }
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

function apply() {
    if (!style) return;
    const colours = THEMES[settings.store.theme as keyof typeof THEMES];
    const rule = (selector: string, set: Colours) => `${selector}{${Object.entries(set).map(([name, value]) => `${name}:${value}!important`).join(";")}}`;
    const chat = CHAT_ONLY[settings.store.theme as keyof typeof THEMES];
    const inChat = DARK_LOOKS.flatMap(look => [`${look} [class^="chat_"]`, `${look} [class*=" chat_"]`]).join(",");
    style.textContent = colours
        ? rule(DARK_LOOKS.join(","), colours) + (chat ? rule(inChat, chat) : "")
        : "";
}

export default definePlugin({
    name: "AgentDiscTheme",
    description: "A theme choice over Discord's dark look: Discord's normal dark or Midnight.",
    authors: [{ name: "Steph", id: 0n }],
    enabledByDefault: true,
    // The theme choice lives in the AgentDisc button menu, so the button must be on.
    dependencies: ["VencordToolbox"],
    settings,

    // Shown inline in the AgentDisc menu, no submenu (Stephane, 29 Sept: one simple frame).
    toolboxActions() {
        const { theme } = settings.use(["theme"]);
        const options = [["discord", "Discord's normal dark"], ["midnight", "Midnight"]];

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
    },

    stop() {
        style?.remove();
        style = null;
    }
});
