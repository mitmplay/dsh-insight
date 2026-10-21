<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	/**
	 * SuggestStrip — the floating suggestion strip above the chat textarea
	 * (ADR D8; ported from OCI's SuggestStrip.svelte).
	 *
	 * Presentational: rows + active index + live query in,
	 * pick/rename/delete/manage/close out. Owns only the exclusive ⋯-menu
	 * coordination (one popup at a time, menuForId); each row renders a
	 * StripChip that owns its own popup state (the multiline preview
	 * tooltip lives in that chip's StripTip).
	 * Composer owns the textarea, query, and prompt refresh. Renders
	 * nothing while rows is empty ({#if rows.length > 0}).
	 *
	 * Floating geometry (BC-1): absolute above the textarea wrapper
	 * (bottom: 100%) — the strip never joins layout, so the textarea's
	 * box never moves when rows appear.
	 */
	import { onMount } from 'svelte';
	import { type SuggestedPrompt } from '$lib/services/chat/prompt-trigger.js';
	import { getWorkspaceState } from '$lib/services/conversation/workspace-context.svelte';
	import { loadTagFilter, saveTagFilter } from '$lib/utils/prompt-tag-prefs';
	import StripChip from './StripChip.svelte';
	import SuggestLine from './SuggestLine.svelte';
	import StripTagChips from './StripTagChips.svelte';

	/** Strip mode (Prompt Macro ADR D1): 'find' — accept inserts the row's
	 *  text (the `?` contract, byte-identical); 'run' — accept RUNS the row
	 *  (the host owns the rest). Threading-only: the chip renders the ⏯ Step
	 *  button for run mode; the host decides what pick/step mean. */
	let {
		rows,
		activeIndex = 0,
		query = '',
		mode = 'find',
		onpick,
		onstep = undefined,
		onrename,
		ondelete,
		onmanage,
		onclose,
		onrefocus = undefined
	}: {
		rows: SuggestedPrompt[];
		activeIndex?: number;
		/** Live trigger query ("?load") — threads to the chip labels so
		 *  rows highlight the matched fragment (F4). Empty = plain. */
		query?: string;
		/** 'run' while the live query starts with `!` (Prompt Macro). */
		mode?: 'find' | 'run';
		onpick: (index: number) => void;
		/** ⏯ Step (run mode): start the row HELD — one line at a time. */
		onstep?: (index: number) => void;
		/** ⋯ menu handlers — both absent renders pick-only chips (the
		 *  broadcast box's strip view shows no dead controls). */
		onrename?: (row: SuggestedPrompt, fields: { uses: string; label: string; text: string }) => void;
		ondelete?: (row: SuggestedPrompt) => void;
		/** Esc/close: host refocuses the prompt textarea. */
		onclose?: () => void;
		/** ⚙ row: host opens the Prompts Manager (Wave 3). */
		onmanage?: () => void;
		/** Tag-chip toggle: host refocuses the prompt textarea — the
		 *  strip's keys live there; focus never parks on a checkbox. */
		onrefocus?: () => void;
	} = $props();

	/** Row whose ⋯ menu is open — null when closed. Exclusive: StripChips
	 *  report open/close and only the matching row shows its popup. */
	let menuForId = $state<number | null>(null);

	function onmenuopen(id: number): void {
		menuForId = id;
	}

	/** Popup closed itself (Save/Delete/Esc) — clear the exclusive-menu id. */
	function onmenuclose(): void {
		menuForId = null;
	}

	// ── Tag chips (The Prompt Tags ADR, 2026-09-14, D10) ──
	const STRIP_TAG_KEY = 'dsi-strip-tags-filter';
	const profile = $derived(getWorkspaceState()?.profile ?? null);

	/** The row's tag words (the stored space-joined form, split). */
	function rowTags(row: SuggestedPrompt): string[] {
		return row.tags ? row.tags.split(' ').filter(Boolean) : [];
	}

	/** recTags: the deduped FIRST-SEEN union of the rows' tags — recomputed
	 *  on every rows change (a $derived over the prop, no fetch: recTags
	 *  describe what is ON SCREEN, not what exists in the library). */
	const recTags = $derived.by(() => {
		const seen = new Set<string>();
		for (const row of rows) for (const w of rowTags(row)) seen.add(w);
		return [...seen];
	});

	/** Checked words — persisted per desk slot. Words that no longer occur
	 *  in recTags STAY persisted but filter nothing (the rows set changed
	 *  under them); they surface again when a row regains the tag. */
	let checkedTags = $state<string[]>([]);

	onMount(() => {
		checkedTags = loadTagFilter(STRIP_TAG_KEY, profile);
	});

	function toggleChecked(word: string): void {
		checkedTags = checkedTags.includes(word)
			? checkedTags.filter((w) => w !== word)
			: [...checkedTags, word];
		saveTagFilter(STRIP_TAG_KEY, checkedTags, profile);
	}

	/** visibleItems: the local AND over the ARRIVED rows, applied BEFORE the
	 *  each — never a refetch. Each item carries the row's ORIGINAL index so
	 *  pick/step callbacks and the host's activeIndex keep their meaning
	 *  when the view is narrowed. Checked words absent from recTags filter
	 *  nothing (D10's persistence rule). */
	const visibleItems = $derived.by(() => {
		const effective = checkedTags.filter((w) => recTags.includes(w));
		const all = rows.map((row, index) => ({ row, index }));
		if (effective.length === 0) return all;
		return all.filter(({ row }) => effective.every((t) => rowTags(row).includes(t)));
	});
</script>

{#if rows.length > 0}
	<div class="suggest-strip" role="listbox" aria-label={t(m.promptSuggestions)} data-testid="suggest-strip">
		{#each visibleItems as { row, index } (row.id)}
			<StripChip
				{row}
				active={index === activeIndex}
				menuOpen={menuForId === row.id}
				anyMenuOpen={menuForId !== null}
				{query}
				{mode}
				onpick={() => onpick(index)}
				onstep={onstep === undefined ? undefined : () => onstep(index)}
				{onrename}
				{ondelete}
				{onclose}
				{onmenuopen}
				{onmenuclose}
			/>
		{/each}
		<SuggestLine {onmanage} />
		<!-- D10: tags-first rows, then the manage affordance, then the tag
		     filter — the bottom of the strip where the eye finishes. -->
		<StripTagChips {recTags} checked={checkedTags} ontoggle={toggleChecked} {onrefocus} />
	</div>
{/if}

<style>
	.suggest-strip {
		/* Floating (BC-1): absolute above the textarea wrapper — the strip
		   never joins layout, so the textarea's box never moves when rows
		   appear and the auto-grow clamp math is unaffected. Height: no
		   fixed max — every row shows, no scrolling inside the strip; the
		   only limit is the screen: the strip grows up from the textarea,
		   so the cap is the viewport minus the input chrome below (~8rem)
		   — it can never render above the top edge. overflow-y is the
		   pathological guard (more rows than a full screen). */
		position: absolute;
		bottom: 100%;
		left: 0;
		right: 0;
		z-index: 5;
		display: flex;
		flex-direction: column;
		background: var(--color-surface-elevated, #ffffff);
		box-shadow: 0 -6px 16px rgba(0, 0, 0, 0.12);
		font-size: 0.75rem;
		max-height: calc(100dvh - 8rem);
		overflow-y: auto;
	}

</style>
