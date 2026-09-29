// Voice pass helper for AgentDisc. The pass never appears on screen.
//
//   node setup-pass.mjs new-pass [app folder] | npx wrangler secret put PASS_SHA256
//       Makes a new random pass, writes it into <app folder>/dist/voice-pass.json and prints
//       only its SHA-256 fingerprint, which goes straight to Cloudflare as a secret.
//   node setup-pass.mjs service <https address> [app folder]
//       Writes the voice service address into the same file.
//   node setup-pass.mjs test <https address> [app folder]
//       One real voice call with the pass from the file (costs well under one US cent).
//
// [app folder] is the AgentDisc app folder, the one holding manifest.json (default: ../extension).
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [mode, ...rest] = process.argv.slice(2);
const folderArg = mode === "new-pass" ? rest[0] : rest[1];
const app = resolve(folderArg ?? fileURLToPath(new URL("../extension", import.meta.url)));
const file = join(app, "dist", "voice-pass.json");

function fail(message) {
    console.error(message);
    process.exit(1);
}

if (!existsSync(join(app, "manifest.json"))) fail(`No AgentDisc app in ${app} (manifest.json missing).`);
const current = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};

if (mode === "new-pass") {
    const pass = randomBytes(32).toString("base64url");
    writeFileSync(file, JSON.stringify({ ...current, pass }, null, 4) + "\n");
    console.error(`New pass written to ${file}.`);
    process.stdout.write(createHash("sha256").update(pass).digest("hex"));
} else if (mode === "service") {
    const address = String(rest[0] ?? "").trim().replace(/\/+$/, "");
    if (!/^https:\/\/\S+$/.test(address)) fail("Give the service address, starting with https://");
    writeFileSync(file, JSON.stringify({ ...current, service: address }, null, 4) + "\n");
    console.log(`Service address written to ${file}.`);
} else if (mode === "test") {
    const address = String(rest[0] ?? current.service ?? "").trim().replace(/\/+$/, "");
    if (!/^https:\/\/\S+$/.test(address)) fail("Give the service address, starting with https://");
    if (!current.pass) fail(`No pass in ${file}; run new-pass first.`);
    let res, body;
    try {
        res = await fetch(address + "/speak", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${current.pass}` },
            body: JSON.stringify({ text: "Hello, AgentDisc is ready to read your messages.", voice: "en-us-concierge-1" }),
        });
        body = await res.arrayBuffer();
    } catch (e) {
        fail(`Could not reach ${address}: ${e?.cause?.code ?? e?.message ?? e}`);
    }
    console.log(`Answer ${res.status}, source ${res.headers.get("X-Voice-Source") ?? "-"}, ${body.byteLength} bytes.`);
    if (!res.ok) fail(new TextDecoder().decode(body).slice(0, 300));
    console.log("The voice works.");
} else {
    fail("Use: new-pass [app folder] | service <address> [app folder] | test <address> [app folder]");
}
