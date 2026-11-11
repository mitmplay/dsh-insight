<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * SessionFilterHeader — the ALWAYS-VISIBLE one-line header of
	 * SidebarSessionFilter (extracted 2026-09-04): the collapse button
	 * (chevron + `{t(m.filterBy)}` summary) with the meta controls
	 * (SessionFilterMeta) pinned to its RIGHT end. The head and the
	 * meta controls are SIBLINGS under one flex row — a button must
	 * never nest buttons. Because meta rides the header line, `All` and
	 * the count toggle stay reachable while the dimension pills are
	 * folded; the fold hides only the Agents/Workspaces pills.
	 *
	 * Summary contract (moved verbatim from SidebarSessionFilter): a CHIP
	 * per selected dimension in the pills' kind grammar — Folder/blue
	 * workspace (grey when ghost), Bot/purple agent — with the ` - ` /
	 * ` + ` separators as plain text, so the summary's textContent
	 * keeps the exact string contract the tests pin; nothing selected
	 * renders the muted `Workspace + Agent` placeholder in the value
	 * slot (2026-09-04 — reordered to match the chips'
	 * workspace-first order). Labels reuse the pill derivation —
	 * workspace basename,
	 * host preset display name — the summary never invents a second
	 * naming scheme.
	 *
	 * The count toggle ([0]/[!0]/[folder]) never enters the summary;
	 * the head button's tooltip discloses the full state instead, so a
	 * standing filter can never become the invisible trap the
	 * 2026-08-24 move closed.
	 *
	 * Narrow-rail guarantee — the summary ellipsizes, the chevron and
	 * the meta controls never shrink, so the 200px rail floor never
	 * overflows.
	 *
	 * Right alignment (2026-09-04 review): the HEAD flexes to fill the
	 * free line (flex: 1) — the growth of the sibling, not a margin on
	 * the meta container, is what pins the meta controls to the right
	 * end; the whole stretch doubles as the collapse button's hit and
	 * hover area.
	 */
	import { ChevronDown, ChevronRight } from '@lucide/svelte';
import AgentChip from '../../common/buttons/AgentChip.svelte';
	import SessionFilterMeta from '../../sessions/SessionFilterMeta.svelte';
	import WorkspaceChip from '../../common/WorkspaceChip.svelte';
	import WorkspaceActionsMenu from '../../sessions/WorkspaceActionsMenu.svelte';
	import {
		workspaceLabel,
		type FilterOption,
		type SessionFilterState
	} from '$lib/utils/session-filters';
	import type { DsiWorkspaceSummary } from '$lib/types';

	let {
		workspaces,
		presets,
		filter,
		collapsed,
		ontoggle,
		onchange,
		oncreated,
		registry = []
	}: {
		workspaces: FilterOption[];
		presets: FilterOption[];
		filter: SessionFilterState;
		/** Fold state — owned by SidebarSessionFilter, never persisted. */
		collapsed: boolean;
		/** Flip the fold. */
		ontoggle: () => void;
		/** Pass-through: the meta controls report full next states. */
		onchange: (next: SessionFilterState) => void;
		/** Pass-through: the meta postfix AddWorkspaceButton reports the
		 *  fresh session created in an adopted workspace. */
		oncreated: (sessionId: string, agentPreset: string | null, path: string) => void;
		/** Raw registry rows — the chip menu resolves workspaceId by path
		 *  AT OPEN (Chip Menu ADR D4); FilterOption carries no id. */
		registry: DsiWorkspaceSummary[];
	} = $props();

	/** Menu open — the registered chip's click owns this gesture (ADR D1);
	 *  the fold keeps the whole rest of the header line. */
	let menuOpen = $state(false);

	/** Selected workspace's registry entry — null when the dimension
	 *  rests or the key matches no pill (basename fallback then). */
	const wsEntry = $derived(
		filter.workspace === null ? null : (workspaces.find((w) => w.key === filter.workspace) ?? null)
	);

	/** Selected workspace's label — the pill list's basename, honest
	 *  basename fallback for a key no pill carries. */
	const wsLabel = $derived(
		filter.workspace === null ? null : (wsEntry?.label ?? workspaceLabel(filter.workspace))
	);

	/** Selected agent's label — the host's display name, id fallback. */
	const agentLabel = $derived(
		filter.preset === null
			? null
			: (presets.find((p) => p.key === filter.preset)?.label ?? filter.preset)
	);

	/** Ghost chip: the selected cwd's registry entry is gone — the same
	 *  hybrid truth the ghost pill carries (grey, never blue). */
	const wsGhost = $derived(wsEntry?.registered === false);

	/** Registry row for the selected path — resolved fresh per render, so
	 *  the menu's id is never stale (ADR D4). Null when ghost/unset. */
	const wsRegistryEntry = $derived(
		filter.workspace === null ? null : (registry.find((w) => w.path === filter.workspace) ?? null)
	);

	/** Chip tooltip — the pill's own tooltip grammar: full path (key
	 *  fallback), ghost suffix included; registered chips disclose the
	 *  menu gesture (ADR D1's affordance give-up). */
	const wsChipTitle = $derived(
		filter.workspace === null
			? undefined
			: (wsEntry?.path ?? filter.workspace) +
				(wsGhost ? ' — not in the workspace registry' : ' — click for Rename / Delete')
	);

	/** The chip's click: registered rows open the menu and NEVER fold
	 *  (stopPropagation, ADR D1); ghosts, placeholders, and agent chips
	 *  keep bubbling to the fold. A registry miss (stale selection)
	 *  falls through to the fold — no menu on a spent id (ADR D4). */
	function onWsChipClick(e: MouseEvent): void {
		if (wsGhost || wsRegistryEntry === null) return;
		e.stopPropagation();
		menuOpen = true;
	}

	/** Keyboard twin of the chip click (Enter/Space) — same gesture, same
	 *  guards; ghosts and misses fall through to the fold's own keys. */
	function onWsChipKeydown(e: KeyboardEvent): void {
		if (e.key !== 'Enter' && e.key !== ' ') return;
		if (wsGhost || wsRegistryEntry === null) return;
		e.stopPropagation();
		e.preventDefault();
		menuOpen = true;
	}

	/** Full-state tooltip — the count/workspace toggle stays out of the
	 *  summary, so the hover is the one place that always discloses it. */
	const tooltip = $derived(
		`Workspace: ${wsLabel ?? 'All'} · Agent: ${agentLabel ?? 'All'} · Count: ${
			filter.blankMode === 'any'
				? 'any'
				: filter.blankMode === 'empty'
					? '0'
					: filter.blankMode === 'workspace'
						? 'ws'
						: '!0'
		}`
	);
