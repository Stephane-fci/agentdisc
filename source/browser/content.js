if (typeof browser === "undefined") {
    var browser = chrome;
}

document.addEventListener(
    "DOMContentLoaded",
    () => {
        window.postMessage({
            type: "vencord:meta",
            meta: {
                EXTENSION_VERSION: browser.runtime.getManifest().version,
                EXTENSION_BASE_URL: browser.runtime.getURL(""),
                RENDERER_CSS_URL: browser.runtime.getURL("dist/Vencord.css"),
            }
        });

        chrome.runtime.onMessage.addListener(request => {
            window.postMessage({ type: "vencord:keybinds", meta: request.command });  
        })

        // After the app is reloaded, this script stays in a Discord tab that was not refreshed,
        // cut off from the app: every message to it then throws "Extension context
        // invalidated". It stops listening quietly instead (Stephane, 18 Oct, Chrome's Errors).
        function send(message) {
            try {
                if (chrome.runtime && chrome.runtime.id) return chrome.runtime.sendMessage(message);
            } catch {}
            window.removeEventListener('message', onPageMessage, false);
            return Promise.resolve(undefined);
        }

        function onPageMessage(event) {
            if (event.source !== window) return;

            if (event.data.type === 'OPEN_SHORTCUTS') {
                send({ action: "openShortcuts" }).catch(() => {});
            }

            // AgentDisc read aloud: turn YouTube tabs down while the voice plays.
            if (event.data.type === 'AGENTDISC_DUCK') {
                send({ action: "agentdiscDuck", on: !!event.data.on }).catch(() => {});
            }

            // AgentDisc waiting bookmarks: the checks agents planned in these conversations,
            // asked from the mission board by the background part, which holds its key.
            // AgentDisc bookmarks: the whole list, for each server's board (31 Oct), sent by the background part.
            if (event.data.type === 'AGENTDISC_BOOKMARKS' && Array.isArray(event.data.ids)) {
                send({ action: "agentdiscBookmarks", ids: event.data.ids, guilds: event.data.guilds }).catch(() => {});
            }

            if (event.data.type === 'AGENTDISC_TIME' && typeof event.data.cmd === 'string') {
                const seq = event.data.seq;
                send({ action: "agentdiscTime", cmd: event.data.cmd, args: event.data.args || {} })
                    .then(answer => window.postMessage({ type: "AGENTDISC_TIME_ANSWER", seq, answer: answer || { ok: false, error: "AgentDisc was reloaded; refresh Discord." } }, location.origin))
                    .catch(() => window.postMessage({ type: "AGENTDISC_TIME_ANSWER", seq, answer: { ok: false, error: "AgentDisc was reloaded; refresh Discord." } }, location.origin));
            }

            if (event.data.type === 'AGENTDISC_WAITS' && Array.isArray(event.data.ids)) {
                const seq = event.data.seq;
                send({ action: "agentdiscWaits", ids: event.data.ids.slice(0, 60), guilds: event.data.guilds })
                    .then(waits => { if (waits) window.postMessage({ type: "AGENTDISC_WAITS_ANSWER", seq, waits }, location.origin); })
                    .catch(() => {});
            }
        }

        // AgentDisc time and focus (9 Nov 2026): his clicks go to the background part, the one
        // owner of the timer; every change it saves reaches every Discord tab at once.
        if (chrome.storage && chrome.storage.onChanged) {
            chrome.storage.onChanged.addListener((changes, area) => {
                if (area === "local" && changes.agentdiscTime && changes.agentdiscTime.newValue) {
                    window.postMessage({ type: "AGENTDISC_TIME_STATE", state: changes.agentdiscTime.newValue }, location.origin);
                }
            });
        }

        window.addEventListener('message', onPageMessage, false);
    },
    { once: true }
);
