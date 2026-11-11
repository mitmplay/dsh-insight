<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import { Bot, BotOff, ChevronDown, ChevronRight } from '@lucide/svelte';
	import SidebarOpenPanelHeader from '../../sessions/SidebarOpenPanelHeader.svelte';
	import SidebarOpenPanelTree from '../../sessions/SidebarOpenPanelTree.svelte';

	// Props: all state arrives from the owning host (SidebarSessionOpen);
	// every action returns as a callback — this header owns no state.
	let {
		collapsed,
		headName,
		dead = false,
		running = false,
		allFolded,
		allUnfolded,
		oncollapseall,
		onexpandall,
		subagentsHidden,
		ontoggle,
		ontogglesubagents
	}: {
		collapsed: boolean;
		headName: string | null;
		dead: boolean;
		running: boolean;
		allFolded: boolean;
		allUnfolded: boolean;
		oncollapseall: () => void;
		onexpandall: () => void;
		subagentsHidden: boolean;
		ontoggle: () => void;
		ontogglesubagents: () => void;
	} = $props();
</script>

<div class="group-head-row">
	<button
		type="button"
		class="group-head"
		data-testid="sidebar-panel-group-toggle"
		aria-expanded={!collapsed}
		aria-controls="sidebar-panel-group-rows"
		onclick={ontoggle}
	>
		{#if collapsed}<ChevronRight size={12} aria-hidden="true" />{:else}<ChevronDown size={12} aria-hidden="true" />{/if}
		<!-- Title: `Focused - ` stem, then the focused name chip — the
		     chip is SidebarOpenPanelHeader (extracted 2026-09-02);
		     the ` - ` separator stays text and rides unconditionally
		     (2026-09-03) so the string contract survives. -->
		<span class="head-title" data-testid="sidebar-panel-group-title"
			>{t(m.focused)} - <SidebarOpenPanelHeader name={headName} {dead} {running} /></span
		>
	</button>
	<!-- Lineage fold pair (SidebarOpenPanelTree, extracted
	     2026-09-03): collapse-all / expand-all over every session
	     with lineage; a seg at its extreme disables. -->
	<SidebarOpenPanelTree {collapsed} allFolded={allFolded} allUnfolded={allUnfolded} {oncollapseall} {onexpandall} />
	<!-- Sub-agent view filter (2026-10-31): the spine's
	     sidebar-spine-subagents twin — same Bot/BotOff grammar,
	     same aria-pressed honesty; hides depth>0 rows from THIS
	     list without closing anything. -->
	<button
		type="button"
		class="subagents-btn"
		class:active={subagentsHidden}
		data-testid="sidebar-open-panels-subagents"
		aria-pressed={subagentsHidden}
		title={subagentsHidden ? 'Show sub-agents' : 'Hide sub-agents'}
		onclick={ontogglesubagents}
	>
		{#if subagentsHidden}<BotOff size={12} aria-hidden="true" />{:else}<Bot
				size={12}
				aria-hidden="true"
			/>{/if}
	</button>
</div>

<style>
	/* Group header row: the collapse toggle (flex 1) + the lineage fold
	   pair beside it — siblings under one flex row, the fold pair never
	   squeezed (shrink 0) while the title ellipsizes inside its button. */
	.group-head-row {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 0.25rem;
		min-width: 0;
	}
	/* Sub-agent view-filter button (2026-10-31): a byte-faithful port of
	   the spine's .subagents-btn grammar (SidebarSessionList) — one
	   button, one look, the two headers can never drift. */
	.subagents-btn {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 1.25rem;
		min-width: 1.375rem;
		padding: 0 0.25rem;
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 0.375rem;
		background: var(--color-surface-elevated, #ffffff);
		color: var(--color-text-secondary, #6c757d);
		cursor: pointer;
		transition:
			background-color 0.15s ease,
			color 0.15s ease,
			border-color 0.15s ease;
	}

	.subagents-btn:hover {
		background: var(--color-surface-hover, #e9ecef);
		color: var(--color-text-primary, #212529);
	}

	.subagents-btn:focus-visible {
		outline: 2px solid var(--color-navy-focus);
		outline-offset: 1px;
	}

	/* Engaged = sub-agents HIDDEN: the spine active tint (green). */
	.subagents-btn.active {
		border-color: color-mix(in srgb, var(--color-status-pass) 40%, transparent);
		background: color-mix(in srgb, var(--color-status-pass) 15%, transparent);
		color: var(--color-success-ink, #1a7f37);
	}

	.subagents-btn.active:hover {
		background: color-mix(in srgb, var(--color-status-pass) 24%, transparent);
	}

	/* Group header (2026-08-26): the collapse/expand toggle — full-width
	   button in the group's own grammar (radius, hover field), chevron
	   leading. Always rendered while panels exist: collapsed, it IS the
	   group, and the title carries the floor's focus. Never shrinks —
	   when the pane hits its half-column cap the rows container below
	   absorbs the shortage (the spine group's pinned-header rule). */
	.group-head {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.25rem 0.375rem;
		border: none;
		border-radius: 0.375rem;
		background: transparent;
		font-size: 0.6875rem;
		line-height: 1.25;
		color: var(--color-text-primary, #212529);
		cursor: pointer;
		transition: background-color 0.15s ease;
	}

	.group-head:hover {
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 18%, var(--color-surface-elevated));
	}

	/* Keyboard focus gets a RING, not just the hover field — a visible
	   focus indicator (WCAG 2.4.7) in NAVY: 8.86:1 on the wash (the
	   50% accent-deep mix measured 3.98:1 — under the 3:1 an indicator
	   needs to pop reliably at the ring's thin stroke). */
	.group-head:focus-visible {
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 18%, var(--color-surface-elevated));
		outline: 2px solid var(--color-navy-focus);
		outline-offset: -2px;
	}

	.group-head :global(svg) {
		flex-shrink: 0;
		color: var(--color-navy-focus);
	}

	/* Title — `Focused - <selected session name>`, exactly the row-label
	   grammar for the name half (title ?? sessionId). One span so the
	   string tests pin is the string users read. NAVY (2026-08-26 audit):
	   11px text needs AA 4.5:1 — navy holds 8.86:1 on the wash where the
	   accent-deep mix managed 3.98:1 — same hue family (the accent's own
	   darkened anchor), honest contrast + weight 600 for the floor's
	   focus cue. Flex row (2026-09-02): the span claims the header row's
	   free width and hands it to the chip, which grows to fill it; the
	   chip's label ellipsizes inside, so this span only clips. */
	.head-title {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		align-items: center;
		overflow: hidden;
		white-space: nowrap;
		font-weight: 600;
		color: var(--color-navy-focus);
	}
</style>
