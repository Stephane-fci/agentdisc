/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";

import { splitPieces } from "./clean";
import { setDuck } from "./duck";
import * as highlight from "./highlight";
import { keepCopy, Made, makeSpeech, ServiceError } from "./service";

// The player: one answer at a time, made piece by piece. The first piece plays while
// the rest is made; the timeline covers the whole answer (unmade pieces count with a
// guessed length until they arrive). It lives outside any Discord screen, so it keeps
// playing when the channel changes.

const logger = new Logger("AgentDiscVoice");
const CHARS_PER_SECOND = 15;

type Status = "waiting" | "making" | "ready" | "browser" | "failed";

interface Piece {
    text: string;
    status: Status;
    seconds: number;
    url?: string;
}

export interface PlayerView {
    open: boolean;
    // The first message of the text being read, so its play button can show loading and pause.
    key: string | null;
    agent: string;
    playing: boolean;
    waiting: boolean;
    position: number;
    total: number;
    rate: number;
    note: string | null;
    browserOnly: boolean;
}

const view: PlayerView = { open: false, key: null, agent: "", playing: false, waiting: false, position: 0, total: 0, rate: 1, note: null, browserOnly: false };
const listeners = new Set<() => void>();
let snapshot: PlayerView = { ...view };

export function subscribe(fn: () => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
}
export function getView() {
    return snapshot;
}
function emit() {
    view.total = pieces.reduce((n, p) => n + p.seconds, 0);
    view.position = Math.min(view.position, view.total);
    view.browserOnly = pieces.length > 0 && pieces.every(p => p.status === "browser");
    snapshot = { ...view };
    listeners.forEach(fn => fn());
    setDuck(view.open && view.playing);
}

let pieces: Piece[] = [];
// Set when the user pauses, jumps or clicks a word: then the player stays open at the end.
let touched = false;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
let index = 0;
let pendingOffset = 0;
let run: AbortController | null = null;
let audio: HTMLAudioElement | null = null;
let browserSentence = 0;

function startOf(i: number) {
    let t = 0;
    for (let k = 0; k < i; k++) t += pieces[k].seconds;
    return t;
}

function el() {
    if (audio) return audio;
    audio = new Audio();
    audio.preservesPitch = true;
    audio.addEventListener("timeupdate", () => {
        if (pieces[index]?.status !== "ready") return;
        view.position = startOf(index) + (audio!.currentTime || 0);
        emit();
    });
    audio.addEventListener("play", () => startLight());
    audio.addEventListener("seeked", () => lightNow());
    audio.addEventListener("ended", () => next());
    audio.addEventListener("error", () => {
        if (!audio?.getAttribute("src")) return;
        logger.warn("A piece would not play", audio.error);
        pieces[index].status = "failed";
        next();
    });
    return audio;
}

// The word being said lights up in the message, checked every frame while the voice plays.
let frame = 0;
function lightNow() {
    const p = pieces[index];
    if (!audio || p?.status !== "ready") return;
    const length = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : p.seconds;
    if (length > 0) highlight.show(index, audio.currentTime / length);
}
function lightLoop() {
    lightNow();
    frame = audio && !audio.paused ? requestAnimationFrame(lightLoop) : 0;
}
function startLight() {
    if (!frame) frame = requestAnimationFrame(lightLoop);
}

function stopSound() {
    audio?.pause();
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}

function next() {
    if (index >= pieces.length - 1) {
        view.playing = false;
        view.waiting = false;
        view.position = view.total;
        emit();
        // Read to the end with no pause, jump or word click: close by itself (Stephane, 29 Sept).
        if (!touched) closeTimer = setTimeout(() => { if (!touched && !view.playing) close(); }, 800);
        return;
    }
    startPiece(index + 1, 0);
}

