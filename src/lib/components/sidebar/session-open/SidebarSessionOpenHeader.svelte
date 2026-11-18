<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import { Bot, BotOff } from '@lucide/svelte';
	import { PanelListboxHeader } from '@deepseek-insight/container-base';
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

<!-- R8 re-point (ADR-0070 D9): the chevron + label row is the PACKAGE
     organ now (PanelListboxHeader) — the retired hand-rolled .group-head
     grammar was deleted in the same commit. What stays consumer-side is
     exactly the domain: the `Focused - <chip>` stem (the ` - ` rides as
     text unconditionally, 2026-09-03), the lineage fold pair, and the
     sub-agent view filter — injected through the organ's children and
     trailing snippets (D3). The toggle testid and the rows aria-controls
     survive as props (D6). -->
<PanelListboxHeader
	expanded={!collapsed}
	onToggle={ontoggle}
	label={t(m.focused)}
	testid="sidebar-panel-group-header"
	toggleTestid="sidebar-panel-group-toggle"
	controls="sidebar-panel-group-rows"
	class="group-head-row"
>
	{#snippet children()}
		<span class="head-title" data-testid="sidebar-panel-group-title"
			>{t(m.focused)} - <SidebarOpenPanelHeader name={headName} {dead} {running} /></span
		>
	{/snippet}
	{#snippet trailing()}
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
	{/snippet}
</PanelListboxHeader>

<style>
	/* Group header row: the collapse toggle + the lineage fold pair beside
	   it — the flex layout itself is the ORGAN's now. (R8: the retired .group-head chevron
	   grammar is the organ's — deleted same commit, ADR-0070 D9.) */
	/* Sub-agent view-filter button (2026-10-31): the spine's twin —
	   same button, one look (ADR-0070 retires the drift comment: the
	   headers now SHARE the organ; this button stays consumer-side as
	   domain control via the trailing snippet). */
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

	/* Title — `Focused - <selected session name>`, exactly the row-label
	   grammar for the name half (title ?? sessionId). One span so the
	   string tests pin is the string users read. NAVY (2026-08-26 audit):
	   11px text needs AA 4.5:1 — navy holds 8.86:1 on the wash. Flex row
	   (2026-09-02): the span claims the header row's free width and hands
	   it to the chip, which grows to fill it; the chip's label ellipsizes
	   inside, so this span only clips. */
	.head-title {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		align-items: center;
		overflow: hidden;
		white-space: nowrap;
		font-weight: 600;
		font-size: 0.6875rem;
		line-height: 1.25;
		color: var(--color-navy-focus);
	}
</style>
