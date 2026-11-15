<script module lang="ts">
	/**
	 * SliderZoom — the honest floor-zoom control (ADR-0063 D4, moved from
	 * DSI's control bar). Default bounds 0.25..1.25 (the floor's zoom
	 * scale); prop-overridable. The bound value carries EVERY thumb move
	 * live to the owner (PanelsZoom re-measures per move — spec-13's
	 * no-phantom-scrollbar contract rides on this cadence).
	 */
	export const ZOOM_BOUNDS = { min: 0.25, max: 1.25, step: 0.001 } as const;
</script>

<script lang="ts">
	let {
		/** Floor zoom multiplier; updates flow back up via $bindable per input. */
		value = $bindable(1),
		min = ZOOM_BOUNDS.min,
		max = ZOOM_BOUNDS.max,
		step = ZOOM_BOUNDS.step,
		/** Optional LIVE commit per input event (bind already carries value). */
		oncommit,
		/** Caption content — consumer words (the base ships none). */
		caption,
		/** Accessible name for the input (consumer words). */
		ariaLabel,
		/** Testid stem: <stem>, <stem>-input, <stem>-value. */
		testId = 'cb-slider-zoom'
	}: {
		value?: number;
		min?: number;
		max?: number;
		step?: number;
		oncommit?: (zoom: number) => void;
		caption?: import('svelte').Snippet<[number]>;
		ariaLabel: string;
		testId?: string;
	} = $props();
</script>

<label class="cb-slider-zoom" data-testid={testId}>
	{#if caption}
		<span class="cb-slider-caption">
			{@render caption(value)}
		</span>
	{/if}
	<input
		type="range"
		{min}
		{max}
		{step}
		bind:value
		oninput={() => oncommit?.(value)}
		data-testid={testId + '-input'}
		aria-label={ariaLabel}
	/>
</label>

<style>
	.cb-slider-zoom {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.6875rem;
		color: var(--color-text-secondary);
	}
	.cb-slider-caption {
		display: flex;
		justify-content: space-between;
	}
	.cb-slider-zoom input {
		width: 100%;
		accent-color: var(--color-accent-blue);
	}
	.cb-slider-zoom input:focus-visible {
		outline: 2px solid var(--color-accent-blue);
		outline-offset: 2px;
	}
</style>
