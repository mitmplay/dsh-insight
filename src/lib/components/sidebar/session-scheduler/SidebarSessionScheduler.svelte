<script lang="ts" module>
	/**
	 * SchedulerShelf — pure helpers (script module: the 2.3-T suite pins
	 * them directly, no mount required). Honest-em-dash discipline lives
	 * here so the markup stays a pure projection of ledger truth.
	 */
	import { SvelteSet } from 'svelte/reactivity';

	/**
	 * The armed-count pill value: rows with status 'active'. The ledger's
	 * paused/ended rows never inflate it.
	 */
	export function armedCount(tasks: ReadonlyArray<{ status: string }>): number {
		let n = 0;
		for (const task of tasks) if (task.status === 'active') n += 1;
		return n;
	}

	/**
	 * Honest countdown for an active row's next fire: 'in 2h 5m' shape,
	 * computed from the caller's now (Date.now() at render — no ticker;
	 * ADR-0058's accepted staleness give-up). A past, absent, or
	 * unparseable scheduledAt renders the em-dash — never invented text.
	 */
	export function humanizeCountdown(scheduledAt: string | null, now: number): string {
		if (scheduledAt === null || scheduledAt === '') return '—';
		const at = Date.parse(scheduledAt);
		if (!Number.isFinite(at)) return '—';
		const deltaMs = at - now;
		if (deltaMs <= 0) return '—';
		const totalMin = Math.floor(deltaMs / 60000);
		const days = Math.floor(totalMin / 1440);
		const hours = Math.floor((totalMin % 1440) / 60);
		const mins = totalMin % 60;
		const parts: string[] = [];
		if (days > 0) parts.push(`${days}d`);
		if (hours > 0) parts.push(`${hours}h`);
		if (mins > 0 || parts.length === 0) parts.push(`${mins}m`);
		return `in ${parts.join(' ')}`;
	}

	/**
	 * A scheduledAt's day stamp (YYYY-MM-DD, deterministic across
	 * locales) — the FilterDateButton dot rule + the day match (Filter
	 * Cluster ADR D3). Absent, empty, or unparseable → '' (excluded
	 * from the dot set, the day match, and S-mode presence).
	 */
	export function shelfDateStamp(scheduledAt: string | null): string {
		if (scheduledAt === null || scheduledAt === '') return '';
		const at = Date.parse(scheduledAt);
		if (!Number.isFinite(at)) return '';
		const d = new Date(at);
		const pad = (n: number): string => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	}

	/** Days holding at least one scheduled task — the calendar's dot set (D3).
	 *  SvelteSet: the set crosses the reactivity boundary as a derived source. */
	export function collectShelfDates(tasks: ReadonlyArray<{ scheduledAt: string | null }>): SvelteSet<string> {
		const dates = new SvelteSet<string>();
		for (const task of tasks) {
			const stamp = shelfDateStamp(task.scheduledAt);
			if (stamp !== '') dates.add(stamp);
		}
		return dates;
	}

	/** Ended rows carrying a delivery receipt — the D slice + its pill (D2/D4). */
	export function deliveredCountOf(tasks: ReadonlyArray<{ status: string; lastDelivery: unknown }>): number {
		let n = 0;
		for (const task of tasks) if (task.status === 'ended' && task.lastDelivery !== null) n += 1;
		return n;
	}

	/**
	 * Rows in the view still awaiting a delivery receipt — the pending
	 * pill (operator amendment 2026-11-11): everything the delivered
	 * pill does not count, slice-faithful (D4). An ended row without a
	 * receipt is pending, not delivered.
	 */
	export function pendingCountOf(tasks: ReadonlyArray<{ status: string; lastDelivery: unknown }>): number {
		return tasks.length - deliveredCountOf(tasks);
	}

	/**
	 * The filter pipeline (Filter Cluster ADR flowchart): name → date →
	 * view. Empty filters pass their stage; 'scheduled' (operator
	 * amendment SC#1 2026-11-11) keeps rows still awaiting delivery —
	 * scheduledAt present-and-parseable AND no receipt yet (a delivered
	 * row is no longer scheduled to fire); 'delivered' keeps ended rows
	 * with a receipt only.
	 */
	export function filterShelfTasks<T extends { title: string; scheduledAt: string | null; status: string; lastDelivery: unknown }>(
		tasks: ReadonlyArray<T>,
		nameFilter: string,
		dateFilter: string,
		viewMode: 'all' | 'scheduled' | 'delivered'
	): T[] {
		const kept: (typeof tasks)[number][] = [];
		for (const task of tasks) {
			// Stage 1 — name: a non-empty filter keeps title substrings (an
			// empty title matches only the empty filter — never invented).
			if (nameFilter !== '' && !task.title.includes(nameFilter)) continue;
			// Stage 2 — date: a picked day keeps rows scheduled on it.
			if (dateFilter !== '' && shelfDateStamp(task.scheduledAt) !== dateFilter) continue;
			// Stage 3 — view (D2; S = pending delivery, SC#1 2026-11-11).
			if (viewMode === 'scheduled' && (shelfDateStamp(task.scheduledAt) === '' || (task.status === 'ended' && task.lastDelivery !== null))) continue;
			if (viewMode === 'delivered' && !(task.status === 'ended' && task.lastDelivery !== null)) continue;
			kept.push(task);
		}
		return kept;
	}

