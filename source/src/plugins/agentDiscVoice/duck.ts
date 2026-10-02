/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// While the voice plays, music in YouTube tabs gets quieter, and goes back to where it
// was once the voice stops (Stephane, 2 Oct: "it doesn't turn it off or pause the
// video, it just turns the volume down"). The page asks the extension (content.js), the
// extension's background part turns the YouTube tabs down or back up. A short wait
// before coming back up keeps the music low between two pieces of one answer.

const BACK_UP_AFTER = 1200;

let lowered = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let enabled: () => boolean = () => true;

export function duckWhen(fn: () => boolean) {
    enabled = fn;
}

function send(on: boolean) {
    lowered = on;
    window.postMessage({ type: "AGENTDISC_DUCK", on }, "*");
}

export function setDuck(on: boolean) {
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }
    const want = on && enabled();
    if (want === lowered) return;
    if (want) send(true);
    else timer = setTimeout(() => {
        timer = null;
        send(false);
    }, BACK_UP_AFTER);
}
