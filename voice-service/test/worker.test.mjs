// Offline checks of the voice service: node --test test/
// The Cloudflare-only import is replaced by a stand-in, KV and the counter are in memory,
// and Google is a fake that records each call.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const src = readFileSync(new URL("../src/index.js", import.meta.url), "utf8").replace(
    'import { DurableObject } from "cloudflare:workers";',
    "class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }",
);
const file = join(mkdtempSync(join(tmpdir(), "agentdisc-voice-")), "index.mjs");
writeFileSync(file, src);
const mod = await import(file);
const worker = mod.default;

const PASS = "test-pass-0123456789abcdefghij";
const PASS_SHA = createHash("sha256").update(PASS).digest("hex");

function makeEnv(limit = "5") {
    const kv = new Map();
    const store = new Map();
    const meter = new mod.SpendMeter({ storage: { get: async k => store.get(k), put: async (k, v) => void store.set(k, v), delete: async k => void store.delete(k) } }, {});
    return {
        kv, store,
        DAILY_LIMIT_USD: limit,
        GEMINI_API_KEY: "fake-google-key-never-shown",
        PASS_SHA256: PASS_SHA,
        VOICE: {
            get: async k => kv.get(k)?.value ?? null,
            getWithMetadata: async k => kv.get(k) ?? { value: null, metadata: null },
            put: async (k, value, opts) => void kv.set(k, { value, metadata: opts?.metadata ?? null, ttl: opts?.expirationTtl }),
        },
        SPEND: { idFromName: n => n, get: () => meter },
    };
}

let calls = [];
let reply = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/wav", data: "UklGRg==" } }] } }], usageMetadata: { candidatesTokenCount: 50 } }), { status: 200 });
globalThis.fetch = async (url, init) => { calls.push({ url, init }); return reply(); };

const speakReq = (body, headers = {}) => new Request("https://voice.test/speak", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${PASS}`, Origin: "https://discord.com", ...headers },
    body: JSON.stringify(body),
});

test("info and health answer without the pass and show no secret", async () => {
    const env = makeEnv();
    const info = await worker.fetch(new Request("https://voice.test/info"), env);
    assert.equal(info.status, 200);
    const text = await info.text();
    assert.ok(!text.includes("fake-google-key") && !text.includes(PASS_SHA));
    const health = await worker.fetch(new Request("https://voice.test/health"), env);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ok, true);
});

test("no pass or a wrong pass is refused, and Google is not called", async () => {
    calls = [];
    const env = makeEnv();
    const none = await worker.fetch(speakReq({ text: "Hello", voice: "en-us-concierge-1" }, { Authorization: "" }), env);
    assert.equal(none.status, 401);
    const wrong = await worker.fetch(speakReq({ text: "Hello", voice: "en-us-concierge-1" }, { Authorization: "Bearer wrong-pass-0123456789abcdefghij" }), env);
    assert.equal(wrong.status, 401);
    assert.equal(calls.length, 0);
});

test("another website is refused", async () => {
    const r = await worker.fetch(speakReq({ text: "Hello", voice: "en-us-concierge-1" }, { Origin: "https://evil.example" }), makeEnv());
    assert.equal(r.status, 403);
});

test("the browser's preflight from Discord is allowed", async () => {
    const r = await worker.fetch(new Request("https://voice.test/speak", { method: "OPTIONS", headers: { Origin: "https://discord.com" } }), makeEnv());
    assert.equal(r.status, 204);
    assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://discord.com");
});

test("a new piece goes to Google once, is charged, and a saved copy is replayed for free", async () => {
    calls = [];
    const env = makeEnv();
    const first = await worker.fetch(speakReq({ text: "Hello there.", voice: "en-us-concierge-1" }), env);
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("X-Voice-Source"), "new");
    const key = first.headers.get("X-Voice-Key");
    assert.match(key, /^[0-9a-f]{64}$/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.headers["x-goog-api-key"], "fake-google-key-never-shown");
    assert.equal(JSON.parse(calls[0].init.body).generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, "en-us-concierge-1");
    const today = new Date().toISOString().slice(0, 10);
    assert.ok(env.store.get(`spend:${today}`) > 0);

    const put = await worker.fetch(new Request(`https://voice.test/saved/${key}`, {
        method: "PUT", headers: { Authorization: `Bearer ${PASS}`, "Content-Type": "audio/x-agentdisc-opus", Origin: "https://discord.com" }, body: new Uint8Array([1, 2, 3]),
    }), env);
    assert.equal(put.status, 204);
    assert.equal(env.kv.get(`a:${key}`).ttl, 30 * 86400);

    const spentBefore = env.store.get(`spend:${today}`);
    const again = await worker.fetch(speakReq({ text: "Hello there.", voice: "en-us-concierge-1" }), env);
    assert.equal(again.headers.get("X-Voice-Source"), "saved");
    assert.deepEqual([...new Uint8Array(await again.arrayBuffer())], [1, 2, 3]);
    assert.equal(calls.length, 1);
    assert.equal(env.store.get(`spend:${today}`), spentBefore);
});

test("the daily tripwire refuses once the limit is reached", async () => {
    calls = [];
    const env = makeEnv("0.0001");
    const r = await worker.fetch(speakReq({ text: "x".repeat(200), voice: "en-us-concierge-1" }), env);
    assert.equal(r.status, 429);
    assert.equal((await r.json()).error, "daily-limit");
    assert.equal(calls.length, 0);
});

test("the tripwire lets pieces through until the sum passes the limit", async () => {
    calls = [];
    const env = makeEnv("0.01"); // about 480 characters at the guessed price
    const texts = ["a".repeat(200), "b".repeat(200), "c".repeat(200)];
    const statuses = [];
    for (const text of texts) statuses.push((await worker.fetch(speakReq({ text, voice: "en-us-concierge-1" }), env)).status);
    assert.deepEqual(statuses, [200, 200, 429]);
    assert.equal(calls.length, 2);
});

test("too long, empty or odd input is refused before any cost", async () => {
    calls = [];
    const env = makeEnv();
    assert.equal((await worker.fetch(speakReq({ text: "x".repeat(mod.MAX_TEXT_CHARS + 1), voice: "en-us-concierge-1" }), env)).status, 400);
    assert.equal((await worker.fetch(speakReq({ text: "  ", voice: "en-us-concierge-1" }), env)).status, 400);
    assert.equal((await worker.fetch(speakReq({ text: "Hi", voice: "bad voice!" }), env)).status, 400);
    const put = await worker.fetch(new Request(`https://voice.test/saved/${"a".repeat(64)}`, {
        method: "PUT", headers: { Authorization: `Bearer ${PASS}`, "Content-Type": "text/html" }, body: "x",
    }), env);
    assert.equal(put.status, 400);
    assert.equal(calls.length, 0);
});

test("a Google failure comes back as a short message without the key", async () => {
    const env = makeEnv();
    reply = () => new Response(JSON.stringify({ error: { message: "Quota exceeded" } }), { status: 429 });
    const r = await worker.fetch(speakReq({ text: "Hello", voice: "en-us-concierge-1" }), env);
    assert.equal(r.status, 502);
    const text = await r.text();
    assert.ok(text.includes("Quota exceeded") && !text.includes("fake-google-key"));
});

test("Chinese text counts three times per character for the tripwire", () => {
    assert.equal(mod.spokenWeight("abc"), 3);
    assert.equal(mod.spokenWeight("你好a"), 7);
});
