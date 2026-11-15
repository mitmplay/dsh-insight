<script lang="ts">
	/**
	 * ResizeGutter — the 6px draggable seam after every pane (ADR-0006 R8
	 * port, generalized for the container base, ADR-0062 W4 / D6: the i18n
	 * labels arrive as PROPS — the package never learns a consumer's
	 * translation system).
	 *
	 * The gutter does not resize anything itself — mousedown reports the
	 * event upward through the injected onGutterDown hook, and the HOST
	 * (the drag owner) snapshots widths and runs the resize math. No drag
	 * state lives here.
	 */
	let {
		index,
		ariaLabel,
		title,
		onGutterDown
	}: {
		/** The pane index this seam trails — the host's drag payload. */
		index: number;
		/** Accessible name for the seam (consumer-localized). */
		ariaLabel: string;
		/** Hover tooltip (consumer-localized). */
		title: string;
		/** Mousedown — the HOST owns the drag and the clamp. */
		onGutterDown?: (event: MouseEvent) => void;
	} = $props();
</script>

<!-- A real button (a11y): the gutter is an interactive separator; drag
     reports upward — the host owns the drag math. Button styling resets
     to the 6px seam. Keyboard-driven resize is a known gap (filed, not
     hidden — ADR-0062 §7). -->
<button
	type="button"
	class="gutter"
	data-testid="panel-gutter-{index}"
	aria-label={ariaLabel}
	{title}
	onmousedown={(e) => {
		e.preventDefault();
		onGutterDown?.(e);
	}}
></button>

<style>
	.gutter {
		display: block;
		padding: 0;
		border: none;
		flex: 0 0 6px;
		width: 6px;
		align-self: stretch;
		cursor: col-resize;
		background: transparent;
		transition: background-color 0.15s ease;
	}

	.gutter:hover,
	.gutter:active {
		background: var(--color-accent-blue);
	}

	.gutter:focus-visible {
		outline: 2px solid var(--color-accent-blue);
		outline-offset: -2px;
	}
</style>
