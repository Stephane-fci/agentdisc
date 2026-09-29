/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Message } from "@vencord/discord-types";
import { ChannelStore, GuildMemberStore, GuildRoleStore, MessageStore, UserStore } from "@webpack/common";

import { cleanText, isNoise, Names, parseWordList } from "./clean";

// One message to read = everything Discord shows under one name: the same author's
// messages in a row, nobody else in between, as Discord groups them (up to seven
// minutes apart, a reply starts a new group), plus the parts of one long answer
// (sent within a minute, even when each part is a reply). Progress cards left out.
// Text comes from Discord's stored messages, never from the screen, so names,
// times, "edited" and reply previews are never read.

const PARTS_MS = 60_000;
const GROUP_MS = 7 * 60_000;
const REPLY = 19;
// Ordinary messages, replies and command answers; anything else is a system line.
const CONVERSATION_TYPES = new Set([0, 19, 20, 23]);

function time(m: Message) {
    return new Date(m.timestamp as any).getTime();
}

function textOf(m: Message) {
    if (m.content?.trim()) return m.content;
    // An answer posted as a rich card: read its title and text, never link previews.
    const card = m.embeds?.find((e: any) => e?.type === "rich" && (e.rawDescription || e.rawTitle));
    return card ? [(card as any).rawTitle, (card as any).rawDescription].filter(Boolean).join("\n") : "";
}

// A progress card or account note (a message with only a file is not a card: it can sit inside an answer).
export function isCard(m: Message) {
    return Boolean(m.content?.trim()) && isNoise(m.content);
}

export function isAgent(m: Message | undefined) {
    return Boolean(m?.author?.bot);
}

export function agentName(m: Message) {
    const guildId = ChannelStore.getChannel(m.channel_id)?.guild_id;
    return (guildId && GuildMemberStore.getNick(guildId, m.author.id))
        || (m.author as any).globalName || m.author.username || "Agent";
}

export function answerMessages(clicked: Message): Message[] {
    const list: Message[] = (MessageStore.getMessages(clicked.channel_id) as any)?._array ?? [];
    const at = list.findIndex(m => m.id === clicked.id);
    if (at < 0) return [clicked];

    const sameAuthor = (m: Message) => m.author?.id === clicked.author.id && CONVERSATION_TYPES.has(m.type as number);
    // Does "later" continue the text of "earlier"?
    const joins = (earlier: Message, later: Message) => {
        if (!sameAuthor(earlier) || !sameAuthor(later) || isCard(earlier) || isCard(later)) return false;
        const gap = time(later) - time(earlier);
        return gap <= PARTS_MS || (gap <= GROUP_MS && later.type !== REPLY);
    };

    let first = at, last = at;
    while (first > 0 && joins(list[first - 1], list[first])) first--;
    while (last < list.length - 1 && joins(list[last], list[last + 1])) last++;
    return list.slice(first, last + 1);
}

function names(channelId: string): Names {
    const guildId = ChannelStore.getChannel(channelId)?.guild_id;
    return {
        user(id) {
            const nick = guildId ? GuildMemberStore.getNick(guildId, id) : null;
            const u = UserStore.getUser(id) as any;
            return nick || u?.globalName || u?.username || null;
        },
        channel(id) {
            return ChannelStore.getChannel(id)?.name ?? null;
        },
        role(id) {
            return guildId ? GuildRoleStore.getRole(guildId, id)?.name ?? null : null;
        },
    };
}

export function answerText(clicked: Message, wordList: string) {
    const messages = answerMessages(clicked).filter(m => !isCard(m));
    // Cleaned as one text: a code block the 2,000-character cut split over two messages stays whole.
    const raw = messages.map(textOf).filter(t => t.trim()).join("\n");
    const text = cleanText(raw, names(clicked.channel_id), parseWordList(wordList));
    return { text, messages };
}
