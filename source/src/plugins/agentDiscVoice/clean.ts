/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Turns a Discord answer into what a person would read out loud: plain rules,
// no AI rewrite, so it is free, instant and never changes the meaning.
// No Discord imports here, so it can be checked on real answers outside Discord.

export interface Names {
    user(id: string): string | null;
    channel(id: string): string | null;
    role(id: string): string | null;
}

// The Claude Code router's progress card and its other status lines (same pattern as the router).
const PROGRESS = /^(⏳|🔄|✅ Finished|⚠️ Claude session|⏱️ Turn ended by the harness|Claude could not complete this request:|📚 Booting Claude|🧠 Claude is working|🕒 Waiting for a Claude slot)/u;
// Old account-limit notes and "no reply needed" lines.
const NOTE = /^(⛔|No reply needed\s*$)/u;

export function isNoise(content: string) {
    // The router posts its card in bold ("**🧠 Claude is working…**"), so leading marks go first.
    const t = content.trim().replace(/^[*_~>#\s]+/, "");
    return !t || PROGRESS.test(t) || NOTE.test(t);
}

// Roadmap marks read as words (core-roadmap: done, current, to do, waiting, running, blocked).
const MARKS: Record<string, string> = {
    "✅": "done: ",
    "🔄": "current: ",
    "⬜": "to do: ",
    "🟦": "waiting: ",
    "🟨": "running: ",
    "🟫": "blocked: ",
    "❌": "failed: ",
    "⚠️": "warning: ",
};

const CURRENCY: [RegExp, string][] = [
    [/\bA\$\s?(\d[\d,.]*)(k|K)?/g, "$1$2 Australian dollars"],
    [/\bNZ\$\s?(\d[\d,.]*)(k|K)?/g, "$1$2 New Zealand dollars"],
    [/\b(?:US|U\.S\.)\$\s?(\d[\d,.]*)(k|K)?/g, "$1$2 US dollars"],
    [/\bC(?:A)?\$\s?(\d[\d,.]*)(k|K)?/g, "$1$2 Canadian dollars"],
];

function siteName(url: string) {
    try {
        return new URL(url).hostname.replace(/^www\./, "");
    } catch {
        return "a website";
    }
}

function plainChannelName(name: string) {
    // Channel names carry emoji and dashes: "🥑-discord-typing" reads "discord typing".
    return name.replace(/\p{Extended_Pictographic}|️|‍/gu, "").replace(/[-_]+/g, " ").trim();
}

function readDate(unix: string) {
    const d = new Date(Number(unix) * 1000);
    if (isNaN(+d)) return "a date";
    return d.toLocaleString("en-GB", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

function readInlineCode(code: string) {
    const c = code.trim();
    const looksLikePath = /[\\/]/.test(c) && c.length > 18;
    const looksLikeFile = /^[\w.-]+\.(md|ts|tsx|js|mjs|json|py|sh|txt|css|html|yml|yaml|toml|sql|png|jpg|mp3|wav|zip)$/i.test(c);
    if (looksLikePath) return "a file";
    if (looksLikeFile) return c.replace(/\.(\w+)$/, " dot $1").replace(/[-_]/g, " ");
    if (c.length > 60) return "a code line";
    return c.replace(/[-_]/g, " ");
}

// Word list: "from=to" pairs separated by ";" or new lines, from the plugin settings.
export function parseWordList(list: string): [RegExp, string][] {
    return list.split(/[;\n]/).map(p => p.split("=")).filter(p => p.length === 2 && p[0].trim())
        .map(([from, to]) => [new RegExp(`\\b${from.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g"), to.trim()]);
}

export function cleanText(content: string, names: Names, words: [RegExp, string][] = [], state = { saidCode: false }) {
    let t = content.replace(/\r\n/g, "\n");

    // Code blocks: "code skipped" once per answer.
    t = t.replace(/```[\s\S]*?(```|$)/g, () => {
        if (state.saidCode) return "\n";
        state.saidCode = true;
        return "\nCode skipped.\n";
    });

    const lines: string[] = [];
    for (let line of t.split("\n")) {
        if (/^\s*-#\s/.test(line)) continue; // small grey footnote lines
        line = line.replace(/^\s*>{1,3}\s?/, ""); // quotes
        const heading = /^\s*#{1,3}\s+/.test(line);
        const item = /^\s*([-*•]|\d+[.)])\s+/.test(line);
        line = line.replace(/^\s*#{1,3}\s+/, "").replace(/^\s*[-*•]\s+/, "").replace(/^\s*(\d+)[.)]\s+/, "$1: "); // numbers stay: answers say "tell me which number"
        if ((heading || item) && line.trim() && !/[.!?:;]\s*$/.test(line)) line = line.trimEnd() + ".";
        lines.push(line);
    }
    t = lines.join("\n");

    // Links: a labelled link reads its label; a bare link reads "a link to" and the site.
    t = t.replace(/\[([^\]]+)\]\(<?(https?:\/\/[^)\s>]+)>?\)/g, "$1");
    t = t.replace(/<?(https?:\/\/[^\s<>)]+)>?/g, (_, url) => `a link to ${siteName(url)}`);

    // Discord tags.
    t = t.replace(/<a?:\w+:\d+>/g, ""); // custom emoji
    t = t.replace(/<@!?(\d+)>/g, (_, id) => names.user(id) ?? "someone");
    t = t.replace(/<#(\d+)>/g, (_, id) => {
        const n = names.channel(id);
        return n ? plainChannelName(n) : "a channel";
    });
    t = t.replace(/<@&(\d+)>/g, (_, id) => names.role(id) ?? "a role");
    t = t.replace(/<t:(-?\d+)(?::\w)?>/g, (_, unix) => readDate(unix));
    t = t.replace(/<\/([\w -]+):\d+>/g, "/$1"); // slash command mentions

    // Inline code and text marks.
    t = t.replace(/`([^`\n]+)`/g, (_, c) => readInlineCode(c));
    t = t.replace(/\*\*|__|~~|\|\|/g, "");
    t = t.replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?:;]|$)/g, "$1$2");

    // Marks, currencies, arrows, decorative emoji.
    for (const [mark, word] of Object.entries(MARKS)) t = t.split(mark + " ").join(word).split(mark).join(word);
    for (const [re, to] of CURRENCY) t = t.replace(re, to);
    t = t.replace(/\s?(→|->|⇒)\s?/g, " to ");
    t = t.replace(/\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}])*/gu, "");
    t = t.replace(/[️‍]/g, "");

    for (const [re, to] of words) t = t.replace(re, to);

    return t.split("\n").map(l => l.replace(/[ \t]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Sentences end at . ! or ? followed by a space, so "1.5" or "e.g." inside a sentence stay whole.
function sentences(text: string) {
    return text.split(/(?<=[.!?]["')\]]*)\s+/).map(s => s.trim()).filter(Boolean);
}

// Cut a long piece of text at sentence ends, then at commas, then at spaces.
function cut(text: string, max: number): string[] {
    if (text.length <= max) return [text];
    const out: string[] = [];
    let cur = "";
    for (const s of sentences(text)) {
        if (s.length > max) {
            if (cur) { out.push(cur); cur = ""; }
            let rest = s;
            while (rest.length > max) {
                let at = rest.lastIndexOf(", ", max);
                if (at < max / 3) at = rest.lastIndexOf(" ", max);
                if (at < max / 3) at = max - 1;
                out.push(rest.slice(0, at + 1).trim());
                rest = rest.slice(at + 1).trim();
            }
            cur = rest;
            continue;
        }
        if (cur && cur.length + 1 + s.length > max) {
            out.push(cur);
            cur = s;
        } else {
            cur = cur ? `${cur} ${s}` : s;
        }
    }
    if (cur) out.push(cur);
    return out;
}

// Pieces grow: a short first piece so the voice starts quickly, then bigger ones.
// The voice makes sound about 2.5 times faster than it plays and three pieces are made
// at a time, so each piece can be about twice the one before and still be ready in time.
export const PIECE_SIZES = [160, 450, 1000, 1300];

export function splitPieces(text: string): string[] {
    const paragraphs = text.split(/\n+/).map(p => p.trim()).filter(Boolean);
    const pieces: string[] = [];
    let cur = "";
    const max = () => PIECE_SIZES[Math.min(pieces.length, PIECE_SIZES.length - 1)];
    const push = () => { if (cur) { pieces.push(cur); cur = ""; } };

    for (const para of paragraphs) {
        const joined = cur ? `${cur}\n${para}` : para;
        if (joined.length <= max()) {
            cur = joined;
            continue;
        }
        push();
        // Sentences joined by single spaces, so every cut is an exact start of what is left.
        let rest = sentences(para).join(" ");
        while (rest.length > max()) {
            const [first] = cut(rest, max());
            if (!first || !rest.startsWith(first)) {
                pieces.push(...cut(rest, max()));
                rest = "";
                break;
            }
            pieces.push(first);
            rest = rest.slice(first.length).trim();
        }
        cur = rest;
    }
    push();
    return pieces;
}
