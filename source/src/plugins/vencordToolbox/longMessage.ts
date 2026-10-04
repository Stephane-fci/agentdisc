/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Channel } from "@vencord/discord-types";
import { ComponentDispatch, DraftType, UploadHandler } from "@webpack/common";

// A message over Discord's length limit (Stephane, 4 Oct): Enter attaches it as message.txt
// at once, the way the "Upload" button of Discord's "message too long" window does, instead
// of opening that window. He then sends it with Enter as usual.
export function attachLongMessage(channel: Channel, content: string) {
    const file = new File([content], "message.txt", { type: "text/plain" });
    UploadHandler.promptToUpload([file], channel, DraftType.ChannelMessage);
    ComponentDispatch.dispatchToLastSubscribed("CLEAR_TEXT");
}
