/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
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

import "./styles.css";

import { isPluginEnabled } from "@api/PluginManager";
import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { togglePriority, usePriority } from "@plugins/channelGroups";
import { ChannelSectionStore, isHidden, settings as panelSettings, startSearch, toggleMembers, toggleServerList } from "@plugins/panelSwitches";
import { Devs } from "@utils/constants";
import { copyWithToast } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";
import { ChannelStore, Popout, SelectedChannelStore, useEffect, useRef, useState, useStateFromStores } from "@webpack/common";
import type { PropsWithChildren } from "react";

import { startFindShortcut, stopFindShortcut, useFind } from "./channelSearch";
import { isFeedbackOn, onFeedbackChange, setFeedback, startFeedbackShortcut, stopFeedbackShortcut } from "./feedback";
import { LinksPanel } from "./links";
import { attachLongMessage } from "./longMessage";
import { renderPopout } from "./menu";
import { startChannelShortcuts, stopChannelShortcuts } from "./shortcuts";
import { startSideData, stopSideData } from "./sideData";
import { renderSidePanel, startRightPanelWidth, stopRightPanelWidth } from "./sidePanel";

const HeaderBarIcon = findComponentByCodeLazy(".HEADER_BAR_BADGE_BOTTOM,", 'position:"bottom"');

export const settings = definePluginSettings({
    showPluginMenu: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Show the plugins menu in the toolbox",
    },
    linksHideDiscord: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Links panel: hide links to Discord channels and messages",
        hidden: true
    },
    linksGroup: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Links panel: group the same link posted several times",
        hidden: true
    },
    linksHideSlack: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Links panel: hide Slack links",
        hidden: true
    },
    linksGroupVariants: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Links panel: also group links that only differ by tracking codes",
        hidden: true
    },
    mapChannels: { type: OptionType.BOOLEAN, default: true, description: "Map: show channels", hidden: true },
    mapThreads: { type: OptionType.BOOLEAN, default: true, description: "Map: show threads", hidden: true },
    mapTitles: { type: OptionType.BOOLEAN, default: true, description: "Map: show names", hidden: true },
    rightPanelWidth: {
        type: OptionType.NUMBER,
        default: 0,
        description: "Width of the right column (member list, map and calendar); 0 is Discord's own",
        hidden: true
    }
});

// AgentDisc's button: a small purple robot (Stephane, 29 Sept), a little brighter while its menu is open.
function Icon({ isShown }: { isShown: boolean; }) {
    return (
        <svg viewBox="0 0 24 24" width={20} height={20} className="vc-toolbox-icon" aria-hidden="true">
            <g fill={isShown ? "#7984f5" : "#5865f2"}>
                <rect x="11.2" y="2.2" width="1.6" height="3.4" />
                <circle cx="12" cy="2.4" r="1.9" />
                <rect x="1.2" y="10" width="2.6" height="6.6" rx="1" />
                <rect x="20.2" y="10" width="2.6" height="6.6" rx="1" />
                <rect x="3" y="5.6" width="18" height="17" rx="4" />
            </g>
            <g fill="#fff">
                <circle cx="8.3" cy="12" r="1.9" />
                <circle cx="15.7" cy="12" r="1.9" />
                <rect x="8.2" y="16.8" width="7.6" height="1.9" rx="0.95" />
            </g>
        </svg>
    );
}

// Three buttons before the inbox (Stephane, 30 Sept): search, the server list, and
// Discord's own member list switch, drawn like the top bar's other icons.
function TopIcon({ children }: PropsWithChildren) {
    return (
        <svg viewBox="0 0 24 24" width={20} height={20} className="vc-toolbox-icon" aria-hidden="true">{children}</svg>
    );
}

// The priority flag: red while the channel or thread being read is marked.
const FlagIcon = ({ on }: { on: boolean; }) => (
    <TopIcon>
        <path d="M5 21V4m0 0h11.5l-2 4 2 4H5" fill={on ? "#f23f43" : "none"} stroke={on ? "#f23f43" : "currentColor"} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </TopIcon>
);

