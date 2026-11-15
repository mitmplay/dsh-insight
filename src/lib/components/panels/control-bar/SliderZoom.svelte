<script lang="ts">
	/**
	 * SliderZoom — the tray's floor-zoom control (Panel Floor W5 task
	 * 5.1), now a THIN WRAPPER over the base slider (ADR-0063 D4): the
	 * honest-slider mechanism lives in
	 * container-base/src/components/SliderZoom.svelte; DSI contributes
	 * paraglide words, config bounds (panel.minZoom/maxZoom), and the
	 * tray testids. The bound zoom prop (route-owned, $bindable) carries
	 * every thumb move live into PanelsZoom — spec-13's no-phantom-
	 * scrollbar contract rides on that per-move cadence, unchanged.
	 */
	import { SliderZoom } from '@deepseek-insight/container-base';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { PANEL_DEFAULT_ZOOM } from '$lib/utils/panel-prefs';
	import { appConfig } from '$lib/services/config/app-config.svelte';

	let {
		zoom = $bindable(PANEL_DEFAULT_ZOOM)
	}: {
		/** Floor zoom multiplier, default 0.25..1.25 (bind: up to the route). */
		zoom?: number;
	} = $props();

	const bounds = $derived(appConfig().panel);
</script>

{#snippet caption(v: number)}
	<span>{t(m.zoom)}</span>
	<span class="pct" data-testid="controlbar-slider-zoom-value">{Math.round(v * 100)}%</span>
{/snippet}

<SliderZoom bind:value={zoom} {caption} min={bounds.minZoom} max={bounds.maxZoom} step={0.001} ariaLabel={t(m.floorZoom)} testId="controlbar-slider-zoom" />

<style>
	.pct {
		font-variant-numeric: tabular-nums;
		color: var(--color-text-primary);
	}
</style>
