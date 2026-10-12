/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IconUtils, useEffect, useReducer } from "@webpack/common";
import type { ReactNode } from "react";

// No top bar (Stephane, 12 Oct: "get rid of the bar above"). Its pieces move: the back and
// forward arrows go next to the server name, the server icon goes before the name, the
// icons on its right go into the channel's own bar, and the add people button goes into
// the row of tools above the channel list. Kept free of plugin imports so both parts can
// use it.

type Listener = () => void;

function store<T>(initial: T) {
    let value = initial;
    const listeners = new Set<Listener>();
    return {
        get: () => value,
        set(next: T) {
            if (next === value) return;
            value = next;
            listeners.forEach(l => l());
        },
        use() {
            const [, redraw] = useReducer((n: number) => n + 1, 0);
            useEffect(() => {
                listeners.add(redraw);
                return () => void listeners.delete(redraw);
            }, []);
            return value;
        }
    };
}

// Discord's own back and forward buttons, kept from the top bar as it draws them.
const arrows = store<React.ComponentType<any> | null>(null);

export function keepArrows(component: React.ComponentType<any>) {
    if (component && !arrows.get()) arrows.set(component);
    return null;
}

function Arrows() {
    const Buttons = arrows.use();
    if (!Buttons) return null;
    // The server name opens its menu on a click; the arrows must not.
    return (
        <div className="agentdisc-server-arrows" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
            <Buttons />
        </div>
    );
}

export const renderArrows = () => <Arrows key="agentdisc-arrows" />;

// The server's own picture before its name, or its initials when it has none.
function ServerIcon({ guild }: { guild: any; }) {
    if (!guild?.id) return null;
    const url = guild.icon ? IconUtils.getGuildIconURL({ id: guild.id, icon: guild.icon, size: 64, canAnimate: false }) : null;
    return url
        ? <img className="agentdisc-server-icon" src={url} alt="" aria-hidden="true" />
        : <span className="agentdisc-server-icon agentdisc-server-initials" aria-hidden="true">{guild.acronym ?? guild.name?.slice(0, 2)}</span>;
}

export const renderServerIcon = (guild: any) => <ServerIcon key="agentdisc-server-icon" guild={guild} />;

// Discord's add people action of each server, as its server name bar builds it.
const invites = store<Record<string, () => void>>({});

export function keepInvite(guildId: string, open: () => void) {
    const all = invites.get();
    if (guildId && open && all[guildId] !== open) invites.set({ ...all, [guildId]: open });
    return null;
}

export function useInvite(guildId: string | null | undefined) {
    const all = invites.use();
    return guildId ? all[guildId] ?? null : null;
}

// The icons that sat at the right of the top bar (Discord's inbox and help, and AgentDisc's
// own), drawn in the channel's bar instead.
const trailing = store<ReactNode>(null);

export function setTrailing(children: ReactNode) {
    trailing.set(children);
}

export const useTrailing = trailing.use;