function PriorityButton({ channelId }: { channelId: string; }) {
    const on = usePriority(channelId);
    return (
        <HeaderBarIcon className="vc-toolbox-btn" onClick={() => togglePriority(channelId)} tooltip={on ? "Remove bookmark (Ctrl+B)" : "Bookmark (Ctrl+B)"} icon={() => <FlagIcon on={on} />} selected={on} />
    );
}

const LinksIcon = () => (
    <TopIcon>
        <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </TopIcon>
);

// Every link posted in the channel being read, in a panel under the button.
function LinksButton({ channelId, guildId }: { channelId: string; guildId: string | null; }) {
    const buttonRef = useRef(null);
    const [show, setShow] = useState(false);
    const s = settings.use(["linksHideDiscord", "linksHideSlack", "linksGroup", "linksGroupVariants"]);
    const options = { hideDiscord: s.linksHideDiscord, hideSlack: s.linksHideSlack, group: s.linksGroup, groupVariants: s.linksGroupVariants };
    const setOption = (key: keyof typeof options, value: boolean) => {
        const name = { hideDiscord: "linksHideDiscord", hideSlack: "linksHideSlack", group: "linksGroup", groupVariants: "linksGroupVariants" }[key] as "linksHideDiscord";
        settings.store[name] = value;
    };
    return (
        <Popout
            position="bottom"
            align="right"
            animation={Popout.Animation.NONE}
            shouldShow={show}
            onRequestClose={() => setShow(false)}
            targetElementRef={buttonRef}
            renderPopout={() => <LinksPanel key={channelId} channelId={channelId} guildId={guildId} onClose={() => setShow(false)} options={options} setOption={setOption} />}
        >
            {(_, { isShown }) => (
                <HeaderBarIcon ref={buttonRef} className="vc-toolbox-btn" onClick={() => setShow(v => !v)} tooltip={isShown ? null : "Links in this channel"} icon={LinksIcon} selected={isShown} />
            )}
        </Popout>
    );
}

const FindIcon = () => (
    <TopIcon>
        <path d="M8.5 3 6.6 15M14.5 3l-1.2 7.4M3 7.5h15M2.4 12.5h7.4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="16" cy="16" r="3.6" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M18.7 18.7 21.5 21.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </TopIcon>
);

// Find a channel or thread by name (also Ctrl+M).
function FindButton() {
    const { open, toggle, box } = useFind();
    return (
        <>
            <HeaderBarIcon className="vc-toolbox-btn" onClick={toggle} tooltip="Find a channel in this server (Ctrl+O)" icon={FindIcon} selected={open} />
            {box}
        </>
    );
}

// Feedback mode: a speech bubble with a quote mark, orange while the mode is on.
const FeedbackIcon = ({ on }: { on: boolean; }) => (
    <TopIcon>
        <path d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9l-4.5 3.5V17H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" fill={on ? "#f08c28" : "none"} stroke={on ? "#f08c28" : "currentColor"} strokeWidth="2" strokeLinejoin="round" />
        <path d="M8.5 9.5v2.5M11.5 9.5v2.5M14.5 12h3" stroke={on ? "#fff" : "currentColor"} strokeWidth="2" strokeLinecap="round" />
    </TopIcon>
);

function FeedbackButton() {
    const [on, setOn] = useState(isFeedbackOn());
    useEffect(() => onFeedbackChange(setOn), []);
    return (
        <HeaderBarIcon className="vc-toolbox-btn" onClick={() => setFeedback(!on)} tooltip={on ? "Feedback mode on: click a paragraph to quote it (tap Ctrl: sentence or paragraph). Ctrl+L or Esc to stop" : "Feedback mode (Ctrl+L): quote paragraphs or sentences into your reply"} icon={() => <FeedbackIcon on={on} />} selected={on} />
    );
}

const SearchIcon = () => (
    <TopIcon>
        <circle cx="10.5" cy="10.5" r="6.3" fill="none" stroke="currentColor" strokeWidth="2.2" />
        <path d="M15.3 15.3 20.6 20.6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </TopIcon>
);

const ServersIcon = () => (
    <TopIcon>
        <rect x="2.5" y="3.5" width="19" height="17" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M9 4v16" stroke="currentColor" strokeWidth="2" />
        <circle cx="5.8" cy="7.6" r="1.4" fill="currentColor" />
        <circle cx="5.8" cy="12" r="1.4" fill="currentColor" />
        <circle cx="5.8" cy="16.4" r="1.4" fill="currentColor" />
    </TopIcon>
);