function startPiece(i: number, offset: number) {
    stopSound();
    index = i;
    pendingOffset = offset;
    const p = pieces[i];
    view.waiting = false;
    if (!p) return;

    if (p.status === "failed") {
        if (i < pieces.length - 1) return startPiece(i + 1, 0);
        return next();
    }
    if (p.status === "waiting" || p.status === "making") {
        view.waiting = true;
        view.position = startOf(i) + offset;
        emit();
        return;
    }
    if (p.status === "browser") {
        highlight.clear();
        view.position = startOf(i);
        emit();
        if (view.playing) speakInBrowser(i, offset > 0 ? Math.floor(offset / p.seconds * sentencesOf(p.text).length) : 0);
        return;
    }
    offset = Math.min(offset, Math.max(0, p.seconds - 0.05));
    const a = el();
    if (a.getAttribute("src") !== p.url) a.src = p.url!;
    a.playbackRate = view.rate;
    const seek = () => { a.currentTime = Math.min(offset, Math.max(0, p.seconds - 0.05)); };
    if (a.readyState >= 1) seek(); else a.addEventListener("loadedmetadata", seek, { once: true });
    view.position = startOf(i) + offset;
    emit();
    if (view.playing) a.play().catch(e => logger.warn("Play refused", e));
}

// The browser's own voice, sentence by sentence (Chrome's voices stop after about
// 15 seconds of one long sentence list).
function sentencesOf(text: string) {
    return text.split(/(?<=[.!?:])\s+|\n+/).map(s => s.trim()).filter(Boolean);
}

function speakInBrowser(i: number, from: number) {
    if (typeof speechSynthesis === "undefined") {
        pieces[i].status = "failed";
        return next();
    }
    const list = sentencesOf(pieces[i].text);
    browserSentence = from;
    const say = () => {
        if (index !== i || !view.playing) return;
        if (browserSentence >= list.length) return next();
        const u = new SpeechSynthesisUtterance(list[browserSentence]);
        u.rate = view.rate;
        u.lang = "en-US";
        u.onend = () => {
            if (index !== i) return;
            browserSentence++;
            view.position = startOf(i) + pieces[i].seconds * browserSentence / list.length;
            emit();
            say();
        };
        speechSynthesis.speak(u);
    };
    say();
}

export interface Request {
    agent: string;
    text: string;
    // The Discord messages being read, so their words can light up as they are said.
    messageIds?: string[];
    key?: string;
    service: string;
    voice: string;
}

export function play(req: Request) {
    close();
    const texts = splitPieces(req.text);
    if (!texts.length) {
        Object.assign(view, { open: true, key: req.key ?? null, agent: req.agent, playing: false, waiting: false, position: 0, note: "Nothing to read in this answer." });
        emit();
        return;
    }
    pieces = texts.map(text => ({ text, status: "waiting" as Status, seconds: text.length / CHARS_PER_SECOND }));
    highlight.begin(req.messageIds ?? [], texts);
    Object.assign(view, { open: true, key: req.key ?? null, agent: req.agent, playing: true, waiting: true, position: 0, note: null });
    touched = false;
    index = 0;
    pendingOffset = 0;
    run = new AbortController();
    emit();
    void makeAll(req, run.signal);
}

// Three pieces are made at a time, in order, so the voice keeps ahead even at 2x speed.
async function makeAll(req: Request, signal: AbortSignal) {
    const list = pieces;
    let nextPiece = 0;
    let stopped = false;
    const worker = async () => {
        while (!stopped && !signal.aborted) {
            const i = nextPiece++;
            if (i >= list.length) return;
            if (list[i].status !== "waiting") continue;
            if (!(await makeOne(list, i, req, signal))) stopped = true;
        }
    };
    await Promise.all([worker(), worker(), worker()]);
}