</script>

<script lang="ts">
	/**
	 * SchedulerShelf — the sidebar's scheduler-ledger shelf (ADR-0058,
	 * W2 task 2.3): a collapsed-by-default line between SidebarOpenPanels
	 * and SidebarSessionFilter (D2 placement, D3 per-profile fold) that,
	 * expanded, lists the host's scheduled tasks — status dot (armed
	 * green / paused amber / ended gray), honest countdown or delivery
	 * receipt (CheckCheck + relative age), em-dash for every absent
	 * field. The kind chip is gone (operator 2026-11-11: every row read
	 * the same 'rrule' — noise, not information).
	 *
	 * READ-ONLY surface (D4): the only wire traffic is the unary
	 * schedule/list read behind GET /api/dsh/schedule — fetched on mount
	 * when expanded and on EVERY expand, never while collapsed, never
	 * polled, never subscribed (the cut's accepted staleness give-up).
	 * Click-through follows the sidebar-row
	 * grammar exactly (RowSessionItem): addPanelFromSidebar on plain
	 * click, the seed deep link as the no-floor fallback — and ONLY for
	 * a row whose target carries a non-empty sessionId ('new'-kind
	 * targets reserve none; their rows render inert).
	 */
	import { onMount } from 'svelte';
	import SidebarSessionSchedulerHeader from './SidebarSessionSchedulerHeader.svelte';
	import SidebarSessionSchedulerList from './SidebarSessionSchedulerList.svelte';
	import { getWorkspaceState } from '$lib/services/conversation/workspace-context.svelte';
	import { addPanelFromSidebar } from '$lib/services/panels/panel-registry';
	import { loadSchedulerPrefs, saveSchedulerPrefs, type SchedulerViewMode } from '$lib/utils/scheduler-prefs';
	import type { DsiScheduledTask } from '$lib/types';

	/** The active workspace profile — the sidebar-row source of truth. */
	function currentProfile(): string | null {
		return getWorkspaceState()?.profile ?? null;
	}

	// D2/D3 + Filter Cluster D5: the fold AND the filters seed ONCE at
	// component init from the persisted prefs (SSR has no localStorage →
	// the defaults); every change persists immediately. No mount effect,
	// no state assignment in one.
	const seededPrefs = loadSchedulerPrefs(currentProfile());
	let collapsed = $state(seededPrefs.collapsed);
	let nameFilter = $state(seededPrefs.nameFilter);
	let dateFilter = $state(seededPrefs.dateFilter);
	let viewMode = $state<SchedulerViewMode>(seededPrefs.viewMode);
	let tasks = $state.raw<DsiScheduledTask[]>([]);
	let loaded = $state(false);

	/** Persist the whole view blob (fold + filters) — best-effort (D5). */
	function persistPrefs(): void {
		saveSchedulerPrefs({ collapsed, nameFilter, dateFilter, viewMode }, currentProfile());
	}

	/** Filter-row callbacks — the header stays stateless (D1), the host owns + persists. */
	function onFilterInput(event: Event): void {
		nameFilter = (event.currentTarget as HTMLInputElement).value;
		persistPrefs();
	}

	function onDateChange(date: string): void {
		dateFilter = date;
		persistPrefs();
	}

	function onViewChange(next: SchedulerViewMode): void {
		viewMode = next;
		persistPrefs();
	}

	async function fetchTasks(): Promise<void> {
		try {
			const res = await fetch('/api/dsh/schedule');
			const body = (await res.json()) as { items?: unknown };
			tasks = res.ok && Array.isArray(body.items) ? (body.items as DsiScheduledTask[]) : [];
		} catch {
			tasks = [];
		} finally {
			loaded = true;
		}
	}

	// Mount read: an EXPANDED mount fetches on mount; a collapsed mount
	// fetches NOTHING until its first expand (toggle) — the quiet shelf is
	// also a silent one, so mounting the sidebar never adds wire traffic
	// by itself. ADR-0058 D4 amendment (2026-11-11, operator: the stale
	// shelf read as missing schedules): while EXPANDED a 30s refresh keeps
	// the rows honest; collapsed still costs zero traffic.
	onMount(() => {
		if (!collapsed) void fetchTasks();
		const timer = setInterval(() => {
			if (!collapsed && document.visibilityState === 'visible') void fetchTasks();
		}, 30_000);
		return () => clearInterval(timer);
	});

	/** Chevron click — fold/unfold, persist, and re-read the ledger on expand. */
	function toggle(): void {
		collapsed = !collapsed;
		persistPrefs();
		if (!collapsed) void fetchTasks();
	}

	/**
	 * Row click-through — ONLY with a target session (the click gate):
	 * the sidebar-row verb (addPanelFromSidebar); handled → the anchor's
	 * default navigation is swallowed, no floor → the seed href navigates.
	 * (Rendered by SidebarSessionSchedulerList; the gate logic stays with
	 * the host so the List remains a pure projection.)
	 */
	function onRowClick(event: MouseEvent, task: DsiScheduledTask): void {
		if (task.targetSessionId === null || task.targetSessionId === '') return;
		const handled = addPanelFromSidebar({ sessionId: task.targetSessionId, agentPreset: null });
		if (handled) event.preventDefault();
	}

	// The filter pipeline (Filter Cluster ADR): the ledger's truth stays
	// in `tasks`; everything below is a recomputed projection.
	const shelfDates = $derived(collectShelfDates(tasks));
	const filteredTasks = $derived(filterShelfTasks(tasks, nameFilter, dateFilter, viewMode));
