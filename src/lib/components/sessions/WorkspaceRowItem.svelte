<script lang="ts">
	/**
	 * WorkspaceRowItem — the shared INTERIOR of a session row (extracted
	 * 2026-08-26): status icon + workspace chip + label, the grammar
	 * ADR-0005 pins. TWO list surfaces render the identical triple —
	 * the spine (SidebarSessionList rows) and the pinned panel group
	 * (SidebarOpenPanels rows) — and had drifted into copy-paste
	 * twins; this component is the one home for that markup now.
	 *
	 * FRAGMENT BY DESIGN: three root nodes (status, chip-or-slot,
	 * label), no wrapper — the host row (<a> in the spine, <div> in the
	 * panel group) is the flex container and its gap spaces these nodes
	 * as direct children. The host owns what differs (wrapper element,
	 * hover/current/dead states, trailing column: time vs actions);
	 * this component owns what is identical.
	 *
	 * Status icon (2026-08-26 stream restyle, extracted to
	 * SessionStatus the same day): running renders THREE ANIMATED
	 * BARS — a stream/equalizer glyph, staggered like the chat
	 * StreamingIndicator (the house pattern for live motion); idle
	 * renders the old static grey dot, same 0.5rem footprint so row
	 * alignment is byte-identical. prefers-reduced-motion freezes the
	 * bars at staggered static heights — still a distinct "running"
	 * glyph, never moving (WCAG 2.3.3). The glyph lives in
	 * SessionStatus now, shared with the panel-group title chip.
	 *
	 * Palette (2026-08-26 selected-row restyle): defaults are chosen to
	 * hold contrast on EVERY field the two hosts paint — white spine,
	 * the panel group's accent wash (14%), row hover (18%), and the
	 * LIGHT selected field (30% accent) — so hosts override nothing.
	 * All ratios computed against the WCAG relative-luminance formula
	 * (calibrated script, 2026-08-26): run var(--color-success-ink) 5.48/4.69/4.47/3.86
	 * (3:1 need, 1.4.11); idle var(--color-slate-neutral) 6.46/5.52/—/4.54; chip navy-mix
	 * 4.94+ (AA, 9px text). CSS custom properties (--si-run, --si-idle,
	 * --si-chip, --si-chip-bg, --si-chip-ghost, --si-chip-ghost-bg)
	 * remain the extension point for fields this file does not know.
	 */
	import { isRegisteredWorkspace, workspaceDisplayLabel } from '$lib/utils/session-filters';
	import type { DsiWorkspaceSummary } from '$lib/types';
	import { Clock } from '@lucide/svelte';
	import SessionStatus from './SessionStatus.svelte';
	import WorkspaceChip from '../common/WorkspaceChip.svelte';

	let {
		running,
		delegated = false,
		count = 0,
		browser = false,
		depth = 0,
		fork = false,
		docChild = false,
		wsChild = false,
		workspace,
		workspaces,
		label,
		scheduled = false
	}: {
		/** Live-turn flag — bars when true, static dot when false. */
		running: boolean;
		/** Delegation live (2026-08-27, ADR D3) — forwarded to the glyph;
		 *  default false renders the pre-lineage two-state glyph. */
		delegated?: boolean;
		/** ADR-0037 D4 — a folded GLASS row: forwarded to the glyph (the
		 *  pulsing frame). Default false = the session grammar. */
		browser?: boolean;
		/** Live descendant count — forwarded; badge only when > 0. */
		count?: number;
		/** Lineage depth (ADR D6, spine rows): > 0 replaces the chip with
		 *  the branch slot — a spawned session's cwd is its spawner's, so
		 *  the workspace column carries the depth cue instead. The slot
		 *  keeps the FIXED outer width, so the label column stays
		 *  x-aligned across rows. Default 0 renders chip/slot as before. */
		depth?: number;
		/** Fork child (2026-09-01): parent edge, origin not 'subagent'.
		 *  With depth > 0 the branch tree line paints the FORK GREEN
		 *  (var(--color-ws-green), 2px stroke) — one glance separates fork children
		 *  from spawned children in the same slot. Default false keeps
		 *  the muted spawn line. */
		fork?: boolean;
		/** Document child (2026-09-07, Loadinjected ADR D3): with depth > 0
		 *  the branch tree line paints MAROON var(--color-doc-child) — the third child
		 *  paint, beside fork GREEN and spawned VIOLET. Default false keeps
		 *  the fork/muted grammar. */
		docChild?: boolean;
		/** Workspace child (2026-09-10): with depth > 0 the branch tree
		 *  line paints WORKSPACE BLUE var(--color-ws-blue) — the fourth child paint,
		 *  separating the explorer/file pair from a spawned sub-agent or a
		 *  fork. Default false keeps the existing grammar. */
		wsChild?: boolean;
		/** Session cwd — the chip's key; null renders the alignment slot. */
		workspace: string | null;
		/** Host workspace registry — the authority for chip ghost styling
		 *  and the title-first label (ADR D5: a rename shows on every
		 *  surface that names the workspace). */
		workspaces: DsiWorkspaceSummary[];
		/** RESOLVED row label — the caller owns the fallback grammar
		 *  (spine: 'untitled'; panel group: the session id). */
		label: string;
		/** Scheduled Mark pill (ADR-0057 D2, 2026-11-10): show the muted
		 *  clock+SCH pill. The CALLER derives this from the session's
		 *  origin — this presenter never sees origin itself (dumb boolean,
		 *  D3: no behavior keys to the badge). Default false = every row
		 *  before this wave renders byte-identically. */
		scheduled?: boolean;
	} = $props();
