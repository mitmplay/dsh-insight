<script module lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * slashMenuMatches — the menu's And-filter, exported so the HOST
	 * counts matched rows for its keyboard guard with the SAME matcher
	 * (ONE source of truth; the menu and the ladder-guard never drift).
	 *
	 * Strip parity: split the query on `;` and whitespace, lowercase,
	 * drop empties; EVERY term must hit the row's display text
	 * (`name + description`), case-insensitive. A bare `/` (query with
	 * no terms) matches everything — the open menu lists the whole
	 * vocabulary before the operator narrows it.
	 */
	export function slashMenuMatches(
		row: { name: string; description: string; display?: string },
		query: string
	): boolean {
		const terms = query
			.slice(1)
			.toLowerCase()
			.split(/[;\s]+/)
			.filter(Boolean);
		if (terms.length === 0) return true;
		// The Shelf Voice W1 fix (RCA 2026-09-20): the DISPLAY token is what
		// the operator types — a gesture whose name differs from its display
		// ('skillshelf' vs '/dsi-skills') must still be findable by the
		// visible prefix, so the display rides the haystack.
		const hay = `${row.name} ${row.display ?? ''} ${row.description}`.toLowerCase();
		return terms.every((t) => hay.includes(t));
	}

	/**
	 * slashMenuScrollIntoView — the keyboard-follow rule (2026-09-03 bug
	 * fix): arrowing past the menu's viewport must carry the active row
	 * into view, or the operator steers blind past the cap. PURE so the
	 * math is pinned by plain-number unit tests; the component's effect
	 * applies the returned scrollTop to the menu container only — never
	 * an ancestor scroller (the page must not move because the menu
	 * arrowed).
	 *
	 * @param activeTop the active row's offsetTop (the container is the
	 *                  rows' offsetParent — it is position:absolute).
	 * @param activeBottom activeTop + the row's offsetHeight.
	 * @param scrollTop the container's current scrollTop.
	 * @param clientHeight the container's visible height.
	 * @returns the new scrollTop when the row sits outside the view
	 *          (minimum movement: align the breached edge), null when the
	 *          row is already fully visible — no scroll, no jump.
	 */
	export function slashMenuScrollIntoView(
		activeTop: number,
		activeBottom: number,
		scrollTop: number,
		clientHeight: number
	): number | null {
		if (activeTop < scrollTop) return activeTop;
		if (activeBottom > scrollTop + clientHeight) return activeBottom - clientHeight;
		return null;
	}
</script>

