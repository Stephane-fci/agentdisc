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

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";
import { Popout, useRef, useState } from "@webpack/common";
import type { PropsWithChildren } from "react";

import { renderPopout } from "./menu";

const HeaderBarIcon = findComponentByCodeLazy(".HEADER_BAR_BADGE_BOTTOM,", 'position:"bottom"');

export const settings = definePluginSettings({
    showPluginMenu: {
        type: OptionType.BOOLEAN,
        default: true,
        description: "Show the plugins menu in the toolbox",
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
        {
            find: '?"BACK_FORWARD_NAVIGATION":',
            replacement: {
                match: /(trailing:.{0,50}?)\i\.Fragment,(?=\{children:\[)/,
                replace: "$1$self.TrailingWrapper,"
            }
        }
    ],

    TrailingWrapper({ children }: PropsWithChildren) {
        return (
            <>
                {children}
                <ErrorBoundary key="vc-toolbox" noop>
                    <VencordPopoutButton />
                </ErrorBoundary>
            </>
        );
    },
});