</script>

<div class="shelf" data-testid="scheduler-shelf">
	<SidebarSessionSchedulerHeader
		{collapsed}
		pendingCount={pendingCountOf(filteredTasks)}
		deliveredCount={deliveredCountOf(filteredTasks)}
		{nameFilter}
		{dateFilter}
		{viewMode}
		sessionDates={shelfDates}
		ontoggle={toggle}
		onfilterinput={onFilterInput}
		ondatechange={onDateChange}
		onviewchange={onViewChange}
	/>
	{#if !collapsed}
		<SidebarSessionSchedulerList tasks={filteredTasks} {loaded} onrowclick={onRowClick} />
	{/if}
</div>

<style>
	/* The panel-group box grammar (SidebarSessionFilter's sibling voice):
	   accent-tinted border, radius, margins — the shelf reads as a
	   sibling of the Focused/Filter boxes above/below it. */
	.shelf {
		/* Animated gradient surface (Filter Cluster ADR D6, task 3.1) — a
		   component-local copy of the AppSidebarHeader rail-header grammar
		   (KEEP IN SYNC with AppSidebarHeader.svelte — the rail gradient is
		   the grammar's OWNER), recolored 2026-11-14 (operator pick):
		   TRIPLET CORNER BLOOMS — three soft radial washes anchored at the
		   corners over a near-white field (pastel maroon top-left keeping
		   the family voice, pastel blue top-right, pastel green bottom-
		   right). The 12s background-position pan drifts the bloom field
		   gently; AA holds — --color-text-primary #212529 = ~12.7:1 on the
		   palest field. Dark lamp (ADR-0023): same corner geometry,
		   luminance-dropped stops. */
		background-color: #f6f7f9;
		background-image: radial-gradient(at 0% 0%, #f5d0d5 0, transparent 55%),
			radial-gradient(at 100% 0%, #dbe4f7 0, transparent 55%),
			radial-gradient(at 100% 100%, #ddf3e3 0, transparent 55%);
		background-size: 300% 300%;
		animation: shelf-gradient 12s ease-in-out infinite;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.25rem;
		min-width: 0;
		margin: 0.125rem 0;
		border: 1px solid color-mix(in srgb, var(--color-accent-blue, #3b82f6) 35%, var(--color-surface-elevated));
		border-radius: 0.5rem;
	}

	/* Dark lamp: same corner geometry, dropped luminance — the shelf stays
	   a readable sibling of the dark rail. */
	:global(html[data-theme='dark']) .shelf {
		background-color: #20222b;
		background-image: radial-gradient(at 0% 0%, #402a2a 0, transparent 55%),
			radial-gradient(at 100% 0%, #26304a 0, transparent 55%),
			radial-gradient(at 100% 100%, #1f3a2c 0, transparent 55%);
	}

	@keyframes shelf-gradient {
		0% {
			background-position: 0% 50%;
		}
		50% {
			background-position: 100% 50%;
		}
		100% {
			background-position: 0% 50%;
		}
	}

	/* Reduced motion: the pan is decoration — turn the ANIMATION off, the
	   gradient tint itself stays (AppSidebarHeader grammar). */
	@media (prefers-reduced-motion: reduce) {
		.shelf {
			animation: none;
		}
	}

</style>