// The right column (member list, map and calendar): the servers icon mirrored (7 Oct).
const MembersIcon = () => (
    <TopIcon>
        <rect x="2.5" y="3.5" width="19" height="17" rx="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M15 4v16" stroke="currentColor" strokeWidth="2" />
        <path d="M17 8h2.5M17 12h2.5M17 16h2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </TopIcon>
);

// Discord shows its member switch in server channels, threads and group chats; a
// one-to-one chat and a voice channel have none.
const NO_MEMBER_LIST = new Set([1, 2, 13]);

function PanelButtons() {
    // Read the settings through the hook, so the buttons redraw when a switch changes.
    panelSettings.use(["hideServerList", "chatOnly", "chatOnlyHides", "hideChannelHeader"]);
    const membersShown = useStateFromStores([ChannelSectionStore as any], () => ChannelSectionStore.getState().isMembersOpen);
    const channelType = useStateFromStores([SelectedChannelStore, ChannelStore], () => ChannelStore.getChannel(SelectedChannelStore.getChannelId())?.type);
    const channelId = useStateFromStores([SelectedChannelStore], () => SelectedChannelStore.getChannelId());
    const guildId = useStateFromStores([SelectedChannelStore, ChannelStore], () => ChannelStore.getChannel(SelectedChannelStore.getChannelId())?.guild_id ?? null);
    const inServer = !!guildId;
    const serversShown = !isHidden("serverList");
    return (
        <>
            {inServer && channelId && isPluginEnabled("ChannelGroups") && <PriorityButton channelId={channelId} />}
            <FeedbackButton />
            <FindButton />
            <HeaderBarIcon className="vc-toolbox-btn" onClick={startSearch} tooltip="Search" icon={SearchIcon} selected={false} />
            {channelId && <LinksButton channelId={channelId} guildId={guildId} />}
            <HeaderBarIcon className="vc-toolbox-btn" onClick={toggleServerList} tooltip={serversShown ? "Hide servers" : "Show servers"} icon={ServersIcon} selected={serversShown} />
            {channelType != null && !NO_MEMBER_LIST.has(channelType) && (
                <HeaderBarIcon className="vc-toolbox-btn" onClick={toggleMembers} tooltip={membersShown ? "Hide the right panel" : "Show the right panel"} icon={MembersIcon} selected={membersShown} />
            )}
        </>
    );
}

function VencordPopoutButton() {
    const buttonRef = useRef(null);
    const [show, setShow] = useState(false);

    return (
        <Popout
            position="bottom"
            align="right"
            animation={Popout.Animation.NONE}
            shouldShow={show}
            onRequestClose={() => setShow(false)}
            targetElementRef={buttonRef}
            renderPopout={() => renderPopout(() => setShow(false))}
        >
            {(_, { isShown }) => (
                <HeaderBarIcon
                    ref={buttonRef}
                    className="vc-toolbox-btn"
                    onClick={() => setShow(v => !v)}
                    tooltip={isShown ? null : "AgentDisc"}
                    icon={() => <Icon isShown={isShown} />}
                    selected={isShown}
                />
            )}
        </Popout>
    );
}

