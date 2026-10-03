/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { insertTextIntoChatInputBox } from "@utils/discord";
import { ComponentDispatch } from "@webpack/common";

// Feedback mode (Stephane, 2 Oct): with the mode on, the paragraph under the mouse in any
// message lights up orange (a bullet point or heading counts as a paragraph); a click puts
// it in the message box as
//   "the paragraph" >>
// ready for his answer, each new one on its own line, the way he already answers long
// messages by hand. A tap on Ctrl switches to the sentence under the mouse, the next tap
// back to the paragraph (Stephane, 3 Oct); Ctrl used in a shortcut such as Ctrl+V does not
// count. Text he selects himself is taken as it is. Ctrl+L (the L key, whatever the
// keyboard) turns the mode on and off, like the top-bar button; Esc turns it off.

const HIGHLIGHT = "agentdisc-feedback";
const CONTENT = '[id^="message-content-"]';
const BLOCK = "li, h1, h2, h3, blockquote";

let on = false;
// Whole paragraphs (true) or single sentences (false); each new start is paragraphs.
let whole = true;
// Set while Ctrl is down after it switched the mode: any other key undoes the switch.
let ctrlSwitched = false;
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
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
        const parent = n.parentElement;
        // The "(edited)" mark is not part of the message.
        if (parent?.closest("time")) continue;
        // Lists, headings, quotes and code blocks are their own blocks: the message text
        // around them leaves them out, and they end the paragraph before them.
        const block = parent?.closest(BLOCK);
        if (parent?.closest("pre") || block && block !== scope && scope.contains(block)) {
            if (text && !text.endsWith("\n")) text += "\n";
            continue;
        }
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

// The paragraph (or the sentence) around one point of a message.
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
        hovered = pieceAt(m.clientX, m.clientY, whole);
        paint(hovered);
    });
}

function repaint() {
    if (!lastMove) return;
    hovered = pieceAt(lastMove.clientX, lastMove.clientY, whole);
    paint(hovered);
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
    const range = selected.trim() ? null : pieceAt(e.clientX, e.clientY, whole);
    const text = selected.trim() || range?.toString() || "";
    if (!text.trim()) return;
    e.preventDefault();
    e.stopPropagation();
    window.getSelection()?.removeAllRanges();
    quote(text);
}

function onKey(e: KeyboardEvent) {
    if (e.key === "Escape" && on) setFeedback(false);
    if (e.key === "Control") {
        if (e.repeat || e.altKey || e.shiftKey || e.metaKey) return;
        whole = !whole;
        ctrlSwitched = true;
        repaint();
    } else if (ctrlSwitched && e.ctrlKey) {
        // Ctrl was the start of a shortcut, not a switch.
        whole = !whole;
        ctrlSwitched = false;
        repaint();
    }
}

function onKeyUp(e: KeyboardEvent) {
    if (e.key === "Control") ctrlSwitched = false;
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
    whole = true;
    ctrlSwitched = false;
    document.documentElement.classList.toggle("agentdisc-feedback-on", on);
    if (on) {
        document.addEventListener("mousemove", onMove, true);
        document.addEventListener("click", onClick, true);
        document.addEventListener("keydown", onKey, true);
        document.addEventListener("keyup", onKeyUp, true);
    } else {
        document.removeEventListener("mousemove", onMove, true);
        document.removeEventListener("click", onClick, true);
        document.removeEventListener("keydown", onKey, true);
        document.removeEventListener("keyup", onKeyUp, true);
        hovered = null;
        paint(null);
    }
    listeners.forEach(fn => fn(on));
}
