<script lang="ts">
	/**
	 * SegmentedTabs — THE one joined-pill tab grammar (The Plugin Rack
	 * ADR, amendment IV 2026-10-31): the scoped-CSS pill lived
	 * copy-pasted in PluginManagerHeaderTabs, SettingsSkillsHeaderTabs
	 * and WorkspaceFileTabGroup; this Tailwind component replaces all
	 * three (zero gap, outer curves only, active = accent blue).
	 * Presentational: no state lives here — the owner owns `active`
	 * and speaks its own tab vocabulary through `tabs`/`onchange`.
	 * The on/off states are MUTUALLY EXCLUSIVE class sets (v4 lesson:
	 * bg-transparent + bg-accent-blue in one list fight by stylesheet
	 * order, and transparent won — the white-on-white pill).
	 */
	interface Tab {
		/** The owner's tab id — echoed back through onchange. */
		id: string;
		/** The visible (already localized) label. */
		label: string;
		/** Renders the segment disabled (e.g. a locked Diff). */
		disabled?: boolean;
		/** The owner's test hook (data-testid). */
		testid?: string;
	}
	let {
		/** The segments, left to right. */
		tabs,
		/** The active tab id — the owner's state. */
		active,
		/** Group aria-label, already localized. */
		ariaLabel,
		/** Group test hook — the owners' tests pin the container. */
		groupTestid,
		/** Tab intent — the owner bridges it to its state. */
		onchange
	}: {
		tabs: Tab[];
		active: string;
		ariaLabel?: string;
		groupTestid?: string;
		onchange?: (id: string) => void;
	} = $props();
</script>

<!-- The joined-pill grammar: zero gap, outer curves only, selected = accent blue. -->
<div class="inline-flex shrink-0" role="group" aria-label={ariaLabel} data-testid={groupTestid}>
	{#each tabs as seg, i (seg.id)}
		<button
			type="button"
			class="cursor-pointer border px-2 py-[0.1rem] text-[0.6875rem] leading-normal transition-colors {i === 0
				? 'rounded-l-sm'
				: 'rounded-r-sm border-l-0'} {active === seg.id
				? 'border-accent-blue bg-accent-blue text-white'
				: 'border-border bg-transparent'} disabled:cursor-not-allowed disabled:opacity-50"
			aria-pressed={active === seg.id}
			disabled={seg.disabled === true}
			data-testid={seg.testid}
			onclick={() => onchange?.(seg.id)}
		>{seg.label}</button>
	{/each}
</div>
