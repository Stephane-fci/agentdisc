# AgentDisc: setup guide for the agent

You are installing AgentDisc for your human. AgentDisc is a Chrome extension that makes Discord in the browser better for working with AI agents: typing signs on threads, threads grouped under their channel, panels you can hide, a calm dark theme, left-hand shortcuts, and a play button that reads any message aloud in a natural Google voice. It was built by Stephane Franceschini on top of Vencord (open source, GPL-3.0) and is shared here with his own settings as the starting look.

Follow the steps in order. Each step says who does it: you (commands) or your human (a few clicks in their browser). At the end, walk your human through `WHAT-AGENTDISC-DOES.md`.

## What is in this folder

- `extension/`: the finished app, ready to load in Chrome. Nothing to build.
- `voice-service/`: a very small Cloudflare service that holds the Google voice key, so the key never sits in the browser. It keeps each message's audio for 30 days so a replay is free, and stops making new audio for the day past a spending limit ($5 by default).
- `source/`: the full source of the app, for rebuilding after a Discord change. Not needed for the install.
- `WHAT-AGENTDISC-DOES.md`: every feature, in plain words, for your human.

## Before you start

Your human needs: a computer with Google Chrome (Microsoft Edge or Brave also work; Firefox and the Discord desktop app do not, AgentDisc runs on Discord in the browser at https://discord.com/app), a Google account, and a free Cloudflare account. You need Node.js 22 or newer where you run the commands. Plan about 20 minutes, of which about 5 minutes are clicks by your human.

Two secrets are made during setup: the Google voice key and a private pass between the app and the voice service. Never print them, paste them in a chat, put them in a log, or save them anywhere except the two places this guide names: the Google key goes only into Cloudflare as a secret, and the pass goes only into the app folder (`extension/dist/voice-pass.json`) on your human's computer, while Cloudflare keeps just its fingerprint.

## Step 1: the Google voice key (your human, about 3 minutes)

Guide your human through this:

1. Open https://aistudio.google.com/apikey and sign in with their Google account. Accept the terms if asked (new accounts get a default project automatically).
2. Click "Create API key" and pick the project. Keys made in Google AI Studio are limited to the Gemini API, which is what Google now requires (Google refuses unrestricted keys). If the button says they lack permission, create a new project not tied to a company organisation and make the key there.
3. Copy the key and give it to you privately (not in a shared or public channel).
4. Paying: the free level works for trying, with daily limits, and Google may use the text to improve its products. For daily use, turn on billing for that project (in AI Studio, the project's billing or plan option; it links a Google Cloud billing account with a card). The price is about 1.5 US cents for a typical answer read aloud (Gemini 3.8 Flash voice, $9 per million sound tokens until 31 December 2026, double after that); playing the same message again costs nothing for 30 days.

## Step 2: the voice service on Cloudflare (you, about 10 minutes)

1. Your human creates a free Cloudflare account at https://dash.cloudflare.com/sign-up if they have none.
2. Install the Cloudflare tool: `cd voice-service` then `npm install`.
3. Log in to their Cloudflare account. If you run on your human's own computer: `npx wrangler login`, a browser page opens, they click Allow. If you run on a server with no browser: your human opens https://dash.cloudflare.com/profile/api-tokens, clicks "Create Token", uses the template "Edit Cloudflare Workers", picks their account, creates it and gives you the token privately; then set `CLOUDFLARE_API_TOKEN` to it and `CLOUDFLARE_ACCOUNT_ID` to their account id (shown on the Workers and Pages page of the dashboard). Check with `npx wrangler whoami`.
4. Make the audio store: `npx wrangler kv namespace create agentdisc-voice`. Copy the id it prints into `wrangler.toml`, in place of `PUT-THE-KV-NAMESPACE-ID-HERE`.
5. Put the service online: `npx wrangler deploy`. On a new account Cloudflare first needs a workers.dev subdomain: in an interactive terminal wrangler asks for one (pick any free name); without one it stops with a link to the dashboard's Workers onboarding page, where your human registers a subdomain, then run the deploy again. Note the address it prints, like `https://agentdisc-voice.<their-subdomain>.workers.dev`.
6. Give it the Google key: `npx wrangler secret put GEMINI_API_KEY` and enter the key when asked (or pipe it in from where you hold it; never echo it into a log).
7. Make the pass: `node setup-pass.mjs new-pass | npx wrangler secret put PASS_SHA256`. This writes a new random pass into `../extension/dist/voice-pass.json` and sends Cloudflare only its fingerprint. Nobody sees the pass.
8. Tell the app where its voice lives: `node setup-pass.mjs service https://agentdisc-voice.<their-subdomain>.workers.dev`.
9. Check the service: open or `curl` `https://agentdisc-voice.<their-subdomain>.workers.dev/health`. It must answer `"ok": true` (store, meter, voiceKey and pass all true). If one is false, redo the matching step above.
10. One real voice call (well under one cent): `node setup-pass.mjs test https://agentdisc-voice.<their-subdomain>.workers.dev`. It must end with "The voice works." An answer 401 means the pass fingerprint is wrong (redo step 7), 502 means Google refused (check the key and billing), 429 means the daily limit is reached.

`setup-pass.mjs` takes the app folder as its last argument when the app is not in `../extension`; run `node setup-pass.mjs` with no argument to see the forms.

## Step 3: put the app on your human's computer (you)

Copy the whole `extension` folder, now holding `dist/voice-pass.json`, to a lasting place on the computer where your human uses Chrome, for example `Documents\AgentDisc` on Windows or `~/Documents/AgentDisc` on a Mac. Chrome loads it from there at every start, so it must not be moved or deleted later. If you ran step 2 on a server, bring the folder over in a private way (it holds the pass). If Vencord is already installed in this Chrome, ask your human to switch it off on the extensions page; two copies clash.

## Step 4: load it in Chrome (your human, 1 minute)

1. Type `chrome://extensions` in the address bar (Edge: `edge://extensions`).
2. Turn on "Developer mode" (top right).
3. Click "Load unpacked" and choose the AgentDisc folder (the one that holds `manifest.json`).
4. "AgentDisc" appears with a purple robot icon. If it shows an "Errors" button, ask for a screenshot.
5. Open https://discord.com/app, or refresh it if it was open.

## Step 5: check it with your human

- Discord shows the Midnight colours (they need Discord's own theme on Dark: Discord settings, Appearance), and the server list, channel header, account bar and message box buttons are hidden: that is Stephane's look, the starting setup. A purple robot button at the top opens the AgentDisc menu, where each part can be shown again.
- Next to the name on any message there is a small purple play button. A click reads the message aloud; a player appears (just above the message box in this starting look, or in the channel header when that is shown) and the words light up as they are read.
- If a note says "The voice is not set up yet" and a robotic voice reads instead, the app did not find its setup file: check that `voice-pass.json` sits in the app folder's `dist` subfolder, click the reload arrow on AgentDisc in `chrome://extensions`, then refresh Discord. Another way: press Ctrl and comma in Discord to open the settings, choose AgentDisc, then Plugins, then the cog on AgentDiscVoice, and paste the service address and the pass there.
- Ask which keyboard they use. AZERTY (French): nothing to do, Alt with Z, Q, S and D moves between channels. QWERTY: in the settings (Ctrl and comma), AgentDisc, Plugins, cog on LeftHandKeys, choose "W A S D (QWERTY keyboard)", then refresh Discord.

Then give your human the short tour in `WHAT-AGENTDISC-DOES.md`.

## Later changes

- Voice: the default is `en-us-concierge-1`, a calm, clear American man. Your human can hear and compare voices at https://aistudio.google.com/generate-speech. To change it: settings (Ctrl and comma), AgentDisc, Plugins, cog on AgentDiscVoice, "Voice for every agent", with a Google voice name (a main voice like `Charon`, `Kore`, `Puck` or `Achird`, or a library name; the full list: `GET https://generativelanguage.googleapis.com/v1beta/voices` with the key in the `x-goog-api-key` header). Each agent can have its own voice in "Own voice per agent" as `agent account id=voice`, separated by `;`.
- Pronunciation: "How to say names" takes pairs like `AgentDisc=Agent Disc`, separated by `;`.
- Daily limit: change `DAILY_LIMIT_USD` in `wrangler.toml` and run `npx wrangler deploy` again. To stop all new voice spending at once, set it to `"0"` and deploy, or delete the key in Google AI Studio.
- New pass: run step 7 again, then in the AgentDiscVoice settings click "Forget" and refresh Discord; the app takes the new pass from its folder.

## When Discord changes

Discord updates its web app often. If a part of AgentDisc stops fitting, a thin purple bar appears at the top of Discord; hovering it names the part. To rebuild: in `source/`, with Node.js 22 or newer, run `corepack enable`, `pnpm install --frozen-lockfile`, then the build with two values it would otherwise read from Git: `VENCORD_HASH=agentdisc VENCORD_REMOTE=Vendicated/Vencord pnpm buildWeb` (Windows PowerShell: `$env:VENCORD_HASH='agentdisc'; $env:VENCORD_REMOTE='Vendicated/Vencord'; pnpm buildWeb`). The new app is in `source/dist/chromium-unpacked`: copy its content over your human's AgentDisc folder (keep `dist/voice-pass.json`), click the reload arrow on AgentDisc in `chrome://extensions` and refresh Discord. The parts live in `source/src/plugins/` (one folder each; `agentdisc-keep.json` lists which parts ship). The copy is based on Vencord 1.15.8 (https://github.com/Vendicated/Vencord); a newer Vencord release can be taken by moving these changes onto it.

## Privacy

AgentDisc sends a message's text only when your human presses play, and only to their own voice service, which passes it to Google. The service answers only Discord pages that carry the pass. Discord's own tracking is blocked (the NoTrack part). Everything else stays in the browser.
