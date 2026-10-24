<script lang="ts">
	/**
	 * AppSidebarHeader — the expanded rail header (extracted from
	 * AppSidebar, 2026-09): the About prefix, the brand title, and the
	 * right-hand action cluster, composed from AboutButton,
	 * AppSidebarHeaderTitle, and AppSidebarHeaderAction. Owns the
	 * animated gradient surface for the expanded state (the collapsed
	 * stub keeps its copy in AppSidebar — Svelte styles are
	 * component-scoped, so the shared rule had to be split; keep the two
	 * gradients in sync).
	 *
	 * Presentational only — collapse flipping stays delegated upward.
	 */
	import AppSidebarHeaderTitle from './AppSidebarHeaderTitle.svelte';
	import AppSidebarHeaderAction from './AppSidebarHeaderAction.svelte';
	import AboutButton from './AboutButton.svelte';
	import RestartButton from './RestartButton.svelte';
	import { PANEL_DEFAULT_WIDTH, PANEL_DEFAULT_ZOOM } from '$lib/utils/panel-prefs';

	let {
		captureContainer = null,
		trayContainer = null,
		panelWidth = $bindable(PANEL_DEFAULT_WIDTH),
		zoom = $bindable(PANEL_DEFAULT_ZOOM),
		onresizeall,
		onToggleCollapse
	}: {
		/** The ConversationPage root element — passed through to the
		 *  canvas-copy button's capture target (page-owned bind:this). */
		captureContainer?: HTMLElement | null;
		/** The floor element — the ControlBar tray's canvas-copy capture
		 *  target, threaded down to the action cluster. */
		trayContainer?: HTMLElement | null;
		/** Uniform-panel width preset (bind: through to ControlBar). */
		panelWidth?: number;
		/** Floor zoom multiplier (bind: through to ControlBar). */
		zoom?: number;
		/** Commit a new uniform width on every thumb move. */
		onresizeall?: (width: number) => void;
		/** Flip collapsed ↔ expanded (page-owned, persisted there). */
		onToggleCollapse?: () => void;
	} = $props();
</script>

<header class="rail-header">
	<!-- Prefix: the circled-A About trigger leads the header row. -->
	<RestartButton class="rail-collapsed-label" />
	<AboutButton />
	<AppSidebarHeaderTitle />
	<AppSidebarHeaderAction
		{captureContainer}
		{trayContainer}
		bind:panelWidth
		bind:zoom
		{onresizeall}
		{onToggleCollapse}
	/>
</header>

<style>
	.rail-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.375rem;
		padding: 0.25rem 0.25rem;
		border-radius: 0.25rem;
		border: solid thin color-mix(in srgb, var(--color-accent-amber) 24%, transparent);
	}

	/* Animated gradient surface — the expanded-header half of what was one
	   shared rule with the collapsed stub (.rail-collapsed) in AppSidebar.
	   Svelte styles are component-scoped, so the rule split across the two
	   components; the gradient is oversized (300% x 300%) and the animation
	   pans background-position. Stops are richer pastels (warm peach → sky
	   blue → lilac → mint), each WCAG-AA-checked against the var(--color-text-secondary) label
	   text (>= 5.4:1 contrast). Keep in sync with AppSidebar's stub copy. */
	.rail-header {
		--rail-gradient: linear-gradient(
			120deg,
			#ffe9d6,
			#c7ddf8,
			#e4d5f7,
			#c3f0dc,
			#ffe9d6
		);
		background: var(--rail-gradient);
		background-size: 300% 300%;
		animation: rail-header-gradient 12s ease-in-out infinite;
	}

	/* Dark lamp (ADR-0023): the pastels re-tuned for the dark rail — same
	 * hues, dropped luminance; keep in sync with the stub copy below. */
	:global(html[data-theme='dark']) .rail-header {
		--rail-gradient: linear-gradient(
			120deg,
			#382c20,
			#1e2b3e,
			#2c2340,
			#1b332a,
			#382c20
		);
	}

	@keyframes rail-header-gradient {
		0% {
			background-position: 0% 50%;
		}
		50% {
			background-position: 100% 50%;
		}
		100% {
			background-position: 0% 50%;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.rail-header {
			animation: none;
		}
	}
</style>
