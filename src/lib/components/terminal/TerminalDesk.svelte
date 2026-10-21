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
	import { jobsRoster, isLiveJob } from '$lib/services/jobs/roster-store.svelte';
	import { registerJobTabOpener, registerJobTabClearer, connectJobFollow } from '$lib/services/jobs/follow-client.svelte';
	import { appConfig, loadAppConfig } from '$lib/services/config/app-config.svelte';
	import type { DsiJobFollowEvent } from '$lib/types';

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
	};
	type Tab = { key: number; rows: Row[] };

	let {
		onShellExit,
		restored = null,
		onMirror
	}: {
		onShellExit?: () => void;
		/** The clamped blob mirror (from the terminal panel entry) — the
		 *  rebuild ladder's REMEMBERED half; the probe is the authority. */
		restored?: TerminalDeskMirror | null;
		/** Fires whenever the tree settles, with the mirror to persist. */
		onMirror?: (mirror: TerminalDeskMirror) => void;
	} = $props();

	/** The desk's root — the anchor for finding the hosting PanelColumn,
		 *  the WHOLE column (the panel floor slot the desk lives in), not just
	 *  the terminal. Absent column (bare mounts) = null — the button's
	 *  documented no-op. */
	let deskEl = $state<HTMLElement | null>(null);

	let nextKey = 1;
	const mkKey = (): number => nextKey++;

	const defaultTab = (): Tab => ({ key: mkKey(), rows: [{ key: mkKey(), assigned: null }] });

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

	// ── Job follower tabs (ADR-0035 D2/D3) ────────────────────────────
	// A second tab species: a READ-ONLY follow of one job's output ring.
	// Job tabs never mint sessions, never ride the mirror (D5), and are
	// indexed AFTER the shell tabs in the combined selection.
	type JobTab = {
		key: number;
		owner: string;
		jobId: string;
		label: string;
		events: DsiJobFollowEvent[];
		closer: () => void;
		settled: boolean;
	};
	let jobTabs = $state<JobTab[]>([]);
	let unregisterOpener: (() => void) | null = null;

	const jobCount = (): number => tabs.length + jobTabs.length;

	function closeJobTab(tab: JobTab): void {
		const timer = pendingCloses.get(tab.key);
		if (timer !== undefined) {
			clearTimeout(timer);
			pendingCloses.delete(tab.key);
		}
		const i = jobTabs.indexOf(tab);
		if (i < 0) return;
		tab.closer();
		if (tab.owner) jobsRoster.unwatch(tab.owner);
		jobTabs.splice(i, 1);
		selectedTab = Math.max(0, Math.min(jobCount() - 1, selectedTab));
	}

	/** D3 amendment (operator, 2026-10-21): a settled job tab lingers 25s
	 *  before auto-close — time to read the tail before it disappears. */
	const JOB_TAB_CLOSE_DELAY_MS = 25_000;
	const pendingCloses = new Map<number, ReturnType<typeof setTimeout>>();

	function scheduleJobTabClose(tab: JobTab): void {
		if (pendingCloses.has(tab.key)) return; // one timer per tab
		pendingCloses.set(
			tab.key,
			setTimeout(() => {
				pendingCloses.delete(tab.key);
				closeJobTab(tab);
			}, JOB_TAB_CLOSE_DELAY_MS)
		);
	}

	/** The condition un-applied (roster refilled, job re-listed) — undo a
	 *  pending close. Without this, a transient empty-roster window (status
	 *  frame racing the first roster frame) permanently armed the close. */
	function cancelJobTabClose(tab: JobTab): void {
		const timer = pendingCloses.get(tab.key);
		if (timer !== undefined) {
			clearTimeout(timer);
			pendingCloses.delete(tab.key);
		}
	}

	function openJobTab(owner: string, jobId: string, label: string, select = true): void {
		const existing = jobTabs.find((t) => t.owner === owner && t.jobId === jobId);
		if (existing) {
			if (select) selectedTab = tabs.length + jobTabs.indexOf(existing);
			return;
		}
		if (owner) jobsRoster.watch(owner);
		const closer = connectJobFollow(owner, jobId, (event) => {
			const t = jobTabs.find((x) => x.owner === owner && x.jobId === jobId);
			if (t === undefined) return;
			t.events.push(event);
			if (event.type === 'status') t.settled = true;
		});
		const tab: JobTab = { key: mkKey(), owner, jobId, label, events: [], closer, settled: false };
		jobTabs.push(tab);
		if (select) selectedTab = jobCount() - 1;
	}

	const unregisterJobTabOpener = registerJobTabOpener((owner, jobId, label) => openJobTab(owner, jobId, label));
	const unregisterJobTabClearer = registerJobTabClearer((owner, jobId) => {
		for (const tab of [...jobTabs]) {
			if (tab.owner === owner && tab.jobId === jobId) closeJobTab(tab);
		}
	});

	// Lifecycle auto-close (D3, amended 2026-10-21): a job tab is a view of
	// ACTIVE work. Once the tab's job has settled AND its owner's roster
	// shows no live jobs (or the job vanished entirely), the tab closes —
	// 'no active jobs' means no terminal for it. Rides the page spine's
	// refreshWatched cadence via the watch opened in openJobTab. A pending
	// roster frame never writes [], so an honest-darkness tick is inert.
	$effect(() => {
		// jobs.autoClose (settings.yaml, default FALSE): false → the -J tab
		// stays until the roster row's clear button or the job leaving the
		// roster; true → the settle + no-active-jobs grace timer closes it.
		loadAppConfig();
		const autoClose = appConfig().jobs.autoClose;
		for (const tab of [...jobTabs]) {
			void jobsRoster.jobs(tab.owner); // track the version signal
			if (!tab.settled) continue;
			// An UNOWNED job has no roster to read — its settle IS the end
			// (the follow stream already closed at status). Owned tabs also
			// demand the roster agree: job gone, or (autoClose only) no live
			// jobs left.
			if (!tab.owner) {
				// no roster to read → with autoClose the settle closes it;
				// without, only the clear button removes it
				if (autoClose) scheduleJobTabClose(tab);
				else cancelJobTabClose(tab);
				continue;
			}
			const roster = jobsRoster.jobs(tab.owner); // track the roster version
			if (autoClose) {
				const jobGone = !roster.some((j) => j.id === tab.jobId);
				const noActiveJobs = !roster.some((j) => isLiveJob(j));
				if (jobGone || noActiveJobs) scheduleJobTabClose(tab);
				else cancelJobTabClose(tab);
			} else {
				// manual mode: the desk takes NO closing action, ever — the
				// roster row's clear button is the only remover
				cancelJobTabClose(tab);
			}
		}
	});

	onMount(() => {
		return () => {
			unregisterJobTabOpener();
			unregisterJobTabClearer();
			for (const timer of pendingCloses.values()) clearTimeout(timer);
			pendingCloses.clear();
			for (const tab of [...jobTabs]) {
				tab.closer();
				if (tab.owner) jobsRoster.unwatch(tab.owner);
			}
			jobTabs = [];
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

	$effect(() => {
		if (restoring) return;
		// Job tabs ride the mirror too (D5 amendment): remembered -J tabs
		// survive a hard reload and re-open their follows on rebuild.
		void jobTabs.length;
		const jobs = jobTabs.map((j) => ({ owner: j.owner, jobId: j.jobId }));
		const shells = tabs.map((t) => ({ sessionIds: t.rows.map((r) => r.assigned?.sessionId ?? '').filter((id) => id !== '') }));
		if (shells.length === 0 && jobs.length === 0) return;
		onMirror?.({
			tabs: shells,
			selectedTab,
			...(jobs.length > 0 ? { jobs } : {})
		});
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
			return { key: mkKey(), assigned: { sessionId: body.sessionId, token: body.token } };
		} finally {
			opening = false;
		}
	}

	/** The floor's forwarded command action (ADR D2): --new-tab appends a
	 *  tab and selects it; --split-down stacks a row on the SELECTED tab.
	 *  Both open a fresh session (never re-attach). */
	export function applyAction(action: 'new-tab' | 'split-down'): void {
		void (async () => {
			const row = await mintSession();
			if (!row) return;
			if (action === 'new-tab') {
				tabs.push({ key: mkKey(), rows: [row] });
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
			if (row.assigned) {
				void fetch('/api/terminal/' + row.assigned.sessionId + '/send', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ token: row.assigned.token, action: 'close' }),
					keepalive: true
				}).catch(() => undefined);
			}
		}
		tabs.splice(tabIndex, 1);
		if (tabs.length === 0) {
			onShellExit?.();
			return;
		}
		selectedTab = Math.min(tabIndex, tabs.length - 1);
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
					sessions?: Array<{ id: string; exited: boolean }>;
				};
				const live = new Set((body.sessions ?? []).filter((s) => !s.exited).map((s) => s.id));
				for (const remember of restored?.tabs ?? []) {
					const rows: Row[] = [];
					for (const sessionId of remember.sessionIds) {
						if (!live.has(sessionId)) continue; // gone or exited — drop
						const res = await fetch('/api/terminal/' + sessionId + '/reattach', {
							method: 'POST',
							headers: { 'content-type': 'application/json' },
							body: '{}'
						});
						if (!res.ok) continue;
						const re = (await res.json()) as { token: string };
						rows.push({ key: mkKey(), assigned: { sessionId, token: re.token } });
					}
					if (rows.length > 0) built.push({ key: mkKey(), rows });
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
			// D5 amendment: remembered -J tabs re-open their follows after the
			// shell ladder settles (label falls back to the job id until the
			// roster names it).
			for (const remembered of restored?.jobs ?? []) {
				openJobTab(remembered.owner, remembered.jobId, remembered.jobId, false); // never steal focus from the restored selection
			}
			restoring = false;
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
		<TerminalTabHeader>
			{#each tabs as tab, i (tab.key)}
				<TerminalTabButton
					index={i}
					label={'T' + (i + 1)}
					selected={i === selectedTab}
					onSelect={() => (selectedTab = i)}
					onClose={() => closeTab(i)}
				/>
			{#each jobTabs as job, ji (job.key)}
				<TerminalTabButton
					index={tabs.length + ji}
					label={'T' + (tabs.length + ji + 1) + '-J'}
					title={job.label || job.jobId}
					selected={tabs.length + ji === selectedTab}
					onSelect={() => (selectedTab = tabs.length + ji)}
					onClose={() => closeJobTab(job)}
				/>
			{/each}
			{/each}
		</TerminalTabHeader>
		{#each tabs as tab, i (tab.key)}
			<TerminalTabContainer index={i} visible={i === selectedTab}>
				<TerminalSplitContainer rowCount={tab.rows.length}>
					{#each tab.rows as row (row.key)}
						<div class="min-h-0" style="flex: 1 1 0; min-height: 10rem;">
							<TerminalPanel
								bind:this={panelEls[row.key]}
								assigned={row.assigned}
								onAssigned={(sessionId, token) => recordAssigned(row, sessionId, token)}
								onShellExit={() => removeRow(i, row)}
							/>
						</div>
					{/each}
				</TerminalSplitContainer>
			</TerminalTabContainer>
		{/each}
		{#each jobTabs as job, ji (job.key)}
			<TerminalTabContainer index={tabs.length + ji} visible={tabs.length + ji === selectedTab}>
				<JobTail events={job.events} label={job.label} />
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
