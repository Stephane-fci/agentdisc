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
            if (event.data.type === 'AGENTDISC_WAITS' && Array.isArray(event.data.ids)) {
                const seq = event.data.seq;
                send({ action: "agentdiscWaits", ids: event.data.ids.slice(0, 60), guilds: event.data.guilds })
                    .then(waits => { if (waits) window.postMessage({ type: "AGENTDISC_WAITS_ANSWER", seq, waits }, location.origin); })
                    .catch(() => {});
            }
        }

        window.addEventListener('message', onPageMessage, false);
    },
    { once: true }
);
