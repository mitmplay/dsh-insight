<script lang="ts">
	/**
	 * ControlBarTray — the base tray body (ADR-0073 D2): a FIXED anatomy,
	 * in stack order:
	 *   1. capture row  — CanvasCopyButton, prop-gated (renders only when
	 *      captureContainer is supplied; null before mount is the
	 *      CanvasCopyButton no-op)
	 *   2. width slider — caption snippet + bounds via props, bindable value
	 *   3. zoom slider  — same pattern, bindable zoom
	 *   4. extras       — consumer snippet, rendered only when passed (no
	 *      empty row)
	 *
	 * The base NEVER translates and NEVER reads the consumer config — all
	 * words arrive as props/snippets from the consumer; the card visuals
	 * (15rem min-width, padding, border, shadow) moved in from DSI's
	 * hand-rolled tray verbatim (ADR-0073 D2, hover behavior byte-equivalent).
	 */
	import CanvasCopyButton from './CanvasCopyButton.svelte';
	import SliderWidth, { WIDTH_BOUNDS } from './SliderWidth.svelte';
	import SliderZoom, { ZOOM_BOUNDS } from './SliderZoom.svelte';

	let {
		panelWidth = $bindable(WIDTH_BOUNDS.min + 250),
		zoom = $bindable(1),
		/** LIVE commit per width-thumb move (route-owned commit). */
		onresizeall,
		// ── capture row (prop-gated) ──
		captureContainer = null,
		captureTitle = '',
		captureMode = 'visible' as 'full' | 'visible',
		captureRowLabel = 'Capture',
		captureRowTestId = 'controlbar-tray-buttons',
		// ── width slider ──
		widthMin = WIDTH_BOUNDS.min,
		widthMax = WIDTH_BOUNDS.max,
		widthStep = WIDTH_BOUNDS.step,
		widthCaption,
		widthAriaLabel,
		widthTestId = 'controlbar-slider-width',
		// ── zoom slider ──
		zoomMin = ZOOM_BOUNDS.min,
		zoomMax = ZOOM_BOUNDS.max,
		zoomStep = ZOOM_BOUNDS.step,
		zoomCaption,
		zoomAriaLabel,
		zoomTestId = 'controlbar-slider-zoom',
		// ── extras ──
		extras,
		trayTestId = 'controlbar-tray',
		trayLabel = 'Floor controls'
	}: {
		/** Bound width preset (bind: through ControlBar to the route). */
		panelWidth?: number;
		/** Floor zoom multiplier (bind: through ControlBar to the route). */
		zoom?: number;
		/** Commit a new uniform width on every thumb move. */
		onresizeall?: (width: number) => void;
		/** The capture target (page-owned floor element); null = no row. */
		captureContainer?: HTMLElement | null;
		/** Capture button tooltip — consumer words. */
		captureTitle?: string;
		/** Capture mode ('visible' crops to the client box). */
		captureMode?: 'full' | 'visible';
		/** Capture row accessible name — consumer words. */
		captureRowLabel?: string;
		/** Capture row testid (base default matches the DSI floor suite). */
		captureRowTestId?: string;
		widthMin?: number;
		widthMax?: number;
		widthStep?: number;
		/** Width caption snippet — consumer words (base ships none). */
		widthCaption?: import('svelte').Snippet<[number]>;
		widthAriaLabel?: string;
		widthTestId?: string;
		zoomMin?: number;
		zoomMax?: number;
		zoomStep?: number;
		/** Zoom caption snippet — consumer words. */
		zoomCaption?: import('svelte').Snippet<[number]>;
		zoomAriaLabel?: string;
		zoomTestId?: string;
		/** Consumer extras — rendered only when passed (no empty row). */
		extras?: import('svelte').Snippet;
		/** Tray testid (base default matches the DSI floor suite). */
		trayTestId?: string;
		/** Tray accessible name — consumer words. */
		trayLabel?: string;
	} = $props();
</script>

<div class="tray" data-testid={trayTestId} role="group" aria-label={trayLabel}>
	{#if captureContainer}
		<div class="tray-buttons" data-testid={captureRowTestId} role="group" aria-label={captureRowLabel}>
			<CanvasCopyButton
				container={captureContainer}
				mode={captureMode}
				title={captureTitle}
				size={14}
				class="cb-capture-btn"
			/>
		</div>
	{/if}
	<SliderWidth
		bind:value={panelWidth}
		min={widthMin}
		max={widthMax}
		step={widthStep}
		caption={widthCaption}
		ariaLabel={widthAriaLabel ?? ''}
		testId={widthTestId}
		oncommit={onresizeall}
	/>
	<SliderZoom
		bind:value={zoom}
		min={zoomMin}
		max={zoomMax}
		step={zoomStep}
		caption={zoomCaption}
		ariaLabel={zoomAriaLabel ?? ''}
		testId={zoomTestId}
	/>
	{#if extras}
		{@render extras()}
	{/if}
</div>

<style>
	.tray {
		/* Positioning lives on the portaled .tray-float host in
		   ControlBar — this element carries only the tray's visuals. */
		display: flex;
		flex-direction: column;
		gap: 0.625rem;
		min-width: 15rem;
		padding: 0.75rem;
		border: 1px solid var(--color-surface-border);
		border-radius: 0.5rem;
		background: var(--color-surface-primary);
		box-shadow: 0 4px 16px var(--color-shadow-tray);
	}
	.tray-buttons {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.375rem;
	}
	/* Capture button sizing — consumer-neutral (class prop passthrough;
	 * no Tailwind utilities: the package ships no skin, W6 ground rule) */
	.tray-buttons :global(.cb-capture-btn) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		flex-shrink: 0;
		border: none;
		background: transparent;
		padding: 0;
		cursor: pointer;
		border-radius: 0.25rem;
		color: var(--color-text-secondary);
		transition: color 0.15s ease;
	}
	.tray-buttons :global(.cb-capture-btn:hover) {
		background: var(--color-surface-secondary);
		color: var(--color-text-primary);
	}
</style>