<script lang="ts">
	/**
	 * SlashMenu — the composer's THIRD floating surface (Slash Menu ADR
	 * §3.3, task 2.1): a three-section directory of the session's whole
	 * vocabulary — DSI gestures, Commands, Skills (§1.1's layers A→B→C,
	 * the submit ladder's own priority order) — filtered as the operator
	 * types the `/` draft.
	 *
	 * Presentational (the MacroBar rule): rows + filter query +
	 * lifecycle state in; kind-aware pick events out. No fetch, no store
	 * import — the HOST (Composer) owns the draft, the trigger, the
	 * catalog state, and the keyboard lifecycle. This component renders;
	 * it never listens for keys itself.
	 *
	 * Section semantics (ADR §1.1 + §2 wire facts):
	 *   - DSI gestures — handled by this page, never reach the host.
	 *     A pick is insert-only: `seed` lands in the draft, the
	 *     operator's own Enter is press 2 through the existing ladder
	 *     (the two-press rule). display renders verbatim — the mention
	 *     row is never re-prefixed with `/`.
	 *   - Commands — executed host-side, never reach the model. Rows
	 *     WITHOUT input.hint fire pickCommand (pick = execute); rows WITH
	 *     input.hint fire pickCommandWithHint (pick lands `/name ` — the
	 *     arguments are the operator's). The hint renders as the row's
	 *     SECONDARY line, never a ghost overlay (Resolved decision 7).
	 *   - Skills — shipped as the prompt's first token. pickSkill lands
	 *     `/name ` into the draft; the operator's own Enter sends it (the
	 *     two-press rule). modelInvocable: false renders a muted "you"
	 *     badge — the row still picks (the host serves the catalog it
	 *     lists; DSI never adjudicates).
	 *
	 * Keyboard lifecycle is HOST-OWNED (Resolved decision 6): Tab/Enter
	 * and arrows are intercepted by the HOST only while its own count of
	 * matched rows (same matcher, exported above) is ≥1 — otherwise
	 * Enter falls through to submit and the host closes the menu (the
	 * strip's shipped guard `triggerActive && rows.length > 0`,
	 * Composer.svelte — row-gated interception). Tab accepts exactly
	 * like Enter (strip parity); Shift+Tab cycles back. The menu owns no
	 * key listener and no fall-through branch — the contract is
	 * structural. Loading/idle/failed render status rows that never
	 * match, so their count is 0 and they never intercept.
	 *
	 * Keyboard-follow (2026-09-03): the menu SCROLLS ITS OWN active row
	 * into view whenever activeIndex changes past the capped viewport
	 * (slashMenuScrollIntoView, minimum movement, container-only) —
	 * arrowing past the cap steers by the highlighted row, never blind.
	 *
	 * Floating geometry (SuggestStrip + CommandHelpCard parity):
	 * absolute above the textarea wrapper (bottom: 100%), z-5, elevated
	 * surface — the menu never joins layout, so the textarea's box never
	 * moves when it appears.
	 */
	import type { DsiCommandRow, DsiGestureRow, DsiSkillRow } from '$lib/types';
	import { ensureVoiceMap, voicedSkillRow } from '$lib/services/chat/skill-voice.svelte';

	interface Props {
		/** DSI client-gesture rows (layer A) — the menu's first section. */
		gestures: readonly DsiGestureRow[];
		/** Host command rows, wire order (name-sorted by the host). */
		commands: readonly DsiCommandRow[];
		/** Host skill rows, wire order. */
		skills: readonly DsiSkillRow[];
		/** Catalog lifecycle — loading/idle/failed render status rows. */
		state: 'idle' | 'loading' | 'ready' | 'failed';
		/** Live filter query (the whole `/`-draft, leading slash included). */
		query: string;
		/** Highlighted row over the MATCHED set (gestures, commands, then
		 *  skills — the host owns the index and cycles it on arrows). */
		activeIndex?: number;
		/** Pick a gesture row — the host lands the row's seed (never sends). */
		onpickgesture: (seed: string) => void;
		/** Pick a hint-less command row — the host executes it host-side. */
		onpickcommand: (name: string) => void;
		/** Pick a hint-carrying command row — the host lands `/name `. */
		onpickcommandwithhint: (name: string) => void;
		/** Pick a skill row — the host lands `/name ` (never sends). */
		onpickskill: (name: string) => void;
	}

	let {
		gestures,
		commands,
		skills,
		state: catalogState,
		query,
		activeIndex = 0,
		onpickgesture,
		onpickcommand,
		onpickcommandwithhint,
		onpickskill
	}: Props = $props();

	/** Matched gesture rows — MENU_GESTURES order (the ladder's priority). */
	const matchedGestures = $derived(gestures.filter((row) => slashMenuMatches(row, query)));
	/** Matched command rows — host order kept. */
	const matchedCommands = $derived(commands.filter((row) => slashMenuMatches(row, query)));
	/** Matched skill rows — host order kept. The collision rule (a name
	 *  in both catalogs resolves to the COMMAND) is the ladder's, not the
	 *  menu's — the menu lists every matched row it was given. */
	const matchedSkills = $derived(skills.filter((row) => slashMenuMatches(row, query)).map(voicedSkillRow));

	// Annotation style, NOT the $state<T> generic. NOTE: the destructure
	// above renames the catalog prop to catalogState deliberately — with a
	// prop named `state`, this svelte version lowers a legacy `$state`
	// store-subscription helper that COLLIDES with the $state rune call
	// (menuEl compiled into a subscribe of the prop → store_invalid_shape
	// at mount, 2026-09-03). The prop's public name is unchanged.
	let menuEl: HTMLDivElement | null = $state(null);

	// The Shelf Voice (ADR D5): the voice map is fetched once per session
	// (the overlay store caches); the menu re-derives rows on locale flips.
	$effect(() => {
		void ensureVoiceMap();
	});

	// Keyboard-follow (2026-09-03 bug fix): the HOST cycles activeIndex
	// over the whole matched set; a capped menu (max-height + overflow-y)
	// can leave the active row outside the view — arrow item 17 of 20 in
	// a 15-row viewport and the operator steers blind. On every index
	// change, scroll the container by the minimum the pure rule asks so
	// the active row is fully visible (ARIA combobox pattern). Only the
	// menu's own scrollTop moves — never an ancestor scroller.
	$effect(() => {
		if (catalogState !== 'ready') return;
		void activeIndex;
		const container = menuEl;
		const el = container?.querySelector<HTMLElement>('.slash-row.active') ?? null;
		if (container === null || el === null) return;
		const next = slashMenuScrollIntoView(
			el.offsetTop,
			el.offsetTop + el.offsetHeight,
			container.scrollTop,
			container.clientHeight
		);
		if (next !== null) container.scrollTop = next;
	});
