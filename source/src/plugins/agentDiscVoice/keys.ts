/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { getView, skip, togglePlay } from "./player";

// While the player is open, Space pauses or plays and the left and right arrows go back
// or forward 10 seconds (Stephane, 2 Oct). Typing is never disturbed: in the message box
// the keys only act while it is empty, and other text fields keep them.

function messageBoxIsEmpty(el: HTMLElement) {
    if (!el.isContentEditable || !el.closest('[class*="channelTextArea_"]')) return false;
    return !(el.textContent ?? "").replace(/[\s​﻿]/g, "");
}

function onKey(e: KeyboardEvent) {
    if (!getView().open || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    if (e.code !== "Space" && e.code !== "ArrowLeft" && e.code !== "ArrowRight") return;

    const focus = document.activeElement as HTMLElement | null;
    // The player's own buttons and timeline keep their usual keys.
    if (focus?.closest?.(".agentdisc-voice-bar")) return;
    const typing = focus && (focus.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(focus.tagName));
    if (typing && !messageBoxIsEmpty(focus!)) return;

    e.preventDefault();
    e.stopPropagation();
    if (e.code === "Space") {
        if (!e.repeat) togglePlay();
    } else {
        skip(e.code === "ArrowLeft" ? -10 : 10);
    }
}

export function startKeys() {
    document.addEventListener("keydown", onKey, true);
}

export function stopKeys() {
    document.removeEventListener("keydown", onKey, true);
}
