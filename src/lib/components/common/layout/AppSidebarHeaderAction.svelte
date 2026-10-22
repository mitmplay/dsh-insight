<script lang="ts">
	/**
	 * AppSidebarHeaderAction — the expanded rail header's right-hand action
	 * cluster (extracted from AppSidebar, 2026-09): add-workspace, locale
	 * switcher, canvas copy, and the collapse button. The floor ControlBar
	 * (2026-10-22) rides the cluster's head — it self-positions fixed
	 * top-right over the floor, so hosting it here is purely a mount-site
	 * move; the page still owns panelWidth/zoom state and the resize-all
	 * handler, threaded through the sidebar as $bindable props.
	 */
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import { PanelLeftClose } from '@lucide/svelte';
	import CanvasCopyButton from '$lib/components/common/buttons/CanvasCopyButton.svelte';
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

<div class="rail-header-actions">
	<CanvasCopyButton
		container={captureContainer}
		mode="visible"
		title={t(m.copyPageImage)}
		size={14}
		class="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded transition-colors hover:bg-surface-hover"
	/>
	<button
		type="button"
		class="icon-btn"
		onclick={() => onToggleCollapse?.()}
		aria-expanded={true}
		aria-label={t(m.collapseSidebar)}
		title={t(m.collapseSidebar)}
	>
		<PanelLeftClose size={14} />
	</button>
	<ControlBar bind:panelWidth bind:zoom onresizeall={onresizeall ?? (() => {})} captureContainer={trayContainer} />
</div>

<style>
	.rail-header-actions {
		display: flex;
		align-items: center;
		/*gap: 0.375rem;*/
		flex-shrink: 0;
	}

	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		flex-shrink: 0;
		border-radius: 0.25rem;
		color: var(--color-text-secondary, #6c757d);
		background: transparent;
		transition:
			color 0.15s ease,
			background-color 0.15s ease;
	}

	.icon-btn:hover,
	.icon-btn:focus-visible {
		color: var(--color-accent-purple, var(--color-accent-purple));
		background: var(--color-surface-hover, rgb(0 0 0 / 0.05));
		outline: none;
	}
</style>
