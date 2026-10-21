<script lang="ts">
	/**
	 * PanelColumn — one panel's fixed-width column shell (Panel Floor W3
	 * task 3.2, ADR-0006): PanelHeader (floor chrome) + the conversation
	 * body (ConversationPanel, keyed by sessionId INSIDE the route's each
	 * — remount locality) + the 6px ResizeGutter after every panel.
	 *
	 * Presentational shell only: width and selection arrive as props
	 * (bound up to the route); the body arrives as a snippet so the ROUTE
	 * owns the {#key panel.sessionId} remount and the per-panel cold data.
	 *
	 * Width badge (2026-08-28): a `widthBadge` phase prop ('live' during
	 * a gutter drag that moves this panel's width, 'fading' through the
	 * 10s afterglow) floats the CURRENT width at the column's top right,
	 * below the header's controls, pointer-transparent — the route owns
	 * the membership rule (changed-from-snapshot) and the fade timer.
	 */
	import { panelHeaderLabel } from '$lib/services/panels/panel-rows';
	import { t } from '$lib/services/locale/locale-state.svelte';
import * as m from '$lib/paraglide/messages';
	import PanelHeader from './PanelHeader.svelte';
	import ResizeGutter from './ResizeGutter.svelte';

	let {
		panel,
		index,
		selected,
		widthBadge = null,
		copyValue,
		canMoveLeft = false,
		canMoveRight = false,
		onremove,
		onactivate,
		onloupe,
		children
	}: {
		/** The panel entry — id, sessionId, width (from the route's panels). */
		panel: import('$lib/types').DsiPanelEntry;
		/** Column index — the gutter's registry payload. */
		index: number;
		/** Selection cue — ring on the selected column. */
		selected: boolean;
		/** Width-badge phase — 'live' (dragging), 'fading' (10s
		 *  afterglow), or null (no badge). Route-owned lifecycle. */
		widthBadge?: 'live' | 'fading' | null;
		/** Header copy value override (the workspace-FILE variant): the
		 *  composed full path — the column cannot see the route's root
		 *  fallback (spine/cold), so the route computes and threads it. The
		 *  explorer kind derives its own (panel.root) below. */
		copyValue?: string;
		/** Header move chevron gating — false hides the button (first/last). */
		canMoveLeft?: boolean;
		canMoveRight?: boolean;
		/** Close this panel — route-owned mutation. The opts carry the
		 *  event modifiers the route needs (Shift+Click = close only this
		 *  panel, the family stays). */
		onremove: (opts?: { shiftKey?: boolean }) => void;
		/** Activate (select) this panel — fired on pointerdown/focusin
		 *  anywhere INSIDE the column (2026-08-25: interacting with a
		 *  conversation focuses its floor panel; the sidebar follows). */
		onactivate?: () => void;
		/** Open the loupe on this panel (The Panel Loupe ADR D1,
		 *  2026-09-04; modifier and kind scope widened by The Loupe for
		 *  Every Panel, 2026-09-08): fired on the CLICK phase of an
		 *  Alt+Click whose target is not inside a control — never on
		 *  pointerdown, because a dialog mounted under an in-flight press
		 *  eats its own compatibility mousedown on the loupe's mask and
		 *  closes itself. The exclusion lives in ONE `closest()` check at
		 *  the column handler (no per-control stopPropagation to forget);
		 *  the pointerdown activation rides the same gesture, earlier
		 *  phase (D6: focus follows the click). Optional — absent, the
		 *  Alt+Click is a safe no-op. */
		onloupe?: () => void;
		/** Snippet: the conversation body (the route's keyed ConversationPanel). */
		children: import('svelte').Snippet;
	} = $props();

	/** The loupe trigger (D1, widened by The Loupe for Every Panel,
	 *  2026-09-08): Alt held, target not inside a control — evaluated on
	 *  click release. Alt carries no other verb in DSI's pointer grammar,
	 *  and unlike Shift it never extends the browser's text selection.
	 *  EVERY kind opens: the body ladder kind-switches before the session
	 *  path, so a manager, settings, or injected-doc lens renders its own
	 *  branch — the old D9 no-op's premise (a session-keyed ladder that
	 *  cannot feed those bodies) dissolved with the 2026-09-06 ladder
	 *  extraction. Header Shift+Click keeps its "close only this panel"
	 *  verb; inputs keep text selection and macOS alt-glyph entry. */
	function handleLoupeTrigger(event: MouseEvent): void {
		if (!event.altKey) return;
		const target = event.target;
		if (
			target instanceof Element &&
			target.closest('button, a, input, textarea, [role="button"]') !== null
		) {
			return;
		}
		onloupe?.();
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events — the column is a
     LAYOUT container, not a control: pointerdown is a passive
     selection-follow (interacting with a conversation focuses its panel),
     focusin is the keyboard parity for the same selection, every real
     control inside stays itself, and the click-phase Alt+Click is the
     loupe trigger (The Panel Loupe ADR D1 — pointer-first by decision,
     widened by The Loupe for Every Panel, 2026-09-08; keyboard users
     keep selection through focusin, and a keyboard route to the loupe
     is the ADR's named seam). -->
<div
	class="column"
	class:selected
	data-testid="panel-column"
	data-panel-id={panel.id}
	data-session-id={panel.kind === 'conversation' ? panel.sessionId : null}
	style="width: {panel.width}px; min-width: {panel.width}px; max-width: {panel.width}px;"
	onpointerdown={() => onactivate?.()}
	onfocusin={() => onactivate?.()}
	onclick={handleLoupeTrigger}
>
	<!-- The explorer/file variants (2026-09-11): the label is the
	     workspace / file name and the copy-id prefix button copies the
	     FULL PATH — the panel bodies render NO second header (the
	     column's chrome is the one header strip). -->
	<PanelHeader
		panelId={panel.id}
		sessionId={panel.kind === 'conversation' ? panel.sessionId : ''}
		label={panelHeaderLabel(panel)}
		copyValue={panel.kind === 'workspace-explorer' ? panel.root : panel.kind === 'workspace-file' ? copyValue : undefined}
		copyLabel={panel.kind === 'workspace-explorer' ? t(m.workspaceExplorerCopyWorkspace) : panel.kind === 'workspace-file' ? t(m.workspaceFileCopyFilename) : undefined}
		labelTestId={panel.kind === 'workspace-explorer' ? 'explorer-title' : panel.kind === 'workspace-file' ? 'file-title' : undefined}
		{selected}
		{canMoveLeft}
		{canMoveRight}
		{onremove}
	/>
	{#if widthBadge !== null}
		<!-- Visual aid for a pointer drag: duplicates no unique info to AT
		     (the width is a layout fact), and never intercepts pointers. -->
		<span
			class="width-badge"
			class:fading={widthBadge === 'fading'}
			data-testid="panel-width-badge"
			data-badge-phase={widthBadge}
			aria-hidden="true"
		>
			{Math.round(panel.width)}px
		</span>
	{/if}
	<div class="body">
		{@render children()}
	</div>
</div>

<ResizeGutter {index} />

<style>
	.column {
		position: relative; /* the width badge's absolute anchor */
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--color-surface-primary, var(--color-surface-elevated));
		border-right: 1px solid var(--color-surface-border, #dee2e6);
		flex-shrink: 0;
	}

	/* Width badge (2026-08-28): the drag's live width readout at the
	   column's top right, BELOW the header row so it never covers the
	   move/close controls; pointer-transparent (the drag owns the
	   pointer anyway, and the afterglow must not block clicks). Chip
	   grammar (border + 10% tint + deepened text, tabular-nums — the
	   title-chip family; its mix measured AA 4.94:1 on white). */
	.width-badge {
		position: absolute;
		top: 2.5rem;
		right: 0.875rem;
		z-index: 5;
		pointer-events: none;
		padding: 0.125rem 0.375rem;
		border: 1px solid color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, var(--color-navy-focus));
		border-radius: 0.375rem;
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 10%, var(--color-surface-elevated));
		color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 30%, var(--color-navy-focus));
		font-size: 0.6875rem;
		line-height: 1.25;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		opacity: 1;
	}

	/* Afterglow: after mouseup the badge fades out over 10s. The
	   transition rides ONLY this class — a new drag snapping the badge
	   back to live (or re-showing it) is instant, never a 10s fade-in. */
	.width-badge.fading {
		opacity: 0;
		transition: opacity 10s linear;
	}

	@media (prefers-reduced-motion: reduce) {
		.width-badge.fading {
			transition: none; /* honor the preference: hide at once */
		}
	}

	/* Selection ring — a rounded gradient drawn OUTSIDE the column (same
	   geometry the flat outline had: inset -2px + 2px ring thickness puts
	   the band in the 6px ResizeGutter seam, so it never paints over any
	   child component; the floor row carries matching breathing room
	   (PanelsZoom .panels-row padding) so the ring's top/bottom/first-left
	   segments are not clipped by the viewport's overflow; both the
	   padding and the ring live inside the zoom transform, so they scale
	   in lockstep at any zoom). The ring is a masked pseudo-element, not
	   an outline: outlines cannot take a gradient or a radius. The
	   content-box + exclude mask carves the 2px band; the corners round
	   at 0.75rem without touching the column's own square seams. */
	.column.selected::after {
		content: '';
		position: absolute;
		inset: -3px;
		z-index: 5;
		pointer-events: none; /* the gutter and header own their pointers */
		border-radius: 0.75rem;
		padding: 5px;
		/* Themed (ADR-0023 sweep): the stops were literal hexes (the dark
		   accents) that never followed the mode — the tokens re-point on
		   data-theme, so the ring reads in both. */
		background: linear-gradient(
			135deg,
			var(--color-accent-blue) 0%,
			var(--color-accent-purple) 45%,
			var(--color-accent-rose) 100%
		);
		-webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
		-webkit-mask-composite: xor;
		mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
		mask-composite: exclude;
	}

	.body {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
</style>
