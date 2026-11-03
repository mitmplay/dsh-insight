<script lang="ts">
	import type { Snippet } from 'svelte';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';

	/**
	 * TerminalTabHeader — the desk's tablist strip (Terminal Desk ADR D1,
	 * Wave 2; amended 2026-11-03 D5a/D5b): presentation only; the desk owns
	 * selection state. The strip SCROLLS when crowded (overflow-x) and the
	 * sticky clear control sits in a fixed slot at the right edge, OUTSIDE
	 * the scroller. The popover's three scope verbs (Clear all / Clear jobs /
	 * Clear terminals) emit ONE onClear intent — the desk resolves scope.
	 * No Cancel verb: outside click or Esc cancels.
	 */
	let {
		children,
		actions,
		selectedIndex = 0,
		onClear
	}: {
		children: Snippet;
		/** The desk's right-edge actions (the copy-as-image button). */
		actions?: Snippet;
		/** The desk's selected combined index — the scroll-into-view watcher. */
		selectedIndex?: number;
		/** Clear intent with scope (ADR D5b amendment 2026-11-03). Absent
		 *  renders no clear control. The desk resolves scope (fresh-T1). */
		onClear?: (scope: 'all' | 'jobs' | 'terminals') => void;
	} = $props();

	// D5a: scroll the SELECTED tab into view whenever selection moves.
	// The buttons belong to the desk's children snippet (the parent's
	// scope), so the header cannot reach them with an action — it queries
	// its own strip for the aria-selected button instead.
	let stripEl = $state<HTMLElement | null>(null);
	$effect(() => {
		void selectedIndex;
		// after the DOM settles, the selected button is the aria-selected one;
		// the optional call keeps jsdom (no scrollIntoView) honest in tests
		const btn = stripEl?.querySelector<HTMLElement>('[aria-selected="true"]') ?? null;
		btn?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
	});

	// D5b: the popover. Outside click (fixed backdrop) and Esc both cancel
	// WITHOUT emitting — the verbs are the only paths that fire onClear.
	let clearOpen = $state(false);
	function clear(scope: 'all' | 'jobs' | 'terminals'): void {
		clearOpen = false;
		onClear?.(scope);
	}
	function onClearKeydown(e: KeyboardEvent): void {
		if (clearOpen && e.key === 'Escape') clearOpen = false;
	}
	$effect(() => {
		window.addEventListener('keydown', onClearKeydown);
		return () => window.removeEventListener('keydown', onClearKeydown);
	});
</script>

<!-- TerminalTabHeader — the desk's tablist strip. The strip region is a
     min-w-0 flex child so it scrolls instead of clipping (D5a); the
     actions snippet and the clear control ride fixed slots after it. -->
<div class="flex min-w-0 items-center gap-1 border-b border-slate-800 px-1 py-0.5" data-testid="terminal-tab-header">
	<div class="strip flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" role="tablist" data-testid="terminal-tabstrip" bind:this={stripEl}>
		{@render children()}
	</div>
	{#if onClear}
		<div class="clear-slot relative flex flex-none items-center" data-testid="terminal-tabstrip-clear-slot">
			<button
				type="button"
				class="clear-btn flex h-5 w-5 items-center justify-center rounded border border-slate-600 text-[0.8rem] leading-none text-slate-400 hover:bg-slate-700 hover:text-slate-200"
				data-testid="terminal-tabstrip-clear"
				aria-label={t(m.terminalTabsClear)}
				title={t(m.terminalTabsClear)}
				aria-expanded={clearOpen}
				onclick={() => (clearOpen = !clearOpen)}
			>×</button>
			{#if clearOpen}
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
				<span class="backdrop fixed inset-0 z-40" onclick={() => (clearOpen = false)}></span>
				<div class="clear-pop absolute right-0 top-full z-41 flex min-w-44 flex-col overflow-hidden rounded border border-slate-600 bg-slate-800 shadow-lg" data-testid="terminal-tabstrip-clear-pop" role="menu">
					<button type="button" role="menuitem" class="px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-700" data-testid="terminal-tabstrip-clear-all" onclick={() => clear('all')}>
						{t(m.terminalTabsClearAll)}
					</button>
					<button type="button" role="menuitem" class="px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-700" data-testid="terminal-tabstrip-clear-jobs" onclick={() => clear('jobs')}>
						{t(m.terminalTabsClearJobs)}
					</button>
					<button type="button" role="menuitem" class="px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-700" data-testid="terminal-tabstrip-clear-terminals" onclick={() => clear('terminals')}>
						{t(m.terminalTabsClearTerminals)}
					</button>
				</div>
			{/if}
		</div>
	{/if}
	{#if actions}
		<div class="ml-auto flex flex-none items-center" data-testid="terminal-tab-header-actions">
			{@render actions()}
		</div>
	{/if}
</div>
