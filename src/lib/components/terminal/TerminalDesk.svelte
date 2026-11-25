<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import type { TerminalDeskMirror } from '$lib/types';
	import TerminalPanel from './TerminalPanel.svelte';
	import TerminalTabHeader from './TerminalTabHeader.svelte';
	import TerminalTabButton from './TerminalTabButton.svelte';
	import TerminalTabContainer from './TerminalTabContainer.svelte';
	import TerminalSplitContainer from './TerminalSplitContainer.svelte';
	import JobTail from './JobTail.svelte';
	import CloseButton from '$lib/components/common/buttons/CloseButton.svelte';
	import { jobsRoster, isLiveJob } from '$lib/services/jobs/roster-store.svelte';
	import { registerJobTabOpener, registerJobTabClearer, connectJobFollow } from '$lib/services/jobs/follow-client.svelte';
	import { subscribeRosterPush } from '$lib/services/jobs/roster-push-client.svelte';
	import { spineFeed } from '$lib/services/conversation/spine-feed.svelte';
	import { selectAdoptable, isAdoptable, jobKey } from '$lib/services/jobs/job-adoption';
	import { appConfig, loadAppConfig } from '$lib/services/config/app-config.svelte';
	import { subscribeSessionBorn, type SessionBornFrame } from '$lib/services/terminal/stream-hub.svelte';
	import type { DsiJobFollowEvent, DsiJobView } from '$lib/types';
