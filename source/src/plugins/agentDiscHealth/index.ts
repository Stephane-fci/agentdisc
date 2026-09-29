/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import { Logger } from "@utils/Logger";
import definePlugin, { StartAt } from "@utils/types";

// AgentDisc: when a Discord update stops one of our features from attaching,
// Vencord only writes a warning in the browser console. This shows a small bar
// at the top of Discord that names the feature instead. The full check runs in
// the update script; this bar catches what changed between two updates.

const FEATURE_NAMES: Record<string, string> = {
    TypingIndicator: "the typing dots",
    ChannelListTidy: "the channel list tidy-up",
    VencordToolbox: "the AgentDisc button",
    PanelSwitches: "the panel switches",
    AgentDiscTheme: "the themes",
    Settings: "the AgentDisc settings"
};

const PATCH_FAIL = /^Patch by (\S+) (?:had no effect|errored) \(/;
const START_FAIL = /^Failed to start (\S+)/;
const SHOW_AFTER_MS = 20_000;

const broken = new Set<string>();
let ready = false;
let dismissed = false;
let bar: HTMLDivElement | null = null;
const originals = { warn: Logger.prototype.warn, error: Logger.prototype.error };

const reasons = new Map<string, string>();

function record(logger: Logger, first: unknown, second?: unknown) {
    if (typeof first !== "string") return;
    const match = logger.name === "WebpackPatcher" ? PATCH_FAIL.exec(first)
        : logger.name === "PluginManager" ? START_FAIL.exec(first)
            // Our own features report a part they could not attach with "Could not ...".
            : logger.name in FEATURE_NAMES && first.startsWith("Could not") ? [first, logger.name]
                : null;
    if (!match || broken.has(match[1])) return;
    broken.add(match[1]);
    // Kept for the bar's tooltip, so a screenshot of it shows the cause.
    const why = second instanceof Error ? second.message : typeof second === "string" ? second : first;
    reasons.set(match[1], `${match[1]}: ${why}`.slice(0, 300));
    render();
}

function listNames(names: string[]) {
    return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function render() {
    if (!ready || dismissed) return;
    const names = [...broken].filter(p => isPluginEnabled(p)).map(p => FEATURE_NAMES[p] ?? p);
    if (!names.length) return;

    if (!bar) {
        bar = document.createElement("div");
        bar.id = "agentdisc-health";
        bar.setAttribute("role", "status");
        Object.assign(bar.style, {
            position: "fixed", top: "6px", left: "50%", transform: "translateX(-50%)", zIndex: "100000",
            display: "flex", alignItems: "center", gap: "12px", maxWidth: "80vw",
            padding: "6px 8px 6px 14px", background: "#5865f2", color: "#fff",
            font: "600 13px/1.4 var(--font-primary, sans-serif)", boxShadow: "0 2px 10px rgba(0,0,0,.45)"
        });
        const text = document.createElement("span");
        const close = document.createElement("button");
        close.textContent = "✕";
        close.title = "Hide until Discord reloads";
        Object.assign(close.style, { background: "transparent", border: "0", color: "#fff", font: "inherit", cursor: "pointer", padding: "0 6px" });
        close.onclick = () => {
            dismissed = true;
            bar?.remove();
        };
        bar.append(text, close);
        document.body.append(bar);
    }

    bar.title = [...broken].filter(p => isPluginEnabled(p)).map(p => reasons.get(p) ?? p).join("\n");
    bar.firstElementChild!.textContent =
        `AgentDisc: a Discord update stopped ${listNames(names)}. Everything else works. Ask for an AgentDisc update.`;
}

export default definePlugin({
    name: "AgentDiscHealth",
    description: "Shows a small bar at the top of Discord when a Discord update stops one of AgentDisc's features.",
    authors: [{ name: "Steph", id: 0n }],
    enabledByDefault: true,
    startAt: StartAt.Init,

    start() {
        Logger.prototype.warn = function (this: Logger, ...args: any[]) {
            record(this, args[0], args[1]);
            return originals.warn.apply(this, args);
        };
        Logger.prototype.error = function (this: Logger, ...args: any[]) {
            record(this, args[0], args[1]);
            return originals.error.apply(this, args);
        };

        setTimeout(() => {
            ready = true;
            render();
        }, SHOW_AFTER_MS);
    },

    stop() {
        Logger.prototype.warn = originals.warn;
        Logger.prototype.error = originals.error;
        bar?.remove();
        bar = null;
    }
});
