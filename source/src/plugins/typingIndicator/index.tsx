/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2022 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import "./style.css";

import { isPluginEnabled } from "@api/PluginManager";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import TypingTweaksPlugin, { buildSeveralUsers } from "@plugins/typingTweaks";
import { Devs } from "@utils/constants";
import { getIntlMessage } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";
import { ActiveJoinedThreadsStore, GuildMemberStore, Menu, RelationshipStore, SelectedChannelStore, Tooltip, TypingStore, UserGuildSettingsStore, UserStore, UserSummaryItem, useStateFromStores } from "@webpack/common";

const ThreeDots = findComponentByCodeLazy("Math.min(1,Math.max(", "dotRadius:");

const enum IndicatorMode {
    Dots = 1 << 0,
    Avatars = 1 << 1
}

function getDisplayName(guildId: string, userId: string) {
    const user = UserStore.getUser(userId);
    return GuildMemberStore.getNick(guildId, userId) ?? (user as any).globalName ?? user.username;
}

function TypingIndicator({ channelId, guildId }: { channelId: string; guildId: string; }) {
    const typingUsers: Record<string, number> = useStateFromStores(
        [TypingStore],
        () => ({ ...TypingStore.getTypingUsers(channelId) }),
        null,
        (old, current) => {
            const oldKeys = Object.keys(old);
            const currentKeys = Object.keys(current);

            return oldKeys.length === currentKeys.length && currentKeys.every(key => old[key] != null);
        }
    );
    const currentChannelId = useStateFromStores([SelectedChannelStore], () => SelectedChannelStore.getChannelId());

    if (!settings.store.includeMutedChannels) {
        const isChannelMuted = UserGuildSettingsStore.isChannelMuted(guildId, channelId);
        if (isChannelMuted) return null;
    }

    if (!settings.store.includeCurrentChannel) {
        if (currentChannelId === channelId) return null;
    }

    const myId = UserStore.getCurrentUser()?.id;

    const typingUsersArray = Object.keys(typingUsers).filter(id =>
        id !== myId && !(RelationshipStore.isBlocked(id) && !settings.store.includeBlockedUsers) && !(RelationshipStore.isIgnored(id) && !settings.store.includeIgnoredUsers)
    );
    const [a, b, c] = typingUsersArray;
    let tooltipText: string;

    switch (typingUsersArray.length) {
        case 0: break;
        case 1: {
            tooltipText = getIntlMessage("ONE_USER_TYPING", { a: getDisplayName(guildId, a) });
            break;
        }
        case 2: {
            tooltipText = getIntlMessage("TWO_USERS_TYPING", { a: getDisplayName(guildId, a), b: getDisplayName(guildId, b) });
            break;
        }
        case 3: {
            tooltipText = getIntlMessage("THREE_USERS_TYPING", { a: getDisplayName(guildId, a), b: getDisplayName(guildId, b), c: getDisplayName(guildId, c) });
            break;
        }
        default: {
            tooltipText = isPluginEnabled(TypingTweaksPlugin.name)
                ? buildSeveralUsers({ users: [a, b].map(UserStore.getUser), count: typingUsersArray.length - 2, guildId })
                : getIntlMessage("SEVERAL_USERS_TYPING");
            break;
        }
    }

    if (typingUsersArray.length > 0) {
        return (
            <Tooltip text={tooltipText!}>
                {props => (
                    <div className="vc-typing-indicator" {...props}>
                        {((settings.store.indicatorMode & IndicatorMode.Avatars) === IndicatorMode.Avatars) && (
                            <div
                                onClick={e => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                }}
                                onKeyPress={e => e.stopPropagation()}
                            >
                                <UserSummaryItem
                                    users={typingUsersArray.map(id => UserStore.getUser(id))}
                                    guildId={guildId}
                                    renderIcon={false}
                                    max={3}
                                    showDefaultAvatarsForNullUsers
                                    showUserPopout
                                    size={16}
                                    className="vc-typing-indicator-avatars"
                                />
                            </div>
                        )}
                        {((settings.store.indicatorMode & IndicatorMode.Dots) === IndicatorMode.Dots) && (
                            <div className="vc-typing-indicator-dots">
                                <ThreeDots dotRadius={3} themed={true} />
                            </div>
                        )}
                    </div>
                )}
            </Tooltip>
        );
    }

    return null;
}

