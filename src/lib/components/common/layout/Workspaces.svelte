<script lang="ts">
	/**
	 * Workspaces — the workspace pill group of SessionFilterRow (extracted
	 * 2026-08-24): Folder/blue pills A–Z over the union of session cwds
	 * and registry workspaces, session-count badged — a freshly adopted
	 * folder renders selectable at count 0 (the pills arm + New chat, not
	 * just filter). Registry-annotated: reg = blue at rest, ghost = grey
	 * for a cwd the host workspace registry no longer lists.
	 *
	 * Since 2026-09-06 the pill INTERIOR is WorkspaceChip — the ONE
	 * workspace identity shared with the sidebar rows, the chat header,
	 * and the filter summary chip. The button owns the gesture
	 * (aria-pressed, pick, hover/on states); the chip owns the paint.
	 * States speak the chip's custom-property contract: each rule below
	 * sets --wsc-fg / --wsc-border / --wsc-bg, which cascade from the
	 * button into the chip, so no color is written twice.
	 *
	 * hideGhosts (2026-08-26): while the SessionFilterToggle [folder] toggle
	 * holds its registered-only view (ghost sessions excluded from the
	 * list), ghost pills HIDE — a pill whose filter would match nothing
	 * visible is noise. The pills return the moment the view lifts.
	 * Ghosts are never removed from the DERIVATION — only from this
	 * render. Purely presentational — the option list arrives derived
	 * (session-filters), the filter state lives in SessionFilterRow; a
	 * pick reports the key upward and the owner toggles the dimension.
	 *
	 * The trailing divider (2026-09-04 — the group now LEADS the row's
	 * pills, workspaces before agents) separates it from the agent pills
	 * when those render too.
	 */
	import type { FilterOption } from '$lib/utils/session-filters';
	import WorkspaceChip from '../WorkspaceChip.svelte';

	let {
		workspaces,
		selected,
		onpick,
		divider = false,
		hideGhosts = false
	}: {
		workspaces: FilterOption[];
		/** Active workspace key (full cwd path), null = none. */
		selected: string | null;
		/** Report a pill pick — the owner toggles (same pill untoggles). */
		onpick: (key: string) => void;
		/** Render the trailing divider (agent pills render after this group). */
		divider?: boolean;
		/** Hide ghost (unregistered) pills — the [folder] registered-only view. */
		hideGhosts?: boolean;
	} = $props();

	/** Ghost pills hide while the registered-only view is active. */
	const shown = $derived(
		hideGhosts ? workspaces.filter((w) => w.registered !== false) : workspaces
	);
</script>

{#if shown.length > 0}
	{#each shown as w (w.key)}
		<button
			type="button"
			class="pill"
			class:on={selected === w.key}
			class:reg={w.registered === true}
			class:ghost={w.registered === false}
			onclick={() => onpick(w.key)}
			aria-pressed={selected === w.key}
			title={(w.path ?? w.key) + (w.registered === false ? ' — not in the workspace registry' : '')}
			data-registered={w.registered ?? true}
			data-testid="filter-workspace-{w.label}"
		>
			<WorkspaceChip iconSize={12} label={w.label}>
				<span class="count">{w.count}</span>
			</WorkspaceChip>
		</button>
	{/each}
	{#if divider}<span class="divider" aria-hidden="true"></span>{/if}
{/if}

<style>
	/* The pill = button (gesture) + WorkspaceChip (paint). The button
	   carries NO paint of its own — border/background/color live on the
	   chip, driven per state through the --wsc custom properties below
	   (they cascade from the button into the chip). Geometry vars size
	   the chip to the pill grammar (10px text, roomier padding, 9rem
	   cap). Rest var(--color-slate-neutral) 5.52:1, hover accent-deep 5.17:1, selected
	   white-on-deep 5.17:1 (the raw token managed 3.68:1 at this
	   size — calibrated 2026-08-26). */
	.pill {
		display: inline-flex;
		padding: 0;
		border: none;
		background: transparent;
		cursor: pointer;
		--wsc-fg: var(--color-slate-neutral);
		--wsc-border: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 35%, var(--color-surface-elevated));
		--wsc-bg: transparent;
		--wsc-font-size: 0.625rem;
		--wsc-padding: 0.25rem 0.5rem;
		--wsc-gap: 0.25rem;
		--wsc-max-width: 9rem;
	}

	/* Hover (every non-selected pill): the reg identity's accent-deep
	   values — same triple the filter header's menuable hover uses. */
	.pill:not(.on):hover {
		--wsc-fg: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, var(--color-navy-focus));
		--wsc-border: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, var(--color-navy-focus));
		--wsc-bg: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 12%, var(--color-surface-elevated));
	}

	/* Pill status styles use :not(.on) guards on every REST/HOVER rule
	   (2026-08-23 hover bug): a hover rule at higher specificity than the
	   selected rule once overrode the selected pill's white text with its
	   accent color ON its accent background — same fg as bg. Guards make
	   rest and selected rule sets disjoint; cascade order can no longer
	   regress either state. */

	/* Registered workspace pill (chip parity): blue at REST — the chip's
	   own default identity, restated here only to beat the grey base. */
	.pill.reg:not(.on) {
		--wsc-fg: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, var(--color-navy-focus));
		--wsc-border: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, var(--color-navy-focus));
		--wsc-bg: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 8%, transparent);
	}

	/* Selected (any registry truth): solid deep-blue fill, white text —
	   65% toward navy so white holds 5.17:1. */
	.pill.on {
		--wsc-fg: #fff;
		--wsc-border: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 65%, var(--color-navy-focus));
		--wsc-bg: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 65%, var(--color-navy-focus));
	}

	/* Ghost workspace pill (hybrid truth): sessions ran in this path, but
	   the host workspace registry no longer lists it — grey, never blue.
	   var(--color-slate-neutral) on the wash = 5.52:1. Hides entirely under hideGhosts. */
	.pill.ghost:not(.on) {
		--wsc-border: color-mix(in srgb, var(--color-slate-neutral) 45%, transparent);
	}

	/* Ghost hover darkens the grey (must out-rank the generic hover
	   rule above — it does: two classes + :not + :hover). */
	.pill.ghost:not(.on):hover {
		--wsc-fg: #495057;
		--wsc-border: var(--color-slate-neutral);
	}

	.pill.ghost.on {
		--wsc-fg: #495057;
		--wsc-border: var(--color-slate-neutral);
		--wsc-bg: var(--color-surface-hover, #e9ecef);
	}

	.count {
		flex-shrink: 0;
		font-size: 0.5625rem;
		/* No opacity fade (2026-08-26): at 9px this is TEXT — 0.7 white
		   on the deep blue measured 3.67:1. Full white: 5.17:1. */
		font-variant-numeric: tabular-nums;
	}

	.divider {
		width: 1px;
		height: 0.75rem;
		background: var(--color-surface-border, #dee2e6);
		flex-shrink: 0;
	}
</style>
