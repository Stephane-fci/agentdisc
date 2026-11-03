/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { isPluginEnabled } from "@api/PluginManager";
import { holdOpenThread, togglePin, togglePriority, usePinned, usePriority } from "@plugins/channelGroups";
import { findComponentByCodeLazy } from "@webpack";
import { useEffect } from "@webpack/common";

const HeaderBarIcon = findComponentByCodeLazy(".HEADER_BAR_BADGE_BOTTOM,", 'position:"bottom"');

export function BookmarkButton({ channelId, shortcut = true }: { channelId: string; shortcut?: boolean; }) {
    const on = usePriority(channelId);
    return (
        <HeaderBarIcon
            className="vc-toolbox-btn"
            onClick={() => togglePriority(channelId)}
            tooltip={(on ? "Remove bookmark" : "Bookmark") + (shortcut ? " (Ctrl+B)" : "")}
            selected={on}
            icon={() => (
                <svg viewBox="0 0 24 24" width={20} height={20} className="vc-toolbox-icon" aria-hidden="true">
                    <path d="M5 21V4m0 0h11.5l-2 4 2 4H5" fill={on ? "#f23f43" : "none"} stroke={on ? "#f23f43" : "currentColor"} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                </svg>
            )}
        />
    );
}

export function PinButton({ channelId }: { channelId: string; }) {
    const on = usePinned(channelId);
    return (
        <HeaderBarIcon
            className="vc-toolbox-btn"
            onClick={() => togglePin(channelId)}
            tooltip={on ? "Unpin thread" : "Pin thread"}
            selected={on}
            icon={() => (
                <svg viewBox="0 0 24 24" width={20} height={20} className="vc-toolbox-icon" aria-hidden="true">
                    <path d="M9 3h6l-1 7 4 4v2H6v-2l4-4-1-7ZM12 16v6" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                </svg>
            )}
        />
    );
}

// The sidebar supplies its own thread. SelectedChannelStore can still point to the main
// channel beside it, so these controls must never infer their target from the selection.
export function ThreadMarkButtons({ channel }: { channel: { id: string; isThread(): boolean; }; }) {
    const enabled = !!channel?.isThread?.() && isPluginEnabled("ChannelGroups");
    useEffect(() => enabled ? holdOpenThread(channel.id) : undefined, [enabled, channel?.id]);
    if (!enabled) return null;
    return <><PinButton channelId={channel.id} /><BookmarkButton channelId={channel.id} shortcut={false} /></>;
}
