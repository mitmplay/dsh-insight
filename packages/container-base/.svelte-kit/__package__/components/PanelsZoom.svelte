<script lang="ts">
	/**
	 * PanelsZoom — the floor's zoom frame (Panel Floor W3 task 3.2,
	 * ADR-0006 R9; OCI PanelsZoom port; container-base W4, ADR-0062).
	 *
	 * transform: scale(zoom) does NOT change layout width — scrollWidth
	 * ignores transforms — so a scaled-down row that visually fits still
	 * reports its unscaled width and the browser draws a phantom
	 * horizontal scrollbar. The fix is a two-layer frame:
	 *
	 *   1. THIS component's viewport div carries the scrollable overflow
	 *      and the grey workspace paint.
	 *   2. The zoom-frame div inside it carries the LAYOUT width, set in
	 *      JS to `row.scrollWidth × zoom` — the visual truth at every
	 *      zoom. Layout width is what scrolling measures, so the
	 *      scrollbar appears iff the scaled row truly overflows.
	 *   3. The row inside the frame carries scale(zoom), origin
	 *      top-left, width max-content (so it measures its natural
	 *      width), and a counter-scaled height (100/zoom % — a
	 *      scaled-down row still fills the frame vertically).
	 *
	 * The measurement effect re-runs on a GEOMETRY FINGERPRINT — the
	 * string of all panel widths + count — because scrollWidth itself is
	 * not reactive; the fingerprint is.
	 *
	 * Presentational + mechanical only: zoom, panels, and the selected
	 * panel's id arrive as props (the id + the floor's id sequence drive
	 * the selection-follow — selection change or reshuffle — the one
	 * scroll this component writes itself); the row's children arrive as
	 * a snippet.
	 */
	import ResizeGutter from './ResizeGutter.svelte';

	let {
		zoom = 1,
		panels,
		railWidth = null,
		selectedPanelId = null,
		children
	}: {
		/** Floor zoom multiplier (clamped by the consumer's prefs — one clamp site). */
		zoom?: number;
		/** Open panels — the geometry fingerprint source (widths + count)
		 *  and the reorder fingerprint source (the id sequence). */
		panels: Array<{ id: string; width: number }>;
		/** Leading sticky-column width (px) — the embedded rail column;
		 *  null/undefined = no rail column.
		 *  RIDES THE FINGERPRINT (OCI `leading ? railWidth : ''`): mounting,
		 *  unmounting, or resizing the rail changes row.scrollWidth, and
		 *  scrollWidth itself is not reactive — the fingerprint is. */
		railWidth?: number | null;
		/** The focused panel's id — the selection-follow target: when it
		 *  changes, a column the viewport cannot see is scrolled into view
		 *  (the floor can be several viewports wide; the selection ring
		 *  must never sit off-screen behind the scroll edge). */
		selectedPanelId?: string | null;
		/** Snippet: one rendered child per panel. */
		children: import('svelte').Snippet;
	} = $props();

	// ResizeGutter is re-exported for hosts that compose the row the way
	// the OCI floor does; the gutter itself stays a separate public face.
	void ResizeGutter;

	/** Scroll viewport (overflow-x lives here, grey workspace paint). */
	let viewport = $state<HTMLDivElement | undefined>(undefined);
	/** Zoom-frame div — JS-measured layout width lives here. */
	let frame = $state<HTMLDivElement | undefined>(undefined);
	/** Row div — transform-scaled, natural-width content. */
	let row = $state<HTMLDivElement | undefined>(undefined);

	/**
	 * Geometry fingerprint: every panel width + the count + the leading
	 * rail column's width (empty when absent — OCI `leading ? railWidth :
	 * ''`). Any width change, add, remove, or rail mount/unmount/resize
	 * changes the string and re-runs the measure effect below.
	 * (scrollWidth is not reactive; the fingerprint is.)
	 */
	const geometryFingerprint = $derived(
		panels.map((p) => p.width).join(',') + `#${panels.length}` + `|${railWidth ?? ''}`
	);

	/**
	 * Reorder fingerprint: the panel-ID SEQUENCE. A move reshuffles the
	 * columns — it changes this string while leaving the geometry
	 * fingerprint untouched, and the reshuffle can push the focused
	 * column past a viewport edge. Width-only edits never change it, so
	 * a gutter drag or zoom still never steals the scroll.
	 */
	const orderFingerprint = $derived(panels.map((p) => p.id).join(','));

	$effect(() => {
		// The row's transform reads --zoom (a var, so the counter-scaled
		// height calc can share it); keep it in lockstep with the prop.
		if (row) row.style.setProperty('--zoom', String(zoom));
	});

	$effect(() => {
		// Depend on the fingerprint (and zoom) — the re-measure triggers.
		void geometryFingerprint;
		void zoom;
		if (!frame || !row) return;
		// Measure in a rAF so the browser has laid the (possibly new)
		// geometry out before scrollWidth is read. The frame carries BOTH
		// layout dimensions (width AND height scaled) — a 1px height stub
		// let overflow-y:hidden clip the row's real content under the
		// viewport, breaking pointer events on panel children.
		requestAnimationFrame(() => {
			if (!frame || !row) return;
			// Layout WIDTH only: scrollWidth is transform-blind, so the frame
			// carries the scaled truth for horizontal scrolling. HEIGHT is NOT
			// JS-set — the frame fills the viewport (height:100%) and the row
			// counter-scales (100%/zoom) inside it; a JS height here would be
			// circular (scrollHeight of a percentage-height child).
			frame.style.width = `${Math.ceil(row.scrollWidth * zoom)}px`;
		});
	});

	$effect(() => {
		// Selection-follow: a NEWLY selected panel — or the focused panel
		// after a RESHUFFLE — is scrolled into view: nearest, horizontal
		// only (the viewport never scrolls vertically). Fires on the
		// id-sequence change or the selection change ONLY: geometry edits
		// never steal the scroll. Placed after the measure effect so, in
		// the add+select flush, the frame's rAF runs before this one.
		const target = selectedPanelId;
		void orderFingerprint;
		if (target === null) return;
		requestAnimationFrame(() => {
			if (!viewport) return;
			const col = viewport.querySelector<HTMLElement>(
				`[data-panel-id="${CSS.escape(target)}"]`
			);
			if (!col) return;
			// getBoundingClientRect is transform-true (zoom included), and
			// the frame carries the scaled layout width — visual coordinates
			// ARE scrollLeft's coordinate space. The selection ring extends
			// 4px × zoom outward, so it joins the reveal.
			const vpRect = viewport.getBoundingClientRect();
			const colRect = col.getBoundingClientRect();
			const ring = 4 * zoom;
			const left = colRect.left - vpRect.left + viewport.scrollLeft - ring;
			const right = left + colRect.width + ring * 2;
			let reveal: number | null = null;
			if (left < viewport.scrollLeft) {
				reveal = Math.max(0, left);
			} else if (right > viewport.scrollLeft + viewport.clientWidth) {
				reveal = right - viewport.clientWidth;
			}
			if (reveal === null) return; // fully visible (ring included) — hands off
			// Inertial: the reveal GLIDES; prefers-reduced-motion collapses
			// it to the instant jump.
			const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
			viewport.scrollTo({ left: reveal, behavior: reduceMotion ? 'auto' : 'smooth' });
		});
	});
