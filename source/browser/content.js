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
        }, false);
    },
    { once: true }
);
