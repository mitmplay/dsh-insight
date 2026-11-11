<script lang="ts" module>
	/**
	 * SchedulerList — pure helpers for the shelf's expanded rows (script
	 * module: the row's honest trailing meta renders from these, no
	 * mount required). The recurrence kind's icon (operator 2026-11-11:
	 * the kind returns as an [icon]{label} column — the wire vocabulary,
	 * not i18n copy). Unknown/absent kind → null: the cell renders the
	 * em-dash, never an invented glyph.
	 */
	import { CalendarDays, CalendarFold, CalendarRange, Hourglass, Repeat, Timer, Zap } from '@lucide/svelte';
	import { relativeTime } from '$lib/utils/time';

	const KIND_ICONS: Record<string, typeof CalendarRange> = {
		rrule: CalendarRange,
		cron: Timer,
		every: Repeat,
		daily: CalendarDays,
		weekly: CalendarFold,
		after: Hourglass,
		at: Zap,
		once: Zap
	};

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

	/**
	 * A receipt's relative age via the shared helper (operator
	 * 2026-11-11: the '3h ago' meta); absent or unparseable → null
	 * (the row falls back to the em-dash — never invented text).
	 */
	function deliveryRelative(iso: string | null): string | null {
		if (iso === null || iso === '') return null;
		const at = Date.parse(iso);
		if (!Number.isFinite(at)) return null;
		return relativeTime(at);
	}
</script>

<script lang="ts">
	/**
	 * SchedulerList — the shelf's expanded row list (extracted from
	 * SidebarSessionScheduler 2026-11-11): the loading/empty/rows
	 * projection of the host's filtered ledger. The host owns the read
	 * (wire + fold + filters, ADR-0058 D4); this component is a pure
	 * projection — no fetch, no prefs, no state beyond the per-row meta.
	 */
	import { resolve } from '$app/paths';
	import { humanizeCountdown } from './SidebarSessionScheduler.svelte';
	import { addPanelFromSidebar } from '$lib/services/panels/panel-registry';
	import { getWorkspaceState } from '$lib/services/conversation/workspace-context.svelte';
	import { conversationSeedUrl } from '$lib/utils/seed-url';
	import { CheckCheck } from '@lucide/svelte';
	import type { DsiScheduledTask } from '$lib/types';

	let {
		tasks,
		loaded = false,
		onrowclick
	}: {
		/** readonly: the host hands over its derived projection, never ownership */
		tasks: readonly DsiScheduledTask[];
		loaded?: boolean;
		onrowclick: (event: MouseEvent, task: DsiScheduledTask) => void;
	} = $props();

	/** The active workspace profile — the seed deep link's scope. */
	function currentProfile(): string | null {
		return getWorkspaceState()?.profile ?? null;
	}

	/** The seed deep link's query part for a target-bearing row (no-floor fallback). */
	function shelfSeed(task: DsiScheduledTask): string {
		return conversationSeedUrl(task.targetSessionId ?? '', currentProfile());
	}

	/**
	 * The row's honest trailing meta (operator 2026-11-11): a pending
	 * row keeps its text countdown; a delivered row becomes CheckCheck
	 * + relative age (exact date in the title); anything else em-dash.
	 */
	const rowMeta = $derived.by(() => {
		return new Map(
			tasks.map((task) => {
				if (task.status === 'active') {
					return [task.id, { delivered: false, text: humanizeCountdown(task.scheduledAt, Date.now()), title: '' }];
				}
				if (task.status === 'ended' && task.lastDelivery !== null) {
					const rel = deliveryRelative(task.lastDelivery.deliveredAt);
					return [
						task.id,
						{
							delivered: true,
							text: rel ?? '—',
							title: 'delivered ' + deliveryDate(task.lastDelivery.deliveredAt) // i18n-skip: keys pending approval
						}
					];
				}
				return [task.id, { delivered: false, text: '—', title: '' }];
			})
		);
	});
</script>

<!-- ROWS CAP (operator 2026-11-11): past 10 rows the column stops growing
	and scrolls — the shelf never pushes the sidebar's lower siblings off. -->
<div class="rows" class:scrollable={tasks.length > 10}>
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
					onclick={(event) => onrowclick(event, task)}
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

{#snippet rowBody(task: DsiScheduledTask)}
	<span
		class="dot"
		class:armed={task.status === 'active'}
		class:paused={task.status === 'paused'}
		class:ended={task.status === 'ended'}
	></span>
	<span class="title">{task.title !== '' ? task.title : '—'}</span>
	{@const KindIcon = task.kind !== null && task.kind !== undefined ? KIND_ICONS[task.kind] ?? null : null}
	<span class="kind" title={task.kind ?? ''}>
		{#if KindIcon}
			<KindIcon size={12} aria-hidden="true" />
		{/if}
		{task.kind ?? '—'}
	</span>
	{@const meta = rowMeta.get(task.id)}
	<span class="meta" title={meta?.title !== '' && meta?.title ? meta.title : undefined}>
		{meta?.text ?? '—'}
		{#if meta?.delivered}
			<CheckCheck size={12} aria-hidden="true" />
		{/if}
	</span>
{/snippet}

<style>
	.rows {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		min-width: 0;
	}

	/* More than 10 rows: cap at 10 rows (1.2125rem each ≈ normal line for
	   the 0.6875rem font + 0.4rem padding, plus 9 column gaps) and hand
	   the rest to a scrollbar. Overscroll chaining is cut so a fling at
	   the cap never scrolls the whole sidebar page instead. */
	.rows.scrollable {
		max-height: 13.25rem;
		overflow-y: auto;
		overscroll-behavior-y: contain;
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

	/* The recurrence column (operator 2026-11-11): fixed width, text
	   left-aligned — every row's label starts at the same x and the
	   title's ellipsis can never shift it (flex-shrink: 0, the title
	   is the only flexible cell). */
	.kind {
		flex-shrink: 0;
		width: 2.75rem;
		display: inline-flex;
		align-items: center;
		gap: 0.15rem;
		font-size: 0.625rem;
		color: var(--color-text-secondary, #6c757d);
		white-space: nowrap;
		overflow: hidden;
	}

	.kind :global(svg) {
		flex-shrink: 0;
	}

	/* The meta is ALSO fixed-width, right-aligned internally: '47m ago'
	   is wider than '1d ago', and a content-sized meta would drag the
	   kind column's x-position row by row (operator screenshot
	   2026-11-11). Both trailing columns now lock to the right edge. */
	.meta {
		flex-shrink: 0;
		width: 3.75rem;
		justify-content: flex-end;
		font-size: 0.625rem;
		color: var(--color-text-secondary, #6c757d);
		white-space: nowrap;
		display: inline-flex;
		align-items: center;
		gap: 0.15rem;
	}

	/* The delivered receipt icon inherits the meta ink (operator
	   2026-11-11: CheckCheck replaces the 'delivered' word). */
	.meta :global(svg) {
		flex-shrink: 0;
	}

	.empty {
		margin: 0;
		padding: 0.15rem 0.3rem;
		font-size: 0.6875rem;
		color: var(--color-text-secondary, #6c757d);
	}
</style>
