<!--
	BrowserTab — one chip in the panel's tab strip (ADR-0040 D5). Dumb and
	presentational: the SERVER stays the authority (activeTargetId); a click
	reports activate upward, the ✕ reports close upward — the panel owns the
	wire (activate paints the boundary frame; close resyncs from the top).
	glass-tab-ids Task 5: chrome-like chip — rounded top, raised borderless
	active background, favicon dot, ordinal badge ("tab:N" off the Task 2
	wire's tabId), hover-revealed close, and a bold ✕ with a bigger hit area.
-->
<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import CloseButton from '$lib/components/common/buttons/CloseButton.svelte';
	let {
		/** The registry tab this chip mirrors. */
		tab,
		/** 1-based STRIP POSITION (tabs array index + 1) — the badge label and
		 *  Alt+N share this indexing (focus polish 2026-10-28). Absent (a bare
		 *  direct mount) degrades to the old tab:{tabId} grammar. */
		position = undefined,
		/** True while an activate is in flight — the whole strip holds still. */
		disabled = false,
		/** Activate intent — the panel POSTs /activate and repaints. */
		onactivate,
		/** Close intent — the panel POSTs /closetab and resyncs. */
		onclose
	}: {
		tab: { targetId: string; tabId?: number; url: string; title: string; active: boolean };
		disabled?: boolean;
		onactivate?: (targetId: string) => void;
		onclose?: (targetId: string) => void;
		position?: number | undefined;
	} = $props();

	/** Focus polish 2026-10-28: the badge reads the strip position — the same
		 *  number Alt+N dispatches on — while PROMPT GRAMMAR stays tab:{id}
		 *  (the registry is untouched; this is display-only). */
	/** Real-favicon upgrade (fix round 2): the same cheap s2 path the menu
	 *  uses; non-http(s) tabs keep the colored dot (the img never renders). */
	function faviconUrl(u: string): string {
		try {
			const p = new URL(u);
			return p.protocol === 'http:' || p.protocol === 'https:'
				? 'https://www.google.com/s2/favicons?domain=' + p.hostname + '&sz=32'
				: '';
		} catch {
			return '';
		}
	}

	const ordinalLabel = $derived(
		position !== undefined ? 't' + position + ':' + tab.tabId : 'tab:' + tab.tabId
	);
</script>

<div class="group/tab relative flex shrink-0 items-stretch">
	<button
		type="button"
		class="flex h-6 w-36 items-center gap-1 truncate rounded-t-md border border-b-0 px-1.5 text-left whitespace-nowrap {tab.active
			? 'border-transparent bg-blue-100 text-blue-900 font-medium shadow-sm'
			: 'border-transparent text-zinc-600 hover:bg-zinc-100 hover:border-surface-border'}"
		disabled={disabled || tab.active}
		data-testid="browser-tab"
		data-active={tab.active}
		title={tab.url}
		onclick={() => onactivate?.(tab.targetId)}
	>
		<!-- favicon: real site icon (s2) over the state dot — green on the
			 active chip, quiet zinc otherwise; onerror falls back to the dot -->
		<span class="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center" data-testid="browser-tab-favicon">
			<span class="absolute h-1.5 w-1.5 rounded-full {tab.active ? 'bg-emerald-500' : 'bg-zinc-400'}"></span>
			{#if faviconUrl(tab.url)}
				<img
					src={faviconUrl(tab.url)}
					alt=""
					class="relative h-3.5 w-3.5 rounded-sm"
					onerror={(ev) => { (ev.currentTarget as HTMLElement).style.display = 'none'; }}
				/>
			{/if}
		</span>
		{#if tab.tabId !== undefined}
			<span
				class="shrink-0 rounded-sm bg-black/5 px-0.5 font-mono text-[9px] leading-tight opacity-80"
				data-testid="browser-tab-ordinal">{ordinalLabel}</span
			>
		{/if}
		<span class="min-w-0 flex-1 truncate">{tab.title || tab.url || 'tab'}</span>
	</button>
	<CloseButton
		class="browser-glyph browser-glyph-destructive absolute right-0 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded font-semibold opacity-0 leading-none transition-opacity group-hover/tab:opacity-100 hover:bg-red-500 focus-visible:opacity-100"
		label={m.browserTabCloseTitle()}
		testid="browser-tab-close"
		onclick={() => onclose?.(tab.targetId)}
	/>
</div>