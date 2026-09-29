import { DurableObject } from "cloudflare:workers";

// AgentDisc voice: turns a piece of a Discord message into speech with
// Google's Gemini voice, for the AgentDisc extension.
// Holds the voice key, accepts only requests carrying the private pass, keeps
// each finished piece's audio for 30 days so a replay costs nothing, and stops
// making new audio past a daily spending tripwire.

export const VERSION = "1.1.0";
export const MODEL = "gemini-3.8-flash-tts";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const ALLOWED_ORIGINS = new Set([
    "https://discord.com",
    "https://ptb.discord.com",
    "https://canary.discord.com",
]);
const SAVE_DAYS = 30;
export const MAX_TEXT_CHARS = 1500;
const MAX_SAVED_BYTES = 4 * 1024 * 1024;
const SAVED_TYPES = new Set(["audio/x-agentdisc-opus", "audio/wav"]);
const VOICE_NAME = /^[A-Za-z0-9-]{2,48}$/;
const KEY_NAME = /^[0-9a-f]{64}$/;

// Cost guess per character, on the high side on purpose: Gemini 3.8 Flash voice
// costs $9 per million sound tokens (25 a second); a real answer measured about
// 1.9 sound tokens per character. 2.2 tokens per character plus the text going in.
// Doubles on 1 January 2027 with Google's price.
function usdPerChar(now = new Date()) {
    const base = 2.2 * 9 / 1e6 + 0.5 / 1e6;
    return now >= new Date("2027-01-01T00:00:00Z") ? base * 2 : base;
}

// Chinese, Japanese and Korean characters each make about 2.5 times more speech than a
// Latin letter, so they count three times.
export function spokenWeight(text) {
    const wide = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
    return text.length + 2 * wide;
}

export default {
    async fetch(request, env) {
        const origin = request.headers.get("Origin");
        const cors = corsHeaders(origin);
        if (origin && !cors) return json({ error: "origin-not-allowed" }, 403);

        const url = new URL(request.url);
        try {
            if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors ?? {} });
            if (request.method === "GET" && url.pathname === "/info") return info(env, cors);
            if (request.method === "GET" && url.pathname === "/health") return await health(env, cors);
            if (request.method === "POST" && url.pathname === "/speak") {
                if (!(await passOk(request, env))) return json({ error: "pass-refused" }, 401, cors);
                return await speak(request, env, cors);
            }
            const saved = url.pathname.match(/^\/saved\/([0-9a-f]{64})$/);
            if (request.method === "PUT" && saved) {
                if (!(await passOk(request, env))) return json({ error: "pass-refused" }, 401, cors);
                return await save(request, env, saved[1], cors);
            }
            return json({ error: "not-found" }, 404, cors);
        } catch (e) {
            return json({ error: "service-error", message: String(e?.message ?? e).slice(0, 200) }, 500, cors);
        }
    },
};

function corsHeaders(origin) {
    if (!origin) return {};
    if (!ALLOWED_ORIGINS.has(origin)) return null;
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Expose-Headers": "X-Voice-Source, X-Voice-Key",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin",
    };
}

function json(body, status = 200, extra = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra },
    });
}

function info(env, cors) {
    return json({
        name: "agentdisc-voice",
        purpose: "Reads Discord messages aloud for the AgentDisc extension: Gemini voice, private pass, audio kept 30 days, daily spending tripwire.",
        version: VERSION,
        model: MODEL,
        savedDays: SAVE_DAYS,
        maxTextChars: MAX_TEXT_CHARS,
        dailyLimitUsd: limitUsd(env),
    }, 200, cors);
}

async function health(env, cors) {
    let store = false;
    try { await env.VOICE.get("health-probe"); store = true; } catch { }
    let spentTodayUsd = null;
    try { spentTodayUsd = (await env.SPEND.get(env.SPEND.idFromName("daily")).today(new Date().toISOString().slice(0, 10))) / 1e6; } catch { }
    const ok = store && spentTodayUsd !== null && Boolean(env.GEMINI_API_KEY) && Boolean(env.PASS_SHA256);
    return json({ ok, store, meter: spentTodayUsd !== null, spentTodayUsd, limitUsd: limitUsd(env), voiceKey: Boolean(env.GEMINI_API_KEY), pass: Boolean(env.PASS_SHA256) }, ok ? 200 : 503, cors);
}

function limitUsd(env) {
    const n = Number(env.DAILY_LIMIT_USD);
    return Number.isFinite(n) && n >= 0 ? n : 5;
}

