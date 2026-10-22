<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	/**
	 * AppSidebar — the conversation page's left rail (OCI ControlRail port,
	 * 2026-08-23). One component, two branches × two hosts (2026-08-26):
	 *
	 *   expanded  → width-carrying wrapper: `<aside>` (header = title
	 *               "Deepseek Insight" + actions + collapse button pinned
	 *               right; body = the mini sessions list) with the drag
	 *               gutter as its flex SIBLING — the rail's
	 *               overflow:hidden must never clip the gutter's hit area.
	 *   collapsed → 34px stub: the expand button with a vertical
	 *               "Deepseek Insight" label.
	 *
	 *   HOSTS (config sidebar.placement):
	 *    - standalone (default, 'none')  → the rail renders BESIDE the
	 *      floor: this component owns the px width wrapper + the trailing
	 *      gutter, neither of which ever scales with zoom.
	 *    - embedded ('panels-zoom')      → the BARE rail renders inside
	 *      PanelsZoom as the floor's first column, hosted by
	 *      StickyColumnContainer (OCI ControlRail pattern): the column
	 *      owns the triple-locked width and the gutter; this component
	 *      owns neither and scales with the floor's zoom.
	 *
	 * The former Home anchor retired with the homepage (Root-is-the-Floor
	 * ADR, 2026-09-02) — the spine IS the session list, and `/` is the
	 * floor itself.
	 *
	 * Presentational only — collapse/width state and drag math live in the
	 * page (OCI ownership split); the gutter just reports mousedown, and the
	 * single width clamp lives in sidebar-prefs (clampSidebarWidth).
	 */
	import { PanelLeftClose } from '@lucide/svelte';
	import SidebarSessions from '../../sessions/SidebarSessions.svelte';
	// The expanded rail header (brand title + action cluster) — extracted
	// to its own component. AboutButton rides the header prefix AND the
	// collapsed stub's prefix.
	import { type SessionFilterState } from '$lib/utils/session-filters';
	import { loadSessionFilter, saveSessionFilter } from '$lib/utils/session-filter-prefs';
	import AppSidebarHeader from './AppSidebarHeader.svelte';
	import AboutButton from './AboutButton.svelte';
	import RestartButton from './RestartButton.svelte';
	import { PANEL_DEFAULT_WIDTH, PANEL_DEFAULT_ZOOM } from '$lib/utils/panel-prefs';
	import ControlBar from '../../panels/control-bar/ControlBar.svelte';

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
		 *  filter's storage key (dsi-session-filter_<profile>): each desk
		 *  remembers its own pills. Constant per mount; null = default. */
		profile?: string | null;
		collapsed?: boolean;
		width?: number;
		/** EMBEDDED RAIL (sidebar.placement 'panels-zoom', 2026-08-26):
		 *  render the BARE rail — no width wrapper, no gutter. Both belong
		 *  to the hosting StickyColumnContainer (OCI ControlRail pattern:
		 *  the rail owns neither). Ignored when collapsed (the stub is
		 *  never embedded — it renders beside the floor, OCI parity). */
		embedded?: boolean;
		/** Session whose conversation page is showing — highlighted row. */
		currentSessionId: string;
		/** Open floor panels (W4) — paneled sessions leave the spine. */
		paneledSessionIds?: string[];
		/** The ConversationPage root element — the header's canvas-copy
		 *  button capture target (page-owned bind:this, the same
		 *  container-down flow ToolsMessage's canvas button uses). Null
		 *  before mount (SSR, first paint): the button renders regardless,
		 *  its click is CanvasCopyButton's documented null-container
		 *  no-op. */
		captureContainer?: HTMLElement | null;
		/** The floor element — the ControlBar tray's canvas-copy capture
		 *  target (page-owned bind:this on .floor, threaded to the tray). */
		trayContainer?: HTMLElement | null;
		/** Uniform-panel width preset (bind: up to the route, through to
		 *  the ControlBar the sidebar now hosts, 2026-10-22). */
		panelWidth?: number;
		/** Floor zoom multiplier (bind: up to the route, through to the
		 *  ControlBar). */
		zoom?: number;
		/** ControlBar thumb move — route sets all panels + the preset. */
		onresizeall?: (width: number) => void;
		/** Folded glasses for the SPINE (see the prop comment above). */
		glassRows?: Array<{ sessionId: string; openedBy: string; title: string }>;
		/** Flip collapsed ↔ expanded (page-owned, persisted there). */
		onToggleCollapse?: () => void;
		/** Gutter mousedown — the page runs the drag and owns the clamp.
		 *  Only the STANDALONE gutter reports (the embedded rail has no
		 *  gutter of its own — StickyColumnContainer's does). */
		onResizeStart?: (e: MouseEvent) => void;
	} = $props();

	// Session-filter state: owned HERE so the body's one filter row (pills
	// AND the conversation-count toggle inside SessionFilterRow) shares a
	// single state with anything else the rail ever reads. Layout state
	// (collapsed/width) stays page-owned — list-filtering is a sidebar
	// concern, not a page one. The WHOLE filter (pills + toggle) seeds
	// from and writes back to session-filter-prefs — a set filter
	// survives a hard reload.
	// Intentional initial capture: the profile is constant per mount (one
	// page load = one desk — switching desks is a navigation), so the
	// filter seeds from that desk's key once and never re-seeds.
	// svelte-ignore state_referenced_locally
	let filter = $state<SessionFilterState>(loadSessionFilter(profile));

	$effect(() => {
		saveSessionFilter(filter, profile);
	});
</script>

