<script lang="ts">
	/**
	 * AppSidebarHeaderAction — the expanded rail header's right-hand action
	 * cluster, now a THIN consumer of the base SidebarHeaderActions corner
	 * (ADR-0074, R11): paraglide labels, the page-root capture target, and
	 * the floor ControlBar slotted into the extras snippet. The corner's
	 * skin lives in the base component — the old global corner-skin block
	 * is retired. The page still owns panelWidth/zoom state and the
	 * resize-all handler, threaded through as bindable passthrough.
	 */
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import { SidebarHeaderActions } from '@deepseek-insight/container-base';
	import { PANEL_DEFAULT_WIDTH, PANEL_DEFAULT_ZOOM } from '$lib/utils/panel-prefs';
	import ControlBar from '$lib/components/panels/control-bar/ControlBar.svelte';

	let {
		captureContainer = null,
		trayContainer = null,
		panelWidth = $bindable(PANEL_DEFAULT_WIDTH),
		zoom = $bindable(PANEL_DEFAULT_ZOOM),
		onresizeall,
		onToggleCollapse
	}: {
		/** The ConversationPage root element — the canvas-copy button's
		 * capture target (page-owned bind:this). Null before mount (SSR,
		 * first paint): the button renders regardless, its click is
		 * CanvasCopyButton's documented null-container no-op. */
		captureContainer?: HTMLElement | null;
		/** The floor element — the ControlBar tray's canvas-copy capture
		 * target (the page's bind:this on .floor, threaded down). */
		trayContainer?: HTMLElement | null;
		/** Uniform-panel width preset (bind: up to the route). */
		panelWidth?: number;
		/** Floor zoom multiplier (bind: up to the route). */
		zoom?: number;
		/** Commit a new uniform width on every thumb move. */
		onresizeall?: (width: number) => void;
		/** Flip collapsed ↔ expanded (page-owned, persisted there). */
		onToggleCollapse?: () => void;
	} = $props();
</script>

<SidebarHeaderActions
	captureContainer={captureContainer}
	captureTitle={t(m.copyPageImage)}
	captureMode="visible"
	collapseLabel={t(m.collapseSidebar)}
	onToggleCollapse={() => onToggleCollapse?.()}
>
	<ControlBar bind:panelWidth bind:zoom onresizeall={onresizeall ?? (() => {})} captureContainer={trayContainer} />
</SidebarHeaderActions>
