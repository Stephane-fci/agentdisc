/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

interface ThreadRecord {
    id: string;
    parent_id?: string | null;
    guild_id?: string | null;
    isThread?(): boolean;
}

interface OrderOptions {
    read(): Record<string, string[]> | undefined;
    write(value: Record<string, string[]>): void;
    channel(id: string): ThreadRecord | undefined;
    changed(): void;
}

const ROW = '[data-list-item-id^="channels___"]';

// Only local ordering. Discord may put the selected/recent thread first; once a parent
// has been seen, that changing input must never replace its established order.
export function createThreadOrdering(options: OrderOptions) {
    const cache = new Map<string, string[]>();
    const pending = new Map<string, string[]>();
    let queued = false;

    function flush() {
        queued = false;
        if (!pending.size) return;
        const orders = { ...options.read() };
        for (const [parent, ids] of pending) orders[parent] = ids;
        pending.clear();
        options.write(orders);
    }

    function sort(parent: string, ids: string[]) {
        if (!ids.length) return [];
        const saved = cache.get(parent) ?? options.read()?.[parent];
        const known = Array.isArray(saved) ? saved.filter(id => typeof id === "string") : [];
        const order = [...new Set(known)];
        const seen = new Set(order);
        let anchor: string | undefined;
        // Insert only unseen threads beside their next known native neighbour. Existing
        // threads never move, but newly joined work keeps its usual place near the top.
        for (const id of [...new Set(ids)].reverse()) {
            if (!seen.has(id)) {
                order.splice(anchor === undefined ? order.length : order.indexOf(anchor), 0, id);
                seen.add(id);
            }
            anchor = id;
        }
        cache.set(parent, order);
        if (known.length !== order.length || !Array.isArray(saved)) {
            pending.set(parent, order);
            // This can be called by Discord's render/height functions. Persist afterward.
            if (!queued) { queued = true; queueMicrotask(flush); }
        }
        const visible = new Set(ids);
        return order.filter(id => visible.has(id));
    }

    function move(source: string, target: string, after: boolean) {
        const a = options.channel(source);
        const b = options.channel(target);
        if (!a?.isThread?.() || !b?.isThread?.() || !a.parent_id || a.parent_id !== b.parent_id || a.guild_id !== b.guild_id || source === target) return;
        sort(a.parent_id, [source, target]);
        const next = cache.get(a.parent_id)!.filter(id => id !== source);
        next.splice(next.indexOf(target) + (after ? 1 : 0), 0, source);
        cache.set(a.parent_id, next);
        pending.delete(a.parent_id);
        options.write({ ...options.read(), [a.parent_id]: next });
        options.changed();
    }

    function row(target: EventTarget | null) {
        const element = target instanceof Element ? target.closest<HTMLElement>(ROW) : null;
        const id = element?.getAttribute("data-list-item-id")?.slice("channels___".length);
        const channel = id ? options.channel(id) : undefined;
        return element && channel?.isThread?.() && channel.parent_id ? { element, channel } : null;
    }

    let prepared: { element: HTMLElement; previous: string | null; } | null = null;
    let dragging: ThreadRecord | null = null;
    let indicator: HTMLDivElement | null = null;
    let active = false;

    function finish() {
        indicator?.remove();
        indicator = null;
        dragging = null;
        if (prepared) {
            if (prepared.previous == null) prepared.element.removeAttribute("draggable");
            else prepared.element.setAttribute("draggable", prepared.previous);
            prepared = null;
        }
    }

    function pointerDown(e: PointerEvent) {
        if (e.button !== 0 || e.pointerType === "touch" || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
        if (e.target instanceof Element && e.target.closest("button,input,textarea,[contenteditable=true]")) return;
        finish();
        const item = row(e.target);
        if (!item) return;
        prepared = { element: item.element, previous: item.element.getAttribute("draggable") };
        item.element.draggable = true;
    }

    function pointerUp() { if (!dragging) finish(); }

    function dragStart(e: DragEvent) {
        const item = row(e.target);
        if (!item || !prepared || item.element !== prepared.element || !e.dataTransfer) return;
        dragging = item.channel;
        const siblings = [...document.querySelectorAll(ROW)].map(el => row(el)?.channel)
            .filter(c => c?.parent_id === dragging!.parent_id).map(c => c!.id);
        sort(dragging.parent_id!, siblings);
        e.dataTransfer.clearData();
        e.dataTransfer.setData("application/x-agentdisc-thread", dragging.id);
        e.dataTransfer.effectAllowed = "move";
        // Never hand our thread gesture to Discord's channel-reordering handlers.
        e.stopImmediatePropagation();
    }

    function dragOver(e: DragEvent) {
        if (!dragging) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const item = row(e.target);
        const valid = item && item.channel.id !== dragging.id && item.channel.parent_id === dragging.parent_id && item.channel.guild_id === dragging.guild_id;
        if (e.dataTransfer) e.dataTransfer.dropEffect = valid ? "move" : "none";
        if (!valid) { indicator?.remove(); indicator = null; return; }
        const rect = item.element.getBoundingClientRect();
        const after = e.clientY >= rect.top + rect.height / 2;
        if (!indicator) {
            indicator = document.createElement("div");
            indicator.dataset.agentdiscThreadDrop = "true";
            indicator.style.cssText = "position:fixed;height:2px;pointer-events:none;z-index:100000;background:var(--brand-500,#5865f2)";
            document.body.append(indicator);
        }
        indicator.style.left = `${rect.left}px`;
        indicator.style.width = `${rect.width}px`;
        indicator.style.top = `${after ? rect.bottom : rect.top}px`;
    }

    function drop(e: DragEvent) {
        if (!dragging) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const item = row(e.target);
        if (item) {
            const rect = item.element.getBoundingClientRect();
            move(dragging.id, item.channel.id, e.clientY >= rect.top + rect.height / 2);
        }
        finish();
    }

    function escape(e: KeyboardEvent) { if (e.key === "Escape") finish(); }

    function start() {
        if (active) return;
        active = true;
        document.addEventListener("pointerdown", pointerDown, true);
        document.addEventListener("pointerup", pointerUp, true);
        document.addEventListener("pointercancel", pointerUp, true);
        document.addEventListener("dragstart", dragStart, true);
        document.addEventListener("dragover", dragOver, true);
        document.addEventListener("drop", drop, true);
        document.addEventListener("dragend", finish, true);
        document.addEventListener("keydown", escape, true);
        window.addEventListener("blur", finish);
    }

    function stop() {
        active = false;
        document.removeEventListener("pointerdown", pointerDown, true);
        document.removeEventListener("pointerup", pointerUp, true);
        document.removeEventListener("pointercancel", pointerUp, true);
        document.removeEventListener("dragstart", dragStart, true);
        document.removeEventListener("dragover", dragOver, true);
        document.removeEventListener("drop", drop, true);
        document.removeEventListener("dragend", finish, true);
        document.removeEventListener("keydown", escape, true);
        window.removeEventListener("blur", finish);
        finish();
        flush();
        cache.clear();
    }

    return { sort, start, stop };
}
