<script lang="ts">
	/**
	 * Agents — the agent pill group of SidebarSessionFilter (extracted
	 * 2026-08-24): Bot/purple pills A–Z, one per preset the HOST offers
	 * (agentPreset.list), session-count badged — count 0 for agents with
	 * no sessions yet. Labels are the host's display names (DSH picker
	 * parity: `cordis` shows as `Creator mode`; unlisted presets fall
	 * back to the id), so the testid anchors to the stable key, never
	 * the mutable label (workspaces may key by label — their labels ARE
	 * stable path basenames). The pills are dual-purpose (2026-08-24):
	 * they filter the list AND arm + New chat with the selected agent,
	 * so an available-but-unused agent must render selectable. Purely
	 * presentational — the option list arrives derived (session-filters),
	 * the filter state lives in SidebarSessionFilter; a pick reports the key
	 * upward and the owner toggles the dimension.
	 */
	import AgentChip from '../buttons/AgentChip.svelte';
	import type { FilterOption } from '$lib/utils/session-filters';

	let {
		presets,
		selected,
		onpick
	}: {
		presets: FilterOption[];
		/** Active preset id, null = none. */
		selected: string | null;
		/** Report a pill pick — the owner toggles (same pill untoggles). */
		onpick: (key: string) => void;
	} = $props();
</script>

{#if presets.length > 0}
	{#each presets as p (p.key)}
		<AgentChip
			interactive
			label={p.label}
			count={p.count}
			pickKey={p.key}
			onpick={onpick}
			selected={selected === p.key}
			title={`agent preset — ${p.key}`}
			size="pill"
			maxWidth="9rem"
			testid={`filter-preset-${p.key ?? ''}`}
		/>
	{/each}
{/if}

<style>
	/* The pill identity (shape, AA color-mixes, states) moved into
	   AgentChip (2026-11-06) — this file is markup + props only. */
</style>
