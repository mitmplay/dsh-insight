<script lang="ts" module>
	/**
	 * SchedulerShelf — pure helpers (script module: the 2.3-T suite pins
	 * them directly, no mount required). Honest-em-dash discipline lives
	 * here so the markup stays a pure projection of ledger truth.
	 */

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
	 * The delivery receipt's date (YYYY-MM-DD, deterministic across
	 * locales); absent or unparseable → the em-dash.
	 */
	function deliveryDate(iso: string | null): string {
		if (iso === null || iso === '') return '—';
		const at = Date.parse(iso);
		if (!Number.isFinite(at)) return '—';
		const d = new Date(at);
		const pad = (n: number): string => String(n).padStart(2, '0');
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	}
</script>

<script lang="ts">
	/**
	 * SchedulerShelf — the sidebar's scheduler-ledger shelf (ADR-0058,
	 * W2 task 2.3): a collapsed-by-default line between SidebarOpenPanels
	 * and SidebarSessionFilter (D2 placement, D3 per-profile fold) that,
	 * expanded, lists the host's scheduled tasks — status dot (armed
	 * green / paused amber / ended gray), kind chip, honest countdown or
	 * delivery receipt, em-dash for every absent field.
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
	import { ChevronDown, ChevronRight, Clock } from '@lucide/svelte';
	import { resolve } from '$app/paths';
	import { addPanelFromSidebar } from '$lib/services/panels/panel-registry';
	import { getWorkspaceState } from '$lib/services/conversation/workspace-context.svelte';
	import { conversationSeedUrl } from '$lib/utils/seed-url';
	import { loadSchedulerPrefs, saveSchedulerPrefs } from '$lib/utils/scheduler-prefs';
	import type { DsiScheduledTask } from '$lib/types';

	/** The active workspace profile — the sidebar-row source of truth. */
	function currentProfile(): string | null {
		return getWorkspaceState()?.profile ?? null;
	}

	// D2/D3: the fold seeds ONCE at component init from the persisted prefs
	// (SSR has no localStorage → the collapsed default); every toggle
	// persists immediately. No mount effect, no state assignment in one.
	let collapsed = $state(loadSchedulerPrefs(currentProfile()).collapsed);
	let tasks = $state.raw<DsiScheduledTask[]>([]);
	let loaded = $state(false);

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
		saveSchedulerPrefs({ collapsed }, currentProfile());
		if (!collapsed) void fetchTasks();
	}

	/**
	 * Row click-through — ONLY with a target session (the click gate):
	 * the sidebar-row verb (addPanelFromSidebar); handled → the anchor's
	 * default navigation is swallowed, no floor → the seed href navigates.
	 */
	function onRowClick(event: MouseEvent, task: DsiScheduledTask): void {
		if (task.targetSessionId === null || task.targetSessionId === '') return;
		const handled = addPanelFromSidebar({ sessionId: task.targetSessionId, agentPreset: null });
		if (handled) event.preventDefault();
	}

	/** The seed deep link's query part for a target-bearing row (no-floor fallback). */
	function shelfSeed(task: DsiScheduledTask): string {
		return conversationSeedUrl(task.targetSessionId ?? '', currentProfile());
	}

	/** The row's honest trailing meta: countdown / receipt / em-dash. */
	const rowMeta = $derived.by(() => {
		return new Map(
			tasks.map((task) => [
				task.id,
				task.status === 'active'
					? humanizeCountdown(task.scheduledAt, Date.now())
					: task.status === 'ended' && task.lastDelivery !== null
						? `delivered ${deliveryDate(task.lastDelivery.deliveredAt)}` // i18n-skip: keys pending approval
						: '—'
			])
		);
	});
</script>

