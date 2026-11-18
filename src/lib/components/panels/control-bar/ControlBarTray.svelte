<script lang="ts">
	/**
	 * ControlBarTray — THIN CONSUMER (ADR-0073 W2): the fixed tray
	 * anatomy (capture row → width → zoom → extras) lives in
	 * container-base; this file contributes DSI's identity only:
	 *   - paraglide words (tray label, capture title/row label, slider
	 *     captions + aria labels)
	 *   - config bounds (appConfig panel width and zoom bounds — the same source
	 *     the single clamp site reads)
	 *   - the capture row props (trayContainer + visible mode)
	 *   - extras = AddPanel (the tray's paste-add field, unchanged — its
	 *     registry verbs stay exactly as they were, ADR-0006 R7)
	 *
	 * The SliderWidth/SliderZoom wrapper files stay (their caption
	 * snippets now flow into the base tray directly, task 2.2 executor
	 * call: pass captions, keep the files).
	 */
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { PANEL_DEFAULT_WIDTH, PANEL_DEFAULT_ZOOM } from '$lib/utils/panel-prefs';
	import { appConfig } from '$lib/services/config/app-config.svelte';
	import { ControlBarTray } from '@deepseek-insight/container-base';
	import AddPanel from './AddPanel.svelte';

	let {
		panelWidth = $bindable(PANEL_DEFAULT_WIDTH),
		zoom = $bindable(PANEL_DEFAULT_ZOOM),
		onresizeall,
		captureContainer = null
	}: {
		/** Bound width preset (bind: through ControlBar to the route). */
		panelWidth?: number;
		/** Floor zoom multiplier (bind: through ControlBar to the route). */
		zoom?: number;
		/** Commit a new uniform width on every thumb move. */
		onresizeall: (width: number) => void;
		/** The floor capture target (PanelsZoom's layout slot) — null
		 *  before mount: the base capture row is prop-gated (ADR-0073 D2). */
		captureContainer?: HTMLElement | null;
	} = $props();

	/** Config-tunable bounds — reactive if config lands late. */
	const bounds = $derived(appConfig().panel);
</script>

{#snippet widthCaption(v: number)}
	<span>{t(m.width)}</span>
	<span class="px" data-testid="controlbar-slider-width-value">{v}px</span>
{/snippet}

{#snippet zoomCaption(v: number)}
	<span>{t(m.zoom)}</span>
	<span class="pct" data-testid="controlbar-slider-zoom-value">{Math.round(v * 100)}%</span>
{/snippet}

{#snippet extras()}
	<AddPanel />
{/snippet}

<ControlBarTray
	bind:panelWidth
	bind:zoom
	{onresizeall}
	{captureContainer}
	captureTitle={t(m.copyFloorImage)}
	captureMode="visible"
	captureRowLabel={t(m.floorCapture)}
	widthMin={bounds.minWidth}
	widthMax={bounds.maxWidth}
	widthStep={1}
	widthAriaLabel={t(m.panelWidthAll)}
	{widthCaption}
	zoomMin={bounds.minZoom}
	zoomMax={bounds.maxZoom}
	zoomStep={0.001}
	zoomAriaLabel={t(m.floorZoom)}
	{zoomCaption}
	{extras}
/>

<style>
	.px {
		font-variant-numeric: tabular-nums;
		color: var(--color-text-primary);
	}
	.pct {
		font-variant-numeric: tabular-nums;
		color: var(--color-text-primary);
	}
</style>
