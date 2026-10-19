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
    agentWaits(message.ids).then(sendResponse, () => sendResponse({}));
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
const BOARD_RULE = 1001;

async function setBoardKey() {
  let rule = null;
  try {
    const res = await fetch(chrome.runtime.getURL("mission-panel-key.json"), { cache: "no-store" });
    if (res.ok) {
      const key = await res.json();
      const host = new URL(key.board).hostname;
      if (host && key.client_id && key.client_secret) {
        rule = {
          id: BOARD_RULE,
          priority: 1,
          action: {
            type: "modifyHeaders",
            requestHeaders: [
              { header: "CF-Access-Client-Id", operation: "set", value: String(key.client_id) },
              { header: "CF-Access-Client-Secret", operation: "set", value: String(key.client_secret) }
            ]
          },
          condition: {
            requestDomains: [host],
            resourceTypes: ["sub_frame", "xmlhttprequest", "script", "stylesheet", "image", "font", "media", "ping", "other"]
          }
        };
      }
    }
  } catch {}
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [BOARD_RULE], addRules: rule ? [rule] : [] }).catch(() => {});
}

setBoardKey();

// AgentDisc waiting bookmarks (Stephane, 18 Oct): a bookmarked line turns blue while an
// agent has planned its next check there. The mission board knows the agents' planned
// checks; its board of a channel lists them for the channel and for each card's thread
// (one-off checks as wakes; repeating jobs as jobs, asked of the board on 19 Oct).
// Only the due times go back to the page; the key never leaves this background part.
const ID = /^\d{15,21}$/;

async function boardKey() {
  try {
    const res = await fetch(chrome.runtime.getURL("mission-panel-key.json"), { cache: "no-store" });
    if (!res.ok) return null;
    const key = await res.json();
    const board = new URL(key.board);
    if (board.protocol !== "https:" || !key.client_id || !key.client_secret) return null;
    return { origin: board.origin, headers: { "CF-Access-Client-Id": String(key.client_id), "CF-Access-Client-Secret": String(key.client_secret) } };
  } catch {
    return null;
  }
}

async function agentWaits(ids) {
  const key = await boardKey();
  if (!key || !Array.isArray(ids)) return {};
  const asked = [...new Set(ids.map(String).filter(id => ID.test(id)))].slice(0, 60);
  const out = {};
  const add = (id, wakes) => {
    if (!ID.test(String(id)) || !Array.isArray(wakes)) return;
    for (const w of wakes) if (w && typeof w.at === "string") (out[id] ??= []).push(w.at);
  };
  // A few at a time: the board is a small server.
  const queue = [...asked];
  async function worker() {
    for (let id; (id = queue.shift());) {
      try {
        const res = await fetch(`${key.origin}/api/board/${id}`, { headers: key.headers, cache: "no-store", credentials: "omit", redirect: "manual" });
        if (!res.ok) continue;
        const board = await res.json();
        // One-off planned checks (wakes) and, once the board lists them, the next runs of
        // repeating jobs (jobs, same shape: { at }), for the channel and each card's thread.
        const timers = live => [...((live && live.wakes) || []), ...((live && live.jobs) || [])];
        add(board.channel, timers(board.live));
        for (const card of board.cards || []) if (card && card.thread) add(card.thread, timers(card.live));
      } catch {}
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  for (const id of Object.keys(out)) out[id] = [...new Set(out[id])];
  return out;
}
