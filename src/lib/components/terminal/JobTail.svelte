<script lang="ts">
	import { EVICTION_SEAM, emptyTail, applyFollowEvent, formatCommandLines, explainFollowError } from './job-tail-lines';
	import { LoaderCircle, CircleCheck, CircleX, CircleAlert } from '@lucide/svelte';
	import type { DsiJobFollowEvent } from '$lib/types';
	import * as m from '$lib/paraglide/messages';

	/**
	 * JobTail — the follower tab's surface (ADR-0035 D1/D6): a read-only log
	 * of one job's output ring. Not an xterm: jobs emit plain log text, the
	 * stream is one-way, and the eviction seam must stay visible. The parent
	 * (TerminalDesk) feeds frames; this only renders.
	 */
	let { events, label }: { events: DsiJobFollowEvent[]; label: string } = $props();

	const tail = $derived(events.reduce((s, e) => applyFollowEvent(s, e), emptyTail()));
	const commandLines = $derived(formatCommandLines(label));
	const followError = $derived(explainFollowError(tail.error));
	let tailEl = $state<HTMLElement | null>(null);

	$effect(() => {
		void tail.lines.length;
		tailEl?.scrollTo({ top: tailEl.scrollHeight });
	});
</script>

<div class="flex h-full min-h-0 flex-col" data-testid="job-tail">
	<div class="flex items-center gap-2 px-2.5 py-1.5 text-[11px] text-slate-400 border-b border-slate-700/50">
		{#if tail.settled}
			{#if tail.status === 'killed' || tail.status === 'failed'}
				<CircleX size={12} class="text-red-400" />
			{:else if tail.status === 'completed'}
				<CircleCheck size={12} class="text-green-400" />
			{:else}
				<CircleAlert size={12} class="text-slate-500" />
			{/if}
			<span data-testid="job-tail-settled">{tail.status}</span>
		{:else}
			{#if followError}
				<CircleAlert size={12} class="text-slate-500" />
				<span class="truncate" data-testid="job-tail-unavailable">{followError}</span>
			{:else}
				<LoaderCircle size={12} class="animate-spin text-amber-400" />
				<span class="truncate">{label}</span>
			{/if}
		{/if}
		{#if tail.error}
			<span class="text-red-400" data-testid="job-tail-error">{tail.error}</span>
		{/if}
	</div>
	<div bind:this={tailEl} class="flex-1 min-h-0 overflow-auto px-2.5 py-2 font-mono text-[11px] leading-4 text-slate-200 whitespace-pre-wrap break-all">
		{#if commandLines.length > 0}
			<pre class="mb-2 rounded bg-slate-800/60 p-2 text-slate-300" data-testid="job-tail-command">{commandLines.join('\n')}</pre>
		{/if}
		{#if tail.lines.length === 0}
			<div class="text-slate-500" data-testid="job-tail-empty">{m.jobTailWaiting()}</div>
		{/if}
		{#each tail.lines as line, i (i)}
			<div class:seam={line === EVICTION_SEAM}>{line}</div>
		{/each}
	</div>
</div>

<style>
	.seam {
		color: #94a3b8;
		font-style: italic;
		border-top: 1px dashed #475569;
		margin-top: 0.25rem;
		padding-top: 0.25rem;
	}
</style>
