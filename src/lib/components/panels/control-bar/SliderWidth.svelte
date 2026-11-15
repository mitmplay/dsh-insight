<script lang="ts">
	/**
	 * SliderWidth — the tray's uniform-width control (Panel Floor W5 task
	 * 5.1), now a THIN WRAPPER over the base slider (ADR-0063 D4): the
	 * honest-slider mechanism (range, per-input live commit, token
	 * styling) lives in container-base/src/components/SliderWidth.svelte;
	 * DSI contributes its identity — paraglide words, config bounds
	 * (panel.minWidth/maxWidth — the same source the single clamp site
	 * reads), the clampPanelWidth-routed onresizeall, and the tray testids.
	 *
	 * Realtime: every thumb move fires onresizeall(width) on input — the
	 * panels resize LIVE under the dragging thumb (2026-08-27 cadence,
	 * unchanged).
	 */
	import { SliderWidth } from '@deepseek-insight/container-base';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { PANEL_DEFAULT_WIDTH } from '$lib/utils/panel-prefs';
	import { appConfig } from '$lib/services/config/app-config.svelte';

	let {
		value = $bindable(PANEL_DEFAULT_WIDTH),
		onresizeall
	}: {
		/** Bound width preset (config bounds, default 480..860). */
		value?: number;
		/** Commit: apply this width to all panels (route-owned). */
		onresizeall: (width: number) => void;
	} = $props();

	/** Config-tunable bounds (panel.minWidth/maxWidth) — same source the
	 *  single clamp site reads; reactive if config lands late. */
	const bounds = $derived(appConfig().panel);
</script>

{#snippet caption(v: number)}
	<span>{t(m.width)}</span>
	<span class="px" data-testid="controlbar-slider-width-value">{v}px</span>
{/snippet}

<SliderWidth bind:value {caption} min={bounds.minWidth} max={bounds.maxWidth} step={1} oncommit={onresizeall} ariaLabel={t(m.panelWidthAll)} testId="controlbar-slider-width" />

<style>
	.px {
		font-variant-numeric: tabular-nums;
		color: var(--color-text-primary);
	}
</style>
