<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { LoaderCircle, CircleCheck, CircleX, CircleAlert, CircleDashed } from '@lucide/svelte';
	import { jobsRoster, isLiveJob } from '$lib/services/jobs/roster-store.svelte';
	import { openJobTab, clearJobTab } from '$lib/services/jobs/follow-client.svelte';
	import type { DsiJobView } from '$lib/types';

	/**
	 * JobRosterList — the shared live readout of one session's visible job
	 * roster (Job Badge Waves 2+3, ADR-0026): status, label, output bytes
	 * per row, and the kill button with the host's 3-second arm-confirm
	 * (KILL_ARM_MS parity). Kill is the human's only direct job verb (ADR
	 * fact 6); the fence stays server-side. Extracted 2026-10-16 so the
	 * RowJobBadge popover and the JobsButton popup render ONE readout
	 * implementation, never a copy.
	 */
	let { jobs, sessionId }: { jobs: DsiJobView[]; sessionId: string } = $props();

	/** Host kill-arm window (job-controller KILL_ARM_MS). */
	const KILL_ARM_MS = 3000;

	/** Per-job arm state: the id awaiting its confirm click, or null. */
	let armedJobId = $state<string | null>(null);
	let armTimer: ReturnType<typeof setTimeout> | undefined;

	function disarm(): void {
		if (armTimer !== undefined) clearTimeout(armTimer);
		armTimer = undefined;
		armedJobId = null;
	}

	/** First click arms for KILL_ARM_MS; a stale arm expires silently. */
	function arm(jobId: string): void {
		disarm();
		armedJobId = jobId;
		armTimer = setTimeout(disarm, KILL_ARM_MS);
	}

	/** Confirm click — job.kill passthrough; the roster's next poll shows it. */
	async function kill(job: DsiJobView): Promise<void> {
		disarm();
		try {
			await fetch('/api/dsh/jobs', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ sessionId, jobId: job.id })
			});
		} finally {
			void jobsRoster.refresh(sessionId);
		}
	}
</script>

{#if jobs.length === 0}
	<div class="empty" data-testid="job-roster-empty">—</div>
{:else}
	{#each jobs as job (job.id)}
		<div class="job" class:live={isLiveJob(job)} data-job-id={job.id}>
			<!-- status as an icon (2026-10-17, operator request): the word stole
			     a whole column; the full word survives as the tooltip. RUNNING
			     spins — live work is visibly live. -->
			<span class="status" title={job.status}>
				{#if job.status === 'running'}
					<LoaderCircle size={12} class="spin" />
				{:else if job.status === 'stopping'}
					<LoaderCircle size={12} class="stopping" />
				{:else if job.status === 'completed'}
					<CircleCheck size={12} class="ok" />
				{:else if job.status === 'failed'}
					<CircleAlert size={12} class="bad" />
				{:else if job.status === 'killed'}
					<CircleX size={12} class="dead" />
				{:else}
					<CircleDashed size={12} class="dead" />
				{/if}
			</span>
			<!-- Job Follower Tab (ADR-0035; operator spec 2026-10-21): EVERY row
		     opens its follower tab in the desk. The right-aligned clear
		     button closes that job's -J tab (the autoClose:false path). -->
		<button
			type="button"
			class="label clickable"
			title={job.label + ' — open output in terminal'}
			data-testid={'job-open-' + job.id}
			onclick={() => openJobTab(job.owner ?? '', job.id, job.label)}
		>
			{job.label}
		</button>
		<button
			type="button"
			class="clear"
			title="clear this job's terminal tab"
			data-testid={'job-clear-' + job.id}
			onclick={() => clearJobTab(job.owner ?? '', job.id)}
		>
			clear
		</button>
			<span class="bytes">{job.output.total}B</span>
			{#if isLiveJob(job)}
				<button
					type="button"
					class="kill"
					class:armed={armedJobId === job.id}
					data-testid={'job-kill-' + job.id}
					onclick={() => (armedJobId === job.id ? kill(job) : arm(job.id))}
				>
					{armedJobId === job.id ? m.confirmKill() : m.killJob()}
				</button>
			{/if}
		</div>
	{/each}
{/if}

<style>
	/* Row typography matches the shell's sibling popups (UserMessageJumper):
	   text-xs base, px-2.5 py-2 rhythm — the former sizes lived on the
	   hand-rolled .popup container and were lost in the shell port. */
	.job {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.5rem 0.625rem;
		border-radius: 0.25rem;
		font-size: 0.75rem;
		line-height: 1.1rem;
	}

	.job + .job {
		border-top: 1px solid var(--color-border, #eee);
	}

	.status {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 0.875rem;
		color: var(--color-text-muted, #adb5bd);
	}

	.status :global(.spin) {
		color: #f59e0b;
		animation: job-spin 1s linear infinite;
	}

	.status :global(.stopping) {
		color: #f59e0b;
		opacity: 0.6;
	}

	.status :global(.ok) {
		color: var(--color-accent-green, #2f9e44);
	}

	.status :global(.bad) {
		color: #ef4444;
	}

	.status :global(.dead) {
		color: var(--color-text-muted, #adb5bd);
	}

	@keyframes job-spin {
		to {
			transform: rotate(360deg);
		}
	}

	.job.live .status {
		color: #f59e0b;
	}

	.label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-text-primary, #212529);
	}

	.bytes {
		flex-shrink: 0;
		color: var(--color-text-muted, #adb5bd);
		font-variant-numeric: tabular-nums;
	}

	.clear {
		flex-shrink: 0;
		margin-left: auto;
		border: 1px solid var(--color-border, #dee2e6);
		color: var(--color-text-muted, #adb5bd);
		background: transparent;
		border-radius: 0.25rem;
		font-size: 0.5625rem;
		padding: 0.05rem 0.3rem;
		cursor: pointer;
	}

	.clear:hover {
		color: #ef4444;
		border-color: #ef4444;
	}

	.label.clickable {
		cursor: pointer;
		text-align: left;
		background: transparent;
		border: none;
		padding: 0;
		font: inherit;
		color: inherit;
	}

	.label.clickable:hover {
		text-decoration: underline;
	}

	.kill {
		flex-shrink: 0;
		border: 1px solid #ef4444;
		color: #ef4444;
		background: transparent;
		border-radius: 0.25rem;
		font-size: 0.5625rem;
		padding: 0.05rem 0.3rem;
		cursor: pointer;
	}

	.kill.armed {
		background: #ef4444;
		color: #fff;
	}

	.empty {
		color: var(--color-text-muted, #adb5bd);
		padding: 0.25rem;
		text-align: center;
	}
</style>