<div class="shelf" data-testid="scheduler-shelf">
	<button
		class="head"
		type="button"
		data-testid="scheduler-shelf-toggle"
		aria-expanded={!collapsed}
		onclick={toggle}
	>
		{#if collapsed}<ChevronRight size={12} />{:else}<ChevronDown size={12} />{/if}
		<Clock size={12} />
		<!-- i18n-skip: locale keys pending planner approval (W2 report proposal) -->
		<span class="label">Scheduler</span>
		<span class="pill" data-testid="scheduler-shelf-count">{armedCount(tasks)}</span>
	</button>
	{#if !collapsed}
		<div class="rows">
			{#if !loaded}
				<!-- first read in flight: show nothing rather than a premature empty line -->
			{:else if tasks.length === 0}
				<!-- the honest empty line: nothing to show, said without copy -->
				<p class="empty">—</p>
			{:else}
				{#each tasks as task (task.id)}
					{#if task.targetSessionId !== null && task.targetSessionId !== ''}
						<a
							class="row"
							href={resolve(shelfSeed(task) as '/')}
							data-testid="scheduler-shelf-row"
							onclick={(event) => onRowClick(event, task)}
						>
							{@render rowBody(task)}
						</a>
					{:else}
						<!-- inert: 'new'-kind targets reserve no session to open -->
						<div class="row" data-testid="scheduler-shelf-row">
							{@render rowBody(task)}
						</div>
					{/if}
				{/each}
			{/if}
		</div>
	{/if}
</div>

{#snippet rowBody(task: DsiScheduledTask)}
	<span
		class="dot"
		class:armed={task.status === 'active'}
		class:paused={task.status === 'paused'}
		class:ended={task.status === 'ended'}
	></span>
	<span class="title">{task.title !== '' ? task.title : '—'}</span>
	<span class="chip">{task.kind ?? '—'}</span>
	<span class="meta">{rowMeta.get(task.id) ?? '—'}</span>
{/snippet}

<style>
	/* The panel-group box grammar (SidebarSessionFilter's sibling voice):
	   accent-tinted border, radius, margins — the shelf reads as a
	   sibling of the Focused/Filter boxes above/below it. */
	.shelf {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding: 0.25rem;
		min-width: 0;
		margin: 0.125rem 0;
		border: 1px solid color-mix(in srgb, var(--color-accent-blue, #3b82f6) 35%, var(--color-surface-elevated));
		border-radius: 0.5rem;
	}

	.head {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		min-width: 0;
		padding: 0.15rem 0.3rem;
		border: none;
		background: transparent;
		border-radius: 0.375rem;
		cursor: pointer;
		/* The sidebar's 11px coherence rule (RowSessionItem 2026-11-06). */
		font-size: 0.6875rem;
		color: var(--color-text-primary, #212529);
		text-align: left;
	}

	.label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.pill {
		flex-shrink: 0;
		padding: 0 0.35rem;
		border-radius: 999px;
		font-size: 0.625rem;
		color: var(--color-text-secondary, #6c757d);
		background: color-mix(in srgb, var(--color-accent-purple) 14%, transparent);
	}

	.rows {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}

	.row {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		min-width: 0;
		padding: 0.2rem 0.3rem;
		border-radius: 0.375rem;
		font-size: 0.6875rem;
		color: var(--color-text-primary, #212529);
		text-decoration: none;
	}

	a.row:hover {
		background-color: var(--color-surface-hover, rgba(0, 0, 0, 0.04));
	}

	/* Status dots — armed green / paused amber / ended gray, via the
	   theme's status tokens (both themes). */
	.dot {
		width: 0.5rem;
		height: 0.5rem;
		flex-shrink: 0;
		border-radius: 999px;
		background: var(--color-text-muted, #868e96);
	}
	.dot.armed {
		background: var(--color-status-pass, #10b981);
	}
	.dot.paused {
		background: var(--color-status-pending, #f59e0b);
	}
	.dot.ended {
		background: var(--color-text-muted, #868e96);
	}

	.title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.chip {
		flex-shrink: 0;
		padding: 0 0.3rem;
		border-radius: 0.25rem;
		font-size: 0.625rem;
		color: var(--color-text-secondary, #6c757d);
		background: var(--color-surface-hover, rgba(0, 0, 0, 0.04));
	}

	.meta {
		flex-shrink: 0;
		font-size: 0.625rem;
		color: var(--color-text-secondary, #6c757d);
		white-space: nowrap;
	}

	.empty {
		margin: 0;
		padding: 0.15rem 0.3rem;
		font-size: 0.6875rem;
		color: var(--color-text-secondary, #6c757d);
	}
</style>
