<!--
	SidebarCollapseButton — the sidebar's collapse verb as ONE organ
	(ADR-0067, R7): glyphs inline (lucide panel-left-close / panel-left-open
	paths — no dependency), words via props with English defaults (the base
	never translates), dressing via `class` (the base ships no skin).
	Presentational: collapse state stays with the consumer — clicks report
	upward via `onToggle`, the `collapsed` prop picks the glyph.
-->
<script lang="ts">
	let {
		collapsed = false,
		onToggle,
		label = 'Collapse sidebar',
		labelCollapsed = 'Restore sidebar',
		testid,
		class: className = '',
		size = 14
	}: {
		collapsed?: boolean;
		onToggle?: () => void;
		label?: string;
		labelCollapsed?: string;
		testid?: string;
		class?: string;
		size?: number;
	} = $props();
	const spoken = $derived(collapsed ? labelCollapsed : label);
</script>

<button
	type="button"
	class={className}
	data-testid={testid}
	aria-expanded={!collapsed}
	aria-label={spoken}
	title={spoken}
	onclick={() => onToggle?.()}
>
	{#if collapsed}
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<rect x="3" y="3" width="18" height="18" rx="2" />
			<path d="M15 12H9" />
			<path d="M12 9l-3 3 3 3" />
		</svg>
	{:else}
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<rect x="3" y="3" width="18" height="18" rx="2" />
			<path d="M9 12h6" />
		</svg>
	{/if}
</button>