</script>

<SessionStatus {running} {delegated} {count} {browser} />
{#if depth > 0}
	<!-- Sub-agent row (ADR D6): the workspace column carries the depth
	     cue instead of a chip — the spawned session's cwd is its
	     spawner's. The slot keeps the fixed outer width (the inline
	     padding insets the glyph INSIDE it), so the label and every
	     column after the workspace start at the same x on every row. -->
	<span
		class="ws-slot branch"
		class:fork={fork}
		class:doc-child={docChild}
		class:ws-child={wsChild}
		data-testid="sidebar-workspace-branch"
		style={`padding-left:${depth * 0.75}rem`}
		aria-hidden="true"
	>
		<!-- Tree line (the file-tree `└` guide, arrow tipped): one
		     border-drawn stroke that STRETCHES across the slot's free
		     width — vertical descend, rounded turn, horizontal reach,
		     ending in an arrow aimed at the label. -->
		<span class="tree-line"></span>
	</span>
{:else if workspace}
	<!-- The chip itself is WorkspaceChip — the shared identity + ghost
	     logic; the label is the title-first workspaceDisplayLabel (ADR D5 —
	     parity with the filter pills). This host owns only the FIXED 6.5rem
	     column geometry (the alignment slot contract) through the --wsc
	     custom properties. -->
	<WorkspaceChip
		class="ws"
		label={workspaceDisplayLabel(workspace, workspaces)}
		ghost={!isRegisteredWorkspace(workspace, workspaces)}
		iconSize={9}
		testid="sidebar-workspace-chip"
		data-registered={isRegisteredWorkspace(workspace, workspaces)}
		style="--wsc-width: 6.5rem; --wsc-gap: 0.1875rem; --wsc-font-size: 0.6875rem"
	/>
{:else}
	<span class="ws-slot" aria-hidden="true"></span>
{/if}
{#if scheduled}
	<!-- Scheduled Mark pill (ADR-0057 D2): a muted clock+SCH badge riding
	     BEFORE the label on scheduler-born rows. Pure decoration — the
	     title string is untouched and nothing behaves differently
	     (ADR-0057 D3). The glyph is aria-hidden; the SCH text stays
	     readable (assistive tech + Playwright role/text selectors). -->
	<span class="sch-badge" data-testid="sidebar-sch-badge"
		><Clock size={8} aria-hidden="true" /><span class="sch-text">SCH</span></span
	>
{/if}
<span class="label">{label}</span>

<style>
	/* ── Workspace chip ───────────────────────────────────────────────
	   FIXED-width slot (2026-08-23): the workspace cue is a column, not
	   a ragged inline chip — every row's title starts at the same x.
	   Longest common label fits; longer ellipsizes; a missing workspace
	   renders the empty slot so alignment never breaks.
	   Identity + ghost logic live in WorkspaceChip (2026-09-06); the
	   inline style passes only the fixed-width geometry (--wsc-width),
	   and the --si-chip* custom properties remain the host-field
	   extension point the chip reads. */
	/* Alignment spacer — same geometry as the chip column, no paint. */
	.ws-slot {
		flex-shrink: 0;
		width: 6.5rem;
	}

	/* Branch variant (depth > 0, spine sub-agent rows): the alignment
	   slot with the depth cue inside — the inline padding-left
	   (depth × 0.75rem) insets the glyph without changing the fixed
	   outer width; overflow hidden guards a pathological depth. Muted
	   and decorative (aria-hidden) — quieter than any chip. */
	.ws-slot.branch {
		display: inline-flex;
		align-items: center;
		overflow: hidden;
		color: var(--color-text-muted, #adb5bd);
	}

	/* Fork variant (2026-09-01): a fork child's tree line paints the fork
	   GREEN var(--color-ws-green) and a 2px stroke (the muted spawn line keeps 1.5px) —
	   measured on every field the row paints (WCAG relative luminance,
	   2026-09-01): 3.18:1 white spine, 2.72/2.93 wash, 2.59 hover, 2.24
	   selected — near the 3:1 non-text floor (1.4.11), the operator's
	   pick; the line stays decorative (aria-hidden) with fork kind also
	   carried by depth and position. Spawned children keep the muted
	   line, so the color itself says fork. */
	.ws-slot.branch.fork {
		color: var(--color-ws-green);
	}

	/* Document variant (2026-09-07, Loadinjected ADR D3): a document
	   child's tree line paints MAROON var(--color-doc-child) — the third child paint.
	   Maroon 8.4:1 on white clears the 3:1 non-text floor on every field
	   the row paints (the fork calibration applies; maroon is darker). */
	.ws-slot.branch.doc-child {
		color: var(--color-doc-child);
	}

	/* Workspace variant (2026-09-10): an explorer/file row's tree line
	   paints WORKSPACE BLUE var(--color-ws-blue) — the fourth child paint. Blue ≈ 5.4:1
	   on white clears the 3:1 non-text floor on every field the row paints
	   (the fork calibration applies; blue is darker than the fork green),
	   so the workspace pair never reads as a spawned sub-agent. */
	.ws-slot.branch.ws-child {
		color: var(--color-ws-blue);
	}

	/* The tree line OWNS the slot's free width (flex: 1): a border-drawn
	   `└` guide — border-left descends, the rounded bottom-left corner
	   turns it, border-bottom runs to the arrow. Borders paint in the
	   slot's currentColor (muted on spawn rows, fork green on fork rows);
	   no svg, so app.css's blanket svg purple default is out of play. */
	.tree-line {
		position: relative;
		flex: 1;
		height: 10px;
	}

	.tree-line::before {
		content: '';
		position: absolute;
		inset: 0 3px 0 0; /* the right gap seats the arrowhead */
		border-left: 1.5px solid currentColor;
		border-left-width: 2px;
		border-bottom: 1.5px solid currentColor;
		border-bottom-width: 2px;
		border-bottom-left-radius: 5px;
	}

	/* The tip: a chevron (top+right borders, rotated 45°) riding the
	   horizontal line's end, centered on it. */
	.tree-line::after {
		content: '';
		position: absolute;
		top: 7px;
		right: 1.5px;
		width: 4px;
		height: 4px;
		border-top: 1.5px solid currentColor;
		border-top-width: 2px;
		border-right: 1.5px solid currentColor;
		border-right-width: 2px;
		transform: rotate(45deg);
	}

	/* ── Label ────────────────────────────────────────────────────────
	   The row's name — caller-resolved (fallback grammar differs per
	   list). Elliptizes; never sets its own color so the host row's
	   state styling (dead tint, selected white) inherits straight in. */
	.label {
		min-width: 0;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* ── Scheduled pill (ADR-0057 D2, 2026-11-10) ────────────────────
	   Muted pill BEFORE the label on origin-'scheduled' rows, per the
	   operator screenshot palette: hairline border, muted ink, tiny
	   fixed footprint. flex-shrink 0 keeps it whole while the label's
	   ellipsize grammar (above) absorbs the shortened name column —
	   the pill never squeezes and the title never overflows. Both
	   paints are theme vars, so light + dark need no overrides. */
	.sch-badge {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		gap: 0.125rem;
		padding: 0 0.3125rem;
		border: 1px solid var(--color-surface-border, #dee2e6);
		border-radius: 9999px;
		background: var(--color-surface-elevated, #ffffff);
		color: var(--color-text-muted, #6c757d);
		font-size: 0.5625rem;
		line-height: 1.2;
		letter-spacing: 0.02em;
	}

	/* The SCH text carries the weight so the 8px glyph reads with it. */
	.sch-text {
		font-weight: 600;
	}
</style>
