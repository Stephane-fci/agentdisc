/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// AgentDisc read aloud: the word being spoken lights up in the message itself
// (Stephane, 29 Sept: "highlight the words it is reading so I would see the highlight
// moving from word to word"). The voice service gives no word times, so each word's
// moment is estimated inside its piece from its length and the pauses at punctuation;
// each piece starts on time, so the guess never drifts far. The spoken text is cleaned
// (links read as "a link to...", code skipped), so spoken words are lined up with the
// words on screen as a whole, keeping the most words in order and skipping what only one
// side has; a bare link's own text on screen is left out. Nothing in Discord's page is
// changed: the light is drawn with the browser's own highlight layer.

const HIGHLIGHT = "agentdisc-reading";
const HOVER = "agentdisc-hover";
const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu;
const LOOK_AHEAD = 40;
// Above this many word pairs the whole-text line-up would take too long; the quick
// in-order match is used instead.
const MAX_PAIRS = 6_000_000;
const BARE_LINK = /^\s*(https?:\/\/|www\.)\S+\s*$/i;

interface SpokenWord { norm: string; at: number; }
interface ScreenWord { norm: string; range: Range; }

let messageIds: string[] = [];
let spoken: SpokenWord[][] = []; // per piece: words with their moment (0..1) inside the piece
let offsets: number[] = []; // index of each piece's first word in the whole list
let screen: ScreenWord[] = [];
let link: (number | null)[] = []; // spoken word -> screen word
let shown = -1;

const norm = (w: string) => w.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");

// A pause counts as extra letters: short after a comma, longer after a full stop or a new line.
function pauseAfter(ch: string) {
    if (ch === "," || ch === ";" || ch === ":") return 4;
    if (ch === "." || ch === "!" || ch === "?" || ch === "\n") return 8;
    return 0;
}

function timeWords(text: string): SpokenWord[] {
    const cost: number[] = [];
    let total = 0;
    for (const ch of text) {
        cost.push(total);
        total += 1 + pauseAfter(ch);
    }
    if (!total) return [];
    const words: SpokenWord[] = [];
    for (const m of text.matchAll(WORD)) {
        const i = Array.from(text.slice(0, m.index!)).length;
        words.push({ norm: norm(m[0]), at: (cost[i] ?? 0) / total });
    }
    return words;
}

function readScreen() {
    screen = [];
    for (const id of messageIds) {
        const box = document.getElementById(`message-content-${id}`);
        if (!box) continue;
        const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT, {
            // Code blocks are skipped by the voice, so they are skipped here too, and so is
            // the text of a bare link (the voice says "a link to" and the site instead).
            acceptNode: n => {
                const parent = n.parentElement;
                if (parent?.closest("pre")) return NodeFilter.FILTER_REJECT;
                const anchor = parent?.closest("a");
                if (anchor && BARE_LINK.test(anchor.textContent ?? "")) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const text = node.textContent ?? "";
            for (const m of text.matchAll(WORD)) {
                const range = document.createRange();
                range.setStart(node, m.index!);
                range.setEnd(node, m.index! + m[0].length);
                screen.push({ norm: norm(m[0]), range });
            }
        }
    }
}

// Spoken words and screen words are lined up as a whole: the longest run of words both
// share, in order (Stephane, 2 Oct: after a link "all the words after it go everywhere",
// and in a long message the words further down could not be hovered). A word only one
// side has (a link read as "a link to", a number read differently) is simply skipped and
// never pulls the rest out of place.
function match() {
    const words = spoken.flat().map(w => w.norm);
    const n = words.length;
    const m = screen.length;
    link = new Array(n).fill(null);
    if (!n || !m) return;

    if (n * m > MAX_PAIRS) {
        let j = 0;
        for (let i = 0; i < n; i++) {
            for (let k = j; k < Math.min(m, j + LOOK_AHEAD); k++) {
                if (screen[k].norm === words[i]) { link[i] = k; j = k + 1; break; }
            }
        }
        return;
    }

    // best[i][j]: how many words line up between spoken word i onwards and screen word j onwards.
    const width = m + 1;
    const best = new Uint16Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            best[i * width + j] = words[i] === screen[j].norm
                ? best[(i + 1) * width + j + 1] + 1
                : Math.max(best[(i + 1) * width + j], best[i * width + j + 1]);
        }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (words[i] === screen[j].norm) {
            link[i++] = j++;
        } else if (best[(i + 1) * width + j] >= best[i * width + j + 1]) {
            i++;
        } else {
            j++;
        }
    }
}

