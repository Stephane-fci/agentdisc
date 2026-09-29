/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

// Left-hand shortcuts: Alt with the gaming keys does what Alt with the arrows does.
// Discord keeps a list of keys for each move; each list gets one more entry, so both
// ways always do exactly the same thing.
//   AZERTY  Alt+Z up, Alt+S down, Alt+Q back, Alt+D forward
//   QWERTY  Alt+W up, Alt+S down, Alt+A back, Alt+D forward
const LETTERS = {
    zqsd: { up: "alt+z", down: "alt+s", left: "alt+q", right: "alt+d" },
    wasd: { up: "alt+w", down: "alt+s", left: "alt+a", right: "alt+d" }
};

const settings = definePluginSettings({
    letters: {
        type: OptionType.SELECT,
        description: "Which keys move between channels with Alt",
        options: [
            { label: "Z Q S D (AZERTY keyboard)", value: "zqsd", default: true },
            { label: "W A S D (QWERTY keyboard)", value: "wasd" }
        ],
        restartNeeded: true
    }
});

export default definePlugin({
    name: "LeftHandKeys",
    description: "Alt with Z, S, Q and D (or W, S, A and D on a QWERTY keyboard) moves between channels like Alt with the up, down, left and right arrows.",
    authors: [{ name: "Steph", id: 0n }],
    enabledByDefault: true,
    settings,

    key(move: "up" | "down" | "left" | "right") {
        try {
            return LETTERS[settings.store.letters === "wasd" ? "wasd" : "zqsd"][move];
        } catch {
            return LETTERS.zqsd[move];
        }
    },

    patches: [{
        find: 'binds:["alt+down"],comboKeysBindGlobal',
        replacement: [
            { match: /binds:\["alt\+up"\]/, replace: 'binds:["alt+up",$self.key("up")]' },
            { match: /binds:\["alt\+down"\]/, replace: 'binds:["alt+down",$self.key("down")]' },
            { match: /\["alt\+left"\]/, replace: '["alt+left",$self.key("left")]' },
            { match: /\["alt\+right"\]/, replace: '["alt+right",$self.key("right")]' }
        ]
    }]
});
