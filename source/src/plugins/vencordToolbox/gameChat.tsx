/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { showToast, Toasts, useEffect, useRef, useState } from "@webpack/common";
import type { ComponentType } from "react";

const GameChatIcon = () => (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="2.5" y="3.5" width="19" height="17" rx="2.5" stroke="currentColor" strokeWidth="2" />
        <path d="M3 8h18M12 11v6M9 14h6M17 12h.01M19 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
);

// The isolated content script handles the real click. No channel, command or native
// argument supplied by the page is trusted; the background uses its sender tab's URL.
export function GameChatButton({ HeaderIcon }: { HeaderIcon: ComponentType<any>; }) {
    const [opening, setOpening] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        const answer = (event: MessageEvent) => {
            if (event.source !== window || event.origin !== location.origin || event.data?.type !== "AGENTDISC_GAME_CHAT_ANSWER" || !timer.current) return;
            clearTimeout(timer.current);
            timer.current = null;
            setOpening(false);
            if (!event.data.answer?.ok) showToast(event.data.answer?.error || "Game chat could not open. Try again.", Toasts.Type.FAILURE);
        };
        window.addEventListener("message", answer);
        return () => {
            window.removeEventListener("message", answer);
            if (timer.current) clearTimeout(timer.current);
        };
    }, []);
    const clicked = () => {
        if (timer.current) return;
        setOpening(true);
        timer.current = setTimeout(() => {
            timer.current = null;
            setOpening(false);
            showToast("Game chat did not answer. Reload AgentDisc and refresh this Discord page, then try again.", Toasts.Type.FAILURE);
        }, 60000);
    };
    return (
        <span data-agentdisc-game-chat="" style={{ display: "contents" }}>
            <HeaderIcon className="vc-toolbox-btn" onClick={clicked} tooltip={opening ? "Opening game chat…" : "Open game chat"} icon={GameChatIcon} selected={opening} />
        </span>
    );
}
