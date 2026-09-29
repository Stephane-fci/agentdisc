/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as highlight from "./highlight";
import { getView, playFrom, subscribe } from "./player";

// While the play bar is open, every word of the message being read shows it can be
// clicked, and a click starts reading from that word (Stephane, 29 Sept: "click on
// the word and it would start on the word I clicked").

let attached = false;
let frame = 0;
let x = 0;
let y = 0;

function setPointer(on: boolean) {
    document.documentElement.classList.toggle("agentdisc-word-hover", on);
}

function onMove(e: MouseEvent) {
    x = e.clientX;
    y = e.clientY;
    if (frame) return;
    frame = requestAnimationFrame(() => {
        frame = 0;
        const k = highlight.wordAt(x, y);
        highlight.hover(k);
        setPointer(k != null);
    });
}

function onClick(e: MouseEvent) {
    if (e.button !== 0) return;
    // A drag that selected text is not a click on a word.
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const k = highlight.wordAt(e.clientX, e.clientY);
    if (k == null) return;
    const spot = highlight.spotOf(k);
    if (!spot) return;
    e.preventDefault();
    e.stopPropagation();
    playFrom(spot.piece, spot.at);
}

function sync() {
    const { open } = getView();
    if (open && !attached) {
        document.addEventListener("mousemove", onMove, true);
        document.addEventListener("click", onClick, true);
        attached = true;
    } else if (!open && attached) {
        detach();
    }
}

function detach() {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    attached = false;
    highlight.hover(null);
    setPointer(false);
}

let unsubscribe: (() => void) | null = null;

export function startClickToRead() {
    unsubscribe = subscribe(sync);
    sync();
}

export function stopClickToRead() {
    unsubscribe?.();
    unsubscribe = null;
    detach();
}
