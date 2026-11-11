<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * SessionFilterToggle — the conversation-count/workspace segmented
	 * toggle (EmptySessionFilter until 2026-08-26; SessionFilter until
	 * 2026-09-04; extracted from SidebarSessionFilter 2026-08-23). Rendered
	 * BY SidebarSessionFilter, immediately after the `All` clear pill
	 * (SessionFilterClear since 2026-09-04): one filter row, one
	 * reading order, no second placement to miss.
	 *
	 * A quad-state `[0] | [!0] | [folder]` control rendered as ONE pill:
	 * zero gap between segments, outer curves only (first button rounds
	 * left, last rounds right; shared edges via border-left-width 0 on
	 * every segment after the first). No count badges — the glyphs alone
	 * carry the meaning.
	 *
	 * Semantics (mutually exclusive segments; tapping the selected one
	 * unselects it):
	 *   'any'      — none selected, no blank/workspace filtering
	 *   'empty'    — [0]: only never-prompted sessions
	 *   'nonempty' — [!0]: only sessions with at least one conversation
	 *   'workspace'— [folder]: only sessions whose cwd is a registered
	 *                (enabled) workspace — ghosts and cwd-less rows drop
	 *
	 * Fully presentational + own geometry: takes the active mode, reports
	 * the next mode. Styles are self-contained — child DOM is out of the
	 * parent's scoped pill rules' reach, so the pill base look lives here
	 * too.
	 */
	import { Folder } from '@lucide/svelte';
	import type { BlankMode } from '$lib/utils/session-filters';

	let {
		mode,
		onchange
	}: {
		/** Active conversation-count mode. */
		mode: BlankMode;
		/** Reports the next mode ('any' when the selected half is re-tapped). */
		onchange: (next: BlankMode) => void;
	} = $props();

	/** Tapping the selected segment unselects it; selecting one
	 *  implicitly deselects the others (mutual exclusion via single-mode
	 *  state). */
	function pick(next: 'empty' | 'nonempty' | 'workspace'): void {
		onchange(mode === next ? 'any' : next);
	}
</script>

<div class="blank-group" role="group" aria-label={t(m.filterCountOrWorkspace)} data-testid="filter-blank-toggle">
	<button
		type="button"
		class="pill left"
		class:on={mode === 'empty'}
		onclick={() => pick('empty')}
		aria-pressed={mode === 'empty'}
		title={t(m.onlyNeverPrompted)}
		data-testid="filter-blank-empty"
	>
		0
	</button>
	<button
		type="button"
		class="pill mid"
		class:on={mode === 'nonempty'}
		onclick={() => pick('nonempty')}
		aria-pressed={mode === 'nonempty'}
		title={t(m.onlyWithConversation)}
		data-testid="filter-blank-nonempty"
	>
		#
	</button>
	<button
		type="button"
		class="pill right"
		class:on={mode === 'workspace'}
		onclick={() => pick('workspace')}
		aria-pressed={mode === 'workspace'}
		title={t(m.onlyEnabledWorkspaces)}
		data-testid="filter-blank-workspace"
	>
		<Folder size={11} aria-hidden="true" />
	</button>
</div>

<style>
	/* Pill base (self-contained — the parent's scoped .pill rules cannot
	   reach into this component's DOM). Same visual contract as the
	   parent's pills, restyled 2026-08-26 for the row's accent-wash
	   field: rest text var(--color-slate-neutral) (5.52:1 on the wash), hover accent-DEEP
	   (5.17:1 — the raw token never cleared AA at 10px). */
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
		padding: 0.25rem 0.25rem;
		cursor: pointer;
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

	/* Segmented control — reads as ONE button: zero gap, shared 1px
	   borders (every segment after the first drops its LEFT border; the
	   edge belongs to the previous segment's right border). First rounds
	   left only, last rounds right only, middle is square. */
	.blank-group {
		display: flex;
		align-items: stretch;
		flex-shrink: 0;
	}

	.pill.left {
		border-top-right-radius: 0;
		border-bottom-right-radius: 0;
		border-top-left-radius: 9999px;
		border-bottom-left-radius: 9999px;
	}

	.pill.mid {
		border-radius: 0;
		border-left-width: 0;
	}

	.pill.right {
		border-top-left-radius: 0;
		border-bottom-left-radius: 0;
		border-top-right-radius: 9999px;
		border-bottom-right-radius: 9999px;
		border-left-width: 0;
	}

	/* Selected segment (2026-08-26): yellowgreen — the SAME attention cue
	   as the row's count-only All pill ("something still filters").
	   The count filter is one story, so the toggle and the All pill that
	   warns about it speak one color. Dark text: #212529 on yellowgreen
	   = 8.19:1 (white on yellowgreen is ~2:1 — never white here). The
	   folder icon inherits the color — it stays #212529 too. */
	.pill.on {
		background: yellowgreen;
		border-color: color-mix(in srgb, yellowgreen 65%, black);
		color: var(--color-text-primary, #212529);
	}

	/* Hover on the selected segment darkens a notch (count-only grammar):
	   #212529 on the darkened field = 5.92:1. */
	.pill.on:hover {
		background: color-mix(in srgb, yellowgreen 85%, black);
		border-color: color-mix(in srgb, yellowgreen 55%, black);
		color: var(--color-text-primary, #212529);
	}

	/* Icon never shrinks inside its segment. */
	.pill :global(svg) {
		flex-shrink: 0;
	}

	/* Selected pill (app.css icon standard exception): the icon follows
	   the on-state text color — white on the saturated surface — so the
	   global purple default never paints it into its own background. At
	   rest the global purple applies (the pill's icon identity). */
	.pill.on :global(svg) {
		color: inherit;
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
