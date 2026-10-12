/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import { toggleLeftPanel, toggleMembers } from "@plugins/panelSwitches";

import { isFeedbackOn, setFeedback } from "./feedback";

// Shift shortcuts (Stephane, 12 Oct: "I want CAP + < >"), for his left hand at rest: thumb
// on space, little finger on Shift, middle finger on Z.
//   Shift twice    feedback mode on or off (two quick presses with nothing in between)
//   Shift + ←      hide or show the left panel (servers and channels)
//   Shift + →      hide or show the right panel
// While typing in a box that holds text, Shift with the arrows still selects text.

const TWICE_MS = 400;
// A press longer than this is Shift held for something else, not a tap.
const TAP_MS = 300;

let held = false;
let pressedAt = 0;
let usedWithKey = false;
let lastTap = 0;

function typingWithText() {
    const box = (document.activeElement as HTMLElement | null)?.closest?.<HTMLElement>('input, textarea, [contenteditable="true"]');
    if (!box) return false;
    const text = box instanceof HTMLInputElement || box instanceof HTMLTextAreaElement ? box.value : box.textContent ?? "";
    return text.replace(/[\s\u200b\ufeff]/g, "") !== "";
}

function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Shift") {
        if (e.repeat) return;
        held = true;
        pressedAt = performance.now();
        usedWithKey = false;
        return;
    }
    if (held) {
        usedWithKey = true;
        lastTap = 0;
        if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !e.ctrlKey && !e.altKey && !e.metaKey && !typingWithText()) {
            e.preventDefault();
            e.stopPropagation();
            if (e.repeat || !isPluginEnabled("PanelSwitches")) return;
            if (e.key === "ArrowLeft") toggleLeftPanel();
            else toggleMembers();
        }
        return;
    }
    // Anything typed between two presses means they were not a double press.
    lastTap = 0;
}

function onKeyUp(e: KeyboardEvent) {
    if (e.key !== "Shift") return;
    held = false;
    const now = performance.now();
    if (usedWithKey || now - pressedAt > TAP_MS) {
        lastTap = 0;
        return;
    }
    if (lastTap && now - lastTap < TWICE_MS) {
        lastTap = 0;
        setFeedback(!isFeedbackOn());
    } else {
        lastTap = now;
    }
}

// A Shift+click is not a tap either.
function onMouseDown() {
    if (held) usedWithKey = true;
    lastTap = 0;
}

function onBlur() {
    held = false;
    lastTap = 0;
}

export function startShiftKeys() {
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keyup", onKeyUp, true);
    document.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("blur", onBlur);
}

export function stopShiftKeys() {
    document.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("keyup", onKeyUp, true);
    document.removeEventListener("mousedown", onMouseDown, true);
    window.removeEventListener("blur", onBlur);
}