</script>

<div class="panels-viewport" bind:this={viewport} data-testid="panels-viewport">
	<div class="zoom-frame" bind:this={frame} data-testid="panels-zoom-frame">
		<div class="panels-row" bind:this={row} data-testid="panels-row">
			{@render children()}
		</div>
	</div>
</div>

<style>
	.panels-viewport {
		flex: 1;
		min-width: 0;
		overflow-x: auto;
		overflow-y: hidden;
		/* Grey workspace paint — the floor the panels sit on. */
		background: var(--color-surface-secondary);
	}

	.zoom-frame {
		/* Fills the viewport vertically — the row counter-scales inside. */
		height: 100%;
	}


	.panels-row {
		display: flex;
		align-items: stretch;
		/* SSC#2 G8 (2026-11-14/15): border-box so the 4px ring-breathing
		 * padding sits INSIDE the counter-scaled height — content-box let
		 * children resolve height:100% to the full calc'd value and overflow
		 * the viewport bottom by the scaled padding whenever the row fits
		 * horizontally (no scrollbar shrinking the viewport, i.e. any
		 * zoomed-out desk). Matches DSI's resolved geometry.
		 * The -8px in the calc reserves the selected ring's protrusion (3px
		 * out + 5px band, PaneBase ::after) OUTSIDE the scaled fill: with the
		 * row filling the viewport EXACTLY, the ring's bottom band landed
		 * flush on the viewport edge at every zoom and read as cut off (the
		 * operator's 2026-11-15 report). The reservation scales back up with
		 * the row, so the slack stays proportional, not a fixed gap. */
		box-sizing: border-box;
		/* Natural width so the frame can measure the true row width. */
		width: max-content;
		/* The zoom transform — visual only, layout-blind by CSS design. */
		transform: scale(var(--zoom, 1));
		transform-origin: top left;
		height: calc((100% - 8px) / var(--zoom, 1));
		/* Counter-scaled height: a scaled-down row still fills the frame
		   vertically, with the ring reservation above leaving the selected
		   ring's bottom band visible at every zoom. */
		/* Breathing room for the selected column's OUTWARD ring (4px
		   extent beyond the border box). The padding lives INSIDE this
		   transform, so it scales with zoom in lockstep with the ring. */
		padding: 4px;
	}
</style>
