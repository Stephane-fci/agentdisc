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
