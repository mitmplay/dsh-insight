<script lang="ts">
	/**
	 * ControlBar — THIN CONSUMER (ADR-0073 W2): the hover-tray machine
	 * (trigger, 250ms grace, focus guards, Escape, portal, clamp) moved
	 * to container-base (R10 W1); this file contributes only DSI's
	 * identity — the paraglide words — and hosts the DSI tray body
	 * (ControlBarTray, below) through the base's tray snippet. Every
	 * testid, the data-open contract and the portaled .tray-float host
	 * are the BASE defaults, byte-identical to what the floor suites pin.
	 */
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { PANEL_DEFAULT_WIDTH, PANEL_DEFAULT_ZOOM } from '$lib/utils/panel-prefs';
	import { ControlBar } from '@deepseek-insight/container-base';
	import ControlBarTray from './ControlBarTray.svelte';

	let {
		panelWidth = $bindable(PANEL_DEFAULT_WIDTH),
		zoom = $bindable(PANEL_DEFAULT_ZOOM),
		onresizeall,
		captureContainer = null
	}: {
		/** Uniform-panel width preset (bind: up to the route). */
		panelWidth?: number;
		/** Floor zoom multiplier (bind: up to the route). */
		zoom?: number;
		/** Commit a new uniform width on every thumb move: route sets all panels + the preset. */
		onresizeall: (width: number) => void;
		/** The floor capture target (PanelsZoom's layout slot) — null
		 *  before mount: the base capture row is prop-gated (ADR-0073). */
		captureContainer?: HTMLElement | null;
	} = $props();
</script>

{#snippet tray()}
	<ControlBarTray bind:panelWidth bind:zoom {onresizeall} {captureContainer} />
{/snippet}

<ControlBar ariaLabel={t(m.floorControls)} bind:panelWidth bind:zoom {tray} />
