<script lang="ts">
	/**
	 * ControlBar — the base hover-tray machine (ADR-0073, R10): the
	 * gear trigger + portal + tray lifecycle that used to live in DSI's
	 * app class, now package surface so every floor-having app mounts
	 * instead of reimplements. Hover behavior is byte-equivalent to the
	 * DSI original (Panel Floor W5 task 5.1, ADR-0006 R7 lineage):
	 * hovering the trigger reveals the tray, leaving hides it after
	 * 250ms (the timer clears on re-enter, so grazing the tray keeps it
	 * open); focus-in reveals, focus-out hides only when focus truly
	 * leaves; Escape closes.
	 *
	 * The tray PORTALS to document.body: the bar mounts inside sidebar
	 * rails (overflow:hidden) and transform:scale() ancestors (fixed
	 * descendants would re-space) — anchored under the trigger's
	 * VIEWPORT rect, clamped so the 15rem tray never leaves screen.
	 *
	 * Communication (ADR-0073 D3): props down (bindable panelWidth/zoom,
	 * capture props, caption snippets, bounds), callbacks up
	 * (onresizeall). The base NEVER imports consumer modules — the
	 * consumer contributes its own words, bounds and actions via
	 * props/snippets; the tray body is ControlBarTray.
	 */
	import ControlBarTray from './ControlBarTray.svelte';

	let {
		/** Trigger + toolbar accessible name — consumer words. */
		ariaLabel = 'Floor controls',
		/** Testids — base defaults match the DSI floor suite verbatim. */
		testId = 'controlbar',
		triggerTestId = 'controlbar-trigger',
		trayTestId = 'controlbar-tray',
		panelWidth = $bindable(730),
		zoom = $bindable(1),
		onresizeall,
		captureContainer = null,
		captureTitle = '',
		captureMode = 'visible' as 'full' | 'visible',
		captureRowLabel = 'Capture',
		captureRowTestId = 'controlbar-tray-buttons',
		widthMin,
		widthMax,
		widthStep,
		widthCaption,
		widthAriaLabel = ariaLabel,
		widthTestId = 'controlbar-slider-width',
		zoomMin,
		zoomMax,
		zoomStep,
		zoomCaption,
		zoomAriaLabel = ariaLabel,
		zoomTestId = 'controlbar-slider-zoom',
		extras,
		/** Optional tray-body override (W2 cutover): when supplied, rendered
		 *  inside the portaled float INSTEAD of the default ControlBarTray —
		 *  a consumer thin-tray (e.g. DSI's caption/bounds/AddPanel shell)
		 *  hosts here. Default: the base tray with the props above. */
		tray
	}: {
		ariaLabel?: string;
		testId?: string;
		triggerTestId?: string;
		trayTestId?: string;
		/** Uniform-panel width preset (bind: up to the route). */
		panelWidth?: number;
		/** Floor zoom multiplier (bind: up to the route). */
		zoom?: number;
		/** Commit a new uniform width on every thumb move. */
		onresizeall?: (width: number) => void;
		/** The floor capture target — null (the default) renders no row. */
		captureContainer?: HTMLElement | null;
		captureTitle?: string;
		captureMode?: 'full' | 'visible';
		captureRowLabel?: string;
		captureRowTestId?: string;
		widthMin?: number;
		widthMax?: number;
		widthStep?: number;
		widthCaption?: import('svelte').Snippet<[number]>;
		widthAriaLabel?: string;
		widthTestId?: string;
		zoomMin?: number;
		zoomMax?: number;
		zoomStep?: number;
		zoomCaption?: import('svelte').Snippet<[number]>;
		zoomAriaLabel?: string;
		zoomTestId?: string;
		/** Consumer extras (DSI: AddPanel) — rendered only when passed. */
		extras?: import('svelte').Snippet;
		/** Optional tray-body override (see prop comment). */
		tray?: import('svelte').Snippet;
	} = $props();

	let open = $state(false);
	let hideTimer: ReturnType<typeof setTimeout> | null = null;
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
	aria-label={ariaLabel}
	aria-orientation="vertical"
	tabindex="-1"
	data-testid={testId}
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
		data-testid={triggerTestId}
		aria-label={ariaLabel}
		aria-expanded={open}
		onclick={reveal}
	>
		<!-- settings gear (lucide geometry, inlined: the package is
		     dependency-free with the svelte peer, ADR-0064 D4) -->
		<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
			<circle cx="12" cy="12" r="3" />
		</svg>
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
			{#if tray}
				{@render tray()}
			{:else}
				<ControlBarTray
					bind:panelWidth
					bind:zoom
					{onresizeall}
					{captureContainer}
					{captureTitle}
					{captureMode}
					{captureRowLabel}
					{captureRowTestId}
					{widthMin}
					{widthMax}
					{widthStep}
					{widthCaption}
					{widthAriaLabel}
					{widthTestId}
					{zoomMin}
					{zoomMax}
					{zoomStep}
					{zoomCaption}
					{zoomAriaLabel}
					{zoomTestId}
					{extras}
					{trayTestId}
					trayLabel={ariaLabel}
				/>
			{/if}
		</div>
	{/if}
</div>

<style>
	/* .controlbar flows inline where hosted (sidebar header action
	   cluster / collapsed stub) — no fixed pinning. */
	.trigger {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		margin-left: auto;
		border: 1px solid var(--color-surface-border);
		border-radius: 0.375rem;
		background: var(--color-surface-primary);
		color: var(--color-text-secondary);
		cursor: pointer;
		box-shadow: 0 1px 2px var(--color-shadow-soft);
		opacity: 0.65;
		transition:
			opacity 0.15s ease,
			color 0.15s ease;
	}

	.controlbar:hover .trigger,
	.controlbar.open .trigger,
	.trigger:focus-visible {
		opacity: 1;
		color: var(--color-text-primary);
	}

	/* Portaled tray host: fixed under the trigger's viewport rect
	   (left/top set inline), above every floor chrome. */
	.tray-float {
		position: fixed;
		z-index: 60;
	}
</style>
