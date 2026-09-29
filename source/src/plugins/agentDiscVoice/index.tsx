/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { addMessageDecoration, removeMessageDecoration } from "@api/MessageDecorations";
import { definePluginSettings } from "@api/Settings";
import { Button } from "@components/Button";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { OptionType } from "@utils/types";
import { Message } from "@vencord/discord-types";
import { createRoot, Menu, useEffect, useState } from "@webpack/common";

import { agentName, answerText, isCard } from "./answer";
import { startClickToRead, stopClickToRead } from "./clickToRead";
import { PlayBar, Spinner } from "./PlayBar";
import { close, getView, play, subscribe, togglePlay } from "./player";
import { hasPass, loadPass, savePass, setServiceFound } from "./service";
import managedStyle from "./styles.css?managed";

// AgentDisc read aloud: a small play button beside the name on every message (and
// "Read aloud" in its right-click menu) reads everything shown under that name in an
// AI voice, with a play bar above the message box (Stephane, 29 Sept: "every message,
// whether it's mine, Claude Code's, or any other message, even if it's in several
// parts, to have a play button"). The voice comes from the owner's own voice service (a small
// Cloudflare service that holds the Google voice key); this app only holds its address and a
// private pass, kept in this browser's storage.

function PassSetting() {
    const [saved, setSaved] = useState(hasPass());
    const [value, setValue] = useState("");
    useEffect(() => { void loadPass().then(setSaved); }, []);
    return (
        <div className="agentdisc-voice-pass">
            <span>Voice pass: {saved ? "saved in this browser ✓" : "missing"}</span>
            <input type="password" placeholder="Paste a new pass" value={value} onChange={e => setValue(e.currentTarget.value)} />
            <Button size="small" disabled={value.trim().length < 20} onClick={async () => { await savePass(value); setValue(""); setSaved(true); }}>Save</Button>
            {saved && <Button size="small" variant="secondary" onClick={async () => { await savePass(null); setSaved(false); }}>Forget</Button>}
        </div>
    );
}

const settings = definePluginSettings({
    voice: {
        type: OptionType.STRING,
        description: "Voice for every agent (a Google voice name)",
        default: "en-us-concierge-1"
    },
    agentVoices: {
        type: OptionType.STRING,
        description: "Own voice per agent, as agent account id=voice; separated by ; (empty: the voice above for all)",
        default: ""
    },
    wordList: {
        type: OptionType.STRING,
        description: "How to say names: word=spoken form; separated by ;",
        default: "AgentDisc=Agent Disc; Vencord=Ven cord"
    },
    service: {
        type: OptionType.STRING,
        description: "Voice service address (your own, see the setup guide)",
        default: ""
    },
    pass: {
        type: OptionType.COMPONENT,
        component: PassSetting
    }
});

function voiceFor(agentId: string) {
    for (const pair of settings.store.agentVoices.split(";")) {
        const [id, voice] = pair.split("=").map(s => s.trim());
        if (id === agentId && voice) return voice;
    }
    return settings.store.voice.trim() || "en-us-concierge-1";
}

function readAloud(message: Message) {
    const { text, messages } = answerText(message, settings.store.wordList);
    play({ agent: agentName(message), text, messageIds: messages.map(m => m.id), key: messages[0]?.id ?? message.id, service: settings.store.service, voice: voiceFor(message.author.id) });
}

// Any message with words in it, from anyone; progress cards are left out.
const readable = (m: Message | undefined) => Boolean(m?.author && (m.content?.trim() || m.embeds?.length) && !isCard(m));

function SpeakerIcon(props: { className?: string; height?: number | string; width?: number | string; }) {
    return (
        <svg className={props.className} width={props.width ?? 20} height={props.height ?? 20} viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M3 10v4a1 1 0 0 0 1 1h3l4 4a.8.8 0 0 0 1.4-.6V5.6A.8.8 0 0 0 11 5L7 9H4a1 1 0 0 0-1 1zm13.5 2A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z" />
        </svg>
    );
}

function PlayIcon() {
    return (
        <svg width="10" height="10" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z" />
        </svg>
    );
}

function PauseIcon() {
    return (
        <svg width="10" height="10" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="M6 4h4v16H6zm8 0h4v16h-4z" />
        </svg>
    );
}

// The small play button beside the name and time of a message. While its message is
// loading it turns (Stephane, 29 Sept: "I clicked several times because I thought
// nothing was happening"); while it plays it shows pause, and a click pauses instead
// of starting again.
function PlayButton({ message }: { message: Message; }) {
    const [v, setV] = useState(getView());
    useEffect(() => subscribe(() => setV(getView())), []);
    const mine = v.open && v.key === message.id;
    const loading = mine && v.waiting && v.playing;
    const playing = mine && v.playing && !v.waiting;
    return (
        <button
            type="button"
            className={"agentdisc-voice-play" + (loading ? " agentdisc-voice-play-loading" : "")}
            aria-label={loading ? "Loading the voice" : playing ? "Pause" : "Read aloud"}
            title={loading ? "Loading the voice…" : playing ? "Pause" : "Read aloud"}
            onClick={e => {
                e.stopPropagation();
                if (mine) togglePlay();
                else readAloud(message);
            }}
        >
            {loading ? <Spinner size={12} /> : playing ? <PauseIcon /> : <PlayIcon />}
        </button>
    );
}

const messageMenu: NavContextMenuPatchCallback = (children, { message }: { message?: Message; }) => {
    if (!readable(message)) return;
    children.push(
        <Menu.MenuGroup>
            <Menu.MenuItem id="agentdisc-read-aloud" label="Read aloud" icon={SpeakerIcon} action={() => readAloud(message!)} />
        </Menu.MenuGroup>
    );
};

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLDivElement | null = null;

export default definePlugin({
    name: "AgentDiscVoice",
    description: "Reads any message aloud in an AI voice: a small play button beside the name, a play bar above the message box.",
    // The play button sits in the message header through this helper.
    dependencies: ["MessageDecorationsAPI"],
    authors: [{ name: "Steph", id: 0n }],
    enabledByDefault: true,
    settings,
    managedStyle,

    contextMenus: {
        "message": messageMenu
    },

    // The "Read aloud" group of the AgentDisc button menu.
    toolboxActions() {
        const [open, setOpen] = useState(getView().open);
        useEffect(() => subscribe(() => setOpen(getView().open)), []);
        return open ? [<Menu.MenuItem key="stop" id="agentdisc-stop-reading" label="Stop reading" action={close} />] : [];
    },

    start() {
        // A service address found beside the app fills an empty setting once.
        setServiceFound(address => { if (!settings.store.service.trim()) settings.store.service = address; });
        void loadPass();
        startClickToRead();
        addMessageDecoration("agentdisc-play", ({ message }) => readable(message) ? <PlayButton message={message!} /> : null);
        host = document.createElement("div");
        host.id = "agentdisc-voice-root";
        (document.body ?? document.documentElement).append(host);
        root = createRoot(host);
        root.render(<ErrorBoundary noop><PlayBar /></ErrorBoundary>);
    },

    stop() {
        removeMessageDecoration("agentdisc-play");
        stopClickToRead();
        close();
        root?.unmount();
        root = null;
        host?.remove();
        host = null;
    }
});
