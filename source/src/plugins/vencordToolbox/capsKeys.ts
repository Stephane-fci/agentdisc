/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import { toggleLeftPanel, toggleMembers } from "@plugins/panelSwitches";

import { isFeedbackOn, setFeedback } from "./feedback";

// Caps Lock shortcuts (Stephane, 12 Oct), for his left hand at rest: thumb on space, little
// finger on Caps Lock, middle finger on Z.
//   Caps Lock twice          feedback mode on or off (the two presses leave capitals as they were)
//   Caps Lock held + ←       hide or show the left panel (servers and channels)
//   Caps Lock held + →       hide or show the right panel
// F13 counts as Caps Lock, for a Caps Lock key remapped to it on the PC.

const TWICE_MS = 400;

let held = false;
let usedWithArrow = false;
let lastTap = 0;

const isCaps = (e: KeyboardEvent) => e.code === "CapsLock" || e.key === "CapsLock" || e.key === "F13";

function onKeyDown(e: KeyboardEvent) {
    if (isCaps(e)) {
        if (e.repeat) return;
        held = true;
        usedWithArrow = false;
        return;
    }
    if (held && (e.key === "ArrowLeft" || e.key === "ArrowRight") && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        usedWithArrow = true;
        lastTap = 0;
        if (e.repeat || !isPluginEnabled("PanelSwitches")) return;
        if (e.key === "ArrowLeft") toggleLeftPanel();
        else toggleMembers();
        return;
    }
    // Anything typed between two presses means they were not a double press.
    lastTap = 0;
}

function onKeyUp(e: KeyboardEvent) {
    if (!isCaps(e)) return;
    held = false;
    if (usedWithArrow) {
        lastTap = 0;
        return;
    }
    const now = performance.now();
    if (lastTap && now - lastTap < TWICE_MS) {
        lastTap = 0;
        setFeedback(!isFeedbackOn());
    } else {
        lastTap = now;
    }
}

function onBlur() {
    held = false;
    lastTap = 0;
}

export function startCapsKeys() {
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
}

export function stopCapsKeys() {
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("blur", onBlur);
}
