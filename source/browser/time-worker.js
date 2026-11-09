// AgentDisc time and focus (Stephane, 9 Nov 2026): one activity at a time, tracked by hand.
// His words: "actually I want manual tracking, this way it's really actively done". Time is
// recorded only between his Start and his Pause or Stop (or a deliberate switch of activity);
// nothing here starts, stops or moves time by itself: not opening Discord, not a channel, not
// an idle computer, not a calendar block, not an agent.
//
// This background part is the one owner of the timer for every Discord tab. Each tab sends
// his clicks here with the session it saw; a click made on an outdated view is refused and the
// tab shows the current state instead. Elapsed time always comes from the saved start time,
// never from counting, so a refresh, a closed panel, a restarted background part or a
// sleeping computer can neither add nor lose time.
//
// Ended pieces of time go to his "AgentDisc Actual time" calendar through the small calendar
// service on John (only generic activity names, never what he worked on); the service holds
// the Google login, never this app. Without the service's key file nothing is sent, and the
// pieces wait here.
/* global chrome, globalThis */

(function () {
    const KEY = "agentdiscTime";
    const SEEN = "agentdiscTimeSeen";
    const ACTIVITIES = ["clients", "videos", "made", "workout", "learning", "hobbies", "break"];
    const LABELS = { clients: "Clients & leads", videos: "Videos & visibility", made: "Own business", workout: "Workout", learning: "Learning", hobbies: "Hobbies", break: "Break" };
    const DAY = 86400000;
    const KEEP_DAYS = 120;
    // A gap this long with no Discord tab alive while time ran (computer asleep, browser shut)
    // asks him once whether the session really went on; the time itself is left as it is.
    const GAP = 30 * 60000;
    const ID_CHARS = "0123456789abcdefghijklmnopqrstuv"; // Google event ids allow only these

    function newId(n = 20) {
        const bytes = new Uint8Array(n);
        crypto.getRandomValues(bytes);
        return [...bytes].map(b => ID_CHARS[b & 31]).join("");
    }

    function blank() {
        return {
            v: 1,
            version: 0,
            selected: null,
            running: null, // { id, session, activity, start }
            paused: null, // { session, activity } after Pause, so Resume continues the session
            intervals: [], // { id, session, activity, start, end }
            allowances: {}, // activity -> hours per week, absent when unset
            template: [], // { id, day: 1 (Mon) .. 7, start: "07:00", end: "09:00", activity, sally }
            busy: null, // calendar ids whose appointments count; null: his primary calendar
            check: null, // { since } a long gap with no tab alive while time ran
            sync: { queue: [], error: null, at: 0, revision: 0 },
            remind: { fired: [], later: null, banner: null }
        };
    }

    function clean(state) {
        const s = Object.assign(blank(), state || {});
        s.intervals = Array.isArray(s.intervals) ? s.intervals.filter(okInterval) : [];
        s.template = Array.isArray(s.template) ? s.template : [];
        s.sync = Object.assign({ queue: [], error: null, at: 0 }, s.sync || {});
        s.remind = Object.assign({ fired: [], later: null, banner: null }, s.remind || {});
        if (s.selected && !ACTIVITIES.includes(s.selected)) s.selected = null;
        return s;
    }

    function okInterval(i) {
        return i && typeof i.id === "string" && ACTIVITIES.includes(i.activity) && Number.isFinite(i.start) && Number.isFinite(i.end) && i.end > i.start;
    }

    // Two pieces of his time never overlap: he is one person.
    function overlaps(state, start, end, skipId) {
        if (state.running && skipId !== state.running.id && end > state.running.start) return true;
        return state.intervals.some(i => i.id !== skipId && start < i.end && end > i.start);
    }

    // Every change of a piece gets a higher revision number than any before it, which the calendar
    // service keeps: an older change arriving late can never undo a newer correction there.
    function queue(state, op, now) {
        // The last change of a piece is the one that counts.
        state.sync.queue = state.sync.queue.filter(q => !(q.kind === op.kind && q.id === op.id));
        const revision = Math.max((state.sync.revision || 0) + 1, Math.floor(now || Date.now()));
        state.sync.revision = revision;
        state.sync.queue.push(Object.assign({ tries: 0, next: 0, rev: newId(8), revision }, op));
    }

    function endRunning(state, at) {
        const r = state.running;
        if (!r) return null;
        const end = Math.max(r.start, at);
        const piece = { id: r.id, session: r.session, activity: r.activity, start: r.start, end };
        state.running = null;
        // Under a second is a slip of the finger, not time.
        if (end - r.start >= 1000) {
            state.intervals.push(piece);
            queue(state, { kind: "actual", id: piece.id, op: "put" }, at);
        }
        return piece;
    }

    function weekStart(t) {
        const d = new Date(t);
        const day = (d.getDay() + 6) % 7; // Monday 0
        return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day).getTime();
    }

    function recorded(state, activity, from, to, now) {
        let ms = 0;
        for (const i of state.intervals) if (i.activity === activity) ms += Math.max(0, Math.min(i.end, to) - Math.max(i.start, from));
        const r = state.running;
        if (r && r.activity === activity) ms += Math.max(0, Math.min(now, to) - Math.max(r.start, from));
        return ms;
    }

    // One command from a tab. Returns { ok, error?, changed } and changes the state in place.
    // `seen` is the running session id the tab showed (null when it showed nothing running) and
    // `view` the chosen activity and paused session it showed: a click made on a view that is no
    // longer true (another tab changed it) is refused, so a tab showing "Resume Clients" can never
    // start Videos. Choosing an activity checks only the running session: the choice itself is new.
    function apply(state, cmd, args, now) {
        args = args || {};
        const runningSeen = () => (state.running ? state.running.id : null) === (args.seen ?? null);
        const viewSeen = () => !args.view || ((args.view.selected ?? null) === (state.selected ?? null) && (args.view.paused ?? null) === (state.paused ? state.paused.session : null));
        const sameView = () => runningSeen() && viewSeen();
        const refuse = error => ({ ok: false, error });
        switch (cmd) {
            case "select": {
                const a = args.activity;
                if (a !== null && !ACTIVITIES.includes(a)) return refuse("unknown activity");
                if (!runningSeen()) return refuse("stale");
                if (state.selected === a) return { ok: true, changed: false };
                // A deliberate switch ends the piece that ran; the next one needs Start.
                if (state.running && state.running.activity !== a) endRunning(state, now);
                state.paused = null;
                state.selected = a;
                state.remind.banner = null;
                return { ok: true, changed: true };
            }
            case "start": {
                if (!sameView()) return refuse("stale");
                if (state.running) return refuse("already running");
                const a = args.activity ?? state.selected;
                if (!ACTIVITIES.includes(a)) return refuse("choose an activity first");
                const session = state.paused && state.paused.activity === a ? state.paused.session : newId();
                state.selected = a;
                state.paused = null;
                state.running = { id: newId(), session, activity: a, start: now };
                state.check = null;
                state.remind.banner = null;
                return { ok: true, changed: true };
            }
            case "pause":
            case "stop": {
                if (!sameView()) return refuse("stale");
                if (!state.running) return refuse("nothing running");
                // A plain Pause or Stop always works; only a corrected end time ("it ended earlier") is checked.
                const at = args.at == null ? now : Number(args.at);
                if (args.at != null) {
                    if (!Number.isFinite(at) || at <= state.running.start || at > now) return refuse("that time is outside the session");
                    if (overlaps(state, state.running.start, at, state.running.id)) return refuse("that time overlaps other recorded time");
                }
                const piece = endRunning(state, at);
                state.paused = cmd === "pause" ? { session: piece.session, activity: piece.activity } : null;
                state.check = null;
                state.remind.banner = null;
                return { ok: true, changed: true };
            }
            case "startedAt": {
                // He forgot to press Start: move the running session's start earlier (or later).
                if (!sameView() || !state.running) return refuse("stale");
                const at = Number(args.at);
                if (!Number.isFinite(at) || at >= now || at < now - 2 * DAY) return refuse("pick a time in the last two days");
                if (overlaps(state, at, now, state.running.id)) return refuse("that time overlaps other recorded time");
                state.running.start = at;
                state.check = null;
                return { ok: true, changed: true };
            }
            case "keep": {
                // After a long gap: yes, the session really went on.
                if (!sameView()) return refuse("stale");
                state.check = null;
                return { ok: true, changed: true };
            }
            case "add":
            case "edit": {
                const start = Number(args.start), end = Number(args.end), a = args.activity;
                if (!ACTIVITIES.includes(a)) return refuse("unknown activity");
                if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return refuse("the end must come after the start");
                if (end > now) return refuse("the end cannot be in the future");
                if (start < now - KEEP_DAYS * DAY) return refuse("too far back");
                const old = cmd === "edit" ? state.intervals.find(i => i.id === args.id) : null;
                if (cmd === "edit" && !old) return refuse("that piece no longer exists");
                if (overlaps(state, start, end, old ? old.id : undefined)) return refuse("that time overlaps other recorded time");
                if (old) Object.assign(old, { start, end, activity: a });
                else state.intervals.push({ id: newId(), session: newId(), activity: a, start, end, added: true });
                const id = old ? old.id : state.intervals[state.intervals.length - 1].id;
                queue(state, { kind: "actual", id, op: "put" }, now);
                return { ok: true, changed: true };
            }
            case "remove": {
                const at = state.intervals.findIndex(i => i.id === args.id);
                if (at < 0) return refuse("that piece no longer exists");
                const [gone] = state.intervals.splice(at, 1);
                queue(state, { kind: "actual", id: gone.id, op: "delete" }, now);
                return { ok: true, changed: true };
            }
            case "allowance": {
                const a = args.activity;
                if (!ACTIVITIES.includes(a) || a === "break") return refuse("unknown activity");
                const h = args.hours;
                if (h === null || h === "" || h === undefined) delete state.allowances[a];
                else {
                    const n = Number(h);
                    if (!Number.isFinite(n) || n < 0 || n > 112) return refuse("hours per week between 0 and 112");
                    state.allowances[a] = Math.round(n * 4) / 4;
                }
                return { ok: true, changed: true };
            }
            case "template": {
                const blocks = Array.isArray(args.template) ? args.template : null;
                if (!blocks) return refuse("no template");
                const ok = blocks.every(b => b && typeof b.id === "string" && b.day >= 1 && b.day <= 7 && /^\d\d:\d\d$/.test(b.start) && /^\d\d:\d\d$/.test(b.end) && b.end > b.start && ACTIVITIES.includes(b.activity));
                if (!ok || blocks.length > 120) return refuse("a block is not valid");
                state.template = blocks.map(b => ({ id: b.id, day: b.day, start: b.start, end: b.end, activity: b.activity, sally: !!b.sally }));
                return { ok: true, changed: true };
            }
            case "busy": {
                state.busy = Array.isArray(args.ids) ? args.ids.filter(x => typeof x === "string").slice(0, 20) : null;
                return { ok: true, changed: true };
            }
            case "snooze": {
                // "5 more minutes": the same reminder comes back then. Time keeps running as it was.
                const min = Number(args.minutes);
                if (!Number.isFinite(min) || min <= 0 || min > 240) return refuse("minutes");
                const text = state.remind.banner ? state.remind.banner.text : args.text;
                state.remind.later = { at: now + min * 60000, text: text || "Reminder" };
                state.remind.banner = null;
                return { ok: true, changed: true };
            }
            case "dismiss": {
                state.remind.banner = null;
                return { ok: true, changed: true };
            }
            default:
                return refuse("unknown command");
        }
    }

    // A tab opened or came back: note that a tab is alive, and when time ran through a long
    // gap with no tab alive, ask him once (the time stays as it is until he answers).
    function seen(state, last, now) {
        if (state.running && last && now - last > GAP && !state.check && last > state.running.start) {
            state.check = { since: last };
            return true;
        }
        return false;
    }

    function trim(state, now) {
        const before = state.intervals.length;
        state.intervals = state.intervals.filter(i => i.end > now - KEEP_DAYS * DAY);
        return state.intervals.length !== before;
    }

    // The reminders that can come next, each once: a planned block starting while he is not on
    // its activity, the planned block of the activity he runs ending (unless the next block is
    // the same activity), and the running activity using its weekly allowance; plus one he put
    // off with "5 more minutes". A reminder a little late (a sleeping computer) still comes;
    // one long past does not.
    function reminders(state, plan, now) {
        const out = [];
        const r = state.running;
        const fired = new Set(state.remind.fired || []);
        const blocks = (plan || []).filter(b => Number.isFinite(b.start) && Number.isFinite(b.end)).sort((a, b) => a.start - b.start);
        for (const b of blocks) {
            if (!(r && r.activity === b.activity)) out.push({ key: `start:${b.id}:${b.start}`, at: b.start, kind: "start", block: b });
            const next = blocks.find(x => x.start === b.end && x.activity === b.activity);
            if (r && r.activity === b.activity && !next) out.push({ key: `end:${b.id}:${b.end}`, at: b.end, kind: "end", block: b });
        }
        if (r && state.allowances[r.activity] != null) {
            const ws = weekStart(now);
            const left = state.allowances[r.activity] * 3600000 - recorded(state, r.activity, ws, ws + 7 * DAY, now);
            out.push({ key: `allowance:${r.activity}:${ws}:${state.allowances[r.activity]}`, at: now + Math.max(0, left), kind: "allowance", activity: r.activity });
        }
        const later = state.remind.later;
        if (later && Number.isFinite(later.at)) out.push({ key: `later:${later.at}`, at: later.at, kind: "later", text: later.text });
        return out.filter(t => !fired.has(t.key) && t.at >= now - 5 * 60000).sort((a, b) => a.at - b.at);
    }

    function nextReminder(state, plan, now) {
        return reminders(state, plan, now)[0] || null;
    }

    function reminderText(state, due) {
        const r = state.running;
        if (due.kind === "later") return due.text || "Reminder";
        if (due.kind === "allowance") return `${LABELS[due.activity]}: this week's ${state.allowances[due.activity]} h are used.`;
        const what = LABELS[due.block.activity] || "a block";
        const sally = due.block.sally ? " with your partner" : "";
        if (due.kind === "end") return `Planned ${what} time ends now.`;
        return r ? `Planned now: ${what}${sally}. You are on ${LABELS[r.activity]}.` : `Planned now: ${what}${sally}.`;
    }

    // A due reminder: shown in the panel and as one notification; nothing recorded changes.
    function fire(state, due, now) {
        state.remind.fired = [...(state.remind.fired || []), due.key].slice(-60);
        if (due.kind === "later") state.remind.later = null;
        state.remind.banner = { text: reminderText(state, due), at: now, kind: due.kind, activity: due.block ? due.block.activity : due.activity || null };
        return state.remind.banner;
    }

    globalThis.AgentDiscTime = { ACTIVITIES, LABELS, blank, clean, apply, seen, trim, recorded, weekStart, reminders, nextReminder, reminderText, fire, newId };

    // ---- Background part: storage, alarms, notifications, calendar service ----
    if (typeof chrome === "undefined" || !chrome.storage) return;

    let chain = Promise.resolve();
    const serial = fn => (chain = chain.then(fn, fn));

    async function load() {
        const got = await chrome.storage.local.get([KEY, SEEN]);
        return { state: clean(got[KEY]), last: got[SEEN] || 0 };
    }

    async function save(state) {
        state.version = (state.version || 0) + 1;
        await chrome.storage.local.set({ [KEY]: state });
    }

    function command(cmd, args) {
        return serial(async () => {
            const now = Date.now();
            const { state, last } = await load();
            if (cmd === "get") {
                const changed = seen(state, last, now) | trim(state, now);
                await chrome.storage.local.set({ [SEEN]: now });
                if (changed) await save(state);
                return { ok: true, state, now };
            }
            if (cmd === "alive") {
                const changed = seen(state, last, now);
                await chrome.storage.local.set({ [SEEN]: now });
                if (changed) await save(state);
                return { ok: true, now };
            }
            const result = apply(state, cmd, args, now);
            if (result.ok && result.changed !== false) await save(state);
            if (result.ok) {
                await plan(state);
                if (state.sync.queue.length) syncSoon(0);
            }
            return Object.assign({}, result, { state, now });
        });
    }

    // ---- The calendar service ----
    // Key file beside the app, written only on his PC: { url, client_id, client_secret }. Web
    // pages cannot read it; its key goes only to that one address.
    let keyCache = null;
    async function serviceKey() {
        if (keyCache && Date.now() - keyCache.at < 60000) return keyCache.key;
        let key = null;
        try {
            const res = await fetch(chrome.runtime.getURL("time-service.json"), { cache: "no-store" });
            if (res.ok) {
                const file = await res.json();
                const url = new URL(file.url);
                if (url.protocol === "https:" && file.client_id && file.client_secret) key = { origin: url.origin, headers: { "CF-Access-Client-Id": String(file.client_id), "CF-Access-Client-Secret": String(file.client_secret) } };
            }
        } catch { }
        keyCache = { key, at: Date.now() };
        return key;
    }

    async function ask(path, init) {
        const key = await serviceKey();
        if (!key) throw Object.assign(new Error("The calendar service is not set up on this computer."), { setup: true });
        const res = await fetch(key.origin + path, Object.assign({ cache: "no-store", credentials: "omit", redirect: "manual" }, init, {
            headers: Object.assign({}, key.headers, init && init.body ? { "Content-Type": "application/json" } : {}, { "X-AgentDisc": "1" })
        }));
        let body = null;
        try { body = await res.json(); } catch { }
        if (!res.ok) throw Object.assign(new Error((body && body.error) || `The calendar service answered ${res.status}.`), { status: res.status });
        return body;
    }

    let syncTimer = null;
    function syncSoon(ms) {
        if (syncTimer) return;
        syncTimer = setTimeout(() => { syncTimer = null; sync(); }, ms);
    }

    // Each waiting change goes out once; a failure waits longer each time (up to an hour, by
    // a background alarm, so it survives the background part being stopped). Every piece
    // carries its own id in Google, so sending it twice never makes two entries. The network
    // calls run outside the queue of his clicks, so a slow connection never holds a click up;
    // a change made while one was on its way is sent again after it.
    let syncing = false;
    async function sync() {
        if (syncing) return;
        syncing = true;
        try {
            const now = Date.now();
            const { state } = await serial(load);
            const due = state.sync.queue.filter(q => q.next <= now).map(q => ({ q, piece: state.intervals.find(i => i.id === q.id) }));
            const done = [], failed = [];
            for (const { q, piece } of due) {
                try {
                    if (q.op === "put" && piece) await ask(`/api/actual/${q.id}`, { method: "PUT", body: JSON.stringify({ start: piece.start, end: piece.end, activity: piece.activity, session: piece.session, revision: q.revision }) });
                    else await ask(`/api/actual/${q.id}?revision=${encodeURIComponent(q.revision || 0)}`, { method: "DELETE" });
                    done.push(q);
                } catch (e) {
                    failed.push({ q, error: String(e.message || e).slice(0, 200) });
                    if (e.setup) break;
                }
            }
            await serial(async () => {
                const { state } = await load();
                const same = (a, b) => a.kind === b.kind && a.id === b.id && a.rev === b.rev;
                if (done.length) {
                    state.sync.queue = state.sync.queue.filter(x => !done.some(d => same(d, x)));
                    state.sync.at = Date.now();
                }
                for (const { q, error } of failed) {
                    const x = state.sync.queue.find(y => same(y, q));
                    if (!x) continue;
                    x.tries += 1;
                    x.next = Date.now() + Math.min(3600000, 30000 * 2 ** Math.min(x.tries, 7));
                    x.error = error;
                }
                state.sync.error = failed.length ? failed[failed.length - 1].error : state.sync.queue.some(x => x.error) ? state.sync.error : null;
                if (done.length || failed.length) await save(state);
                armSync(state);
            });
        } finally {
            syncing = false;
        }
    }

    function armSync(state) {
        const next = Math.min(...state.sync.queue.map(q => q.next).filter(Number.isFinite), Infinity);
        if (next === Infinity) chrome.alarms.clear("agentdisc-time-sync");
        else chrome.alarms.create("agentdisc-time-sync", { when: Math.max(Date.now() + 30000, next) });
    }

    // ---- Calendar reads for the panel ----
    async function day(args) {
        const from = Number(args.from), to = Number(args.to);
        if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 8 * DAY) return { ok: false, error: "range" };
        try {
            const { state } = await load();
            const q = new URLSearchParams({ from: new Date(from).toISOString(), to: new Date(to).toISOString() });
            if (state.busy) q.set("busy", state.busy.join(","));
            const body = await ask(`/api/day?${q}`);
            const d = new Date();
            const today = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
            if (from <= today && today + DAY <= to + 1) {
                await keepPlan((body.plan || []).map(b => ({ id: b.id, start: Date.parse(b.start), end: Date.parse(b.end), activity: b.activity, sally: !!b.sally }))
                    .filter(b => b.end > today && b.start < today + DAY));
                serial(async () => plan((await load()).state));
            }
            return { ok: true, day: body };
        } catch (e) {
            return { ok: false, error: String(e.message || e), setup: !!e.setup };
        }
    }

    async function calendars() {
        try {
            return { ok: true, calendars: await ask("/api/calendars") };
        } catch (e) {
            return { ok: false, error: String(e.message || e), setup: !!e.setup };
        }
    }

    // Planned blocks live on his "AgentDisc Plan" calendar, so he can also move them in Google
    // Calendar. Saving one here writes it there at once; nothing else in his calendar changes.
    async function planBlock(args) {
        try {
            if (args.op === "delete") return Object.assign({ ok: true }, await ask(`/api/plan/${encodeURIComponent(args.id)}`, { method: "DELETE" }));
            // onlyIfMissing: putting the week on again never moves or revives a block he changed.
            const body = { start: args.start, end: args.end, activity: args.activity, sally: !!args.sally, onlyIfMissing: !!args.onlyIfMissing };
            return Object.assign({ ok: true }, await ask(`/api/plan/${encodeURIComponent(args.id)}`, { method: "PUT", body: JSON.stringify(body) }));
        } catch (e) {
            return { ok: false, error: String(e.message || e), setup: !!e.setup };
        }
    }

    // ---- Reminders: they only ask; his own clicks change what is recorded ----
    // Today's planned blocks, kept so reminders still come after the background part restarts
    // and while the panel is closed; read again from the Plan calendar every quarter hour.
    const PLAN = "agentdiscTimePlan";
    let todayPlan = null;

    async function storedPlan() {
        if (todayPlan) return todayPlan;
        const got = await chrome.storage.local.get(PLAN);
        const saved = got[PLAN];
        todayPlan = saved && Array.isArray(saved.blocks) && saved.day === new Date().toDateString() ? saved.blocks : [];
        return todayPlan;
    }

    async function keepPlan(blocks) {
        todayPlan = blocks;
        await chrome.storage.local.set({ [PLAN]: { day: new Date().toDateString(), blocks } });
    }

    async function refreshPlan() {
        if (!(await serviceKey())) return;
        const d = new Date();
        const from = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        await day({ from, to: from + DAY });
    }

    async function plan(state) {
        const due = nextReminder(state, await storedPlan(), Date.now());
        if (!due) return chrome.alarms.clear("agentdisc-time-remind");
        chrome.alarms.create("agentdisc-time-remind", { when: Math.max(Date.now() + 1000, due.at) });
    }

    function remindNow() {
        return serial(async () => {
            const now = Date.now();
            const { state } = await load();
            const due = nextReminder(state, await storedPlan(), now);
            if (!due || due.at > now + 1000) return plan(state);
            const banner = fire(state, due, now);
            await save(state);
            try {
                chrome.notifications.create("agentdisc-time", {
                    type: "basic", iconUrl: "icon-128.png", title: "AgentDisc", message: banner.text, priority: 1, requireInteraction: true,
                    buttons: [{ title: "5 more minutes" }, { title: "30 more minutes" }]
                });
            } catch { }
            await plan(state);
        });
    }

    chrome.alarms.onAlarm.addListener(alarm => {
        if (alarm.name === "agentdisc-time-sync") sync();
        if (alarm.name === "agentdisc-time-remind") remindNow();
        if (alarm.name === "agentdisc-time-plan") refreshPlan();
    });

    if (chrome.notifications) {
        chrome.notifications.onButtonClicked.addListener((id, button) => {
            if (id !== "agentdisc-time") return;
            command("snooze", { minutes: button === 0 ? 5 : 30 });
            chrome.notifications.clear(id);
        });
        chrome.notifications.onClicked.addListener(async id => {
            if (id !== "agentdisc-time") return;
            chrome.notifications.clear(id);
            const [tab] = await chrome.tabs.query({ url: ["*://*.discord.com/*"] });
            if (tab) {
                chrome.tabs.update(tab.id, { active: true });
                chrome.windows.update(tab.windowId, { focused: true });
            }
        });
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!message || message.action !== "agentdiscTime" || sender.id !== chrome.runtime.id) return;
        const { cmd, args } = message;
        const run = cmd === "day" ? day(args || {}) : cmd === "calendars" ? calendars() : cmd === "plan" ? planBlock(args || {}) : cmd === "sync" ? (sync(), Promise.resolve({ ok: true })) : command(cmd, args);
        run.then(sendResponse, e => sendResponse({ ok: false, error: String(e && e.message || e) }));
        return true;
    });

    // At start: send what waits, read today's plan, and set the next reminder.
    chrome.alarms.create("agentdisc-time-plan", { periodInMinutes: 15 });
    serial(async () => {
        const { state } = await load();
        await plan(state);
        if (state.sync.queue.length) syncSoon(2000);
    });
    refreshPlan();
})();
