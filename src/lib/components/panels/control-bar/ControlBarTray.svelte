<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * ControlBarTray — the ControlBar's tray body: the TrayButtons row
	 * first (the tray's action buttons — the floor canvas-capture today;
	 * moved to the top 2026-09-07), then AddPanel, SliderWidth, and
	 * SliderZoom stacked (the three floor controls, ADR-0006 R7). Mount-gated by the parent's `{#if open}` —
	 * the tray carries no visibility state of its own. Bindings pass
	 * straight through to the sliders (the route owns both values via
	 * ControlBar); `onresizeall` is SliderWidth's route-owned per-move
	 * commit; `captureContainer` flows down to TrayButtons (page-owned
	 * floor element — the route passes it through ControlBar).
	 */
	import { PANEL_DEFAULT_WIDTH, PANEL_DEFAULT_ZOOM } from '$lib/utils/panel-prefs';
	import AddPanel from './AddPanel.svelte';
	import SliderWidth from './SliderWidth.svelte';
	import SliderZoom from './SliderZoom.svelte';
	import TrayButtons from './TrayButtons.svelte';

	let {
		panelWidth = $bindable(PANEL_DEFAULT_WIDTH),
		zoom = $bindable(PANEL_DEFAULT_ZOOM),
		onresizeall,
		captureContainer = null
	}: {
		/** Uniform-panel width preset (bind: through ControlBar to the route). */
		panelWidth?: number;
		/** Floor zoom multiplier (bind: through ControlBar to the route). */
		zoom?: number;
		/** Commit a new uniform width on every thumb move: route sets all panels + the preset. */
		onresizeall: (width: number) => void;
		/** The floor capture target (PanelsZoom's layout slot) — pass-through to TrayButtons. */
		captureContainer?: HTMLElement | null;
	} = $props();
</script>

<div class="tray" data-testid="controlbar-tray" role="group" aria-label={t(m.floorControls)}>
	<TrayButtons {captureContainer} />
	<AddPanel />
	<SliderWidth bind:value={panelWidth} {onresizeall} />
	<SliderZoom bind:zoom={zoom} />
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
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.5rem;
		background: var(--color-surface-primary, var(--color-surface-elevated));
		box-shadow: 0 4px 16px rgb(0 0 0 / 0.12);
	}
</style>
