<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * SessionFilterClear — the `All` pill of SessionFilterRow (extracted
	 * 2026-09-04): one button that clears EVERY dimension — workspace,
	 * preset, and the count toggle's blankMode. Fully presentational:
	 * the live filter state arrives, the clear REQUEST reports upward
	 * (onclear) and the owner builds the reset state — the child never
	 * invents a second reset literal. Styles are self-contained — the
	 * parent's scoped pill rules cannot reach this component's DOM, so
	 * the pill look travels with it.
	 *
	 * Two states beyond rest, both derived (never stored):
	 *  - `on` — nothing filters; the pill reads as selected
	 *    (aria-pressed marks it).
	 *  - `count-only` — the conversation-count toggle is the ONLY active
	 *    dimension: the once-invisible state that hid every titled
	 *    session (2026-08-24). Yellowgreen warns "something still
	 *    filters; All clears it", guarded with :not(.on) so the two
	 *    states can never collide.
	 */
	import type { SessionFilterState } from '$lib/utils/session-filters';

	let {
		filter,
		onclear
	}: {
		/** Live filter state — drives the `on` / `count-only` reads. */
		filter: SessionFilterState;
		/** Report the clear request — the owner resets every dimension. */
		onclear: () => void;
	} = $props();

	/** Nothing filters — the pill reads as selected (the resting reset). */
	const allClear = $derived(
		filter.workspace === null && filter.preset === null && filter.blankMode === 'any'
	);

	/** The count toggle is the ONLY active filter dimension. */
	const countOnly = $derived(
		filter.workspace === null && filter.preset === null && filter.blankMode !== 'any'
	);
</script>

<button
	type="button"
	class="pill"
	class:on={allClear}
	class:count-only={countOnly}
	onclick={onclear}
	aria-pressed={allClear}
	title={t(m.clearFilters)}
	data-testid="filter-all"
>
	{t(m.all)}
</button>

<style>
	/* Pill base (self-contained — the parent's scoped .pill rules cannot
	   reach into this component's DOM). Same visual contract as the
	   row's pills, restyled 2026-08-26 for the accent-wash field: rest
	   text var(--color-slate-neutral) (5.52:1 on the wash), hover accent-DEEP text + tint
	   field (5.17:1), selected accent-DEEP fill + white (5.17:1; the
	   raw token managed 3.68:1). Border matches the box's accent tint. */
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		border: 1px solid color-mix(in srgb, var(--color-accent-blue, #3b82f6) 35%, var(--color-surface-elevated));
		border-radius: 9999px;
		background: transparent;
		color: var(--color-slate-neutral);
		font-size: 0.625rem;
		line-height: 1;
		padding: 0.25rem 0.5rem;
		cursor: pointer;
		max-width: 9rem;
		white-space: nowrap;
		transition:
			color 0.15s ease,
			border-color 0.15s ease,
			background-color 0.15s ease;
	}

	.pill:hover {
		border-color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, var(--color-navy-focus));
		color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, var(--color-navy-focus));
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 12%, var(--color-surface-elevated));
	}

	.pill.on {
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 65%, var(--color-navy-focus));
		border-color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 65%, var(--color-navy-focus));
		color: #fff;
	}

	/* Count-only All (2026-08-24): the conversation-count toggle is the
	   ONLY active filter — the state that once hid every titled session
	   with no visible cause. Yellowgreen is the attention cue: "something
	   still filters; All clears it". Guarded like every rest state so it
	   can never collide with .on. Dark text — white on yellowgreen is
	   unreadable (~2:1). */
	.pill.count-only:not(.on) {
		background: yellowgreen;
		border-color: color-mix(in srgb, yellowgreen 65%, black);
		color: var(--color-text-primary, #212529);
	}

	.pill.count-only:not(.on):hover {
		background: color-mix(in srgb, yellowgreen 85%, black);
		border-color: color-mix(in srgb, yellowgreen 55%, black);
		color: var(--color-text-primary, #212529);
	}
	/* Dark theme (2026-11-06 SC#3): the rest/hover borders follow the
	   AccessModeChip recipe — accent-deep re-points to the soft dark
	   violet; the light-tuned blue color-mix read too hot on dark.
	   Selected (.on) and the yellowgreen count-only cue are state
	   signals — unchanged. */
	:global([data-theme='dark']) .pill {
		border-color: var(--color-accent-deep);
	}

	:global([data-theme='dark']) .pill:hover {
		border-color: var(--color-accent-deep);
	}
</style>
