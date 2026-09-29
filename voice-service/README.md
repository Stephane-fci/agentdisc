# AgentDisc voice service

A very small Cloudflare Worker that turns a Discord message into speech with Google's Gemini voice for the AgentDisc extension. It holds the Google key (a Cloudflare secret), answers only Discord pages that send the private pass, keeps each message's audio for 30 days so a replay is free, and stops making new audio for the day past `DAILY_LIMIT_USD` (5 US dollars by default).

Setup: step 2 of `../START-HERE-FOR-YOUR-AGENT.md`. Offline checks: `npm test`. Addresses: `GET /health` (is everything in place), `GET /info`, `POST /speak` and `PUT /saved/<key>` (both need the pass).
