<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { jobsRoster, isLiveJob } from '$lib/services/jobs/roster-store.svelte';
	import JobRosterList from '$lib/components/jobs/JobRosterList.svelte';

	/**
	 * RowJobBadge — the Job Badge (ADR-0026 D2, Job Badge Wave 2): a dot +
	 * live-job count riding the OWNER session's sidebar row. A job is never a
	 * row (D1) — this component renders NOTHING while the session owns no
	 * live job, so the roster cannot change the row list's shape. Clicking
	 * opens a popover with the whole visible roster (own jobs + unowned) —
	 * the shared JobRosterList readout (Wave 3 extraction): status,
	 * progress, output bytes, kill with the host's 3-second arm-confirm.
	 */

	let { sessionId }: { sessionId: string } = $props();

	/** Popover open state — toggled by badge click, closed by outside click. */
	let open = $state(false);
	let rootEl: HTMLElement | undefined = $state(undefined);

	// ADR-0034 D2 — the badge is a PURE READER: the heartbeat-scope service
	// owns every watch call (viewport rows ∪ panels ∪ current), so a badge
	// never fetches on its own and offscreen rows cost nothing. This effect
	// (ADR-0033's anchored watcher) is retired by that decision.
	// (The old watch/unwatch effect lived here; see ADR-0033 D1 for why it
	// was anchored, and ADR-0034 D2 for why the scope replaced it.)

	/** Whole visible roster (own jobs + unowned), reactive. */
	const jobs = $derived(jobsRoster.jobs(sessionId));
	/** Live (running/stopping) count — derived FROM jobs (single dependency
	 *  chain: two independent store reads each keep their own freshness, and
	 *  the badge's gate must never lag its own data by a flush). */
	const liveCount = $derived(jobs.filter(isLiveJob).length);

	function onWindowClick(e: MouseEvent): void {
		if (open && rootEl && !rootEl.contains(e.target as Node)) {
			open = false;
		}
	}
</script>

<svelte:window onclick={onWindowClick} />

{#if liveCount > 0 || open}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class="job-badge"
		bind:this={rootEl}
		onclick={(e) => {
			e.stopPropagation();
			e.preventDefault();
		}}
		data-testid="job-badge"
	>
		<button
			type="button"
			class="trigger"
			class:open
			title={m.jobs()}
			data-testid="job-badge-trigger"
			onclick={(e) => {
				e.stopPropagation();
				e.preventDefault();
				open = !open;
			}}
		>
			<span class="dot"></span>{liveCount}
		</button>
		{#if open}
			<div class="popover" data-testid="job-badge-popover" onclick={(e) => { e.stopPropagation(); e.preventDefault(); }}>
				<JobRosterList {jobs} {sessionId} />
			</div>
		{/if}
	</div>
{/if}

<style>
	.job-badge {
		position: relative;
		flex-shrink: 0;
		margin-left: auto;
		display: flex;
		align-items: center;
	}

	.trigger {
		display: flex;
		align-items: center;
		gap: 0.2rem;
		border: none;
		background: transparent;
		cursor: pointer;
		font-size: 0.625rem;
		font-variant-numeric: tabular-nums;
		color: var(--color-text-muted, #adb5bd);
		padding: 0 0.15rem;
		border-radius: 0.25rem;
	}

	.trigger:hover,
	.trigger.open {
		color: var(--color-text-primary, #212529);
		background: var(--color-surface-hover, #e9ecef);
	}

	.dot {
		width: 0.4rem;
		height: 0.4rem;
		border-radius: 9999px;
		background: #f59e0b; /* amber — live background work */
	}

	.popover {
		position: absolute;
		right: 0;
		top: 1.4rem;
		z-index: 30;
		min-width: 14rem;
		max-width: 20rem;
		background: var(--color-surface-elevated, #fff);
		border: 1px solid var(--color-border, #dee2e6);
		border-radius: 0.375rem;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
		padding: 0.25rem;
		font-size: 0.6875rem;
	}
</style>
