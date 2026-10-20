<script lang="ts">
	import type { SessionStats } from '$lib/services/conversation/session-stats';

	/**
	 * ConversationStatsBar — the panel's session baseline (ADR 2026-09-08
	 * "The Stats Bar", D1/D3/D5): one fixed-height line under the transcript
	 * showing what the ledger already proves — turns, steps, tool time,
	 * token totals, cache hit. Pure presentation: the panel derives the
	 * stats and hands them down; segments whose inputs never reached DSI
	 * are omitted, never approximated. Renders nothing before the first
	 * assistant message (D5 gate lives in the derive's null return).
	 */
	let { stats }: { stats: SessionStats | null } = $props();

	/** 85000 -> "1m25s"; 2400000 -> "40m"; 5400000 -> "1h30m"; 250 -> "250ms". */
	function formatDuration(ms: number): string {
		if (ms < 1_000) return `${ms}ms`;
		const totalSec = Math.floor(ms / 1_000);
		const h = Math.floor(totalSec / 3_600);
		const m = Math.floor((totalSec % 3_600) / 60);
		const s = totalSec % 60;
		if (h > 0) return `${h}h${m}m`;
		if (m > 0) return s > 0 ? `${m}m${s}s` : `${m}m`;
		return `${s}s`;
	}

	/** 15800 -> "15.8K"; 56300 -> "56.3K"; 15800000 -> "15.8M"; 108000 -> "108K"; 999 -> "999". */
	function formatTokens(n: number): string {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
		if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
		return String(n);
	}

	const segments = $derived.by(() => {
		if (stats === null) return [] as string[];
		const parts: string[] = [`${stats.turns} turns · ${stats.steps} steps`];
		// Wall times (full-ledger fields): LLM joins tool time in one group,
		// mirroring the DSH bar's durations group.
		const durations: string[] = [];
		if (stats.llmMs !== undefined && stats.llmMs > 0) durations.push(`LLM ${formatDuration(stats.llmMs)}`);
		if (stats.toolMs > 0) durations.push(`Tool ${formatDuration(stats.toolMs)}`);
		if (durations.length > 0) parts.push(durations.join(' · '));
		// Stream speeds (full-ledger fields): TTFT average over its steps,
		// decode throughput over usage-reporting steps.
		const speeds: string[] = [];
		if (stats.ttftSteps !== undefined && stats.ttftSteps > 0 && stats.ttftMs !== undefined) {
			speeds.push(`TTFT avg ${formatDuration(stats.ttftMs / stats.ttftSteps)}`);
		}
		if (stats.decodeMs !== undefined && stats.decodeMs > 0 && stats.decodeTokens !== undefined) {
			speeds.push(`${Math.max(1, Math.round(stats.decodeTokens / (stats.decodeMs / 1_000)))} tok/s`);
		}
		if (speeds.length > 0) parts.push(speeds.join(' · '));
		// 'full-ledger' bills ALL input (cache included); the partial fold
		// keeps its uncached-only figure via the fallback.
		const inputTotal = stats.billedInputTokens ?? stats.inputTokens;
		if (inputTotal !== undefined) {
			parts.push(`Input ${formatTokens(inputTotal)} tok · Output ${formatTokens(stats.outputTokens ?? 0)} tok`);
		}
		if (stats.cacheHitPercent !== undefined) parts.push(`Cache hit ${stats.cacheHitPercent}%`);
		return parts;
	});
</script>

{#if stats !== null}
	<div class="stats-bar" data-testid="conversation-stats-bar" title={segments.join(' | ')}>
		{#each segments as segment, i (segment)}
			{#if i > 0}<span class="sep" aria-hidden="true">|</span>{/if}
			<span class="segment" data-testid="stats-segment">{segment}</span>
		{/each}
	</div>
{/if}

<style>
	/* Fixed one-line baseline (D5): constant height once visible, never
	   wraps, never grows — the Panel Floor's shared height budget.
	   Centered on the panel width; violet ink per operator pick. */
	.stats-bar {
		display: flex;
		align-items: center;
		justify-content: center;
		text-align: center;
		color: var(--color-accent-deep);
		gap: 0.375rem;
		height: 1.5rem;
		padding: 0 0.375rem;
		font-size: 0.75rem;
		opacity: 0.75;
		white-space: nowrap;
		overflow: hidden;
		flex-shrink: 0;
	}
	.segment {
		overflow: hidden;
		text-overflow: ellipsis;
		flex-shrink: 1;
	}
	.sep {
		opacity: 0.5;
		flex-shrink: 0;
	}
</style>
