/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { COLOURS, LABELS, WORK } from "@plugins/vencordToolbox/timeFocus";
import { GuildStore, useReducer } from "@webpack/common";

import { familiesFor, guildMap, type Place, places, setCategoryPlaces, setServerPlaces } from "./activity";
import { closeBox, showBox } from "./boxes";

// The Channels pop-up (Stephane, 9 Nov 2026: "When it comes to Channel, which is very important to
// build and have, I want it built as a pop-up. Just one simple click on a button opens the pop-up
// where I can do it. I also want to be able to add one category to different categories."): one
// row per category of this server (a category and its archives count as one), one tick per
// activity, several allowed; "Always" shows a category whatever records. A single channel or thread
// gets its own choice by a right-click on it. Nothing here touches the timer.

const COLUMNS: Place[] = [...WORK, "always"];
const HEAD: Record<Place, string> = { ...LABELS, always: "Always" } as Record<Place, string>;

function Matrix({ guildId }: { guildId: string; }) {
    const [, redraw] = useReducer((n: number) => n + 1, 0);
    const families = familiesFor(guildId).filter(f => f.main);
    const map = guildMap(guildId);
    const flip = (list: Place[], p: Place) => list.includes(p) ? list.filter(x => x !== p) : [...list, p];
    const row = (key: string, label: string, list: Place[], save: (next: Place[]) => void) => (
        <tr key={key}>
            <th scope="row" className="agentdisc-acts-name" title={label}>{label}</th>
            {COLUMNS.map(p => {
                const on = list.includes(p);
                return (
                    <td key={p}>
                        <button
                            type="button"
                            className={"agentdisc-acts-tick" + (on ? " agentdisc-acts-tick-on" : "")}
                            style={{ "--agentdisc-act": p === "always" ? "var(--text-strong, #f2f3f5)" : COLOURS[p] } as React.CSSProperties}
                            aria-pressed={on}
                            aria-label={`${label}: ${HEAD[p]}`}
                            onClick={() => { save(flip(list, p)); redraw(); }}
                        />
                    </td>
                );
            })}
        </tr>
    );
    return (
        <table className="agentdisc-acts-table">
            <thead>
                <tr>
                    <th />
                    {COLUMNS.map(p => (
                        <th key={p} scope="col" className="agentdisc-acts-head">
                            <span className="agentdisc-acts-dot" style={{ background: p === "always" ? "var(--text-strong, #f2f3f5)" : COLOURS[p] }} />
                            {HEAD[p]}
                        </th>
                    ))}
                </tr>
            </thead>
            <tbody>
                {row("server", "Whole server", places(map.server), next => setServerPlaces(guildId, next))}
                {families.map(f => row(f.key, f.label, places(map.categories?.[f.main.id]), next => setCategoryPlaces(guildId, f.main.id, next)))}
            </tbody>
        </table>
    );
}

function ActivityBox({ guildId }: { guildId: string; }) {
    const guild = GuildStore.getGuild(guildId);
    return (
        <div
            className="agentdisc-find-backdrop"
            onMouseDown={e => { if (e.target === e.currentTarget) closeBox(); }}
            onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); closeBox(); } e.stopPropagation(); }}
        >
            <div className="agentdisc-find agentdisc-acts" role="dialog" aria-label="Channels for each activity" tabIndex={-1} ref={el => el?.focus()}>
                <div className="agentdisc-acts-top">
                    <div className="agentdisc-namebox-title">Channels for each activity{guild?.name ? ` · ${guild.name}` : ""}</div>
                    <button type="button" className="agentdisc-acts-done" onClick={closeBox}>Done</button>
                </div>
                <div className="agentdisc-acts-scroll">
                    <Matrix guildId={guildId} />
                </div>
                <div className="agentdisc-acts-note">While an activity records, the channel list shows only its categories. Right-click a channel or thread for its own choice.</div>
            </div>
        </div>
    );
}

export function openActivityChannels(guildId: string) {
    showBox(<ActivityBox guildId={guildId} />, "activities");
}
