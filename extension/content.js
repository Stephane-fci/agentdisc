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

        window.addEventListener('message', function(event) {
            if (event.source !== window) return;

            if (event.data.type === 'OPEN_SHORTCUTS') {
            chrome.runtime.sendMessage({ action: "openShortcuts" });
            }

            // AgentDisc read aloud: turn YouTube tabs down while the voice plays.
            if (event.data.type === 'AGENTDISC_DUCK') {
                chrome.runtime.sendMessage({ action: "agentdiscDuck", on: !!event.data.on });
            }

            // AgentDisc waiting bookmarks: the checks agents planned in these conversations,
            // asked from the mission board by the background part, which holds its key.
            if (event.data.type === 'AGENTDISC_WAITS' && Array.isArray(event.data.ids)) {
                const seq = event.data.seq;
                chrome.runtime.sendMessage({ action: "agentdiscWaits", ids: event.data.ids.slice(0, 60) })
                    .then(waits => window.postMessage({ type: "AGENTDISC_WAITS_ANSWER", seq, waits: waits || {} }, location.origin))
                    .catch(() => {});
            }
        }, false);
    },
    { once: true }
);
