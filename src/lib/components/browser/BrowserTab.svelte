<!--
	BrowserTab — one chip in the panel's tab strip (ADR-0040 D5). Dumb and
	presentational: the SERVER stays the authority (activeTargetId); a click
	reports activate upward, the ✕ reports close upward — the panel owns the
	wire (activate paints the boundary frame; close resyncs from the top).
-->
<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	let {
		/** The registry tab this chip mirrors. */
		tab,
		/** True while an activate is in flight — the whole strip holds still. */
		disabled = false,
		/** Activate intent — the panel POSTs /activate and repaints. */
		onactivate,
		/** Close intent — the panel POSTs /closetab and resyncs. */
		onclose
	}: {
		tab: { targetId: string; url: string; title: string; active: boolean };
		disabled?: boolean;
		onactivate?: (targetId: string) => void;
		onclose?: (targetId: string) => void;
	} = $props();
</script>

<div class="relative shrink-0">
	<button
		type="button"
		class="w-32 truncate rounded px-1.5 py-0.5 pr-4 text-left whitespace-nowrap"
		class:bg-blue-200={tab.active}
		class:text-blue-900={tab.active}
		class:text-zinc-600={!tab.active}
		class:hover:bg-zinc-100={!tab.active}
		class:font-medium={tab.active}
		disabled={disabled || tab.active}
		data-testid="browser-tab"
		data-active={tab.active}
		title={tab.url}
		onclick={() => onactivate?.(tab.targetId)}
	>
		{tab.title || tab.url || 'tab'}
	</button>
	<button
		type="button"
		class="absolute right-0.5 top-1/2 -translate-y-1/2 rounded text-[10px] leading-none text-red-500 hover:bg-red-500 hover:text-white"
		title={m.browserTabCloseTitle()}
		data-testid="browser-tab-close"
		onclick={(e) => { e.stopPropagation(); onclose?.(tab.targetId); }}
	>✕</button>
</div>
