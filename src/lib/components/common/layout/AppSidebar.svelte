<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	/**
	 * AppSidebar — the conversation page's left rail (OCI ControlRail port,
	 * 2026-08-23), migrated onto the base SidebarContainer (ADR-0063 D5).
	 * The SHELL (three branches, width wrapper, gutter, stub geometry)
	 * lives in container-base/src/components/SidebarContainer.svelte —
	 * DSI contributes its identity only: paraglide words, the animated
	 * gradient stub skin, the header cluster, the sessions body, the
	 * ControlBar mounts, and the width badge. Collapse/width/drag state
	 * stays page-owned (OCI ownership split) via the same callbacks.
	 *
	 *   expanded  → header (title + actions + collapse button) + body
	 *               (the mini sessions list).
	 *   collapsed → 34px stub (base geometry) with the DSI gradient fill,
	 *               the tray mount, About/Restart prefix, vertical label.
	 *
	 *   HOSTS (config sidebar.placement):
	 *    - standalone (default, 'none')  → the rail renders BESIDE the
	 *      floor with the px width wrapper + trailing gutter.
	 *    - embedded ('panels-zoom')      → the BARE rail inside
	 *      PanelsZoom (the column owns width + gutter).
	 */
	import { PanelLeftClose } from '@lucide/svelte';
	import SidebarSessions from '../../sessions/SidebarSessions.svelte';
	import { type SessionFilterState } from '$lib/utils/session-filters';
	import { loadSessionFilter, saveSessionFilter } from '$lib/utils/session-filter-prefs';
	import AppSidebarHeader from './AppSidebarHeader.svelte';
	import { PANEL_DEFAULT_WIDTH, PANEL_DEFAULT_ZOOM } from '$lib/utils/panel-prefs';
	import ControlBar from '../../panels/control-bar/ControlBar.svelte';
	import WidthBadge from '../WidthBadge.svelte';
	import { pagePrefs } from '$lib/services/workspace/page-prefs.svelte';
	import { SidebarContainer } from '@deepseek-insight/container-base';

	let {
		profile = null,
		collapsed = false,
		width = 400,
		embedded = false,
		currentSessionId,
		paneledSessionIds = [],
		captureContainer = null,
		trayContainer = null,
		/** ADR-0037 D4, spine half (2026-10-22): folded glasses whose OPENER
		 *  holds no panel — the page routes them here (not into the roster's
		 *  ghost grammar) so the Sessions list nests them under the opener
		 *  family; the row's click summons the glass back. */
		glassRows = [] as Array<{ sessionId: string; openedBy: string; title: string }>,
		panelWidth = $bindable(PANEL_DEFAULT_WIDTH),
		zoom = $bindable(PANEL_DEFAULT_ZOOM),
		onresizeall,
		onToggleCollapse,
		onResizeStart
	}: {
		/** Active workspace profile (?profile=, sanitized) — suffixes the
		 *  filter's storage key (dsi-session-filter_<profile>). */
		profile?: string | null;
		collapsed?: boolean;
		width?: number;
		/** EMBEDDED RAIL (sidebar.placement 'panels-zoom', 2026-08-26):
		 *  render the BARE rail — no width wrapper, no gutter. */
		embedded?: boolean;
		currentSessionId: string;
		paneledSessionIds?: string[];
		captureContainer?: HTMLElement | null;
		trayContainer?: HTMLElement | null;
		panelWidth?: number;
		zoom?: number;
		onresizeall?: (width: number) => void;
		glassRows?: Array<{ sessionId: string; openedBy: string; title: string }>;
		/** Flip collapsed ↔ expanded (page-owned, persisted there). */
		onToggleCollapse?: () => void;
		/** Gutter mousedown — the page runs the drag and owns the clamp. */
		onResizeStart?: (e: MouseEvent) => void;
	} = $props();

	// Session-filter state: owned HERE so the body's one filter row shares
	// a single state with anything else the rail ever reads (layout state
	// stays page-owned). Intentional initial capture: one page load = one
	// desk. svelte-ignore state_referenced_locally
	// svelte-ignore state_referenced_locally
	let filter = $state<SessionFilterState>(loadSessionFilter(profile));

	$effect(() => {
		saveSessionFilter(filter, profile);
	});
