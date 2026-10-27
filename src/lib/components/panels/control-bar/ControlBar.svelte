<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * ControlBar — the floor's hover tray (Panel Floor W5 task 5.1,
	 * ADR-0006 R7; OCI ControlBar precedent, minus its orchestration
	 * organs). Pinned top-right over the panels viewport; hovering the
	 * gear trigger reveals the tray, leaving hides it after 250ms (the
	 * timer clears on re-enter, so grazing the tray keeps it open).
	 *
	 * This file owns the trigger + the reveal/hide lifecycle; the tray
	 * body — the floor controls + the action-button row — is
	 * ControlBarTray:
	 *   - AddPanel    — paste a sessionId → two verbs: Add appends a new
	 *                   panel beside the focus, Rplc replaces the ACTIVE
	 *                   panel in place (both registry actions)
	 *   - SliderWidth — uniform-width preset 480..860 (`onresizeall` sets
	 *                   every panel + the preset LIVE per thumb move)
	 *   - SliderZoom  — floor zoom 25%..125% step 5 ($bindable zoom)
	 *   - TrayButtons — the tray's button row (the floor canvas-capture:
	 *                   `captureContainer` flows the page-owned floor
	 *                   element down to its CanvasCopyButton)
	 *
	 * Deliberately ABSENT (ADR-0006 R7): RegisterFeature and a home link —
	 * DSI has no orchestration backend for the former, and the sidebar
	 * owns Home for the latter. The OCI tray ships both; this floor does not.
	 *
	 * Communication: AddPanel fires `addPanelFromSidebar` /
	 * `replaceSelectedFromRegistry` through the panel registry — the
	 * tray is a LEAF like a spine row, and the
	 * registry is the only leaf→root action channel (commitment 2). Zoom
	 * is a `$bindable` prop the route owns; every bound routes through
	 * panel-prefs clamps (one clamp site, commitment 3). `onresizeall` is
	 * a ControlBar-specific prop: the tray is a DIRECT child of the
	 * workspace route (not a sidebar intermediate), so prop wiring here
	 * breaks no commitment.
	 */
	import { Settings } from '@lucide/svelte';
	import { PANEL_DEFAULT_WIDTH, PANEL_DEFAULT_ZOOM } from '$lib/utils/panel-prefs';
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
		/** The floor capture target (PanelsZoom's layout slot) — pass-through
		 *  to the tray's TrayButtons row (null before mount: SSR-safe no-op). */
		captureContainer?: HTMLElement | null;
	} = $props();

	let open = $state(false);
	let hideTimer: ReturnType<typeof setTimeout> | null = null;

	// The tray PORTALS to document.body (2026-10-22): the ControlBar now
	// mounts in the sidebar (header action cluster / collapsed stub),
	// whose .rail carries overflow:hidden — an in-flow absolute tray
	// would clip — and the embedded rail lives inside PanelsZoom's
	// transform:scale() ancestor, which turns any fixed descendant into
	// its coordinate space. Anchored under the trigger's VIEWPORT rect
	// (transform-true), clamped so the 15rem tray never leaves screen.
	let triggerEl: HTMLElement | null = null;
	let trayStyle = $state('');

	$effect(() => {
		if (!open) return;
		const rect = triggerEl?.getBoundingClientRect();
		if (!rect) return;
		const TRAY_MIN = 256 + 16; // 15rem min-width + padding slack
		const left = Math.max(8, Math.min(rect.left, window.innerWidth - TRAY_MIN));
		trayStyle = 'left: ' + left + 'px; top: ' + (rect.bottom + 6) + 'px';
	});

	/** Portal action: host the tray outside every clipping/transform
	 *  ancestor; the hover lifecycle re-attaches on the host below. */
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return {
			destroy() {
				node.remove();
			}
		};
	}

	/** Reveal now and cancel any pending hide (hover re-enter, focus). */
	function reveal(): void {
		if (hideTimer !== null) {
			clearTimeout(hideTimer);
			hideTimer = null;
		}
		open = true;
	}

	/** Hide after the 250ms grace — mouseleave from trigger OR tray. */
	function scheduleHide(): void {
		if (hideTimer !== null) clearTimeout(hideTimer);
		hideTimer = setTimeout(() => {
			open = false;
			hideTimer = null;
		}, 250);
	}

	/** Keyboard close: Escape anywhere in the tray dismisses it. */
	function onKeydown(e: KeyboardEvent): void {
		if (e.key === 'Escape') {
			open = false;
			if (hideTimer !== null) {
				clearTimeout(hideTimer);
				hideTimer = null;
			}
		}
	}
</script>

<div
	class="controlbar"
	class:open
	role="toolbar"
	aria-label={t(m.floorControls)}
	aria-orientation="vertical"
	tabindex="-1"
	data-testid="controlbar"
	data-open={open}
	onmouseenter={reveal}
	onmouseleave={scheduleHide}
	onfocusin={reveal}
	onfocusout={(e: FocusEvent & { currentTarget: EventTarget & Node; relatedTarget: EventTarget | null }) => {
		// Hide only when focus leaves the WHOLE tray (tabbing from the
		// trigger INTO an input is navigation, not departure).
		const next = e.relatedTarget;
		if (!(next instanceof Node) || !e.currentTarget.contains(next)) scheduleHide();
	}}
	onkeydown={onKeydown}
>
	<button
		type="button"
		class="trigger"
		bind:this={triggerEl}
		data-testid="controlbar-trigger"
		aria-label={t(m.floorControls)}
		aria-expanded={open}
		onclick={reveal}
	>
		<Settings size={14} aria-hidden="true" />
	</button>
	{#if open}
		<!-- Portaled to document.body — the hover/focus/Escape lifecycle
		     re-attaches here, since the tray is no longer a DOM descendant
		     of the .controlbar host those handlers sit on. -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions —
		     the listeners are the tray's HOVER LIFECYCLE (reveal/hide
		     grace + Escape), not pointer interaction; the tray's real
		     controls stay themselves inside ControlBarTray. -->
		<div
			class="tray-float"
			role="group"
			use:portal
			style={trayStyle}
			onmouseenter={reveal}
			onmouseleave={scheduleHide}
			onfocusin={reveal}
			onfocusout={(e: FocusEvent & { currentTarget: EventTarget & Node; relatedTarget: EventTarget | null }) => {
				const next = e.relatedTarget;
				if (!(next instanceof Node) || !e.currentTarget.contains(next)) scheduleHide();
			}}
			onkeydown={onKeydown}
		>
			<ControlBarTray bind:panelWidth bind:zoom {onresizeall} {captureContainer} />
		</div>
	{/if}
</div>

<style>
	/* .controlbar flows inline where hosted (sidebar header action
	   cluster / collapsed stub, 2026-10-22) — no fixed pinning. */
	.trigger {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		margin-left: auto;
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.375rem;
		background: var(--color-surface-primary, var(--color-surface-elevated));
		color: var(--color-text-secondary, #6c757d);
		cursor: pointer;
		box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);
		opacity: 0.65;
		transition:
			opacity 0.15s ease,
			color 0.15s ease;
	}

	.controlbar:hover .trigger,
	.controlbar.open .trigger,
	.trigger:focus-visible {
		opacity: 1;
		color: var(--color-text-primary, #212529);
	}

	/* Portaled tray host: fixed under the trigger's viewport rect
	   (left/top set inline), above every floor chrome. */
	.tray-float {
		position: fixed;
		z-index: 60;
	}
</style>
