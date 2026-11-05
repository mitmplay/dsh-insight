<script lang="ts">
	/**
	 * AgentChip — ONE owner of the agent-pill identity (ADR, 2026-11-06):
	 * the Bot/purple pill that means "this is agent X" on every surface.
	 * Shape, the AA-tuned color-mixes (rest 5.25:1, selected white
	 * 5.34:1), icon-never-shrinks and label-ellipsis-only live HERE,
	 * exactly once — previously re-declared in SessionFilterHeader,
	 * ToolsAndStatusHeader and Agents.svelte.
	 *
	 * Span mode (default) is display-only — the filter summary chip and
	 * the conversation header chip; it must stay a span when nested in
	 * a button (no button-in-button). interactive renders a real
	 * <button> with aria-pressed — the Agents filter pill; hover/on
	 * states carry the 2026-08-23 :not(.on) guards so rest and selected
	 * rule sets stay disjoint.
	 *
	 * Call sites keep their own testids, titles and layout; only the
	 * identity is owned here.
	 */
	import { Bot } from '@lucide/svelte';

	let {
		label,
		count = null,
		interactive = false,
		selected = false,
		onpick,
		pickKey = '',
		title,
		testid,
		size = 'chip',
		maxWidth
	}: {
		label: string;
		/** Session-count badge (pill mode); null renders none. */
		count?: number | null;
		/** Render a pickable button instead of a display span. */
		interactive?: boolean;
		/** Selected state (button mode). */
		selected?: boolean;
		/** Pick handler (button mode); pickKey names the preset. */
		onpick?: (key: string) => void;
		pickKey?: string;
		title?: string;
		testid?: string;
		/** compact = sidebar summary chip (10px icon, tight padding),
		 *  pill = filter pill (10px text, count badge), chip (default) =
		 *  conversation header chip (12px text). */
		size?: 'compact' | 'pill' | 'chip';
		/** Overflow cap, e.g. '9rem' for pills, '6.5rem' for compact. */
		maxWidth?: string;
	} = $props();
</script>

{#if interactive}
	<button
		type="button"
		class="agent-chip {size}"
		class:on={selected}
		style:max-width={maxWidth}
		onclick={() => onpick?.(pickKey)}
		aria-pressed={selected}
		{title}
		data-testid={testid}
	>
		<Bot size={12} aria-hidden="true" />
		<span class="label">{label}</span>{#if count !== null}<span class="count">{count}</span>{/if}
	</button>
{:else}
	<span
		class="agent-chip {size}"
		style:max-width={maxWidth}
		{title}
		data-testid={testid}
	>
		<Bot size={size === 'compact' ? 10 : 12} aria-hidden="true" />
		<span class="label">{label}</span>
	</span>
{/if}

<style>
	/* THE identity (was .chip.agent / .agent-chip / .pill.preset):
	   border + 8% tint field + purple deepened 50% toward violet-900
	   (rest text 5.25:1 on its tint — the raw token never cleared AA). */
	.agent-chip {
		--agent-fg: color-mix(in srgb, var(--color-accent-purple, var(--color-accent-purple)) 50%, #4c1d95);
		--agent-on: color-mix(in srgb, var(--color-accent-purple, var(--color-accent-purple)) 75%, #4c1d95);
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		border: 1px solid var(--agent-fg);
		border-radius: 9999px;
		font-size: 0.75rem;
		line-height: 1;
		white-space: nowrap;
		color: var(--agent-fg);
		background: color-mix(in srgb, var(--color-accent-purple, var(--color-accent-purple)) 8%, transparent);
		vertical-align: middle;
	}

	/* compact — the sidebar summary chip (was .chip): 10px icon, tight
	   padding, 6.5rem cap set by the caller via maxWidth. */
	.agent-chip.compact {
		gap: 0.1875rem;
		font-size: 0.75em;
		padding: 0.15rem 0.375rem;
	}

	/* chip — the conversation header chip: roomier padding. */
	.agent-chip.chip {
		padding: 0.125rem 0.5rem;
	}

	/* pill — the Agents filter pill: 10px text, count badge. */
	.agent-chip.pill {
		font-size: 0.625rem;
		padding: 0.25rem 0.5rem;
		background: transparent;
		border-color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 35%, var(--color-surface-elevated));
		color: var(--color-slate-neutral);
	}

	/* Button-mode states with :not(.on) guards (2026-08-23 lesson):
	   rest/hover and selected rule sets stay disjoint — cascade order
	   can no longer regress either state. */
	button.agent-chip {
		cursor: pointer;
		transition:
			color 0.15s ease,
			border-color 0.15s ease,
			background-color 0.15s ease;
	}

	button.agent-chip.pill:not(.on):hover {
		border-color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, var(--color-navy-focus));
		color: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 50%, var(--color-navy-focus));
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 12%, var(--color-surface-elevated));
	}

	/* Selected: solid purple (75% toward violet-900 — white 5.34:1). */
	button.agent-chip.on {
		background: var(--agent-on);
		border-color: var(--agent-on);
		color: #fff;
	}

	/* Dark theme (html[data-theme="dark"]): the identity mixes purple
	   50% toward violet-900 — a DARK ink tuned for light tint fields.
	   On the dark surface it sinks into the background (2026-11-06
	   screenshot report), so dark mode re-points the text to white and
	   reads the pill by its purple border + tint instead. Selected
	   (on) is already white-on-deep-purple — unchanged. The compact
	   summary chip keeps its white-on-purple pills in BOTH themes, so
	   it needs no override. */
	:global([data-theme='dark']) .agent-chip.compact {
		color: #fff;
		border-color: var(--color-accent-deep);
	}

	:global([data-theme='dark']) .agent-chip.chip,
	:global([data-theme='dark']) .agent-chip.pill {
		color: #fff;
		/* Border follows the AccessModeChip recipe (2026-11-06 SC#2):
		   accent-deep re-points to the soft dark-theme violet — the
		   light-tuned color-mix borders read too hot on dark. */
		border-color: var(--color-accent-deep);
	}

	/* The Bot glyph too: app.css's @layer base svg default paints every
	   icon var(--color-accent-purple) — on dark theme the white text
	   needs a white-stroke icon beside it (scoped exception, per the
	   app.css icon-standard convention of stating inherit next to the
	   surface that owns it). */
	:global([data-theme='dark']) .agent-chip :global(svg) {
		color: inherit;
	}

	/* Dark-theme hover (pill mode): white text on the blue wash keeps
	   the hover affordance without re-introducing a dark-on-dark ink. */
	:global([data-theme='dark']) button.agent-chip.pill:not(.on):hover {
		color: #fff;
		border-color: var(--color-accent-deep);
	}

	/* The icon follows the on-state text color; at rest the identity
	   color applies. NEVER shrinks (2026-08-23 geometry audit). */
	.agent-chip :global(svg) {
		flex-shrink: 0;
	}

	button.agent-chip.on :global(svg) {
		color: inherit;
	}

	/* Only the label ellipsizes. */
	.label {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Count is TEXT at 9px — full white (0.7 white measured under 4.5:1
	   on the deep fill, 2026-08-26). */
	.count {
		flex-shrink: 0;
		font-size: 0.5625rem;
		font-variant-numeric: tabular-nums;
	}
</style>