</script>

{#if collapsed}
	<SidebarContainer collapsed testIdCollapsed="app-sidebar-collapsed">
		{#snippet collapsedSkin()}
			<!-- The DSI gradient skin rides the base's skin LAYER (an absolute,
			     pointer-transparent underlay) — paint only, never controls. -->
			<div class="stub-fill"></div>
		{/snippet}
		{#snippet collapsedContent()}
			<!-- The floor ControlBar rides the stub too (2026-10-22): it
			     self-positions fixed top-right, so its slot is a mount only. -->
			<ControlBar bind:panelWidth bind:zoom onresizeall={onresizeall ?? (() => {})} captureContainer={trayContainer} />
			<button
				type="button"
				class="stub-expand"
				onclick={() => onToggleCollapse?.()}
				aria-expanded={false}
				aria-label={t(m.expandSidebar)}
				title={t(m.expandSidebar)}
			>
				<PanelLeftClose size={14} class="rotate-180" />
				<span class="rail-collapsed-label">
					<!-- i18n-skip: brand -->
					Deepseek Insight
				</span>
			</button>
		{/snippet}
	</SidebarContainer>
{:else}
	<SidebarContainer {embedded} {width} testId="app-sidebar" gutterLabel={t(m.resizeSidebar)} onResizeStart={onResizeStart}>
		{#snippet badge()}
			{#if !embedded && pagePrefs.sidebarBadge !== null}
				<!-- Sidebar width badge (Movable Rail ADR amendment 2026-10-30):
				     the standalone rail answers the same drag with the same chip
				     the floor gutters show. The EMBEDDED rail renders no badge —
				     its width paints under PanelsZoom's scale(), so a raw px
				     number would misreport (ADR D3). -->
				<WidthBadge phase={pagePrefs.sidebarBadge} width={width} testid="sidebar-width-badge" />
			{/if}
		{/snippet}
		{#snippet header()}
			<AppSidebarHeader {captureContainer} {trayContainer} bind:panelWidth bind:zoom {onresizeall} {onToggleCollapse} />
		{/snippet}
		<SidebarSessions {currentSessionId} {paneledSessionIds} {filter} {glassRows} onfilterchange={(f) => (filter = f)} />
	</SidebarContainer>
{/if}

<style>
	/* The DSI gradient skin — the animated surface of the collapsed stub.
	   Gradient is oversized (300% x 300%) and pans background-position;
	   stops are richer pastels, each WCAG-AA-checked against
	   var(--color-text-secondary) label text (>= 5.4:1). Keep in sync with
	   AppSidebarHeader's copy so both states read as one surface. */
	.stub-fill {
		position: absolute;
		inset: 0;
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
	/* Dark lamp (ADR-0023): the dark gradient copy. */
	:global(html[data-theme='dark']) .stub-fill {
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
		.stub-fill {
			animation: none;
		}
	}

	/* Stub content sits above the gradient fill; ink + geometry mirror the
	   pre-migration stub (34px, small-caps vertical label). */
	.stub-expand {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		flex: 1;
		min-height: 0;
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		cursor: pointer;
		transition:
			color 0.15s ease,
			background-color 0.15s ease;
	}

	.stub-expand:hover,
	.stub-expand:focus-visible {
		color: var(--color-accent-purple);
		background: var(--color-surface-hover, rgb(0 0 0 / 0.03));
		outline: none;
	}

	/* Stub label ink. :global: the class also lands on the AboutButton's
	   inner <button> (child component — parent scope hashes cannot reach
	   it), so the prefix trigger matches the label's small-caps ink. */
	:global(.rail-collapsed-label) {
		font-size: 0.5625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		writing-mode: vertical-rl;
		color: var(--color-text-secondary);
	}
</style>