// Makes one piece; answers false when the service cannot help for the rest of this answer.
async function makeOne(list: Piece[], i: number, req: Request, signal: AbortSignal) {
    const p = list[i];
    p.status = "making";
    emit();
    let made: Made | null = null;
    let problem: ServiceError | null = null;
    for (let attempt = 0; attempt < 2 && !made; attempt++) {
        try {
            made = await makeSpeech(req.service, p.text, req.voice, signal);
        } catch (e) {
            if (signal.aborted) return false;
            problem = e instanceof ServiceError ? e : new ServiceError(String((e as any)?.message ?? e), "voice-failed");
            logger.warn("Piece failed", problem.kind, problem.message);
            if (problem.kind === "down" || problem.kind === "voice-failed") await new Promise(r => setTimeout(r, 1500));
            else break;
        }
    }
    if (signal.aborted || list !== pieces) return false;

    if (made) {
        p.url = URL.createObjectURL(new Blob([made.sound.wav as Uint8Array<ArrayBuffer>], { type: "audio/wav" }));
        p.seconds = made.sound.seconds;
        p.status = "ready";
        void keepCopy(req.service, made);
    } else if (problem && (i === 0 || problem.kind !== "voice-failed")) {
        // The service cannot help for the rest of this answer: the browser's own voice reads it.
        for (let k = i; k < list.length; k++) if (k === i || list[k].status === "waiting") list[k].status = "browser";
        view.note = {
            "no-pass": "The voice is not set up yet (see the setup guide); the browser's own voice reads instead.",
            "pass-refused": "The voice service refused the pass; the browser's own voice reads instead.",
            "daily-limit": "Today's voice spending limit is reached; the browser's own voice reads the rest.",
            "down": "The voice service is not answering; the browser's own voice reads instead.",
            "voice-failed": "The voice could not make this answer; the browser's own voice reads instead.",
        }[problem.kind];
    } else {
        // Only this part failed: the browser's own voice reads it, the rest keeps the AI voice.
        p.status = "browser";
        view.note = "One part could not be made in the AI voice; the browser's own voice reads it.";
        emit();
        const now = list[index];
        if (view.waiting && now && now.status !== "waiting" && now.status !== "making") startPiece(index, pendingOffset);
        return true;
    }
    emit();
    // The listener was waiting on this piece (or on one this failure handed to the browser voice).
    const now = list[index];
    if (view.waiting && now && now.status !== "waiting" && now.status !== "making") startPiece(index, pendingOffset);
    return (p.status as Status) !== "browser";
}

export function togglePlay() {
    if (!view.open || !pieces.length) return;
    touched = true;
    if (view.playing) {
        view.playing = false;
        audio?.pause();
        if (pieces[index]?.status === "browser" && typeof speechSynthesis !== "undefined") speechSynthesis.pause();
        emit();
        return;
    }
    view.playing = true;
    if (view.position >= view.total - 0.05) return seek(0);
    const p = pieces[index];
    if (p?.status === "ready" && audio) {
        audio.playbackRate = view.rate;
        audio.play().catch(e => logger.warn("Play refused", e));
    } else if (p?.status === "browser" && typeof speechSynthesis !== "undefined" && speechSynthesis.paused) {
        speechSynthesis.resume();
    } else {
        startPiece(index, pendingOffset);
    }
    emit();
}

export function seek(to: number) {
    if (!pieces.length) return;
    const t = Math.max(0, Math.min(to, Math.max(0, view.total - 0.05)));
    let i = 0;
    while (i < pieces.length - 1 && t >= startOf(i + 1)) i++;
    const offset = t - startOf(i);
    if (i === index && pieces[i].status === "ready" && audio?.getAttribute("src") === pieces[i].url) {
        audio!.currentTime = offset;
        view.position = t;
        emit();
        return;
    }
    startPiece(i, offset);
}

// Start reading at a word the user clicked: its piece and its moment inside it.
export function playFrom(piece: number, at: number) {
    if (!view.open || !pieces[piece]) return;
    touched = true;
    view.playing = true;
    seek(startOf(piece) + at * pieces[piece].seconds);
    const p = pieces[index];
    if (p?.status === "ready" && audio?.paused) {
        audio.playbackRate = view.rate;
        audio.play().catch(e => logger.warn("Play refused", e));
    }
    emit();
}

// A jump on the timeline or with the 10-second buttons counts as the user's own move.
export function userSeek(to: number) {
    touched = true;
    seek(to);
}

export function skip(seconds: number) {
    touched = true;
    seek(view.position + seconds);
}

export const RATES = [1, 1.25, 1.5, 1.75, 2];

export function nextRate() {
    view.rate = RATES[(RATES.indexOf(view.rate) + 1) % RATES.length];
    if (audio) audio.playbackRate = view.rate;
    emit();
}

export function close() {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = null;
    highlight.end();
    run?.abort();
    run = null;
    stopSound();
    if (audio) {
        audio.removeAttribute("src");
        audio.load();
    }
    for (const p of pieces) if (p.url) URL.revokeObjectURL(p.url);
    pieces = [];
    index = 0;
    Object.assign(view, { open: false, key: null, playing: false, waiting: false, position: 0, note: null });
    emit();
}
