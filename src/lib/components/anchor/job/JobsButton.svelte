<script lang="ts">
	import { jobsRoster, isLiveJob } from '$lib/services/jobs/roster-store.svelte';
	import JobsPopup from './JobsPopup.svelte';
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';

	/**
	 * JobsButton — the live-jobs leaf of the floating anchor stack (Job
	 * Badge Wave 3, ADR-0026): the conversation session's live background
	 * work as one click beside the transcript. Renders NOTHING while the
	 * conversation session owns no live job, so the anchor stack keeps its
	 * shape at zero. The popup is the shared JobRosterList readout (Wave 3
	 * extraction) — status, label, output bytes, kill with the 3-second
	 * arm-confirm — hosted in FloatingAnchorContainerPopup (The Popup Shell
	 * ADR D1) since the 2026-10-17 placement fix: the hand-rolled absolute
	 * popup broke in embedded panel mode, while the shell's
	 * right-full/vertically-centered placement is the pinned surface the
	 * other anchor leaves (User Messages, Plan) already use.
	 */
	let { sessionId }: { sessionId: string } = $props();

	/** Popup open state — bindable into the shared shell. */
	let open = $state(false);
	/** The toggle's wrapper — the shell's close-contract exclusion. */
	let triggerEl: HTMLElement | undefined = $state(undefined);

	// Refcounted watch: mount opens the poll, unmount closes it — the store
	// entry dies with the button, so a poll never outlives its conversation.
	$effect(() => {
		jobsRoster.watch(sessionId);
		return () => jobsRoster.unwatch(sessionId);
	});

	/** Whole visible roster (own jobs + unowned), reactive. */
	const jobs = $derived(sessionId ? jobsRoster.jobs(sessionId) : []);
	/** Live (running/stopping) count — the button's number, derived FROM jobs. */
	const liveCount = $derived(jobs.filter(isLiveJob).length);
</script>

{#if liveCount > 0}
	<div class="relative" bind:this={triggerEl} data-testid="jobs-button">
		<button
			type="button"
			class="floating-anchor-btn tone-amber"
			class:active={open}
			title={t(() => (liveCount === 1 ? m.jobsLiveTitle_one({ n: liveCount }) : m.jobsLiveTitle_other({ n: liveCount })))}
			data-testid="jobs-button-trigger"
			onclick={() => (open = !open)}
		>
			<span class="dot"></span>{liveCount}
		</button>
		<JobsPopup bind:open {triggerEl} {jobs} {sessionId} />
	</div>
{/if}

<style>
	.floating-anchor-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.15rem;
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 9999px;
		cursor: pointer;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
		transition: background 0.15s, color 0.15s, transform 0.1s;
		font-size: 0.625rem;
		font-variant-numeric: tabular-nums;
	}

	.floating-anchor-btn:hover {
		transform: scale(1.08);
	}

	/* Amber tone — live background work (matches the RowJobBadge dot) */
	.tone-amber {
		border: 1px solid #f59e0b;
		background: color-mix(in srgb, #f59e0b 12%, transparent);
		color: #f59e0b;
	}

	.tone-amber:hover,
	.tone-amber.active {
		color: var(--color-text-primary, #212529);
	}

	.tone-amber.active {
		background: #f59e0b;
		color: #fff;
		border-color: #f59e0b;
	}

	.dot {
		width: 0.4rem;
		height: 0.4rem;
		border-radius: 9999px;
		background: #f59e0b; /* amber — live background work */
	}

	.floating-anchor-btn {
		pointer-events: auto;
	}
</style>
