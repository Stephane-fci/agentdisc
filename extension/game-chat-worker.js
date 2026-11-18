// A real click reaches this through the isolated content script. The page cannot
// choose the native command or destination: Chrome supplies the sending tab.
let gameChatOpening = false;
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.action !== "agentdiscGameChat") return;
    if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || !sender.tab) {
        sendResponse({ ok: false, error: "Open game chat from a Discord channel in Chrome." });
        return;
    }
    // A message link (…/channel/message) opens its channel: he often arrives from one.
    const match = /^https:\/\/discord\.com\/channels\/(@me|[0-9]+)\/([0-9]+)(?:\/[0-9]+)?(?:#[^?]*)?$/.exec(sender.tab.url || "");
    if (!match) {
        sendResponse({ ok: false, error: "Open a Discord channel first, then click Open game chat." });
        return;
    }
    if (gameChatOpening) {
        sendResponse({ ok: false, error: "Game chat is already opening. Wait a moment." });
        return;
    }
    gameChatOpening = true;
    const request = { op: "open", url: `https://discord.com/channels/${match[1]}/${match[2]}#agentdisc-minimal` };
    try {
        chrome.runtime.sendNativeMessage("co.sfrance.agentdisc.game_chat", request, answer => {
            gameChatOpening = false;
            if (chrome.runtime.lastError) {
                sendResponse({ ok: false, error: "The Windows game chat helper is unavailable. Update AgentDisc and its helper, then try again." });
            } else if (answer?.ok === true) sendResponse({ ok: true });
            else sendResponse({ ok: false, error: answer?.error || "Game chat could not open. Try again." });
        });
    } catch {
        gameChatOpening = false;
        sendResponse({ ok: false, error: "Game chat needs AgentDisc's Windows helper. Update AgentDisc and its helper, then try again." });
    }
    return true;
});