// On a channel line: a small thread sign with the number of its open threads
// where someone is typing right now. The channel's own dots stay for typing in
// the channel itself, so the two never mix.
function BusyThreads({ channelId, guildId }: { channelId: string; guildId: string; }) {
    const busyNames: string[] = useStateFromStores(
        [ActiveJoinedThreadsStore, TypingStore],
        () => {
            if (!guildId) return [];
            const myId = UserStore.getCurrentUser()?.id;
            const threads = ActiveJoinedThreadsStore.getActiveJoinedThreadsForParent(guildId, channelId) ?? {};
            const names: string[] = [];
            for (const { channel } of Object.values(threads)) {
                const typing = Object.keys(TypingStore.getTypingUsers(channel.id) ?? {}).filter(id =>
                    id !== myId && !(RelationshipStore.isBlocked(id) && !settings.store.includeBlockedUsers) && !(RelationshipStore.isIgnored(id) && !settings.store.includeIgnoredUsers)
                );
                if (typing.length > 0) names.push(channel.name);
            }
            return names;
        },
        [channelId, guildId],
        (old, current) => old.length === current.length && old.every((name, i) => name === current[i])
    );

    if (!settings.store.showBusyThreads) return null;
    if (!settings.store.includeMutedChannels && UserGuildSettingsStore.isChannelMuted(guildId, channelId)) return null;
    if (busyNames.length === 0) return null;

    const tooltipText = (busyNames.length === 1 ? "Thread busy: " : "Threads busy: ") + busyNames.join(", ");

    return (
        <Tooltip text={tooltipText}>
            {props => (
                <div className="vc-busy-threads" {...props}>
                    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                        <path fill="currentColor" d="M4 3a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h1v3.5a.5.5 0 0 0 .85.35L9.7 16H14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H4Z" />
                        <path fill="currentColor" d="M18 8v6a4 4 0 0 1-4 4h-3.1l-1.55 1.55A2 2 0 0 0 11 20h3.3l3.85 3.85a.5.5 0 0 0 .85-.35V20h1a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-2Z" opacity=".6" />
                    </svg>
                    <span>{busyNames.length}</span>
                </div>
            )}
        </Tooltip>
    );
}

const settings = definePluginSettings({
    showBusyThreads: {
        type: OptionType.BOOLEAN,
        description: "Show a sign on a channel when some of its threads are busy",
        default: true
    },
    includeCurrentChannel: {
        type: OptionType.BOOLEAN,
        description: "Whether to show the typing indicator for the currently selected channel",
        default: true
    },
    includeMutedChannels: {
        type: OptionType.BOOLEAN,
        description: "Whether to show the typing indicator for muted channels.",
        default: false
    },
    includeIgnoredUsers: {
        type: OptionType.BOOLEAN,
        description: "Whether to show the typing indicator for ignored users.",
        default: false
    },
    includeBlockedUsers: {
        type: OptionType.BOOLEAN,
        description: "Whether to show the typing indicator for blocked users.",
        default: false
    },
    indicatorMode: {
        type: OptionType.SELECT,
        description: "How should the indicator be displayed?",
        options: [
            { label: "Avatars and animated dots", value: IndicatorMode.Dots | IndicatorMode.Avatars, default: true },
            { label: "Animated dots", value: IndicatorMode.Dots },
            { label: "Avatars", value: IndicatorMode.Avatars },
        ],
    }
});

export default definePlugin({
    name: "TypingIndicator",
    description: "Adds an indicator if someone is typing on a channel.",
    tags: ["Notifications", "Appearance", "Servers"],
    authors: [Devs.Nuckyz, Devs.fawn, Devs.Sqaaakoi],
    // On from the first start, like the other AgentDisc parts.
    enabledByDefault: true,
    settings,

    patches: [
        // Normal channel
        {
            find: "UNREAD_IMPORTANT:",
            replacement: {
                match: /\.Children\.count.+?:null(?<=,channel:(\i).+?)/,
                replace: "$&,$self.BusyThreads($1.id,$1.getGuildId()),$self.TypingIndicator($1.id,$1.getGuildId())"
            }
        },
        // Threads: dots go last, after the mention badge, like on normal channels
        {
            find: "countInVoice:",
            replacement: {
                match: /(onKeyDown:\i\.\i,children:\[\(0,\i\.jsx\)\(\i,\{thread:(\i),countInVoice:[^\]]+)\]/,
                replace: "$1,$self.TypingIndicator($2.id,$2.getGuildId())]"
            }
        }
    ],

    BusyThreads: (channelId: string, guildId: string) => (
        <ErrorBoundary noop>
            <BusyThreads channelId={channelId} guildId={guildId} />
        </ErrorBoundary>
    ),

    // The "Channel signs" group of the AgentDisc menu.
    toolboxActions() {
        const s = settings.use(["indicatorMode", "showBusyThreads", "includeMutedChannels", "includeCurrentChannel"]);
        const withAvatars = (s.indicatorMode & IndicatorMode.Avatars) === IndicatorMode.Avatars;

        return [
            <Menu.MenuCheckboxItem key="avatars" id="agentdisc-sign-avatars" label="Show who is typing (small photos)" checked={withAvatars}
                action={() => { settings.store.indicatorMode = withAvatars ? IndicatorMode.Dots : IndicatorMode.Dots | IndicatorMode.Avatars; }} />,
            <Menu.MenuCheckboxItem key="busy" id="agentdisc-sign-busy" label="Busy threads sign on channels" checked={s.showBusyThreads}
                action={() => { settings.store.showBusyThreads = !settings.store.showBusyThreads; }} />,
            <Menu.MenuCheckboxItem key="current" id="agentdisc-sign-current" label="Also on the channel I'm in" checked={s.includeCurrentChannel}
                action={() => { settings.store.includeCurrentChannel = !settings.store.includeCurrentChannel; }} />,
            <Menu.MenuCheckboxItem key="muted" id="agentdisc-sign-muted" label="Also on muted channels" checked={s.includeMutedChannels}
                action={() => { settings.store.includeMutedChannels = !settings.store.includeMutedChannels; }} />
        ];
    },

    TypingIndicator: (channelId: string, guildId: string) => (
        <ErrorBoundary noop>
            <TypingIndicator channelId={channelId} guildId={guildId} />
        </ErrorBoundary>
    ),
});
