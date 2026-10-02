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

