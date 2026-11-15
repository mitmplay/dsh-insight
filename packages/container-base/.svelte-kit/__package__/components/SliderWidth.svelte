<script module lang="ts">
	/**
	 * SliderWidth — the honest uniform-width control (ADR-0063 D4, moved
	 * from DSI's control bar). Default bounds are the panel-prefs defaults
	 * the floor clamps against (480..860, step 1); a consumer overrides
	 * them via props — the clamp site stays the CONSUMER's (the commit
	 * callback routes wherever the route owner decides), so the
	 * single-bound-site rule holds. Every thumb move commits (per-input
	 * cadence) — panels resize LIVE under the dragging thumb.
	 */
	export const WIDTH_BOUNDS = { min: 480, max: 860, step: 1 } as const;
</script>

<script lang="ts">
	let {
		/** Bound width (px); updates flow back up via $bindable per input. */
		value = $bindable(730),
		/** Bounds — default WIDTH_BOUNDS, prop-overridable. */
		min = WIDTH_BOUNDS.min,
		max = WIDTH_BOUNDS.max,
		step = WIDTH_BOUNDS.step,
		/** LIVE commit per input event (the honest-slider contract). */
		oncommit,
		/** Caption content — consumer words (the base ships none). */
		caption,
		/** Accessible name for the input (consumer words). */
		ariaLabel,
		/** Testid stem: <stem>, <stem>-input, <stem>-value. */
		testId = 'cb-slider-width'
	}: {
		value?: number;
		min?: number;
		max?: number;
		step?: number;
		oncommit?: (width: number) => void;
		caption?: import('svelte').Snippet<[number]>;
		ariaLabel: string;
		testId?: string;
	} = $props();
</script>

<label class="cb-slider-width" data-testid={testId}>
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
	.cb-slider-width {
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
	.cb-slider-width input {
		width: 100%;
		accent-color: var(--color-accent-blue);
	}
	.cb-slider-width input:focus-visible {
		outline: 2px solid var(--color-accent-blue);
		outline-offset: 2px;
	}
</style>