function paint(range: Range | null, name = HIGHLIGHT) {
    const highlights = (CSS as any).highlights as Map<string, unknown> | undefined;
    if (!highlights) return;
    if (!range) return void highlights.delete(name);
    highlights.set(name, new (window as any).Highlight(range));
}

// Discord redraws messages (scrolling, edits): read the screen again when needed.
function freshScreen() {
    if (screen.length && !screen[0].range.startContainer.isConnected) {
        readScreen();
        match();
    }
}

const spokenIndexOf = (k: number) => {
    const i = link.indexOf(k);
    return i < 0 ? null : i;
};

// The word under the pointer in a message being read, if the voice says it. Words in
// links are left alone so links still open.
export function wordAt(x: number, y: number): number | null {
    if (!spoken.length) return null;
    const doc = document as any;
    let node: Node | null = null;
    let offset = 0;
    const pos = doc.caretPositionFromPoint?.(x, y);
    if (pos) {
        node = pos.offsetNode;
        offset = pos.offset;
    } else {
        const r = doc.caretRangeFromPoint?.(x, y);
        if (r) { node = r.startContainer; offset = r.startOffset; }
    }
    if (!node || node.nodeType !== Node.TEXT_NODE || node.parentElement?.closest("a")) return null;
    freshScreen();
    for (let k = 0; k < screen.length; k++) {
        const r = screen[k].range;
        if (r.startContainer !== node || offset < r.startOffset || offset > r.endOffset) continue;
        // The caret lands on the nearest letter even beside the text: the pointer must be on the word.
        for (const box of Array.from(r.getClientRects())) {
            if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return spokenIndexOf(k) == null ? null : k;
        }
        return null;
    }
    return null;
}

// Where a word on screen is said: its piece and its moment (0..1) inside that piece.
export function spotOf(k: number): { piece: number; at: number; } | null {
    const i = spokenIndexOf(k);
    if (i == null) return null;
    let piece = 0;
    while (piece < offsets.length - 1 && offsets[piece + 1] <= i) piece++;
    const word = spoken[piece]?.[i - offsets[piece]];
    return word ? { piece, at: word.at } : null;
}

let hovered = -1;
export function hover(k: number | null) {
    if ((k ?? -1) === hovered) return;
    hovered = k ?? -1;
    paint(k == null ? null : screen[k].range, HOVER);
}

export function begin(ids: string[], pieceTexts: string[]) {
    messageIds = ids;
    spoken = pieceTexts.map(timeWords);
    offsets = [];
    let n = 0;
    for (const piece of spoken) { offsets.push(n); n += piece.length; }
    readScreen();
    match();
    shown = -1;
    paint(null);
}

// Light the word being said at this moment of this piece.
export function show(piece: number, fraction: number) {
    const words = spoken[piece];
    if (!words?.length) return;
    let i = 0;
    while (i < words.length - 1 && words[i + 1].at <= fraction) i++;
    const whole = offsets[piece] + i;
    if (whole === shown) return;
    shown = whole;

    let at = link[whole];
    if (at != null && !screen[at]?.range.startContainer.isConnected) {
        readScreen();
        match();
        at = link[whole];
    }
    if (at == null) return;
    paint(screen[at].range);
}

export function clear() {
    shown = -1;
    paint(null);
}

export function end() {
    clear();
    hover(null);
    messageIds = [];
    spoken = [];
    offsets = [];
    screen = [];
    link = [];
}
