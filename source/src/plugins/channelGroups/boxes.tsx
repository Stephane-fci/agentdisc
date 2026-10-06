/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChannelStore, createRoot, NavigationRouter, RestAPI, SelectedChannelStore, SelectedGuildStore, showToast, Toasts, useState } from "@webpack/common";
import type { Root } from "react-dom/client";

// New channel and rename (Stephane, 6 Oct): one small box in the middle of the screen,
// like the channel search. Type the name, Enter saves, Esc closes. A new channel goes in
// the category of the channel he is in and opens at once.

const CATEGORY = 4;
const TEXT = 0;

let root: Root | null = null;
let host: HTMLElement | null = null;

export function closeBox() {
    root?.unmount();
    host?.remove();
    root = null;
    host = null;
}

function show(node: React.ReactNode) {
    closeBox();
    host = document.createElement("div");
    host.className = "agentdisc-box-host";
    document.body.append(host);
    root = createRoot(host);
    root.render(node);
}

function errorText(e: any) {
    const body = e?.body;
    const field = body?.errors?.name?._errors?.[0]?.message;
    return field ?? body?.message ?? e?.message ?? "Discord did not accept it.";
}

function NameBox({ title, initial, placeholder, save }: { title: string; initial: string; placeholder: string; save(name: string): Promise<void>; }) {
    const [value, setValue] = useState(initial);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    async function submit() {
        const name = value.trim();
        if (!name || busy) return;
        setBusy(true);
        setError("");
        try {
            await save(name);
            closeBox();
        } catch (e) {
            setError(errorText(e));
            setBusy(false);
        }
    }

    return (
        <div className="agentdisc-find-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) closeBox(); }}>
            <div className="agentdisc-find agentdisc-namebox" role="dialog" aria-label={title}>
                <div className="agentdisc-namebox-title">{title}</div>
                <input
                    className="agentdisc-find-input"
                    placeholder={placeholder}
                    value={value}
                    autoFocus
                    disabled={busy}
                    onFocus={e => e.currentTarget.select()}
                    onChange={e => setValue(e.currentTarget.value)}
                    onKeyDown={e => {
                        if (e.key === "Escape") { e.preventDefault(); closeBox(); }
                        else if (e.key === "Enter") { e.preventDefault(); submit(); }
                        e.stopPropagation();
                    }}
                />
                <div className={"agentdisc-find-note" + (error ? " agentdisc-namebox-error" : "")}>
                    {error || (busy ? "Saving…" : "Enter saves, Esc closes.")}
                </div>
            </div>
        </div>
    );
}

// The category a new channel goes in: the one of the channel (or thread's channel) open now.
function currentCategory(channel: any) {
    const base = channel?.isThread?.() ? ChannelStore.getChannel(channel.parent_id) : channel;
    if (!base) return null;
    if (base.type === CATEGORY) return base;
    return base.parent_id ? ChannelStore.getChannel(base.parent_id) : null;
}

export function openNewChannel() {
    const current = ChannelStore.getChannel(SelectedChannelStore.getChannelId());
    const guildId = current?.guild_id ?? SelectedGuildStore.getGuildId();
    if (!guildId) {
        showToast("Open a server first, then create the channel.", Toasts.Type.FAILURE);
        return;
    }
    const category = currentCategory(current);
    show(
        <NameBox
            title={category ? `New channel in ${category.name}` : "New channel"}
            initial=""
            placeholder="Channel name"
            save={async name => {
                const { body } = await RestAPI.post({
                    url: `/guilds/${guildId}/channels`,
                    body: { type: TEXT, name, ...(category ? { parent_id: category.id } : {}) }
                });
                if (body?.id) NavigationRouter.transitionTo(`/channels/${guildId}/${body.id}`);
            }}
        />
    );
}

// Renames the channel or thread open now. False when there is nothing to rename (a DM).
export function openRename(): boolean {
    const channel = ChannelStore.getChannel(SelectedChannelStore.getChannelId());
    if (!channel?.guild_id || channel.type === CATEGORY) return false;
    const thread = channel.isThread?.();
    show(
        <NameBox
            title={thread ? "Rename thread" : "Rename channel"}
            initial={channel.name}
            placeholder={thread ? "Thread name" : "Channel name"}
            save={async name => {
                if (name === channel.name) return;
                await RestAPI.patch({ url: `/channels/${channel.id}`, body: { name } });
            }}
        />
    );
    return true;
}
