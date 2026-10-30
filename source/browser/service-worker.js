chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  chrome.tabs.sendMessage(tab.id, { command });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "openShortcuts") {
    chrome.tabs.create({ url: "about://extensions/shortcuts" });
  }
  if (message.action === "agentdiscDuck") {
    duckYouTube(!!message.on);
  }
  if (message.action === "agentdiscWaits" && sender.id === chrome.runtime.id) {
    agentWaits(message.ids, message.guilds).then(sendResponse, () => sendResponse({}));
    return true;
  }
});

// AgentDisc read aloud: while the voice plays, YouTube tabs go down to a fifth of their
// volume; when it stops, they go back to exactly where they were. Nothing is paused.
async function duckYouTube(on) {
  const tabs = await chrome.tabs.query({ url: ["*://*.youtube.com/*"] });
  for (const tab of tabs) {
    chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", func: duckPage, args: [on] }).catch(() => {});
  }
}

function duckPage(on) {
  const KEY = "__agentdiscDuck";
  const player = document.getElementById("movie_player");
  const media = () => [...document.querySelectorAll("video, audio")];
  if (on) {
    if (window[KEY]) return;
    if (player && typeof player.getVolume === "function") {
      const volume = player.getVolume();
      window[KEY] = { kind: "player", volume };
      player.setVolume(Math.max(1, Math.round(volume / 5)));
    } else {
      const list = media();
      window[KEY] = { kind: "media", volumes: list.map(m => m.volume) };
      list.forEach(m => { m.volume = m.volume / 5; });
    }
  } else {
    const saved = window[KEY];
    if (!saved) return;
    delete window[KEY];
    if (saved.kind === "player" && player && typeof player.setVolume === "function") player.setVolume(saved.volume);
    else media().forEach((m, i) => { if (saved.volumes[i] != null) m.volume = saved.volumes[i]; });
  }
}


// AgentDisc mission board (Stephane, 14 Oct): the board shown in the right panel sits behind
// a Cloudflare login. Where the board is set up, a file beside the app holds its key
// (mission-panel-key.json, which web pages cannot read); this browser then adds the key to
// the board's own requests, so the panel opens without a login. Without the file nothing is
// added, and the rule from an earlier setup is removed.
//
// Each server its own board (Stephane, 30 Oct): the file may hold more boards,
// { board, client_id, client_secret, boards: [{ board, client_id, client_secret }] }. One rule
// per board, for that exact address and nothing under it, so a key never reaches another host.
const BOARD_RULE = 1001;
const BOARD_RULES = 100;

// Every usable board key in the file, the first one for a host winning. A broken one is left out.
async function boardKeys() {
  const keys = [];
  try {
    const res = await fetch(chrome.runtime.getURL("mission-panel-key.json"), { cache: "no-store" });
    if (!res.ok) return keys;
    const file = await res.json();
    for (const key of [file, ...(Array.isArray(file && file.boards) ? file.boards : [])]) {
      try {
        const board = new URL(key.board);
        if (board.protocol !== "https:" || !key.client_id || !key.client_secret || keys.some(k => k.host === board.hostname)) continue;
        keys.push({ host: board.hostname, origin: board.origin, listed: key !== file, headers: { "CF-Access-Client-Id": String(key.client_id), "CF-Access-Client-Secret": String(key.client_secret) } });
      } catch {}
    }
  } catch {}
  return keys;
}

function boardRule(key, index) {
  return {
    id: BOARD_RULE + index,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: Object.entries(key.headers).map(([header, value]) => ({ header, operation: "set", value }))
    },
    condition: {
      urlFilter: `|https://${key.host}/`,
      // A board named in the list opens only from Discord's pages and from itself, never from another page in this browser.
      ...(key.listed ? { initiatorDomains: ["discord.com", key.host] } : {}),
      resourceTypes: ["sub_frame", "xmlhttprequest", "script", "stylesheet", "image", "font", "media", "ping", "other"]
    }
  };
}