</script>

<div class="header">
	<button
		type="button"
		class="head"
		onclick={ontoggle}
		aria-expanded={!collapsed}
		aria-controls="filter-pills"
		title={tooltip}
		data-testid="filter-toggle"
	>
		{#if collapsed}
			<ChevronRight size={12} aria-hidden="true" />
		{:else}
			<ChevronDown size={12} aria-hidden="true" />
		{/if}
		<!-- Summary: standing label + value slot — a chip per selected
		     dimension (the pills' kind grammar: Folder/blue workspace,
		     Bot/purple agent), or the muted `Workspace + Agent`
		     placeholder when nothing filters. The ` - ` / ` + `
		     separators stay text so the string contract survives
		     verbatim. -->
		<span class="summary" data-testid="filter-summary">{t(m.filterBy)}{' - '}{#if wsLabel === null && agentLabel === null}<span
				class="placeholder"
				data-testid="filter-summary-placeholder">{t(m.workspacePlusAgent)}</span
			>{/if}{#if wsLabel !== null}<WorkspaceChip
				label={wsLabel}
				ghost={wsGhost}
				iconSize={10}
				testid="filter-summary-chip-ws"
				title={wsChipTitle}
				class={!wsGhost && wsRegistryEntry !== null ? 'menuable' : ''}
				role={!wsGhost && wsRegistryEntry !== null ? 'button' : undefined}
				onclick={onWsChipClick}
				onkeydown={onWsChipKeydown}
				style="--wsc-font-size: 0.75em"
			/>{/if}{#if wsLabel !== null && agentLabel !== null}{' + '}{/if}{#if agentLabel !== null}<!-- AgentChip owns the identity (2026-11-06); a span, so it nests inside this button. -->{/if}{#if agentLabel !== null}<AgentChip size="compact" label={agentLabel} maxWidth="6.5rem" testid="filter-summary-chip-agent" title={`agent preset — ${filter.preset}`} />{/if}</span>
	</button>
	<!-- The meta controls ride the header line, pinned RIGHT: visible
	     whether the dimension pills are folded or not. -->
	<SessionFilterMeta {workspaces} {filter} {onchange} {oncreated} />
	<!-- The chip menu (ADR D1/D2): anchored under the header line; the
	     WorkspaceActionsMenu owns its own dismissal and faces. -->
	{#if menuOpen && wsRegistryEntry !== null}
		<div class="menu-anchor">
			<WorkspaceActionsMenu
				workspaceId={wsRegistryEntry.workspaceId}
				currentTitle={wsRegistryEntry.title}
				onclose={() => (menuOpen = false)}
			/>
		</div>
	{/if}
</div>

<style>
	/* One line: the HEAD fills the free width — flex: 1 — so the whole
	   stretch up to the meta controls is the collapse button's hit and
	   hover area, and that growth is what pins the meta container to
	   the RIGHT end (no auto margins anywhere). Siblings — never a
	   button inside a button. */
	.header {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		min-width: 0;
		/* The chip menu's anchor context — the popup drops from the
		   header line, inside the row's stacking order. */
		position: relative;
	}

	/* Registered chip menu affordance (ADR D1): the pointer cue is the
	   one visible hint that this chip's click is not the fold's. The
	   chip itself is WorkspaceChip (2026-09-06) — the shared identity;
	   this host reaches it through the --wsc custom-property contract. */
	.header :global(.ws-chip.menuable) {
		cursor: context-menu;
	}

	.header :global(.ws-chip.menuable:hover) {
		--wsc-border: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 80%, var(--color-navy-focus));
	}

	/* Ghost chip keeps its TRANSPARENT field on the header line (the
	   row wash beneath is the field) — the chip's default ghost tint is
	   for the sidebar rows. */
	.header :global(.ws-chip.ghost) {
		--wsc-bg: transparent;
	}

	/* z-index LIVES HERE (2026-09-05 fix): the anchor is the popup's
	   only POSITIONED wrapper, so this is the one z-index that competes
	   with the spine rows' positioned .status glyphs (which paint in DOM
	   order over z-auto popups). The menu component's own z-index is
	   dead without position — never resurrect it there. */
	.menu-anchor {
		position: absolute;
		top: 100%;
		left: 0.375rem;
		z-index: 40;
	}

	/* The collapse button: chevron + summary, one line — the SAME
	   grammar as the panel group's .group-head (2026-08-26): same size
	   (0.6875rem), same accent-deep title, same hover wash and focus
	   ring. flex 1 1 auto — the head FILLS the free line (the sibling
	   meta container keeps its natural width), which is the right
	   alignment; min-width 0 lets the summary — not the controls —
	   squeeze on the narrow rail. */
	.head {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex: 1 1 auto;
		min-width: 0;
		background: transparent;
		border: none;
		padding: 0.25rem 0.375rem;
		border-radius: 0.375rem;
		color: var(--color-text-primary, #212529);
		font-size: 0.6875rem;
		line-height: 1.25;
		text-align: left;
		cursor: pointer;
		transition: background-color 0.15s ease;
	}

	.head:hover {
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 18%, var(--color-surface-elevated));
	}

	/* Keyboard focus gets a RING (WCAG 2.4.7) — the hover wash alone is
	   not a visible-enough keyboard cue on the tinted field. */
	.head:focus-visible {
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 18%, var(--color-surface-elevated));
		outline: 2px solid color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, var(--color-navy-focus));
		outline-offset: -2px;
	}

	/* DIRECT-CHILD only (2026-08-26 chips): the summary chips' kind
	   icons must take their CHIP color (base-layer button-svg inherit),
	   not the chevron blue — a descendant selector here painted every
	   chip icon blue regardless of kind. */
	.head > :global(svg) {
		flex-shrink: 0;
		color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, var(--color-navy-focus));
	}

	/* Summary chips (2026-08-26): the collapsed header previews the live
	   selection in the SAME grammar as the expanded pills — border +
	   kind icon + type color. Colors are the pills' AA rest values
	   (50%-deepened text/border, 8% tint field) so chip and pill of the
	   same dimension read as one identity. Icons inherit the chip color
	   (base-layer button-svg guard). */
	/* The summary chip styles moved into AgentChip (2026-11-06). */

	/* The agent chip identity moved into AgentChip (2026-11-06). */

	/* Summary — accent-deep + 600, the panel group's .head-title twin:
	   5.17:1 against the wash's darkest end at 11px (AA). */
	.summary {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 600;
		color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, var(--color-navy-focus));
	}

	/* Empty-state placeholder (2026-09-05): `Workspace + Agent` sits in
	   the value slot when no dimension filters — the name filter's
	   input-placeholder tone (secondary), never a chip: no border, no
	   kind color, 400 weight against the label's 600. */
	.placeholder {
		font-weight: 400;
		color: var(--color-text-secondary, #6c757d);
	}
</style>