</script>

<div class="slash-menu" role="listbox" aria-label={t(m.slashMenu)} data-testid="slash-menu" bind:this={menuEl}>
	{#if catalogState === 'loading' || catalogState === 'idle'}
		<div class="slash-status" data-testid="slash-menu-loading">{t(m.loadingSessionCommands)}</div>
	{:else if catalogState === 'failed'}
		<div class="slash-status slash-error" data-testid="slash-menu-error">
			{t(m.catalogUnavailable)}
		</div>
	{:else}
		<!-- DSI gestures section — FIRST (§1.1 layer A; the ladder's priority:
		     parseCommand intercepts before the host is ever consulted). -->
		<div class="slash-section-label" data-testid="slash-gestures-label">
			{t(m.dsiGestures)}
			<span class="slash-section-kind">{t(m.gesturesKind)}</span>
		</div>
		{#each matchedGestures as row, i (row.name)}
			<button
				type="button"
				class="slash-row"
				class:active={i === activeIndex}
				role="option"
				aria-selected={i === activeIndex}
				data-testid="slash-gesture-row"
				data-name={row.name}
				onclick={() => onpickgesture(row.seed)}
			>
				<span class="slash-name">{row.display}</span>
				<span class="slash-desc">{row.description}</span>
			</button>
		{/each}
		<!-- Commands section — ABOVE Skills (ADR §3.3). -->
		<div class="slash-section-label" data-testid="slash-commands-label">
			{t(m.commands)}
			<span class="slash-section-kind">{t(m.commandsKind)}</span>
		</div>
		{#each matchedCommands as row, i (row.name)}
			<button
				type="button"
				class="slash-row"
				class:active={matchedGestures.length + i === activeIndex}
				role="option"
				aria-selected={matchedGestures.length + i === activeIndex}
				data-testid="slash-command-row"
				data-name={row.name}
				onclick={() =>
					row.input?.hint !== undefined ? onpickcommandwithhint(row.name) : onpickcommand(row.name)}
			>
				<span class="slash-name">/{row.name}</span>
				<span class="slash-desc">{row.description}</span>
				{#if row.input?.hint !== undefined}
					<span class="slash-hint" data-testid="slash-hint">{row.input.hint}</span>
				{/if}
			</button>
		{/each}
		<!-- Skills section — BELOW Commands. -->
		<div class="slash-section-label" data-testid="slash-skills-label">
			{t(m.skills)}
			<span class="slash-section-kind">{t(m.skillsKind)}</span>
		</div>
		{#each matchedSkills as row, j (row.name)}
			<button
				type="button"
				class="slash-row"
				class:active={matchedGestures.length + matchedCommands.length + j === activeIndex}
				role="option"
				aria-selected={matchedGestures.length + matchedCommands.length + j === activeIndex}
				data-testid="slash-skill-row"
				data-name={row.name}
				onclick={() => onpickskill(row.name)}
			>
				<span class="slash-name">/{row.name}</span>
				<span class="slash-desc">{row.description}</span>
				{#if row.modelInvocable === false}
					<span class="slash-badge" title="Only you can invoke this skill — the model cannot call it">you</span>
				{/if}
				{#if row.whenToUse !== undefined && row.whenToUse !== ''}
					<span class="slash-hint" data-testid="slash-hint">{row.whenToUse}</span>
				{/if}
			</button>
		{/each}
		{#if matchedGestures.length === 0 && matchedCommands.length === 0 && matchedSkills.length === 0}
			<!-- Filter miss on a NON-EMPTY catalog is feedback; an empty
			     catalog (subagent edge) renders the labels above with
			     no rows and no extra copy — an empty answer is correct. -->
			{#if gestures.length + commands.length + skills.length > 0}
				<div class="slash-status" data-testid="slash-menu-nomatch">{t(m.noMatchingCommands)}</div>
			{/if}
		{/if}
	{/if}
</div>

<style>
	.slash-menu {
		/* Floating (strip/help-card parity): absolute above the textarea
		   wrapper — never joins layout. Grows up from the textarea, capped
		   by the viewport; overflow-y is the pathological guard. */
		position: absolute;
		bottom: 100%;
		left: 0;
		right: 0;
		z-index: 5;
		display: flex;
		flex-direction: column;
		background: var(--color-surface-elevated, #ffffff);
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.5rem 0.5rem 0 0;
		box-shadow: 0 -6px 16px rgba(0, 0, 0, 0.12);
		font-size: 0.75rem;
		max-height: calc(100dvh - 10rem);
		overflow-y: auto;
	}
	.slash-section-label {
		display: flex;
		align-items: baseline;
		gap: 0.375rem;
		padding: 0.375rem 0.5rem 0.125rem;
		color: var(--color-text-muted, #868e96);
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.slash-section-kind {
		font-weight: 400;
		text-transform: none;
		letter-spacing: 0;
		color: var(--color-text-muted, #adb5bd);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.slash-row {
		display: flex;
		align-items: baseline;
		gap: 0.375rem;
		width: 100%;
		border: none;
		background: transparent;
		padding: 0.125rem 0.5rem;
		font-size: 0.75rem;
		color: var(--color-text-primary, #212529);
		cursor: pointer;
		text-align: left;
	}
	.slash-row:hover,
	.slash-row.active {
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 10%, transparent);
	}
	.slash-name {
		flex-shrink: 0;
		font-weight: 600;
	}
	.slash-desc {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--color-text-secondary, #6c757d);
	}
	/* Secondary line — the hint/whenToUse wraps under the row's own
	   baseline via flex-wrap on hover-free layout: forced onto its own
	   line (flex-basis 100%) so a hint never pushes the description out. */
	.slash-hint {
		flex-basis: 100%;
		color: var(--color-text-muted, #adb5bd);
		font-size: 0.6875rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.slash-row {
		flex-wrap: wrap;
	}
	.slash-badge {
		flex-shrink: 0;
		padding: 0 0.3rem;
		border-radius: 9999px;
		background: var(--color-surface-hover, #e9ecef);
		color: var(--color-text-secondary, #6c757d);
		font-size: 0.625rem;
		line-height: 1.4;
	}
	.slash-status {
		padding: 0.375rem 0.5rem;
		color: var(--color-text-muted, #868e96);
	}
	.slash-error {
		color: var(--si-run);
	}
</style>