export async function sha256Hex(text) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function sameText(a, b) {
    if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

async function passOk(request, env) {
    const auth = request.headers.get("Authorization") ?? "";
    const m = auth.match(/^Bearer (\S{20,200})$/);
    if (!m || !env.PASS_SHA256) return false;
    return sameText(await sha256Hex(m[1]), String(env.PASS_SHA256).trim().toLowerCase());
}

// The saved copy's name: the same text in the same voice and model always gets the same name.
export function pieceKey(voice, text) {
    return sha256Hex(`${MODEL}\n${voice}\n${text}`);
}

async function speak(request, env, cors) {
    let body;
    try { body = await request.json(); } catch { return json({ error: "bad-request", message: "Send JSON with text and voice." }, 400, cors); }
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    const voice = typeof body?.voice === "string" ? body.voice : "";
    if (!text) return json({ error: "bad-request", message: "No text." }, 400, cors);
    if (text.length > MAX_TEXT_CHARS) return json({ error: "too-long", message: `At most ${MAX_TEXT_CHARS} characters per piece.` }, 400, cors);
    if (!VOICE_NAME.test(voice)) return json({ error: "bad-request", message: "Unknown voice name." }, 400, cors);

    const key = await pieceKey(voice, text);
    const saved = await env.VOICE.getWithMetadata(`a:${key}`, { type: "arrayBuffer" });
    if (saved?.value) {
        return new Response(saved.value, {
            headers: {
                "Content-Type": saved.metadata?.type ?? "application/octet-stream",
                "Cache-Control": "no-store",
                "X-Voice-Source": "saved",
                "X-Voice-Key": key,
                ...cors,
            },
        });
    }

    // Daily tripwire, counted before the call so a failed call still counts.
    // One always-consistent counter (a Durable Object), so no charge is ever lost.
    const day = new Date().toISOString().slice(0, 10);
    const cost = Math.ceil(spokenWeight(text) * usdPerChar() * 1e6);
    const meter = env.SPEND.get(env.SPEND.idFromName("daily"));
    const charge = await meter.charge(day, cost, Math.round(limitUsd(env) * 1e6));
    if (!charge.ok) {
        return json({ error: "daily-limit", message: "Today's voice spending limit is reached; it resets at midnight UTC.", spentUsd: charge.spent / 1e6, limitUsd: charge.limit / 1e6 }, 429, cors);
    }

    const upstream = await fetch(GEMINI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        body: JSON.stringify({
            contents: [{ parts: [{ text }] }],
            generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
            },
        }),
    });
    if (!upstream.ok) {
        let message = "";
        try { message = (await upstream.json())?.error?.message ?? ""; } catch { }
        return json({ error: "voice-failed", status: upstream.status, message: message.slice(0, 300) }, 502, cors);
    }
    // Google's answer goes straight through: the browser unpacks the sound, so this
    // service stays inside the free plan's small compute allowance.
    return new Response(upstream.body, {
        headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
            "X-Voice-Source": "new",
            "X-Voice-Key": key,
            ...cors,
        },
    });
}

async function save(request, env, key, cors) {
    if (!KEY_NAME.test(key)) return json({ error: "bad-request" }, 400, cors);
    const type = (request.headers.get("Content-Type") ?? "").split(";")[0].trim();
    if (!SAVED_TYPES.has(type)) return json({ error: "bad-request", message: "Unknown audio type." }, 400, cors);
    const declared = Number(request.headers.get("Content-Length"));
    if (declared > MAX_SAVED_BYTES) return json({ error: "too-big" }, 413, cors);
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > MAX_SAVED_BYTES) return json({ error: "too-big" }, 413, cors);
    try {
        await env.VOICE.put(`a:${key}`, bytes, {
            expirationTtl: SAVE_DAYS * 86400,
            metadata: { type, bytes: bytes.byteLength, savedAt: new Date().toISOString() },
        });
    } catch {
        return json({ error: "store-busy", message: "The audio store refused the copy (daily write allowance or busy); it plays anyway." }, 503, cors);
    }
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store", ...cors } });
}

// The daily spending counter. A Durable Object handles one call at a time, so
// read, check and write happen together and two pieces can never both slip under the limit.
export class SpendMeter extends DurableObject {
    async charge(day, cost, limit) {
        const spent = (await this.ctx.storage.get(`spend:${day}`)) ?? 0;
        if (spent + cost > limit) return { ok: false, spent, limit };
        await this.ctx.storage.put(`spend:${day}`, spent + cost);
        await this.ctx.storage.delete(`spend:${previousDay(day, 7)}`);
        return { ok: true, spent: spent + cost, limit };
    }

    async today(day) {
        return (await this.ctx.storage.get(`spend:${day}`)) ?? 0;
    }
}

function previousDay(day, n) {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
}
