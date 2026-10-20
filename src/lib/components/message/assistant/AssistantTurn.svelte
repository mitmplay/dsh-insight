<script lang="ts">
	/**
	 * AssistantTurn — everything the LLM produced for one contiguous run
	 * (OCI pattern, 2026-08-21): responses, reasoning, tool chips, unknown
	 * events — all inside ONE left-aligned bubble whose bottom-LEFT corner
	 * stays square (the "I am answering" tail). PromptBubble handles the
	 * user side (square bottom-right, blue tint).
	 *
	 * When the turn carries text and a time, the same hover-revealed
	 * bottom-center affordances as PromptBubble apply: the ToolsMessage
	 * action row (copy text · canvas capture · raw ⇄ rendered — save
	 * prompt stays prompt-side, showSave={false}) and the
	 * RelativeTime stamp at the bottom-RIGHT edge. Raw mode swaps the
	 * rendered runs for one <pre> of the turn's concatenated text
	 * (text = turnText at the call site; tool-only turns get no row).
	 *
	 * Fork-here (The Fork-Here Button ADR, 2026-09-02): with the `fork`
	 * anchor present (non-sub-agent panels), the action row arms with the
	 * fork button on EVERY turn — including tool-only turns, whose
	 * most-valuable cut points carry chips but little prose. The anchor
	 * rides the row; a fork refusal surfaces as a transient chip pinned
	 * to THIS bubble (always visible for its four seconds — a hover row
	 * would hide it the moment the pointer leaves).
	 *
	 * Presentational shell: the page maps group.entries and renders the
	 * members through the existing components (reasoning section, markdown
	 * body, tool chips); this component owns the grouping visual contract.
	 */
	import ToolsMessage from '$lib/components/message/common/ToolsMessage.svelte';
	import RelativeTime from '$lib/components/message/common/RelativeTime.svelte';
	import TurnUsagePanel from './TurnUsagePanel.svelte';
	import { formatRunDuration } from '$lib/utils/time';
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import type { DsiTokenUsage } from '$lib/types';
	import type { TurnLifecycle } from '$lib/services/conversation/turn-projection';

	let {
		time,
		start = undefined,
		usage = undefined,
		text,
		children,
		fork = null,
		lifecycle = undefined
	}: {
		/** Wire: last entry time of the turn (OCI: one stamp per turn). */
		time?: number;
		/** Wire: first entry time of the turn — with `time` it derives the
		 *  turn's wall time, stamped as the RelativeTime prefix (DSH parity:
		 *  "Ran for 2m 08s"). Absent keeps the bare timestamp. */
		start?: number;
		/** Wire: the turn's summed token usage (turnUsage) — mounts the
		 *  bottom-left usage pill + popup (DSH TurnUsagePanel parity). */
		usage?: DsiTokenUsage;
		/** Turn's concatenated assistant text (turnText) — gates the action row + raw flip. */
		text?: string;
		children: import('svelte').Snippet;
		/** Fork-here anchor (forkable panels only): the turn's first entry
		 *  seq plus the source's title/preset — absent on prompt bubbles and
		 *  read-only sub-agent transcripts. */
		fork?: {
			sessionId: string;
			atSeq: number;
			title?: string | null;
			agentPreset?: string | null;
		} | null;
		/** Turn End Stamp (ADR 2026-09-25): the turn's bracket record joined
		 *  by the scroll area (lifecycleForGroup) — drives the stopped chip
		 *  (aborted/user), wire-pair elapsed (completed), or the fallback
		 *  entry-time stamp. undefined = old ledger / no pair. */
		lifecycle?: TurnLifecycle | undefined;
	} = $props();

	/** Operator-stopped turn (ADR D2): chip + duration-prefix suppression. */
	const stoppedByUser = $derived(
		lifecycle?.reasonKind === 'aborted' && lifecycle?.abortKind === 'user'
	);
	/** Completed turns read elapsed from the WIRE pair (ADR D3); the
	 *  entry-time reconstruction stays only as fallback. */
	const ranPrefix = $derived.by(() => {
		if (stoppedByUser) return undefined;
		if (
			lifecycle?.reasonKind === 'completed' &&
			lifecycle.endMs !== undefined &&
			lifecycle.endMs >= lifecycle.startMs
		) {
			return `Ran for ${formatRunDuration(lifecycle.endMs - lifecycle.startMs)}`;
		}
		return start !== undefined && time !== undefined
			? `Ran for ${formatRunDuration(time - start)}`
			: undefined;
	});

	/** Raw ⇄ rendered flip state — owned here, wired to ToolsMessage. */
	let showRaw = $state(false);
	/** Bubble element ref — capture target for the canvas copy button. */
	let bubbleEl: HTMLDivElement | undefined = $state();

	/** Transient fork-refusal chip — the host's message verbatim, four
	 *  seconds, then the bubble self-heals (the ForkButton chip pattern,
	 *  anchored to the refused turn). */
	let forkError = $state<string | null>(null);
	let forkErrorTimer: ReturnType<typeof setTimeout> | undefined;

	function showForkError(message: string): void {
		forkError = message;
		clearTimeout(forkErrorTimer);
		forkErrorTimer = setTimeout(() => (forkError = null), 4000);
	}