import { clampTermFontSize, legacyTerminalFont } from '$lib/utils/panel-prefs';

	/** TerminalDesk — the ONE terminal floor slot (Terminal Desk ADR,
	 *  2026-09-24, D1/D3): tabs of stacked rows over the server's N-session
	 *  registry. The floor counts desks (always at most one); this
	 *  component owns the tab/row tree, selection, the close cascades (D5),
	 *  and the reload survival pair (D3): the blob MIRROR rides out via
	 *  onMirror; the probe's live session list adjudicates the REBUILD —
	 *  remembered ids that are gone or exited drop, survivors re-attach
	 *  (byte-0 replay per the Surviving Shell's amended D3), and an
	 *  all-dead desk falls back to one fresh self-open row. Row sessions
	 *  the desk mints itself are handed to the panel (row mode); the FIRST
	 *  row of a virgin desk self-opens via the panel's own ladder, so a
	 *  bare command behaves byte-identically to the pre-desk panel. */
	type Row = {
		key: number;
		/** Null = self-open (the panel runs its own ladder and reports back
		 *  via onAssigned); set = the desk holds this session's lease. */
		assigned: { sessionId: string; token: string } | null;
		/** This PANE's own base font (ADR-0083 D2): seeded once from the
		 *  restored mirror row, else the legacy global — after which the
		 *  legacy field is dead for this row. The slider writes here. */
		fontPx: number;
	};
	/** The Job Bridge (ADR-0081, PRD 4.1): a tab carries two species in
	 *  PARALLEL arrays. `rows` holds shells ONLY — every entry is a Row,
	 *  which closeTab/removeRow/recordAssigned, the badge and the mirror
	 *  all assume. `jobRows` holds the desk's read-only job strips. A job
	 *  NEVER enters `rows`: there, closeTab would dereference a session
	 *  that does not exist (karpathy-context 3.10, trap 2). */
	type JobRow = {
		/** `owner|id` — the follow relay's own key: one row per job, and
		 *  the {#each} identity. */
		key: string;
		owner: string;
		jobId: string;
		label: string;
		events: DsiJobFollowEvent[];
		closer: () => void;
		settled: boolean;
	};
	type Tab = { key: number; rows: Row[]; jobRows: JobRow[] };

	let {
		onShellExit,
		restored = null,
		onMirror,
		zoom = 1
	}: {
		onShellExit?: () => void;
		/** The clamped blob mirror (from the terminal panel entry) — the
		 *  rebuild ladder's REMEMBERED half; the probe is the authority. */
		restored?: TerminalDeskMirror | null;
		/** Fires whenever the tree settles, with the mirror to persist. */
		onMirror?: (mirror: TerminalDeskMirror) => void;
		/** Floor zoom, forwarded to every row panel (ADR-0041 Am.3 pocket). */
		zoom?: number | null;
	} = $props();

	/** Coerced zoom — one pocket source for every row (null-safe default 1). */
	const deskZoom = $derived(zoom ?? 1);

	/** The desk's root — the anchor for finding the hosting PanelColumn,
		 *  the WHOLE column (the panel floor slot the desk lives in), not just
	 *  the terminal. Absent column (bare mounts) = null — the button's
	 *  documented no-op. */
	let deskEl = $state<HTMLElement | null>(null);

	let nextKey = 1; // hmr-survival probe 2026-11-04: comment-only, safe to remove
	const mkKey = (): number => nextKey++;

	const defaultTab = (): Tab => ({ key: mkKey(), rows: [{ key: mkKey(), assigned: null, fontPx: legacyTerminalFont() }], jobRows: [] });

	/** A pane's slider drag (ADR-0083 D4): write THAT row's font only —
	 *  clamped through the single bound site. Persistence rides the
	 *  existing mirror effect (onMirror stays single-sourced). */
	function setRowFont(row: Row, px: number): void {
		row.fontPx = clampTermFontSize(px);
	}

	// A restored desk starts EMPTY (the rebuild ladder fills it); a virgin
	// desk starts with the classic one self-open row. Until the ladder
	// settles, no mirror publishes and no row self-opens. The restored prop
	// is read ONCE here, by design — rebuild state lives in restoring/tabs.
	// svelte-ignore state_referenced_locally
	let restoring = $state(
		!!restored && (restored.tabs.length > 0 || (restored.jobs?.length ?? 0) > 0)
	);
	// svelte-ignore state_referenced_locally
	let tabs = $state<Tab[]>(restoring ? [] : [defaultTab()]);
	let selectedTab = $state(0);
	let opening = $state(false);
	let capped = $state(false);

	// ── Job strips: settle + linger (ADR-0035 D3 amendment; The Job Bridge
	// 4.1) ─────────────────────────────────────────────────────────────
	/** A settled job strip lingers 25s before auto-close — time to read
	 *  the tail before it disappears (operator, 2026-10-21). */
	const JOB_ROW_CLOSE_DELAY_MS = 25_000;
	// The ONE linger registry, keyed by job ROW key — an `owner|id` string
	// (The Job Bridge, Wave 4: the Tn-J tab species is retired, so no
	// numeric tab key remains in it). Bookkeeping, never render state.
	const pendingCloses = new Map<string, ReturnType<typeof setTimeout>>();

	// ── Job rows (The Job Bridge, ADR-0081 — PRD 4.1/4.5/4.7) ─────────
	// The row is the ONE job surface (D3: Wave 4 retired ADR-0035's
	// standalone Tn-J follower tab): a READ-ONLY follow of one job's output
	// ring, hosted on a tab beside its shells (the parallel `jobRows` array).
	// A row is born two ways. By ADOPTION — the roster PUSH (the primary
	// signal, one frame after birth) or the spine-tick SNAPSHOT (the
	// fallback), both through the ONE predicate (job-adoption.ts), so they
	// can neither disagree nor double-attach. And by the roster CLICK (the
	// bus's `openJobTab`, its name kept: with a desk mounted it attaches or
	// selects the row — the tab it selects is always a shell tab).
	// Rows DO ride the mirror: every attached row publishes as {owner, jobId}
	// and the rebuild ladder re-attaches each as a row — live jobs only (D5).

	/** Dismissed row keys (`owner|id`) — bookkeeping, never render state
	 *  (a plain array for the same reason the push client's registry is
	 *  one). STICKY: a row closed while its job was still live stays
	 *  closed — the browser roster REPLACES on every tick and the same
	 *  running job re-arrives, so an un-sticky dismissal resurrects the
	 *  row within 5 s (trap 1). Only pruneDismissed forgets a key
	 *  (PRD 4.7). */
	const dismissed: string[] = [];

	/** Keys of jobs the desk ITSELF watched settle — the follow's `status`
	 *  event on the desk's own stream, or a roster-driven settle. Bookkeeping,
	 *  never render state (a plain array, like `dismissed`); never pruned —
	 *  ids are registry-issued and never reused, so a stale key costs nothing
	 *  — and it dies with the instance.
	 *  WHY (D-k — a Wave 3 gap the 4.4 e2e found, 2026-11-25; trap 1
	 *  generalized): the FOLLOW settles a row first. The spine SNAPSHOT lags
	 *  it by up to one refreshMs and stays alive through ANOTHER watcher (the
	 *  sidebar badge holds the same owner). A settled row's close records no
	 *  dismissal (PRD 4.7), so the stale `running` snapshot re-adopted the
	 *  just-closed job in the same flush and re-opened its follow (trace: the
	 *  close at 1310 ms, a new follow at 1316 ms) — the operator's close was
	 *  silently undone. What the desk watched finish on its OWN stream
	 *  outranks a lagging snapshot.
	 *  Read by the SNAPSHOT stage alone, handed to the ONE predicate inside
	 *  the dismissed set; the PUSH stage is exempt — the relay's frame is the
	 *  fresh word, and a frame showing the job running again must still
	 *  attach it (3.1-T). The rebuild probe is exempt too: a fresh instance
	 *  has no settled keys and probes a freshly refreshed roster. */
	const settledKeys: string[] = [];

	/** Every session the desk has HEARD a roster frame for (the push
	 *  frames' sessionId) — bookkeeping, never render state. A merely
	 *  KNOWN owner is not watched (a watch is per attached row, task
	 *  3.2): with the attached rows' owners, this names whose
	 *  SNAPSHOT the fallback effect reads. */
	const knownOwners: string[] = [];

	/** Roster frames that arrived while the desk could not adopt yet —
	 *  HELD, never dropped: a job born during the ~100 ms rebuild ladder
	 *  or during the config load is adopted the moment the desk can
	 *  (D-h). */
	const heldFrames: Array<{ sessionId: string; jobs: DsiJobView[] }> = [];

	/** A roster click — or the launcher's pending replay (TRAP 3) — that
	 *  arrived while the desk had NO tab to host a row on: during the
	 *  rebuild ladder, or clearScope's orphan window before the fresh T1
	 *  lands (The Job Bridge 4.1). HELD, never dropped: the retired tab
	 *  species needed no host tab, a row does — a click lost here would be
	 *  the silent no-op the launcher path exists to prevent (RCA
	 *  2026-10-21). Replayed in order once a tab exists. */
	const heldClicks: Array<{ owner: string; jobId: string; label: string }> = [];

	/** False until the first config load settles (loadAppConfig never
	 *  rejects). Adoption reads jobs.autoAttach: a frame that arrives
	 *  before the setting is known is held, never guessed on the default
	 *  (karpathy-context 2.6 — the weakest point). */
	let configSettled = false;

	/** Rows between hosts (D-g′): clearScope's orphan window — off their
	 *  tabs with nothing closed (stream, events, watch and any pending
	 *  linger timer intact) until the fresh T1 takes them. Bookkeeping,
	 *  never render state: the entries are the same live row objects. */
	const orphans: JobRow[] = [];
	/** Bumped on every `orphans` mutation. The list itself is plain
	 *  bookkeeping (never render state), but the MIRROR effect must
	 *  re-publish when a row moves on or off it (The Job Bridge 4.2) —
	 *  a move that is otherwise invisible to effects. */
	let orphanMoves = $state(0);

	/** The row showing one job key, and the tab hosting it — tabIndex -1
	 *  for a row between hosts (D-g′). */
	function findJobRow(key: string): { row: JobRow; tabIndex: number } | null {
		for (let i = 0; i < tabs.length; i++) {
			const row = tabs[i].jobRows.find((r) => r.key === key);
			if (row !== undefined) return { row, tabIndex: i };
		}
		const orphan = orphans.find((r) => r.key === key);
		return orphan === undefined ? null : { row: orphan, tabIndex: -1 };
	}

	/** Every job the desk already shows a row for — as `owner|id` keys:
	 *  the ONE attached set both adoption stages hand the predicate, so
	 *  push + snapshot never double-attach and a birth never opens a
	 *  second surface beside a clicked row (The Job Bridge 4.1: with the
	 *  tab species retired, rows are the whole attached set). */
	function attachedKeys(): Set<string> {
		const keys: string[] = [];
		for (const tab of tabs) for (const row of tab.jobRows) keys.push(row.key);
		for (const row of orphans) keys.push(row.key); // between hosts, still attached
		return new Set(keys);
	}

	/** PRD 4.7 — a dismissal ENDS when its job is SHOWN SETTLED: a roster or
	 *  frame that lists it no longer live (completed, killed, failed).
	 *  ABSENCE is never evidence. A snapshot that PREDATES the job's birth
	 *  shows it absent exactly like a roster it has left — and the spine
	 *  snapshot lags a birth by up to one tick. So "absent from a roster the
	 *  desk itself refreshes" released a row dismissed within one tick of
	 *  its birth, and the next frame re-adopted it: the operator's close was
	 *  undone (the lane floor's live gate, 2026-11-25 — dismissed at 1.2 s,
	 *  back within 7.5 s; pinned red→green in terminal-desk-job-adopt). A
	 *  key whose job vanishes unseen simply stays in the set: ids are
	 *  registry-issued and never reused, so it costs nothing (trap 1). */
	function pruneDismissed(owner: string, roster: readonly DsiJobView[]): void {
		for (let i = dismissed.length - 1; i >= 0; i--) {
			const key = dismissed[i];
			// an OWNED job is its own owner's business; an unowned one
			// rides every roster (its key starts with '|')
			const keyOwner = key.slice(0, key.indexOf('|'));
			if (keyOwner !== '' && keyOwner !== owner) continue;
			const shown = roster.find((job) => jobKey(job) === key);
			if (shown !== undefined && !isLiveJob(shown)) dismissed.splice(i, 1);
		}
	}

	function closeJobRow(row: JobRow, dismiss = true): void {
		// idempotent: a row already gone finds nothing
		const at = findJobRow(row.key);
		if (at === null) return;
		cancelJobRowClose(row);
		row.closer();
		// A DISMISSING close (the row's ✕, the roster row's clear button,
		// clearScope's 'jobs' verb): closed while STILL live → its key is
		// dismissed, it stays closed (trap 1); a settled row records
		// nothing. A RELEASE (dismiss=false — the desk, or its last tab, is
		// going away) records nothing: the operator dismissed no strip (D-g′).
		if (dismiss && !row.settled && !dismissed.includes(row.key)) dismissed.push(row.key);
		if (row.owner) jobsRoster.unwatch(row.owner);
		if (at.tabIndex < 0) {
			const i = orphans.findIndex((r) => r.key === row.key);
			if (i >= 0) {
				orphans.splice(i, 1);
				orphanMoves += 1; // a plain list — the mirror must drop the released row
			}
			return;
		}
		const jobRows = tabs[at.tabIndex].jobRows;
		const i = jobRows.findIndex((r) => r.key === row.key);
		if (i >= 0) jobRows.splice(i, 1);
	}

	/** A DISMISSING close for every row of a tab — the clear verb's 'jobs'
	 *  scope (and destroy): through closeJobRow, so a still-live job records
	 *  its dismissal, every follow closes and every watch is released. */
	function dismissTabJobRows(tab: Tab): void {
		for (const row of [...tab.jobRows]) closeJobRow(row);
	}

	/** D-g′ — a tab that goes away (its ×, the clear-tab chord, its last
	 *  shell exiting) never dismisses a job: its rows RELOCATE to the tab
	 *  that becomes selected, as the SAME objects — one follow stream
	 *  (never closed and re-opened), the same events and key, the watch
	 *  kept, no dismissal recorded. Why: visibility must not couple to the
	 *  host shell's lifetime; stickiness belongs to the operator's
	 *  dismissal of the strip. No tab remains (`to === null`) — the desk
	 *  is going away: release without dismissing. */
	function relocateTabJobRows(tab: Tab, to: Tab | null): void {
		for (const row of [...tab.jobRows]) {
			if (to === null) closeJobRow(row, false);
			else to.jobRows.push(row);
		}
		tab.jobRows.splice(0, tab.jobRows.length);
	}

	/** D-g′ — the clear verb's 'terminals'/'all' scope removes EVERY tab:
	 *  the rows become orphans first (off their tabs, nothing closed) and
	 *  the fresh T1 takes them back once it is minted (see clearScope). */
	function orphanTabJobRows(): void {
		for (const tab of tabs) {
			for (const row of tab.jobRows) orphans.push(row);
			tab.jobRows.splice(0, tab.jobRows.length);
		}
		orphanMoves += 1;
	}

	function scheduleJobRowClose(row: JobRow): void {
		if (pendingCloses.has(row.key)) return; // one timer per row
		pendingCloses.set(
			row.key,
			setTimeout(() => {
				pendingCloses.delete(row.key);
				closeJobRow(row);
			}, JOB_ROW_CLOSE_DELAY_MS)
		);
	}

	function cancelJobRowClose(row: JobRow): void {
		const timer = pendingCloses.get(row.key);
		if (timer !== undefined) {
			clearTimeout(timer);
			pendingCloses.delete(row.key);
		}
	}

	/** find-or-create on `owner|id`, across ALL tabs. Found → only select
	 *  the hosting tab (when asked) — never a second row. Not found →
	 *  host on the SELECTED tab: one follow stream, whose callback looks
	 *  the row up by KEY at event time (never a reference a close could
	 *  leave stale); a `status` event settles it. No tab yet (the
	 *  rebuild ladder still running) → nothing to host on: the caller
	 *  holds the request (heldFrames — a roster click the same way:
	 *  heldClicks). */
	function attachJobRow(owner: string, jobId: string, label: string, select: boolean): void {
		const key = owner + '|' + jobId;
		const existing = findJobRow(key);
		if (existing !== null) {
			if (select && existing.tabIndex >= 0) selectedTab = existing.tabIndex; // -1 = between hosts
			return;
		}
		const tabIndex = Math.min(selectedTab, tabs.length - 1);
		const tab = tabs[tabIndex];
		if (!tab) return;
		if (owner) jobsRoster.watch(owner);
		const closer = connectJobFollow(owner, jobId, (event) => {
			const at = findJobRow(key);
			if (at === null) return;
			at.row.events.push(event);
			if (event.type === 'status') {
				at.row.settled = true;
				// the desk watched this job finish on its own stream (D-k)
				if (!settledKeys.includes(key)) settledKeys.push(key);
			}
		});
		tab.jobRows.push({ key, owner, jobId, label, events: [], closer, settled: false });
		if (select) selectedTab = tabIndex;
	}

	/** The adoption seam BOTH stages share: remember the owner, release
	 *  what its roster shows settled, run the ONE predicate, attach each
	 *  pick. A birth never steals the operator's selection (D-h), and
	 *  re-attaching is find-or-create — a repeated roster is inert (the
	 *  replace-on-every-tick trap). */
	function adoptFromRoster(sessionId: string, jobs: readonly DsiJobView[]): void {
		if (sessionId && !knownOwners.includes(sessionId)) knownOwners.push(sessionId);
		// the roster REPLACES, but an ABSENCE is no evidence (pruneDismissed):
		// only a job it shows SETTLED releases its dismissed key
		pruneDismissed(sessionId, jobs);
		const autoAttach = appConfig().jobs.autoAttach;
		for (const job of selectAdoptable(jobs, attachedKeys(), new Set(dismissed), autoAttach)) {
			attachJobRow(job.owner ?? '', job.id, job.label, false);
		}
	}

	/** The PUSH stage's entry — roster-push-client hands each frame here. */
	function adoptFromFrame(sessionId: string, jobs: DsiJobView[]): void {
		if (restoring || !configSettled) {
			heldFrames.push({ sessionId, jobs });
			return;
		}
		adoptFromRoster(sessionId, jobs);
	}

	/** The desk can adopt again (the ladder settled, the config landed):
	 *  release every held frame. */
	function flushHeldFrames(): void {
		if (restoring || !configSettled) return;
		for (const frame of heldFrames.splice(0, heldFrames.length)) adoptFromRoster(frame.sessionId, frame.jobs);
	}

	/** The desk can host again (the ladder settled, the fresh T1 landed):
	 *  replay every held click — an operator click attaches AND selects. */
	function flushHeldClicks(): void {
		if (tabs.length === 0) return;
		for (const click of heldClicks.splice(0, heldClicks.length)) attachJobRow(click.owner, click.jobId, click.label, true);
	}

	const unregisterJobTabOpener = registerJobTabOpener((owner, jobId, label) => {
		// The roster click (the bus keeps its `openJobTab` name — The Job
		// Bridge 4.1: attach-or-select the ROW). No tab to host on yet →
		// hold the click: a pending replay drains here at component init,
		// BEFORE the rebuild ladder runs (TRAP 3).
		if (tabs.length === 0) heldClicks.push({ owner, jobId, label });
		else attachJobRow(owner, jobId, label, true);
	});

	/** The roster row's clear button closes the job's ROW (a dismissing close). */
	const unregisterJobTabClearer = registerJobTabClearer((owner, jobId) => {
		const row = findJobRow(owner + '|' + jobId);
		if (row !== null) closeJobRow(row.row);
	});

	// Job-row linger (The Job Bridge, PRD 4.7 — the rules ADR-0035 D3's
	// job-tab effect applied, carried to rows; that effect retired with its
	// species in Wave 4). Includes the roster-driven settle: a roster
	// showing the row's job no longer live settles the row, so a missed
	// status frame cannot leave a finished job reading live. Reads the
	// roster version (tracked): the page spine's refreshWatched cadence
	// drives it — no component timer (BC-7); the only timer is the 25s grace.
	$effect(() => {
		loadAppConfig();
		const autoClose = appConfig().jobs.autoClose;
		for (const tab of tabs) {
			for (const row of [...tab.jobRows]) {
				if (!row.owner) {
					// an UNOWNED job has no roster to read — its settle IS the end:
					// with autoClose the settle closes it; without, only the row's
					// close control removes it
					if (row.settled && autoClose) scheduleJobRowClose(row);
					else cancelJobRowClose(row);
					continue;
				}
				const roster = jobsRoster.jobs(row.owner); // track the roster version
				const shown = roster.find((job) => job.id === row.jobId);
				if (shown !== undefined && !isLiveJob(shown)) {
					row.settled = true;
					// a roster-driven settle counts the same (D-k)
					if (!settledKeys.includes(row.key)) settledKeys.push(row.key);
				}
				if (!row.settled) continue;
				if (autoClose) {
					const jobGone = shown === undefined;
					const noActiveJobs = !roster.some((job) => isLiveJob(job));
					if (jobGone || noActiveJobs) scheduleJobRowClose(row);
					else cancelJobRowClose(row);
				} else {
					// manual mode: the desk takes NO closing action, ever — the
					// row's close control is the only remover
					cancelJobRowClose(row);
				}
			}
		}
	});

	// The SNAPSHOT stage (The Job Bridge, ADR-0081 D1 — the fallback). The
	// spine tick replaces each watched roster (jobsRoster.jobs reads the
	// store's version signal — tracked here), and this effect runs the
	// SAME predicate over every roster the desk knows: the attached
	// rows' owners (reactive — a new row re-runs it) and the sessions
	// heard on the push. It is what catches a birth the push missed, a
	// desk mounted mid-job, and the unowned jobs that ride every roster.
	// The setting is read HERE, at adoption time (PRD 4.5), so a config
	// landing re-runs the rule. Dismissal is pruned here too.
	$effect(() => {
		loadAppConfig();
		const autoAttach = appConfig().jobs.autoAttach;
		const owners: string[] = [];
		// the owners of the attached rows (each holds its own watch on the store)
		for (const tab of tabs) {
			for (const row of tab.jobRows) {
				if (row.owner === '') continue;
				if (!owners.includes(row.owner)) owners.push(row.owner);
			}
		}
		for (const owner of knownOwners) {
			if (!owners.includes(owner)) owners.push(owner);
		}
		// The page's own session rows (the spine feed — tracked here, so every
		// tick re-runs the rule): a job that PREDATES the desk's mount never
		// gets a birth frame, and nothing else names its owner. This is the
		// fallback the spec's edge case promises — "a desk mounted mid-job
		// catches it on the next tick" (karpathy 2.4; found by the live gate,
		// 2026-11-25: the lane's own dev-server job never painted). An owner
		// nobody watches reads [] — harmless.
		for (const row of spineFeed.rows) {
			if (row.sessionId && !owners.includes(row.sessionId)) owners.push(row.sessionId);
		}
		for (const owner of owners) {
			const roster = jobsRoster.jobs(owner); // tracks the roster version
			pruneDismissed(owner, roster);
			// attachedKeys() re-read per owner: a row attached for a previous
			// owner is already in the set (one unowned job rides every roster)
			// D-k: a snapshot that lags the follow must never resurrect a row the
			// desk watched settle — settledKeys ride the dismissed set HERE only
			for (const job of selectAdoptable(roster, attachedKeys(), new Set([...dismissed, ...settledKeys]), autoAttach)) {
				attachJobRow(job.owner ?? '', job.id, job.label, false); // a birth never steals the selection
			}
		}
	});

	onMount(() => {
		// The Job Bridge (ADR-0081 D1), the PUSH stage: the desk hears every
		// roster frame the relay forwards, on the ONE stream the push client
		// refcounts (released on destroy). No platform push (no EventSource:
		// a unit environment) → the client registers nothing, and the
		// snapshot effect above is the desk's only birth signal.
		const offPush = subscribeRosterPush((sessionId, jobs) => adoptFromFrame(sessionId, jobs));
		// ADR 2026-11-24 D1: the desk hears session-born on the ONE hub. The
		// subscription itself keeps the hub open even with zero rows.
		const offBorn = subscribeSessionBorn((frame) => adoptBorn(frame));
		// Consent before the first frame: once the config load settles, a
		// held frame is adopted — never guessed on the default (2.6).
		void loadAppConfig().then(() => {
			configSettled = true;
			flushHeldFrames();
		});
		return () => {
			offPush();
			offBorn();
			unregisterJobTabOpener();
			unregisterJobTabClearer();
			for (const timer of pendingCloses.values()) clearTimeout(timer);
			pendingCloses.clear();
			// every job row: its follow closes and its watch is released (a
			// leaked stream is a leak; a leaked watch keeps a dead owner
			// refreshing) — through closeJobRow, the one idempotent path. The
			// dismissal state dies with the instance either way.
			for (const tab of tabs) dismissTabJobRows(tab);
			for (const row of [...orphans]) closeJobRow(row, false); // D-g′: between hosts, still ours
			dismissed.length = 0;
			settledKeys.length = 0;
			knownOwners.length = 0;
			heldFrames.length = 0;
			heldClicks.length = 0;
		};
	});

	// ── ⌥+1…9 tab shortcut (2026-09-25) ──────────────────────────────
	// The desk's row panels by row key — the shortcut focuses the first
	// row's live terminal after switching the visible tab. Option (⌥)
	// because Cmd+1…9 is reserved by the browser (tab switching) and
	// never reaches the page.
	let panelEls = $state<Record<number, { focusTerminal: () => void }>>({});

	function onTabShortcut(event: KeyboardEvent): void {
		if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
		// e.code, not e.key — Option+digit composes special characters
		// on macOS (⌥+2 → '™'), the physical key stays 'Digit2'.
		const match = /^Digit([1-9])$/.exec(event.code);
		if (!match) return;
		const i = Number(match[1]) - 1;
		if (i >= tabs.length) return;
		event.preventDefault();
		selectedTab = i;
		void tick().then(() => {
			const row = tabs[i]?.rows[0];
			if (row) panelEls[row.key]?.focusTerminal?.();
		});
	}

	/** Destroy ONE session through the prune verb, healing once on a stale
	 *  token (reattach → retry the SAME DELETE). Pruned records never come
	 *  back to list() — the corpse pile is the thing this chord removes. */
	async function destroyRowSession(assigned: { sessionId: string; token: string }): Promise<void> {
		const destroy = (token: string) =>
			fetch('/api/terminal/' + assigned.sessionId + '/delete', {
				method: 'DELETE',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ token })
			});
		let res = await destroy(assigned.token).catch(() => undefined);
		if (res && res.status === 403) {
			const re = await fetch('/api/terminal/' + assigned.sessionId + '/reattach', { method: 'POST' }).catch(() => undefined);
			const body = (re && re.ok ? await re.json().catch(() => null) : null) as { token?: string } | null;
			if (body?.token) res = await destroy(body.token).catch(() => undefined);
		}
	}

	/** The chord's action (D6): destroy every session of the SELECTED tab
	 *  (split included, live or exited — the server kills, no shell
	 *  cooperation required), then remove the tab WITHOUT re-killing (the
	 *  entries are already pruned; closeTab's send-close would only 404).
	 *  Last tab ⇒ onShellExit removes the desk slot (the panel close). */
	async function clearTabChord(): Promise<void> {
		const tabIndex = selectedTab;
		const tab = tabs[tabIndex];
		if (!tab) return;
		for (const row of tab.rows) {
			if (row.assigned) await destroyRowSession(row.assigned);
		}
		relocateTabJobRows(tab, tabs[tabIndex + 1] ?? tabs[tabIndex - 1] ?? null); // The Job Bridge D-g′: rows follow the selection, never dismissed
		tabs.splice(tabIndex, 1);
		if (tabs.length === 0) {
			onShellExit?.();
			return;
		}
		selectedTab = Math.min(tabIndex, tabs.length - 1);
	}

	/** The truthful badge grammar (2026-11-04 amendment, ADR D5e/D5f):
	 *  the shell-tab badge pairs the strip position with the session id —
	 *  single row assigned → 'T1:7' (registry id t-7 → 7); split →
	 *  'T1:7+9' (row order); unassigned → plain 'T1'. Display-only: the
	 *  registry and mirror stay keyed on FULL session ids; the badge is a
	 *  view, mirroring the Glass chip's ordinal grammar. */
	function sessionOrdinal(id: string): string {
		return id.replace(/^t-/, '');
	}
	function badgeSuffix(tab: Tab): string {
		const ids = tab.rows.map((r) => r.assigned?.sessionId ?? '').filter((id) => id !== '');
		return ids.length > 0 ? ':' + ids.map(sessionOrdinal).join('+') : '';
	}
	function badgeTitle(tab: Tab): string {
		const ids = tab.rows.map((r) => r.assigned?.sessionId ?? '').filter((id) => id !== '');
		return ids.length > 0 ? 'session ' + ids.join(', ') : '';
	}

	let lastMirrorJson: string | null = null;
	$effect(() => {
		if (restoring) return;
		// Job ROWS ride the mirror (The Job Bridge, ADR-0081 D5 — successor of
		// the 2026-10-21 amendment, whose job TAB no longer exists): every
		// attached row, hosted on a tab or between hosts (an orphan),
		// publishes in the existing {owner, jobId} shape, and the rebuild
		// ladder re-attaches each as a row — live jobs only. Iterating the
		// reactive arrays IS the tracking (tabs → each tab.jobRows);
		// `orphans` is plain bookkeeping, so its move counter is read here.
		void orphanMoves;
		const jobs: Array<{ owner: string; jobId: string }> = [];
		for (const tab of tabs) for (const row of tab.jobRows) jobs.push({ owner: row.owner, jobId: row.jobId });
		for (const row of orphans) jobs.push({ owner: row.owner, jobId: row.jobId });
		// Per-pane fonts (ADR-0083 D2/D4): a single-row tab remembers its
		// font as the row's scalar fontPx; a split tab remembers one font
		// PER ROW, index-aligned with the remembered sessionIds.
		const shells = tabs.map((t) => {
			const fonts = t.rows.map((r) => r.fontPx);
			return {
				sessionIds: t.rows.map((r) => r.assigned?.sessionId ?? '').filter((id) => id !== ''),
				...(fonts.length === 1 ? { fontPx: fonts[0] } : { rowFonts: fonts })
			};
		});
		if (shells.length === 0 && jobs.length === 0) return;
		// Publish only on CONTENT change (2026-11-03): the effect re-runs on
		// unrelated churn (prop identity from the owner's re-render), and the
		// owner's sink writes reactive state — publishing identical mirrors
		// every run fed a write→flush cycle to infinite depth.
		const mirror = { tabs: shells, selectedTab, ...(jobs.length > 0 ? { jobs } : {}) };
		const json = JSON.stringify(mirror);
		if (json === lastMirrorJson) return;
		lastMirrorJson = json;
		onMirror?.(mirror);
	});

	/** Mint a fresh session server-side and hand it to a new row (row
	 *  mode). A new tab or split-down NEVER re-attaches an existing
	 *  session — the reattach ladder is reload-recovery, not a spawner. */
	async function mintSession(): Promise<Row | null> {
		opening = true;
		try {
			const res = await fetch('/api/terminal', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: '{}'
			});
			if (!res.ok) {
				// MAX_SESSIONS (ADR D6): the server refused — the desk renders
				// the refusal; it can never lift its own cap.
				if ((await res.json().catch(() => ({})))?.error === 'MAX_SESSIONS') capped = true;
				return null;
			}
			const body = (await res.json()) as { sessionId: string; token: string };
			return { key: mkKey(), assigned: { sessionId: body.sessionId, token: body.token }, fontPx: legacyTerminalFont() };
		} finally {
			opening = false;
		}
	}

	/** The floor's forwarded command action (ADR D2): --new-tab appends a
	 *  tab and selects it; --split-down stacks a row on the SELECTED tab.
	 *  Both open a fresh session (never re-attach). */
	export function applyAction(action: 'new-tab' | 'split-down' | 'clear-tab'): void {
		if (action === 'clear-tab') {
			// The Alt+T, c chord verb's desk half (2026-11-07): destroy every
			// session of the selected tab (kill + prune), close the tab, and
			// the last tab's removal closes the panel via onShellExit.
			void clearTabChord();
			return;
		}
		void (async () => {
			const row = await mintSession();
			if (!row) return;
			if (action === 'new-tab') {
				tabs.push({ key: mkKey(), rows: [row], jobRows: [] });
				selectedTab = tabs.length - 1;
			} else {
				const shell = tabs[Math.min(selectedTab, tabs.length - 1)];
				if (shell) shell.rows.push(row);
			}
		})();
	}

	/** Tab close (D5): ladder-close every row's session, remove the tab,
	 *  move selection to the right neighbor (or left if last); the last
	 *  tab's close removes the desk slot via onShellExit (the floor's
	 *  removePanel path — the same mutation as the column close). */
	function closeTab(tabIndex: number): void {
		const tab = tabs[tabIndex];
		for (const row of tab.rows) {
			if (row.assigned && row.assigned.token === '') {
				// adopted row — heal-close (see killRow, ADR 2026-11-24 D3)
				void destroyRowSession(row.assigned);
				continue;
			}
			if (row.assigned) {
				void fetch('/api/terminal/' + row.assigned.sessionId + '/send', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ token: row.assigned.token, action: 'close' }),
					keepalive: true
				}).catch(() => undefined);
			}
		}
		relocateTabJobRows(tab, tabs[tabIndex + 1] ?? tabs[tabIndex - 1] ?? null); // The Job Bridge D-g′: rows follow the selection, never dismissed
		tabs.splice(tabIndex, 1);
		if (tabs.length === 0) {
			onShellExit?.();
			return;
		}
		selectedTab = Math.min(tabIndex, tabs.length - 1);
	}

	/** Ladder-close ONE row's session without touching the tab arrays —
	 *  the clear verb's per-session half (ADR D5c amendment 2026-11-03). */
	function killRow(row: Row): void {
		if (!row.assigned) return;
		if (row.assigned.token === '') {
			// An ADOPTED row (ADR 2026-11-24 D3) holds no token — the desk
			// never minted one. Closing it goes through the heal ladder
			// (reattach → destroy), which claims the baton as the operator's
			// close, kills the PTY, and prunes the entry.
			void destroyRowSession(row.assigned);
			return;
		}
		void fetch('/api/terminal/' + row.assigned.sessionId + '/send', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ token: row.assigned.token, action: 'close' }),
			keepalive: true
		}).catch(() => undefined);
	}

	/** The clear verb's scope resolution (ADR D5b/D5c amendment 2026-11-03):
	 *  jobs ⇒ dismiss every job row (The Job Bridge D-g′ — the verb's
	 *  scope is 'jobs'; roster unwatch, PTYs untouched);
	 *  terminals ⇒ ladder-close every shell session, then mint ONE fresh T1
	 *  and select it — the fresh-T1 rule: the desk slot is NEVER removed by
	 *  a clear verb, so D5's last-shell onShellExit cascade does not run
	 *  here. The job rows are NOT dismissed: they outlive their hosts and
	 *  move to the fresh T1 (D-g′ — a shell's end is not a dismissal).
	 *  all ⇒ both, ending in fresh T1. */
	function clearScope(scope: 'all' | 'jobs' | 'terminals'): void {
		if (scope === 'jobs' || scope === 'all') {
			for (const tab of tabs) dismissTabJobRows(tab);
		}
		if (scope === 'terminals' || scope === 'all') {
			for (const tab of tabs) {
				for (const row of tab.rows) killRow(row);
			}
			// D-g′: the rows outlive their hosts — orphaned now (stream and
			// events intact), re-hosted on the fresh T1 once it is minted
			orphanTabJobRows();
			tabs.splice(0, tabs.length);
			void (async () => {
				const row = await mintSession();
				if (!row) {
					// no fresh T1 (a cap refusal): nothing will host them — release, never dismiss
					for (const jobRow of [...orphans]) closeJobRow(jobRow, false);
					return;
				}
				const fresh: Tab = { key: mkKey(), rows: [row], jobRows: [] };
				for (const jobRow of orphans.splice(0, orphans.length)) {
					if (!fresh.jobRows.some((r) => r.key === jobRow.key)) fresh.jobRows.push(jobRow);
				}
				orphanMoves += 1;
				tabs.push(fresh);
				selectedTab = 0;
				flushHeldClicks(); // a click held through the orphan window lands now
			})();
		}
	}

	/** Shell exit in a row (D5): the session is already dead — shrink the
	 *  tab; an empty tab closes (selection rules as closeTab); the desk's
	 *  last shell dying removes the slot (if only one terminal overall, it
	 *  means closing the PanelColumn). */
	function removeRow(tabIndex: number, row: Row): void {
		const tab = tabs[tabIndex];
		const i = tab.rows.indexOf(row);
		if (i >= 0) tab.rows.splice(i, 1);
		if (tab.rows.length === 0) closeTab(tabIndex);
	}

	function recordAssigned(row: Row, sessionId: string, token: string): void {
		// The row self-opened through the panel's ladder — remember the
		// lease so a later tab close can kill it and the mirror persists it.
		row.assigned = { sessionId, token };
	}

	// ── Adoption of wire-born sessions (ADR 2026-11-24 The Headless Split) ──
	// D2: only intent-carrying births are adoptable. D3: DISPLAY-FIRST — the
	// row renders from ring + SSE with NO token mint and NO {} reattach at
	// adoption; the first operator keystroke triggers the panel's existing
	// write-heal, which is the claim. D4: the row carries its sessionId in
	// `assigned`, so the mirror effect publishes it and the rebuild ladder
	// restores it after a refresh — no new persistence.
	const pendingBorn: SessionBornFrame[] = [];

	function adoptBorn(frame: SessionBornFrame): void {
		if (restoring) {
			// born while the rebuild ladder is still running — hold, and flush
			// after restore (the sessionId dedupe below then drops doubles)
			pendingBorn.push(frame);
			return;
		}
		if (frame.deskIntent !== 'new-tab' && frame.deskIntent !== 'split-down') return; // D2: headless = invisible
		const already = tabs.some((tb) => tb.rows.some((r) => r.assigned?.sessionId === frame.sessionId));
		if (already) return; // duplicate birth / already adopted / already ours
		// D3: token '' — the panel streams token-free and claims ONLY on the
		// operator's first keystroke through its existing 403-heal.
		const row: Row = { key: mkKey(), assigned: { sessionId: frame.sessionId, token: '' }, fontPx: legacyTerminalFont() };
		if (frame.deskIntent === 'new-tab' || tabs.length === 0) {
			tabs.push({ key: mkKey(), rows: [row], jobRows: [] });
			selectedTab = tabs.length - 1;
		} else {
			const shell = tabs[Math.min(selectedTab, tabs.length - 1)];
			shell.rows.push(row);
		}
	}

	onMount(() => {
		if (!restoring) return;
		// The REBUILD ladder (ADR D3): probe the registry's live sessions,
		// keep the remembered grouping that still matches reality, re-attach
		// each survivor (byte-0 ring replay — the fresh surface needs the
		// scrollback), drop the dead. All dead (or nothing survives the
		// match) ⇒ one fresh self-open row — never a dead frame.
		void (async () => {
			const built: Tab[] = [];
			try {
				const probe = await fetch('/api/terminal');
				const body = (await probe.json()) as {
					enabled: boolean;
					sessions?: Array<{ id: string; exited: boolean; deskIntent?: string }>;
				};
				const live = new Set((body.sessions ?? []).filter((s) => !s.exited).map((s) => s.id));
				for (const remember of restored?.tabs ?? []) {
					const rows: Row[] = [];
					for (const [m, sessionId] of remember.sessionIds.entries()) {
						if (!live.has(sessionId)) continue; // gone or exited — drop
						const res = await fetch('/api/terminal/' + sessionId + '/reattach', {
							method: 'POST',
							headers: { 'content-type': 'application/json' },
							body: '{}'
						});
						if (!res.ok) continue;
						const re = (await res.json()) as { token: string };
						// ADR-0083 D3 one-shot seed: the row's OWN remembered font
						// (split slot or scalar) wins; legacy global only seeds a
						// row that has none — never a live fallback.
						rows.push({
							key: mkKey(),
							assigned: { sessionId, token: re.token },
							fontPx: remember.rowFonts?.[m] ?? remember.fontPx ?? legacyTerminalFont()
						});
					}
					if (rows.length > 0) built.push({ key: mkKey(), rows, jobRows: [] });
				}
				// ADR 2026-11-24 §6 branch I: a birth that happened while NO desk
				// was mounted left its intent in the registry. The rebuild ladder
				// adopts those too — DISPLAY-FIRST (no reattach, token ''), like
				// the live-born path. Sessions the mirror already placed skip.
				for (const s of body.sessions ?? []) {
					if (s.exited) continue; // an exited session is never adopted
					if (s.deskIntent !== 'new-tab' && s.deskIntent !== 'split-down') continue;
					if (built.some((tb) => tb.rows.some((r) => r.assigned?.sessionId === s.id))) continue;
					built.push({ key: mkKey(), rows: [{ key: mkKey(), assigned: { sessionId: s.id, token: '' }, fontPx: legacyTerminalFont() }], jobRows: [] });
				}
			} catch {
				// the probe failing degrades to the fresh-desk fallback below
			}
			if (built.length === 0) {
				tabs = [defaultTab()];
				selectedTab = 0;
			} else {
				tabs = built;
				selectedTab = Math.max(0, Math.min(built.length - 1, restored?.selectedTab ?? 0));
			}
			// D-j (The Job Bridge, ADR-0081 D5): remembered jobs re-attach as
			// ROWS — and only while still live ("finished jobs restore as
			// settled-and-closed, not re-attached live"). Runs after the shell
			// ladder settles, before `restoring` lifts:
			//  - consent first (karpathy 2.4 — the rebuild goes through the SAME
			//    gate as adoption): jobs.autoAttach off ⇒ nothing is probed and
			//    nothing attaches. The config is AWAITED: this ladder can run
			//    before /api/config lands, and the default is never guessed
			//    (2.6).
			//  - per remembered job WITH an owner, the probe takes its OWN watch
			//    (it seeds the store entry) and refreshes that owner's roster;
			//    the ONE predicate (isAdoptable — never a hand-rolled live check,
			//    trap 1) judges the remembered job. The probe's watch is then
			//    released in BOTH arms: an adopted job's row opens its own watch
			//    (attachJobRow) — exactly one per attached row, never two (a
			//    leaked refcount keeps that owner refreshing for the page's
			//    life: the store is module-level).
			//  - finished, unknown, or a DARK roster (the mirror still pending:
			//    the store keeps its empty seed) ⇒ restores CLOSED, no watch left
			//    behind. The push/snapshot stage re-adopts if it is running.
			//  - an UNOWNED job (owner '') has no owner roster to probe: it is
			//    not probed; it rides every roster frame, so the adoption stage
			//    re-attaches it if it is still live.
			// A probe failure degrades to closed — the ladder always reaches
			// restoring = false.
			try {
				await loadAppConfig(); // the deduped in-flight load — never a second fetch
				const autoAttach = appConfig().jobs.autoAttach;
				if (autoAttach) {
					for (const remembered of restored?.jobs ?? []) {
						if (remembered.owner === '') continue;
						jobsRoster.watch(remembered.owner);
						await jobsRoster.refresh(remembered.owner);
						const shown = jobsRoster.jobs(remembered.owner).find((job) => job.id === remembered.jobId);
						jobsRoster.unwatch(remembered.owner); // the probe's own watch — released whichever way it lands
						if (shown !== undefined && isAdoptable(shown, attachedKeys(), new Set(dismissed), autoAttach)) {
							// the roster's label; the job id until a roster names it
							attachJobRow(remembered.owner, remembered.jobId, shown.label || remembered.jobId, false); // never steal the restored selection
						}
					}
				}
			} catch {
				// a roster probe failing degrades to "restores closed"
			}
			restoring = false;
			// births that arrived mid-rebuild now find a settled tree; the
			// sessionId dedupe in adoptBorn drops any the ladder already placed
			for (const frame of pendingBorn.splice(0, pendingBorn.length)) adoptBorn(frame);
			// roster frames the push delivered mid-ladder now find a settled
			// tree too — never lose a job born during the rebuild (The Job
			// Bridge, D-h)
			flushHeldFrames();
			// a roster click that landed mid-ladder (the launcher's pending replay
			// drains at component init, BEFORE this ladder runs — TRAP 3) now finds
			// a settled tree: attach + select, never dropped
			flushHeldClicks();
		})();
	});
