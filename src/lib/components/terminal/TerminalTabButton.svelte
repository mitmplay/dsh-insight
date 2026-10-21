<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';

	let {
		index,
		selected,
		label,
		title,
		onSelect,
		onClose
	}: {
		index: number;
		selected: boolean;
		label: string;
		/** Hover tooltip (job tabs carry the full command here). */
		title?: string;
		onSelect: () => void;
		onClose: () => void;
	} = $props();
</script>

<!-- TerminalTabButton — one tab in the desk's header (Terminal Desk ADR
     D1/D5): click selects; the × kills EVERY row in the tab (the close
     verb cascades downward — the desk runs the ladder, not this button). -->
<div
	role="tab"
	title={title ?? label}
	aria-selected={selected}
	tabindex="0"
	class="flex cursor-pointer items-center gap-1 rounded px-2 py-0.5 text-[10px] {selected
		? 'bg-slate-700 text-slate-100'
		: 'text-slate-400 hover:bg-slate-800'}"
	data-testid="terminal-tab-button-{index}"
	data-selected={selected ? 'true' : 'false'}
	onclick={onSelect}
	onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect()}
>
	<span>{label}</span>
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<span
		class="ml-1 rounded px-1 text-slate-500 hover:bg-slate-600 hover:text-slate-200"
		role="button"
		tabindex="-1"
		aria-label={t(m.terminalTabClose) + ' ' + label}
		data-testid="terminal-tab-close-{index}"
		onclick={(e) => {
			e.stopPropagation();
			onClose();
		}}
	>
		×
	</span>
</div>
