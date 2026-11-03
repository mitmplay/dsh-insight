<script lang="ts">
	/**
	 * BrowserHistory — the long-press history dropdown (extracted from
	 * BrowserHeader 2026-11-02). ONE block for both directions: the CALLER
	 * anchors it under the back/forward pair and shifts it via `class`
	 * (w-6 chip = left-0 back, left-7 forward); this component renders the
	 * menu card, the per-entry dot+favicon+title rows, and reports the
	 * picked index — the PANEL performs the travel POST (ADR-0031 ACTS).
	 */
	type HistEntry = { index: number; url: string; title: string };

	let {
		/** Which nav button owns the open — picks the dot color. */
		dir,
		/** The session's history rows (header fetched them). */
		entries,
		/** Pick intent — the caller reports it upward for the travel. */
		onpick,
		/** The surface's own e2e seam (browser-history-menu). */
		testid = 'browser-history-menu',
		/** Caller chrome classes (absolute anchoring + shift). */
		class: className = ''
	}: {
		dir: 'back' | 'forward';
		entries: HistEntry[];
		onpick: (index: number) => void;
		testid?: string;
		class?: string;
	} = $props();

	/** The cheap Chrome-parity favicon: Google's s2 service off the entry's
	 * host; empty for non-http(s) URLs (about:, data:, chrome:) — those keep
	 * the colored dot. The dot stays UNDER the img: an onerror hides the
	 * img and the fallback shows through. */
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

	function shortUrl(u: string): string {
		try {
			const p = new URL(u);
			return p.host + (p.pathname === '/' ? '' : p.pathname);
		} catch {
			return u;
		}
	}
</script>

<div
	class="absolute top-full z-50 mt-1 max-h-72 w-72 overflow-y-auto rounded border border-surface-border bg-surface-elevated py-1 shadow-lg {className}"
	data-testid={testid}
>
	{#each entries as e (e.index)}
		<button
			type="button"
			class="flex w-full items-center gap-2 px-2 py-1 text-left text-xs hover:bg-surface-active"
			data-testid="browser-history-item"
			onclick={() => onpick(e.index)}
		>
			<span class="relative flex h-4 w-4 shrink-0 items-center justify-center">
				<span class="absolute h-1.5 w-1.5 rounded-full {dir === 'back' ? 'bg-amber-400' : 'bg-sky-400'}"></span>
				{#if faviconUrl(e.url)}
					<img
						src={faviconUrl(e.url)}
						alt=""
						class="relative block h-4 w-4 rounded-sm"
						data-testid="browser-history-favicon"
						onerror={(ev) => { (ev.currentTarget as HTMLElement).style.display = 'none'; }}
					/>
				{/if}
			</span>
			<span class="min-w-0 flex-1 leading-tight">
				<span class="block truncate text-zinc-800">{e.title || e.url}</span>
				<span class="block truncate text-[10px] text-zinc-500">{shortUrl(e.url)}</span>
			</span>
		</button>
	{/each}
</div>
