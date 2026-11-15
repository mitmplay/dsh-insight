<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * TrayButtons — the ControlBarTray's button row: the container the
	 * tray's action buttons mount into (the sliders' siblings in the
	 * tray body). Current member:
	 *   - CanvasCopyButton — capture the panel floor (PanelsZoom, flowed
	 *     down from the route as `captureContainer`) as a PNG: click
	 *     copies to clipboard, Shift+Click saves a file.
	 *
	 * Presentational: the capture target is page-owned (the route binds
	 * the floor element and flows it down through ControlBar); null
	 * before mount is the CanvasCopyButton null-container no-op — the
	 * button renders regardless.
	 */
	import { CanvasCopyButton } from '@deepseek-insight/container-base';

	let {
		captureContainer = null
	}: {
		/** The floor capture target (PanelsZoom's layout slot) — page-owned. */
		captureContainer?: HTMLElement | null;
	} = $props();
</script>

<div class="tray-buttons" data-testid="controlbar-tray-buttons" role="group" aria-label={t(m.floorCapture)}>
	<CanvasCopyButton
		container={captureContainer}
		mode="visible"
		title={t(m.copyFloorImage)}
		size={14}
		class="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded text-[color:var(--color-text-secondary,#6c757d)] transition-colors hover:bg-surface-hover hover:text-[color:var(--color-text-primary,#212529)]"
	/>
</div>

<style>
	.tray-buttons {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.375rem;
	}
</style>