export default definePlugin({
    name: "VencordToolbox",
    description: "Adds a button to the titlebar that houses Vencord quick actions",
    tags: ["Utility", "Developers"],
    authors: [Devs.Ven, Devs.AutumnVN],

    settings,

    patches: [
        // Ctrl+K and Ctrl+P are AgentDisc's (tidy a channel, new channel, Stephane 6 Oct):
        // Discord's quick switcher (Ctrl+O finds channels instead) and pinned messages
        // shortcuts move to keys nobody presses.
        {
            find: 'binds:["mod+k"],comboKeysBindGlobal',
            replacement: { match: /binds:\["mod\+k"\]/, replace: 'binds:["mod+shift+alt+k"]' }
        },
        {
            find: 'binds:["mod+k","mod+t"],comboKeysBindGlobal',
            replacement: { match: /binds:\["mod\+k","mod\+t"\]/, replace: 'binds:["mod+t"]' }
        },
        {
            find: 'binds:["mod+p"],comboKeysBindGlobal',
            replacement: { match: /binds:\["mod\+p"\]/, replace: 'binds:["mod+shift+alt+p"]' }
        },
        // The right panel (Stephane, 7 Oct): the map of linked channels and the calendar of
        // his days sit above the member list, inside its column.
        {
            find: "lastReportedAnalyticsChannel",
            replacement: [
                {
                    match: /(?<=render\(\)\{let\{groups:\i,listId:\i,channel:(\i),sectionHeight:\i\}=this\.props;.{0,300}?)component:(.{0,400}?)(?=,children:\(0,\i\.jsx\)\(\i\.\i,\{children:\i=>\{let\{ref:)/,
                    replace: "component:[$self.renderSidePanel($1),$2]"
                },
                {
                    // A thread's member list (Stephane, 7 Oct: the panel vanished in threads).
                    match: /(?<=\{channel:(\i),guild:\i\}=\i,\i=`members-\$\{\i\.id\}`[\s\S]{0,4000}?)children:(\(0,\i\.jsx\)\(\i\.\i,\{ref:\i,className:\i\.\i,paddingTop:0,sectionHeight:42,[\s\S]{0,3000}?\.\.\.\i,\.\.\.\i\},\i\))/,
                    replace: "children:[$self.renderSidePanel($1),$2]"
                },
                {
                    // A thread with nobody listed (an archived one, often).
                    match: /(function \i\(\i\)\{let\{channel:(\i)\}=\i;return\(0,\i\.jsxs\)\("div",\{className:\i\(\)\(\i\.\i,\i\.\i,\i\.\i,\i\.\i,\i\.\i\),children:\[)/,
                    replace: "$1$self.renderSidePanel($2),"
                }
            ]
        },
        // A message over the length limit is attached as a text file on Enter, with no window.
        {
            find: '"MESSAGE_LENGTH_UPSELL",this.handleMessageLengthUpsell',
            replacement: {
                match: /handleMessageLengthUpsell\(\i\){let{channel:(\i),content:(\i)}=\i;/,
                replace: "$&return $self.attachLongMessage($1,$2);"
            }
        },
        // No "Send longer messages with Discord Nitro!" under the message box (Stephane, 4 Oct).
        {
            find: "upsellLongMessages:{iconOnly:!1}",
            replacement: {
                match: /upsellLongMessages:\{iconOnly:!\d\}/g,
                replace: "upsellLongMessages:void 0"
            }
        },
        {
            find: '?"BACK_FORWARD_NAVIGATION":',
            replacement: {
                match: /(trailing:.{0,50}?)\i\.Fragment,(?=\{children:\[)/,
                replace: "$1$self.TrailingWrapper,"
            }
        }
    ],

    attachLongMessage,
    renderSidePanel,

    // A link icon in the bar that shows over a message copies the message's link (7 Oct).
    messagePopoverButton: {
        icon: LinksIcon,
        render(message: any) {
            const channel = ChannelStore.getChannel(message?.channel_id);
            if (!channel || !message?.id) return null;
            return {
                label: "Copy message link",
                icon: LinksIcon,
                message,
                channel,
                onClick: () => copyWithToast(`https://discord.com/channels/${channel.guild_id ?? "@me"}/${channel.id}/${message.id}`, "Message link copied")
            };
        }
    },

    start() {
        startFindShortcut();
        startFeedbackShortcut();
        startChannelShortcuts();
        startSideData();
        startRightPanelWidth();
    },

    stop() {
        stopFindShortcut();
        stopFeedbackShortcut();
        stopChannelShortcuts();
        stopSideData();
        stopRightPanelWidth();
        setFeedback(false);
    },

    TrailingWrapper({ children }: PropsWithChildren) {
        return (
            <>
                {isPluginEnabled("PanelSwitches") && (
                    <ErrorBoundary key="agentdisc-panel-buttons" noop>
                        <PanelButtons />
                    </ErrorBoundary>
                )}
                {children}
                <ErrorBoundary key="vc-toolbox" noop>
                    <VencordPopoutButton />
                </ErrorBoundary>
            </>
        );
    },
});
