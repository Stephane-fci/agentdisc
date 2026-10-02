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

// AgentDisc: when a new copy of the app lands in its folder, the app reloads itself and
// refreshes the open Discord tabs, so an update takes effect within half a minute with
// no clicks (Stephane, 2 Oct). Every build carries a new dist/stamp.txt; the stamp of
// the copy that is running is kept, and a different one on disk means a new copy.
const UPDATE_ALARM = "agentdisc-update";

async function diskStamp() {
  try {
    const res = await fetch(chrome.runtime.getURL("dist/stamp.txt"), { cache: "no-store" });
    return res.ok ? (await res.text()).trim() : null;
  } catch {
    return null;
  }
}

async function startWatching() {
  const stamp = await diskStamp();
  if (stamp) await chrome.storage.local.set({ agentdiscRunning: stamp });
  chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: 0.5 });
}

chrome.runtime.onInstalled.addListener(async () => {
  await startWatching();
  // A new or reloaded copy only reaches Discord once its tabs load again.
  const tabs = await chrome.tabs.query({ url: ["*://*.discord.com/*"] });
  for (const tab of tabs) chrome.tabs.reload(tab.id).catch(() => {});
});

chrome.runtime.onStartup.addListener(() => { startWatching(); });

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name !== UPDATE_ALARM) return;
  const [stamp, saved] = await Promise.all([diskStamp(), chrome.storage.local.get("agentdiscRunning")]);
  if (stamp && saved.agentdiscRunning && stamp !== saved.agentdiscRunning) chrome.runtime.reload();
});