async function setBoardKey() {
  const rules = (await boardKeys()).slice(0, BOARD_RULES).map(boardRule);
  const before = await chrome.declarativeNetRequest.getDynamicRules().catch(() => []);
  const stale = before.map(rule => rule.id).filter(id => id >= BOARD_RULE && id < BOARD_RULE + BOARD_RULES);
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: stale, addRules: rules }).catch(() => {});
}

setBoardKey();

// AgentDisc waiting bookmarks (Stephane, 18 Oct): a bookmarked line turns blue while an
// agent has planned its next check there. The mission board knows the agents' planned
// checks; its board of a channel lists them for the channel and for each card's thread
// (one-off checks as wakes; repeating jobs as jobs, asked of the board on 19 Oct).
// Only the due times go back to the page; the key never leaves this background part.
const ID = /^\d{15,21}$/;

// Which board answers for which server, from the setup file beside the app (the page reads the
// same file): the same choice as the panel's. Without that file, the key file's own board.
async function boardChoice(keys) {
  const https = address => {
    try {
      const url = new URL(address);
      return url.protocol === "https:" ? url.origin : null;
    } catch {
      return null;
    }
  };
  let file = null;
  try {
    const res = await fetch(chrome.runtime.getURL("dist/mission-board.json"), { cache: "no-store" });
    if (res.ok) file = await res.json();
  } catch {}
  if (!file) return { main: keys[0] ? keys[0].origin : null, boards: new Map() };
  const listed = file.boards && typeof file.boards === "object" && !Array.isArray(file.boards) ? Object.entries(file.boards) : [];
  return { main: https(file.board), boards: new Map(listed.filter(([guild]) => ID.test(guild)).map(([guild, address]) => [guild, https(address)])) };
}

async function agentWaits(ids, guilds) {
  const keys = await boardKeys();
  if (!keys.length || !Array.isArray(ids)) return {};
  const asked = [...new Set(ids.map(String).filter(id => ID.test(id)))].slice(0, 60);
  const choice = await boardChoice(keys);
  // Each id goes only to its own server's board. With boards set up per server, an id whose
  // server the page did not name goes nowhere; with one board for everything, to that board.
  const perBoard = new Map();
  for (const id of asked) {
    const guild = guilds && typeof guilds === "object" ? String(guilds[id] ?? "") : "";
    const origin = !choice.boards.size ? choice.main : !ID.test(guild) ? null : choice.boards.has(guild) ? choice.boards.get(guild) : choice.main;
    const key = origin && keys.find(k => k.origin === origin);
    if (!key) continue;
    if (!perBoard.has(key)) perBoard.set(key, []);
    perBoard.get(key).push(id);
  }
  const out = {};
  const add = (id, wakes) => {
    if (!ID.test(String(id)) || !Array.isArray(wakes)) return;
    for (const w of wakes) if (w && typeof w.at === "string") (out[id] ??= []).push(w.at);
  };
  await Promise.all([...perBoard].map(([key, list]) => askBoard(key, list, add)));
  for (const id of Object.keys(out)) out[id] = [...new Set(out[id])];
  return out;
}

async function askBoard(key, list, add) {
  // A few at a time: the board is a small server.
  const queue = [...list];
  // A thread's question answers with its channel's board: one read per board is enough.
  const read = new Set();
  async function worker() {
    for (let id; (id = queue.shift());) {
      if (read.has(id)) continue;
      try {
        const res = await fetch(`${key.origin}/api/board/${id}`, { headers: key.headers, cache: "no-store", credentials: "omit", redirect: "manual" });
        if (!res.ok) continue;
        const board = await res.json();
        read.add(String(board.channel));
        // One-off planned checks (wakes) and, once the board lists them, the next runs of
        // repeating jobs (jobs, same shape: { at }), for the channel and each card's thread.
        const timers = live => [...((live && live.wakes) || []), ...((live && live.jobs) || [])];
        add(board.channel, timers(board.live));
        for (const card of board.cards || []) if (card && card.thread) add(card.thread, timers(card.live));
      } catch {}
    }
  }
  await Promise.all([worker(), worker(), worker()]);
}
