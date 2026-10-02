/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { insertTextIntoChatInputBox } from "@utils/discord";
import { ComponentDispatch } from "@webpack/common";

// Feedback mode (Stephane, 2 Oct): with the mode on, the sentence under the mouse in any
// message lights up orange; a click puts it in the message box as
//   "the sentence" >>
// ready for his answer, each new one on its own line, the way he already answers long
// messages by hand. A bullet point is taken whole; elsewhere holding Shift takes the whole
// paragraph; text he selects himself is taken as it is. Ctrl+L (the L key, whatever the
// keyboard) turns the mode on and off, like the top-bar button; Esc turns it off.

const HIGHLIGHT = "agentdisc-feedback";
const CONTENT = '[id^="message-content-"]';
const BLOCK = "li, h1, h2, h3, blockquote";

let on = false;
let hovered: Range | null = null;
let frame = 0;
let lastMove: MouseEvent | null = null;
const listeners = new Set<(on: boolean) => void>();

export function isFeedbackOn() {
    return on;
}

export function onFeedbackChange(fn: (on: boolean) => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
}

function paint(range: Range | null) {
    const highlights = (CSS as any).highlights as Map<string, unknown> | undefined;
    if (!highlights) return;
    if (!range) highlights.delete(HIGHLIGHT);
    else highlights.set(HIGHLIGHT, new (window as any).Highlight(range));
}

function caretAt(x: number, y: number): { node: Node; offset: number; } | null {
    const doc = document as any;
    const pos = doc.caretPositionFromPoint?.(x, y);
    if (pos) return { node: pos.offsetNode, offset: pos.offset };
    const r = doc.caretRangeFromPoint?.(x, y);
    return r ? { node: r.startContainer, offset: r.startOffset } : null;
}

// The text of a block as one string, with where each text piece starts in it.
function textOf(scope: HTMLElement) {
    const pieces: { node: Text; start: number; }[] = [];
    let text = "";
    // Lists, headings and quotes are their own blocks: the message text around them leaves them out.
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
        acceptNode: n => {
            const parent = n.parentElement;
            if (parent?.closest("pre")) return NodeFilter.FILTER_REJECT;
            const block = parent?.closest(BLOCK);
            if (block && block !== scope && scope.contains(block)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        }
    });
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
        pieces.push({ node: n, start: text.length });
        text += n.data;
    }
    return { text, pieces };
}

function pointIn(pieces: { node: Text; start: number; }[], at: number): [Text, number] {
    for (let i = pieces.length - 1; i >= 0; i--) {
        if (pieces[i].start <= at) return [pieces[i].node, Math.min(at - pieces[i].start, pieces[i].node.length)];
    }
    return [pieces[0].node, 0];
}

// The sentence (or, with Shift, the paragraph) around one point of a message.
function pieceAt(x: number, y: number, whole: boolean): Range | null {
    const caret = caretAt(x, y);
    if (!caret || caret.node.nodeType !== Node.TEXT_NODE) return null;
    const parent = caret.node.parentElement;
    const content = parent?.closest<HTMLElement>(CONTENT);
    if (!content || parent?.closest("pre")) return null;
    // The block must sit inside the message text: each Discord message is itself a list
    // item, which must not count as a bullet point.
    const block = parent!.closest<HTMLElement>(BLOCK);
    const scope = block && content.contains(block) ? block : content;
    // A bullet point or a heading is taken whole (Stephane, 2 Oct).
    if (scope !== content && scope.matches("li, h1, h2, h3")) whole = true;

    const { text, pieces } = textOf(scope);
    const own = pieces.find(p => p.node === caret.node);
    if (!own || !text.trim()) return null;
    const at = own.start + caret.offset;

    // The paragraph: between line breaks.
    let start = text.lastIndexOf("\n", at - 1) + 1;
    let end = text.indexOf("\n", at);
    if (end < 0) end = text.length;

    if (!whole) {
        // The sentence: after the last ". ", "! " or "? " before the point, up to the next one.
        const before = text.slice(start, at);
        const stops = [...before.matchAll(/[.!?…]["')\]]*\s+/g)];
        if (stops.length) start += stops[stops.length - 1].index! + stops[stops.length - 1][0].length;
        const after = /[.!?…]["')\]]*(?=\s|$)/.exec(text.slice(at, end));
        if (after) end = at + after.index + after[0].length;
    }
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    if (end <= start) return null;

    const range = document.createRange();
    range.setStart(...pointIn(pieces, start));
    range.setEnd(...pointIn(pieces, end));
    return range;
}

function onMove(e: MouseEvent) {
    lastMove = e;
    if (frame) return;
    frame = requestAnimationFrame(() => {
        frame = 0;
        const m = lastMove!;
        hovered = pieceAt(m.clientX, m.clientY, m.shiftKey);
        paint(hovered);
    });
}

function messageBoxHasText() {
    const box = document.querySelector<HTMLElement>('[class*="channelTextArea_"] [role="textbox"]');
    return !!(box?.textContent ?? "").replace(/[\s​﻿]/g, "");
}

function quote(text: string) {
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) return;
    insertTextIntoChatInputBox((messageBoxHasText() ? "\n" : "") + `"${clean}" >> `);
    ComponentDispatch?.dispatchToLastSubscribed?.("TEXTAREA_FOCUS");
}

function onClick(e: MouseEvent) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (!target?.closest?.(CONTENT)) return;
    // Text he selected himself goes in as it is.
    const selected = window.getSelection()?.toString() ?? "";
    const range = selected.trim() ? null : pieceAt(e.clientX, e.clientY, e.shiftKey);
    const text = selected.trim() || range?.toString() || "";
    if (!text.trim()) return;
    e.preventDefault();
    e.stopPropagation();
    window.getSelection()?.removeAllRanges();
    quote(text);
}

function onKey(e: KeyboardEvent) {
    if (e.key === "Escape" && on) setFeedback(false);
}

// Ctrl+L (Stephane, 2 Oct). Chrome lets the page take it before its own address bar.
function onShortcut(e: KeyboardEvent) {
    if (!e.ctrlKey || e.altKey || e.shiftKey || e.metaKey || e.repeat) return;
    if (e.key.toLowerCase() !== "l") return;
    e.preventDefault();
    e.stopPropagation();
    setFeedback(!on);
}

export function startFeedbackShortcut() {
    document.addEventListener("keydown", onShortcut, true);
}

export function stopFeedbackShortcut() {
    document.removeEventListener("keydown", onShortcut, true);
}

export function setFeedback(next: boolean) {
    if (next === on) return;
    on = next;
    document.documentElement.classList.toggle("agentdisc-feedback-on", on);
    if (on) {
        document.addEventListener("mousemove", onMove, true);
        document.addEventListener("click", onClick, true);
        document.addEventListener("keydown", onKey, true);
    } else {
        document.removeEventListener("mousemove", onMove, true);
        document.removeEventListener("click", onClick, true);
        document.removeEventListener("keydown", onKey, true);
        hovered = null;
        paint(null);
    }
    listeners.forEach(fn => fn(on));
}
