<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	/**
	 * ContextInjection — one harness-injected context message (workspace
	 * instructions · runtime context · skill catalog · loaded skill body ·
	 * compaction checkpoint · the open family: any other injecting plugin,
	 * cross-session recall, unknown kinds) as a simple CHIP
	 * (chip-simplification, 2026-08-22): [chevron icon] + title only —
	 * `instructions` / `context` / `skills` / `skill:<name>` / `compact` /
	 * `<plugin-name>` / `recall:<label>` / `<kind>` (names ride the wire
	 * source; the /compact checkpoint joined 2026-08-31, the open-family
	 * fall-through the same day). An optional second button (ArrowUpRight,
	 * 2026-08-31) opens the chip's referent in its own panel — the
	 * sub-agent report/settled notices carry `senderSessionId`.
	 *
	 * Chip-only since the popup split (2026-08-22): the body renders in
	 * a ChipPopup AFTER the chip row (page-owned) as markdown prose
	 * (MarkdownContent, ToolCallDetail parity) — expanding never pushes
	 * same-row chips. Rendered inline inside a PromptBubble's children
	 * (merged-prompt revision): light-gray transparent pill.
	 *
	 * XSS posture: text renders as TEXT nodes only (no {@html} — BC-12).
	 */
	import { ArrowUpRight, ChevronDown, ChevronRight } from '@lucide/svelte';

	let {
		producer,
		text,
		name,
		open = false,
		ontoggle,
		onopen
	}: {
		producer:
			| 'runtime-context'
			| 'instructions'
			| 'skill-catalog'
			| 'skill-invocation'
	        | 'user-approval'
			| 'goal'
			| 'tool-goal'
			| 'time-context'
			| 'compaction'
			| 'plugin'
			| 'recall'
			| 'injected';
		text: string;
		/** Wire-carried chip name (skill-invocation · recall · plugin ·
		 *  injected · the 2026-11-02 promotions goal/tool-goal/time-context,
		 *  where it rides the tooltip — see `title` for how each uses it). */
		name?: string;
		open?: boolean;
		ontoggle?: () => void;
		/** Optional second affordance beside the toggle — opens the chip's
		 *  referent elsewhere (the sub-agent family's sender panel). Absent
		 *  on chips with no openable referent. */
		onopen?: () => void;
	} = $props();

	// Catalog getters (resolved through t at use site — the reactive seat
	// keeps the chip label live on locale switch; lowercase mono aesthetic).
	const LABELS: Record<typeof producer, () => string> = {
		'runtime-context': () => m.ctxChipContext(),
		instructions: () => m.ctxChipInstructions(),
		'skill-catalog': () => m.ctxChipSkills(),
		'skill-invocation': () => m.ctxChipSkill(),
		'user-approval': () => m.ctxChipUserApproval(),
		goal: () => m.ctxChipGoal(),
		'tool-goal': () => m.ctxChipToolGoal(),
		'time-context': () => m.ctxChipTimeContext(),
		compaction: () => m.ctxChipCompact(),
		plugin: () => m.ctxChipPlugin(),
		recall: () => m.ctxChipRecall(),
		injected: () => m.ctxChipInjected()
	};

	/** Chip title. Tailored producers use their bare category; producers
	 *  whose wire source carries a readable name use it — as a
	 *  `category:name` pair where the category is the attribution
	 *  (skill:dsh-doc · recall:session-title), and BARE where the name IS
	 *  the attribution (the plugin's own name, an unknown kind string). */
	const title = $derived.by(() => {
		const label = t(LABELS[producer]);
		if (name === undefined || name === '') return label;
		if (producer === 'skill-invocation' || producer === 'recall') return `${label}:${name}`;
		if (producer === 'plugin' || producer === 'injected') return name;
		return label;
	});

	// The 2026-11-02 promotions (The Chip Label Promotion ADR D3): the wire
	// plugin string rides the TOOLTIP, never the visible label — the label
	// stays the bare catalog translation. `title` (hover) + the aria label
	// keep the wire nameable for debugging.
	const WIRE_NAMED: readonly string[] = ['goal', 'tool-goal', 'time-context'];
	const wireName = $derived(
		name !== undefined && name !== '' && WIRE_NAMED.includes(producer) ? name : undefined
	);
	const aria = $derived(wireName === undefined ? title : `${title} (${wireName})`);
</script>

<div class="text-xs" data-testid="context-injection-chip" data-producer={producer} data-open={open}>
	<span class="inline-flex items-center">
		<button
			type="button"
			onclick={() => ontoggle?.()}
			aria-expanded={open}
			data-testid="context-injection-toggle"
			aria-label={aria}
			title={wireName}
			class="chip-button inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-mono font-medium max-w-full
				mx-0.5 my-0.5 align-middle shrink-0 transition-colors select-none cursor-pointer
				{open
					? 'bg-accent-purple/20 text-accent-purple border border-accent-purple/30'
					: 'bg-surface0/10 text-text-secondary border border-text-muted/20 hover:bg-surface0/20 hover:text-text-primary'}"
		>
			{#if open}
				<ChevronDown size={10} />
			{:else}
				<ChevronRight size={10} />
			{/if}
			<span class="truncate text-[10px]">{title}</span>
		</button>
		{#if onopen !== undefined}
			<button
				type="button"
				onclick={() => onopen()}
				data-testid="context-injection-open"
				aria-label={t(() => m.openPanelTitle({ title }))}
				title={t(m.openSubagentPanel)}
				class="inline-flex items-center px-0.5 py-0.5 my-0.5 ml-[-2px] rounded-md text-text-secondary
					hover:text-accent-purple transition-colors select-none cursor-pointer shrink-0"
			>
				<ArrowUpRight size={11} />
			</button>
		{/if}
	</span>
</div>

<style>
	.chip-button :global(svg) {
		color: var(--color-accent-purple);
	}
</style>
