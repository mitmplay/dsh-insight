<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * FileContentViewer — typed rendering of a read result's file window
	 * (2026-08-22, OCI ChipDetail parity). Rides the wire's presentation
	 * view (view.card === 'read': path/lang/lines — BC-11, never args
	 * guessing):
	 *
	 *   markdown (.md/.mdx)  → MarkdownContent (prose: headings, lists,
	 *                          tables — the .md-content contract)
	 *   code (ts/js/svelte/  → line-numbered <pre><code> with highlight.js
	 *     css/json/sh/…)       (OCI hljs subset + aliases)
	 *   anything else        → line-numbered plain pre (honest fallback)
	 *
	 * Window framing (OCI FileViewer idiom): filename header + "N of M"
	 * line count; a truncated window shows its offset honestly.
	 */
	import MarkdownContent from './MarkdownContent.svelte';
	import CopyButton from '$lib/components/common/buttons/CopyButton.svelte';
	import { highlightCode, isKnownCodeLang } from '$lib/utils/highlight-code';
	import type { DsiReadView } from '$lib/types';

	let { view }: { view: DsiReadView } = $props();

	/** Markdown family renders as prose; everything else is code-or-plain. */
	const isMarkdown = $derived(view.lang === 'md' || view.lang === 'markdown' || /\.mdx?$/i.test(view.path));

	/** Bounded render: huge windows collapse behind a toggle. */
	const RENDER_CAP = 400;
	let expanded = $state(false);
	const overCap = $derived(view.lines.length > RENDER_CAP);
	const linesShown = $derived(overCap && !expanded ? view.lines.slice(0, RENDER_CAP) : view.lines);

	/** File body: the shown window's lines joined (line numbers ride the gutter). */
	const body = $derived(linesShown.map((l) => l.text).join('\n'));

	const fileName = $derived(view.path.split('/').pop() ?? view.path);
</script>

<div data-testid="file-content-viewer" data-lang={view.lang ?? ''} class="rounded-lg ring-1 ring-surface-border">
	<header
		class="flex items-center justify-between gap-2 rounded-t-lg border-b border-surface-border bg-surface-alt px-2.5 py-1.5"
		data-testid="file-viewer-header"
	>
		<span class="flex min-w-0 items-center gap-1">
			<CopyButton
				value={view.path}
				title={t(m.copyFullPath)}
				size={10}
				class="shrink-0 rounded p-0.5 text-text-muted hover:bg-surface-hover hover:text-text-secondary"
			/>
			<span class="truncate font-mono text-[11px] font-medium text-text-primary" title={view.path}>{fileName}</span>
		</span>
		<span class="shrink-0 text-[10px] text-text-muted">
			{#if view.lines.length > 0 && view.lines.length < view.totalLines}
				lines {view.lines[0].number}–{view.lines[view.lines.length - 1].number} of {view.totalLines}
			{:else}
				{view.totalLines} lines
			{/if}
		</span>
	</header>

	{#if isMarkdown}
		<!-- No hideToggle (OCI parity, 2026-09-05): the markdown body keeps
		     MarkdownContent's hover-revealed Copy/Raw pair top-right. -->
		<div class="[padding:0_10px]" data-testid="file-viewer-markdown">
			<MarkdownContent content={body} small />
		</div>
	{:else if view.lang !== undefined && isKnownCodeLang(view.lang)}
		<!-- eslint-disable-next-line svelte/no-at-html-tags — highlightCode output is escaped/governed by hljs -->
		<div class="p-2.5" data-testid="file-viewer-code">
			<pre class="overflow-x-auto font-mono text-[11px] leading-relaxed"><code class="hljs">{@html highlightCode(body, view.lang)}</code></pre>
		</div>
	{:else}
		<div class="p-2.5" data-testid="file-viewer-plain">
			<pre class="whitespace-pre-wrap break-words font-mono text-[11px] text-text-secondary">{body}</pre>
		</div>
	{/if}

	{#if overCap}
		<button
			type="button"
			data-testid="file-viewer-toggle"
			class="w-full border-t border-surface-border bg-surface-alt py-1 text-[11px] text-text-muted underline hover:text-text-secondary"
			onclick={() => (expanded = !expanded)}
		>
			{expanded ? t(m.showLess) : t(() => m.showAllLines({ n: view.lines.length }))}
		</button>
	{/if}
</div>
