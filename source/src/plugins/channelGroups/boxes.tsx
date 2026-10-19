/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChannelStore, createRoot, GuildChannelStore, GuildStore, NavigationRouter, RestAPI, SelectedChannelStore, SelectedGuildStore, showToast, Toasts, UserStore, useState } from "@webpack/common";
import type { Root } from "react-dom/client";

// New channel and rename (Stephane, 6 Oct): one small box in the middle of the screen,
// like the channel search. Type the name, Enter saves, Esc closes. A new channel goes in
// the category of the channel he is in and opens at once.

const CATEGORY = 4;
const TEXT = 0;

let root: Root | null = null;
let host: HTMLElement | null = null;
let shown = "";

export function closeBox() {
    root?.unmount();
    host?.remove();
    root = null;
    host = null;
    shown = "";
}

// Which box is open ("" for none), so a shortcut can close its own box again.
export function openBoxKind() {
    return shown;
}

export function showBox(node: React.ReactNode, kind = "box") {
    show(node);
    shown = kind;
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

// Categories are read from the server itself, never from a fixed list, and grouped into
// families (Stephane, 13 Oct): "🦕 Lifely", "🦕 Lifely Archive 1" and "🦕 Lifely Archive 2" are
// one family, Lifely. A family is its emoji and its name together, so two categories with the
// same name and different emojis, or the same emoji and different names, stay apart. The
// family's main category is its first one that is not an archive.
export interface CategoryFamily {
    key: string;
    emoji: string | null;
    name: string;
    label: string;
    main: any | null;
    position: number;
}

const ARCHIVE = /\barchiv(?:e|es|ed)\b.*$/iu;
const sameSign = (sign: string | null) => sign?.replace(/[\uFE0E\uFE0F]/g, "") ?? "";
const words = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function familyName(name: string) {
    const trimmed = name.trim();
    const sign = leadingSign(trimmed);
    const rest = sign ? trimmed.slice(sign.length) : trimmed;
    return rest.replace(ARCHIVE, "").replace(/^[\s\-–—_|·:]+|[\s\-–—_|·:]+$/g, "");
}

export function categoryFamilies(guildId: string): CategoryFamily[] {
    // Discord's list of categories starts with a made-up "Uncategorized" one; only real ones count.
    const categories = ((GuildChannelStore.getChannels(guildId) as any)?.[CATEGORY] ?? [])
        .map((e: any) => e.channel)
        .filter((c: any) => c && ChannelStore.getChannel(c.id)?.type === CATEGORY)
        .sort((a: any, b: any) => a.position - b.position);
    const families = new Map<string, CategoryFamily>();
    for (const c of categories) {
        const emoji = leadingSign(c.name.trim());
        const name = familyName(c.name);
        const key = `${sameSign(emoji)}|${words(name)}`;
        let family = families.get(key);
        if (!family) families.set(key, family = { key, emoji, name, label: "", main: null, position: c.position });
        if (!family.main && !ARCHIVE.test(c.name)) {
            family.main = c;
            family.position = c.position;
        }
    }
    return [...families.values()]
        .map(f => ({ ...f, label: f.main?.name ?? [f.emoji, f.name].filter(Boolean).join(" ") }))
        .sort((a, b) => a.position - b.position);
}

// The family a channel belongs in: the one with the channel's emoji (the best name match
// when several share it), or, for a name without an emoji, the family whose name it holds.
function familyForName(name: string, families: CategoryFamily[]) {
    const emoji = leadingEmoji(name);
    const channelWords = ` ${words(name)} `;
    const score = (f: CategoryFamily) => words(f.name).split(" ").filter(w => w && channelWords.includes(` ${w} `)).length;
    if (emoji) {
        const same = families.filter(f => sameSign(f.emoji) === emoji);
        return same.reduce<CategoryFamily | null>((best, f) => !best || score(f) > score(best) ? f : best, null);
    }
    return families
        .filter(f => words(f.name) && channelWords.includes(` ${words(f.name)} `))
        .sort((a, b) => words(b.name).length - words(a.name).length)[0] ?? null;
}

// A channel name as Discord writes it: small letters, a hyphen for each space (13 Oct).
export function toChannelName(text: string) {
    return text.toLowerCase().replace(/\s+/g, "-");
}

// The emoji a name starts with, exactly as written (with its variation sign), or null.
function leadingSign(name: string): string | null {
    const first = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(name)[Symbol.iterator]().next().value?.segment;
    return first && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(first) ? first : null;
}

// A new channel never goes into a category: it lands at the bottom of the channels above the
// categories (Stephane, 13 Oct: "avoid going into the category and instead appear at the
// bottom"); Ctrl+K moves it in later. Picking a category in the box only puts that category's
// emoji at the start of the name, like his other channels; "No category" takes it off again.
// Archive categories are not offered.
function NewChannelBox({ guildId, families, initial }: { guildId: string; families: CategoryFamily[]; initial: string; }) {
    const [name, setName] = useState(toChannelName(initial));
    const [categoryId, setCategoryId] = useState<string | null>(null);
    const [added, setAdded] = useState<string | null>(null);

    function pickCategory(id: string | null) {
        const sign = id ? families.find(f => f.key === id)?.emoji ?? null : null;
        let rest = name;
        const own = leadingSign(rest);
        // The emoji this box put there goes; so does his own one when a category brings another.
        if (own && (own === added || sign)) rest = rest.slice(own.length).replace(/^-/, "");
        setName(sign ? `${sign}-${rest}` : rest);
        setAdded(sign);
        setCategoryId(id);
    }
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    async function submit() {
        const clean = name.trim();
        if (!clean || busy) return;
        setBusy(true);
        setError("");
        try {
            const { body } = await RestAPI.post({
                url: `/guilds/${guildId}/channels`,
                body: { type: TEXT, name: clean, position: lastLoosePosition(guildId) + 1 }
            });
            closeBox();
            if (body?.id) NavigationRouter.transitionTo(`/channels/${guildId}/${body.id}`);
        } catch (e) {
            setError(errorText(e));
            setBusy(false);
        }
    }

    const keys = (e: React.KeyboardEvent) => {
        if (e.key === "Escape") { e.preventDefault(); closeBox(); }
        else if (e.key === "Enter") { e.preventDefault(); submit(); }
        e.stopPropagation();
    };

    return (
        <div className="agentdisc-find-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) closeBox(); }}>
            <div className="agentdisc-find agentdisc-namebox" role="dialog" aria-label="New channel">
                <div className="agentdisc-namebox-title">New channel</div>
                <input
                    className="agentdisc-find-input"
                    placeholder="channel-name"
                    value={name}
                    autoFocus
                    disabled={busy}
                    onChange={e => setName(toChannelName(e.currentTarget.value))}
                    onKeyDown={keys}
                />
                {families.length > 0 && <label className="agentdisc-namebox-field">
                    <span>Category emoji</span>
                    <select
                        className="agentdisc-namebox-select"
                        value={categoryId ?? ""}
                        disabled={busy}
                        onChange={e => pickCategory(e.currentTarget.value || null)}
                        onKeyDown={keys}
                    >
                        <option value="">No category</option>
                        {families.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                </label>}
                <div className={"agentdisc-find-note" + (error ? " agentdisc-namebox-error" : "")}>
                    {error || (busy ? "Saving…" : "Enter creates it at the bottom of the channels with no category. Esc closes.")}
                </div>
            </div>
        </div>
    );
}

// The highest place among the text channels above the categories, so a new one goes after them.
function lastLoosePosition(guildId: string) {
    const loose = ((GuildChannelStore.getChannels(guildId) as any)?.SELECTABLE ?? [])
        .map((e: any) => e.channel)
        .filter((c: any) => c && !c.parent_id);
    return loose.reduce((top: number, c: any) => Math.max(top, c.position ?? 0), 0);
}

// The name typed in Ctrl+O, if any. Used as a click handler it receives the click, which is
// not a name (13 Oct: the plus square broke that way).
export function openNewChannel(initial: unknown = "") {
    const typed = typeof initial === "string" ? initial : "";
    const current = ChannelStore.getChannel(SelectedChannelStore.getChannelId());
    const guildId = current?.guild_id ?? SelectedGuildStore.getGuildId();
    if (!guildId) {
        showToast("Open a server first, then create the channel.", Toasts.Type.FAILURE);
        return;
    }
    // Only families with an emoji: picking one puts its emoji in the name, which is all it does.
    show(<NewChannelBox guildId={guildId} families={categoryFamilies(guildId).filter(f => f.emoji)} initial={typed} />);
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

// Ctrl+K (Stephane, 6 Oct): a channel outside any category goes into the main category of its
// family (same emoji, or its name for a server without emojis, 13 Oct), first in it; a channel
// in a category comes out of it, last of the channels above the categories (7 Oct). In a
// thread, its channel moves.
function leadingEmoji(name: string): string | null {
    const first = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(name.trim())[Symbol.iterator]().next().value?.segment;
    if (!first || !/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(first)) return null;
    return first.replace(/[\uFE0E\uFE0F]/g, "");
}

// Discord's own order of a list: by position, then the older channel first.
const byPlace = (a: any, b: any) => (a.position ?? 0) - (b.position ?? 0) || a.id.length - b.id.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// A channel he has just bookmarked moves to the end of the bookmarked channels of its own
// list (Stephane, 19 Oct: "I want it to be moved automatically at the end of the bookmarked
// channels"): right under the last bookmarked one, or to the top of its list when none is.
// It stays in its category, or out of any. Only in servers he owns: in a client's server,
// moving a channel would change everybody's list there.
export async function moveAfterBookmarks(channelId: string, isBookmarked: (id: string) => boolean) {
    const channel = ChannelStore.getChannel(channelId);
    if (!channel?.guild_id || channel.isThread?.() || channel.type === CATEGORY) return;
    const guild = GuildStore.getGuild(channel.guild_id);
    if (!guild || guild.ownerId !== UserStore.getCurrentUser()?.id) return;
    const lists = GuildChannelStore.getChannels(guild.id) as any;
    const records = (entries: any[] | undefined) => (entries ?? []).map(e => e.channel).filter(Boolean);
    const selectable = records(lists?.SELECTABLE);
    // Text channels and voice channels are ordered apart; the channel moves among its own kind.
    const group = selectable.some(c => c.id === channel.id) ? selectable : records(lists?.VOCAL);
    const parentId = channel.parent_id ?? null;
    const row = group.filter(c => (c.parent_id ?? null) === parentId).sort(byPlace);
    const others = row.filter(c => c.id !== channel.id);
    let at = 0;
    others.forEach((c, i) => { if (isBookmarked(c.id)) at = i + 1; });
    const order = [...others.slice(0, at), channel, ...others.slice(at)];
    if (order.every((c, i) => c.id === row[i]?.id)) return;
    const changes = order.map((c, i) => ({ c, i })).filter(({ c, i }) => c.position !== i).map(({ c, i }) => ({ id: c.id, position: i }));
    try {
        await RestAPI.patch({ url: `/guilds/${guild.id}/channels`, body: changes });
    } catch (e) {
        showToast(`Bookmarked, but it could not move up: ${errorText(e)}`, Toasts.Type.FAILURE);
    }
}

export async function tidyChannel(): Promise<boolean> {
    const open = ChannelStore.getChannel(SelectedChannelStore.getChannelId());
    const channel = open?.isThread?.() ? ChannelStore.getChannel(open.parent_id) : open;
    if (!channel?.guild_id || channel.type === CATEGORY) return false;
    const guildId = channel.guild_id;
    const lists = GuildChannelStore.getChannels(guildId) as any;
    const records = (entries: any[] | undefined) => (entries ?? []).map(e => e.channel).filter(Boolean);
    const selectable = records(lists?.SELECTABLE);
    // Text channels and voice channels are ordered apart; the channel moves among its own kind.
    const group = selectable.some(c => c.id === channel.id) ? selectable : records(lists?.VOCAL);

    let category: any = null;
    if (!channel.parent_id) {
        const family = familyForName(channel.name, categoryFamilies(guildId));
        category = family?.main ?? null;
        if (!category) {
            const emoji = leadingEmoji(channel.name);
            showToast(family ? `Only archive categories for ${family.label}.` : emoji ? `No category starts with ${emoji}.` : "No category matches this channel's name.", Toasts.Type.FAILURE);
            return true;
        }
    }

    const parentId = category?.id ?? null;
    const others = group
        .filter(c => c.id !== channel.id && (c.parent_id ?? null) === parentId)
        .sort((a, b) => a.position - b.position);
    try {
        await RestAPI.patch({
            url: `/guilds/${guildId}/channels`,
            // Into a category: first in it. Out of one: last of the channels above the
            // categories (Stephane, 7 Oct), not first.
            body: category
                ? [{ id: channel.id, parent_id: parentId, position: 0, lock_permissions: false }, ...others.map((c, i) => ({ id: c.id, position: i + 1 }))]
                : [...others.map((c, i) => ({ id: c.id, position: i })), { id: channel.id, parent_id: null, position: others.length, lock_permissions: false }]
        });
        showToast(category ? `Moved into ${category.name}` : "Moved out of its category", Toasts.Type.SUCCESS);
    } catch (e) {
        showToast(`Could not move it: ${errorText(e)}`, Toasts.Type.FAILURE);
    }
    return true;
}