</script>

<!--
TerminalDesk — tabs and rows inside the ONE terminal floor slot
(Terminal Desk ADR D1/D3, Wave 2–3). Header of tab buttons; one
container per tab (hidden tabs keep streaming); a split container stacks
the rows. Restoring shows a quiet placeholder until the ladder settles.
-->

<svelte:window onkeydown={onTabShortcut} />
<div bind:this={deskEl} class="flex h-full min-h-0 flex-col rounded-lg bg-slate-900" data-testid="terminal-desk">
	{#if restoring}
		<div class="p-3 text-xs text-slate-500" data-testid="terminal-desk-restoring">...</div>
	{:else}
		<TerminalTabHeader selectedIndex={selectedTab} onClear={clearScope}>
			{#each tabs as tab, i (tab.key)}
				<TerminalTabButton
					index={i}
					label={'T' + (i + 1) + badgeSuffix(tab)}
					title={badgeTitle(tab)}
					selected={i === selectedTab}
					onSelect={() => (selectedTab = i)}
					onClose={() => closeTab(i)}
				/>
			{/each}
		</TerminalTabHeader>
		{#each tabs as tab, i (tab.key)}
			<TerminalTabContainer index={i} visible={i === selectedTab}>
				<TerminalSplitContainer rowCount={tab.rows.length + tab.jobRows.length}>
					{#each tab.rows as row (row.key)}
						<div class="min-h-0" style="flex: 1 1 0; min-height: 10rem;">
							<TerminalPanel
								bind:this={panelEls[row.key]}
								assigned={row.assigned}
								zoom={deskZoom}
								termFontSize={row.fontPx}
								onFontChange={(px) => setRowFont(row, px)}
								onAssigned={(sessionId, token) => recordAssigned(row, sessionId, token)}
								onShellExit={() => removeRow(i, row)}
							/>
						</div>
					{/each}
					<!-- A job row (The Job Bridge, ADR-0081 D4): display-first and
					     READ-ONLY — a JobTail, never a TerminalPanel, so no token
					     exists for a keystroke to reach. tabindex=-1 on the wrapper:
					     nothing here looks typeable; the ✕ is the one control. -->
					{#each tab.jobRows as jobRow (jobRow.key)}
						<div
							class="flex min-h-0 flex-col rounded bg-slate-950/60"
							style="flex: 0 1 auto; height: 9rem; min-height: 6rem;"
							data-testid="terminal-job-row"
							data-state={jobRow.settled ? 'settled' : 'live'}
							tabindex="-1"
						>
							<div class="flex items-center gap-2 border-b border-slate-700/50 px-2.5 py-1 text-[11px] text-slate-400">
								<span class="truncate" title={jobRow.label}>{jobRow.label}</span>
								<span class="text-slate-500" data-testid="terminal-job-row-state">{jobRow.settled ? 'settled' : 'live'}</span>
								<CloseButton
									class="ml-auto rounded px-1 text-slate-500 hover:bg-slate-700 hover:text-slate-200"
									label="Close job row"
									testid="terminal-job-row-close"
									onclick={() => closeJobRow(jobRow)}
								/>
							</div>
							<div class="min-h-0 flex-1">
								<JobTail events={jobRow.events} label={jobRow.label} />
							</div>
						</div>
					{/each}
				</TerminalSplitContainer>
			</TerminalTabContainer>
		{/each}
		{#if opening}
			<div class="p-2 text-[10px] text-slate-500" data-testid="terminal-desk-opening">...</div>
		{/if}
		{#if capped}
			<div class="p-2 text-[10px] text-slate-500" data-testid="terminal-desk-capped">{t(m.terminalSessionCap)}</div>
		{/if}
	{/if}
</div>
