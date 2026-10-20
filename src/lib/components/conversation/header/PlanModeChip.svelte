<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	/**
	 * PlanModeChip — the conversation header's plan-mode pill (2026-08-31;
	 * extracted from ToolsAndStatusHeader, 2026-09-01): the host's live
	 * plan projection rendered while plan mode is ACTIVE, the pending
	 * flag marking an unconfirmed /plan switch. Purely presentational —
	 * everything arrives as props; nothing reports upward. The chip
	 * hides itself when the projection is inactive or not delivered.
	 *
	 * Accessibility: the fill (accent-purple-soft) and the ink
	 * (accent-purple-ink) are a measured pair — 5.36:1, WCAG AA at
	 * text-xs. The chip is a polite live region (role="status", the
	 * running-status pill's grammar) whose accessible name carries the
	 * full state: the visible "…" is a visual-only pending cue.
	 *
	 * data-testid preserved verbatim (plan-mode-chip) — unit tests pin it.
	 */
	import type { DsiPlanProjection } from '$lib/services/conversation/plan-projection';

	let {
		plan = null
	}: {
		/** The host's plan-mode projection (null = not delivered → hidden). */
		plan?: DsiPlanProjection | null;
	} = $props();

	/** The chip's full-state sentence — accessible name and hover title. */
	const label = $derived(
		plan?.pending
			? 'plan mode — /plan switch in progress'
			: 'plan mode active — the agent plans before writing'
	);
</script>

{#if plan?.active}
	<!-- Plan mode pill (2026-08-31): the host's live plan projection —
	     the soft/ink purple pair matches the plan chrome (think chips,
	     TodoCard). The pending flag marks an unconfirmed /plan switch. -->
	<span
		class="inline-flex items-center gap-1 rounded-full bg-accent-purple-soft px-2 py-0.5 text-xs text-accent-purple-ink ring-1 ring-accent-purple-ink/30"
		data-testid="plan-mode-chip"
		role="status"
		aria-label={label}
		title={label}
	>
		<span class="inline-block h-2 w-2 rounded-full bg-accent-purple-ink" aria-hidden="true"></span>
		{t(m.planMode)}{plan.pending ? '…' : ''}
	</span>
{/if}
