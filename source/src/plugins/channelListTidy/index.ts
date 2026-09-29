/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin from "@utils/types";

// Stephane's own tidy-up of the channel list: the invite and settings buttons
// that appear when hovering a channel are gone (right-click still has both).
export default definePlugin({
    name: "ChannelListTidy",
    description: "Hides the invite and settings buttons that appear when hovering a channel. Right-click still offers both.",
    authors: [{ name: "Steph", id: 0n }],
    enabledByDefault: true,
    patches: [{
        find: "renderInviteButton(){return",
        replacement: [
            {
                match: /renderInviteButton\(\)\{return/,
                replace: "renderInviteButton(){return null;return"
            },
            {
                match: /renderEditButton\(\)\{return/,
                replace: "renderEditButton(){return null;return"
            }
        ]
    }]
});
