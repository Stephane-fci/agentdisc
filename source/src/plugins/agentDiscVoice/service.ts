/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { Logger } from "@utils/Logger";
import { EXTENSION_BASE_URL, metaReady } from "@utils/web-metadata";

import { fromWav, packOpus, Sound, soundFromGoogle, unpackOpus } from "./audio";

// Talks to the voice service (a small Cloudflare service on the owner's own account that
// holds the voice key). The private pass lives in this browser's own storage, never in
// the app's code or in the synced settings.

const logger = new Logger("AgentDiscVoice");
const PASS_KEY = "AgentDiscVoice_pass";
let pass: string | null = null;
let onServiceFound: ((address: string) => void) | null = null;

export function setServiceFound(fn: (address: string) => void) {
    onServiceFound = fn;
}

export class ServiceError extends Error {
    constructor(message: string, public kind: "no-pass" | "pass-refused" | "daily-limit" | "down" | "voice-failed") {
        super(message);
    }
}

export async function loadPass() {
    pass = (await DataStore.get<string>(PASS_KEY)) ?? null;
    // The setup file beside the app on this computer (dist/voice-pass.json):
    // {"service": "https://...workers.dev", "pass": "..."}. The address fills an empty
    // setting; the pass is taken into this browser's storage once.
    try {
        await metaReady;
        if (!EXTENSION_BASE_URL) return Boolean(pass);
        const res = await fetch(EXTENSION_BASE_URL + "dist/voice-pass.json", { cache: "no-store" });
        if (!res.ok) return Boolean(pass);
        const setup = await res.json();
        const address = String(setup?.service ?? "").trim();
        if (/^https:\/\/\S+$/.test(address)) onServiceFound?.(address);
        if (pass) return true;
        const found = String(setup?.pass ?? "").trim();
        if (found.length >= 20) {
            await savePass(found);
            logger.info("Voice pass taken from the app folder");
            return true;
        }
    } catch { }
    return Boolean(pass);
}

export async function savePass(value: string | null) {
    pass = value?.trim() || null;
    if (pass) await DataStore.set(PASS_KEY, pass);
    else await DataStore.del(PASS_KEY);
}

export function hasPass() {
    return Boolean(pass);
}

export interface Made {
    sound: Sound;
    source: "new" | "saved";
    key: string;
}

export async function makeSpeech(service: string, text: string, voice: string, signal: AbortSignal): Promise<Made> {
    if (!pass || !service.trim()) throw new ServiceError("The voice is not set up yet.", "no-pass");
    let res: Response;
    try {
        res = await fetch(service.replace(/\/+$/, "") + "/speak", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${pass}` },
            body: JSON.stringify({ text, voice }),
            signal,
        });
    } catch (e) {
        if (signal.aborted) throw e;
        throw new ServiceError("The voice service is not answering.", "down");
    }
    if (res.status === 401) throw new ServiceError("The voice service refused the pass.", "pass-refused");
    if (res.status === 429) throw new ServiceError("Today's voice spending limit is reached.", "daily-limit");
    if (!res.ok) {
        let message = "";
        try { message = (await res.json())?.message ?? ""; } catch { }
        throw new ServiceError(message || `The voice service answered ${res.status}.`, res.status >= 500 && res.status !== 502 ? "down" : "voice-failed");
    }

    const source = res.headers.get("X-Voice-Source") === "saved" ? "saved" : "new";
    const key = res.headers.get("X-Voice-Key") ?? "";
    if (source === "new") return { sound: soundFromGoogle(await res.json()), source, key };

    const bytes = new Uint8Array(await res.arrayBuffer());
    const type = res.headers.get("Content-Type") ?? "";
    const sound = type.startsWith("audio/wav") ? fromWav(bytes) : await unpackOpus(bytes);
    return { sound, source, key };
}

// After a new piece plays, keep a small copy in the service's store for 30 days.
export async function keepCopy(service: string, made: Made) {
    if (made.source !== "new" || !/^[0-9a-f]{64}$/.test(made.key) || !pass) return;
    try {
        const packed = await packOpus(made.sound);
        const body = packed ?? made.sound.wav;
        if (body.byteLength > 4 * 1024 * 1024) return;
        const res = await fetch(service.replace(/\/+$/, "") + "/saved/" + made.key, {
            method: "PUT",
            headers: { "Content-Type": packed ? "audio/x-agentdisc-opus" : "audio/wav", "Authorization": `Bearer ${pass}` },
            body: new Blob([body as Uint8Array<ArrayBuffer>]),
        });
        if (!res.ok) logger.warn("Saved copy refused", res.status);
    } catch (e) {
        logger.warn("Could not keep a copy", e);
    }
}