{#if collapsed}
	<div class="rail-collapsed" data-testid="app-sidebar-collapsed">
		<!-- The floor ControlBar rides the stub too (2026-10-22): it
		     self-positions fixed top-right over the floor, so its slot in
		     the stub is a mount site only. -->
		<ControlBar bind:panelWidth bind:zoom onresizeall={onresizeall ?? (() => {})} captureContainer={trayContainer} />
		<!-- Prefix of the stub: the circled-A About trigger, wearing the
		     stub label's ink so it reads as part of the vertical stack. -->
		<RestartButton class="rail-collapsed-label" />
		<AboutButton class="rail-collapsed-label" />
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
	</div>
{:else if embedded}
	<!-- Embedded rail (placement 'panels-zoom'): the BARE aside fills the
	     hosting StickyColumnContainer — no width wrapper (the column's
	     width is triple-locked), no gutter (the column owns the trailing
	     seam). Same testid as the standalone rail so specs/E2E target one
	     contract at either site. -->
	<aside class="rail rail-embedded" data-testid="app-sidebar">
		<AppSidebarHeader
			{captureContainer}
			{trayContainer}
			bind:panelWidth
			bind:zoom
			{onresizeall}
			{onToggleCollapse}
		/>

		<SidebarSessions
			{currentSessionId}
			{paneledSessionIds}
			{filter}
			onfilterchange={(f) => (filter = f)}
		/>
	</aside>
{:else}
	<div class="rail-wrap" data-testid="app-sidebar" style="width: {width}px">
		<aside class="rail">
			<AppSidebarHeader
			{captureContainer}
			{trayContainer}
			bind:panelWidth
			bind:zoom
			{onresizeall}
			{onToggleCollapse}
		/>

			<SidebarSessions
				{currentSessionId}
				{paneledSessionIds}
				{filter}
				{glassRows}
				onfilterchange={(f) => (filter = f)}
			/>
		</aside>

		<!-- Drag gutter (OCI rail-resize analog): flex sibling of the rail so
		     the rail's overflow:hidden cannot clip it. Reports mousedown
		     only; window-level move/up and the [200,500] clamp live in the
		     page — one drag owner, one clamp site. -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions —
		     mouse-drag resize handle (OCI ResizeGutter pattern);
		     keyboard-driven resize is a known gap, not a silent omission -->
		<div
			class="rail-gutter"
			data-testid="sidebar-gutter"
			role="separator"
			aria-orientation="vertical"
			aria-label={t(m.resizeSidebar)}
			onmousedown={(e) => onResizeStart?.(e)}
		></div>
	</div>
{/if}

<style>
	/* Width wrapper — carries the user-resizable px width (OCI rail column
	   wrapper pattern); the page's drag writes this width. Flex row so the
	   gutter — the rail's flex SIBLING — stretches to the rail's height:
	   as a plain block child after a 100%-height rail it collapsed to
	   height:0 and the resize handle was unhittable (2026-09-11 bug). */
	.rail-wrap {
		display: flex;
		flex-shrink: 0;
		height: 100%;
		min-height: 0;
	}

	.rail {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		height: 100%;
		min-height: 0;
		overflow: hidden;
		background: var(--color-surface-elevated, var(--color-surface-elevated));
	}

	/* Embedded rail fills its StickyColumnContainer: the column carries
	   the triple-locked width, so the rail takes all of it (width:100%
	   under flex-column stretch is belt-and-braces) and all of its height. */
	.rail-embedded {
		width: 100%;
	}

	/* Animated gradient surface — the collapsed-stub half of what was one
	   shared rule with the expanded header; the header's half moved into
	   AppSidebarHeader (Svelte styles are component-scoped, so the rule
	   split across the two components). Gradient is oversized (300% x
	   300%) and the animation pans background-position; stops are richer
	   pastels (warm peach → sky blue → lilac → mint), each WCAG-AA-checked
	   against the var(--color-text-secondary) label text (>= 5.4:1 contrast). Keep in sync
	   with AppSidebarHeader's copy so both states read as one surface. */
	.rail-collapsed {
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
	/* Dark lamp (ADR-0023): stub copy of the dark gradient — keep in sync
	 * with AppSidebarHeader's .rail-header override. */
	:global(html[data-theme='dark']) .rail-collapsed {
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
		.rail-collapsed {
			animation: none;
		}
	}

	/* Collapsed stub — same 34px geometry as OCI's ControlRail stub.
	   Gradient + animation come from the shared rule above; var(--color-text-secondary) keeps
	   the vertical label AA (>= 5.4:1) on every stop. */
	.rail-collapsed {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		flex-shrink: 0;
		width: 34px;
		min-width: 34px;
		height: 100%;
		padding: 0.5rem 0;
		border: none;
		border-right: 1px solid var(--color-surface-border, #dee2e6);
		color: var(--color-text-secondary);
	}

	.stub-expand {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		flex: 1;
		min-height: 0;
		border: none;
		background: transparent;
		color: inherit;
		cursor: pointer;
		transition:
			color 0.15s ease,
			background-color 0.15s ease;
	}

	.stub-expand:hover,
	.stub-expand:focus-visible {
		color: var(--color-accent-purple, var(--color-accent-purple));
		background: var(--color-surface-hover, rgb(0 0 0 / 0.03));
		outline: none;
	}

	/* Stub label ink. :global: the class also lands on the AboutButton's
	   inner <button> (child component — parent scope hashes cannot reach
	   it), so the prefix trigger matches the label's small-caps ink. */
	.rail-collapsed :global(.rail-collapsed-label) {
		font-size: 0.5625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		writing-mode: vertical-rl;
	}

	/* Resize gutter — 6px column right of the rail's visible border. */
	.rail-gutter {
		width: 6px;
		flex-shrink: 0;
		cursor: col-resize;
		transition: background-color 0.15s ease;
	}

	.rail-gutter:hover {
		background: var(--color-accent-blue, #3b82f6);
		opacity: 0.25;
	}
</style>