</script>

<div class="flex min-w-0 flex-col items-start">
	<div
		class="group/bubble relative min-w-0 w-full rounded-2xl rounded-bl-sm border border-surface-border bg-surface-elevated px-3 pt-2.5 pb-2 text-sm leading-relaxed text-text-primary"
		bind:this={bubbleEl}
		data-testid="assistant-turn"
	>
		{#if showRaw && text !== undefined}
			<pre
				class="whitespace-pre-wrap break-words font-mono text-text-secondary text-sm leading-relaxed"
				data-testid="message-raw"
			>{text}</pre>
		{:else}
			{@render children()}
		{/if}
		{#if text !== undefined || fork !== null}
			<ToolsMessage
				{text}
				container={bubbleEl}
				bind:showRaw
				showSave={false}
				fork={fork === null ? null : { ...fork, onrefusal: showForkError }}
			/>
		{/if}
		{#if text !== undefined && time !== undefined}
			<!-- Same in-bubble stamp placement as PromptBubble; both sides
			     anchor bottom-RIGHT. The turn's wall time rides as the
			     stamp's PREFIX (DSH parity). -->
			<RelativeTime
				{time}
				role="assistant"
				prefix={ranPrefix}
				class="absolute bottom-0.5 right-3 text-[10px] leading-none text-text-muted/60 group-hover/bubble:text-[var(--color-accent-deep)]"
			/>
		{/if}
		{#if stoppedByUser}
			<!-- Turn End Stamp (ADR D2): the honest end-fate chip — the
			     operator stopped this turn; DSH parity without the banner. -->
			<span
				class="absolute bottom-0.5 left-1/2 -translate-x-1/2 rounded-full border border-status-pending/30 bg-status-pending/100/10 px-1.5 py-0.5 text-[10px] leading-none text-status-pending"
				data-testid="turn-stopped-chip"
				title={t(m.turnStopped)}
			>
				{t(m.turnStopped)}
			</span>
		{/if}
		{#if usage !== undefined}
			<!-- Bottom-LEFT: the pre-2026-09-09 RelativeTime seat. The pill
			     click-opens the per-turn usage popup (DSH TurnUsagePanel
			     parity: Provider/model · Cache hit · Uncached/Cached input ·
			     Output). -->
			<TurnUsagePanel {usage} class="absolute bottom-0.5 left-3 leading-none" />
		{/if}
		{#if forkError}
			<span
				class="absolute right-2 top-1.5 max-w-56 truncate rounded bg-danger-wash px-1.5 py-0.5 text-[10px] text-status-fail"
				data-testid="fork-turn-error"
				role="alert"
				title={forkError}
			>
				{forkError}
			</span>
		{/if}
	</div>
</div>
