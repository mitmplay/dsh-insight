<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	/**
	 * CodeCard — the run_code chip popup body (ADR-0008, 2026-08-26):
	 * the program renders as a PLAN, not a wall of escaped JSON. Title
	 * = the program's own description (the model's one-line intent); a
	 * tool-plan strip answers "which tools, in what order, on what
	 * targets"; the code itself renders as real TypeScript,
	 * syntax-highlighted, unescaped. The verbatim wire stays one
	 * disclosure away (raw JSON toggle — GoalCard's
	 * honest-escape-hatch pattern).
	 *
	 * Dispatch sections (2026-09-05 ADR D1–D6): each sub-call renders
	 * with the renderer its tool name and file extension select — a
	 * `read` of a .md through FileContentViewer (prose), bash/pwsh as a
	 * terminal block, unknown tools as a generic row; a start-without-
	 * settle keeps its placeholder (D5). The outer program output
	 * collapses into a footer (D6): model curation, not ground truth.
	 *
	 * Presentational — props are raw wire strings; parsing is the pure
	 * code-programs.ts / dispatch-view.ts functions. Junk args (no
	 * parseable code member) falls back to the raw panes directly —
	 * never an empty card.
	 *
	 * XSS posture: code renders through highlightCode (hljs escapes its
	 * own output — the FileContentViewer contract, BC-12); every other
	 * field renders as a TEXT node.
	 */
	import { Code2 } from '@lucide/svelte';
	import { CanvasCopyButton } from '@deepseek-insight/container-base';
	import ToolCallDetail from '$lib/components/message/ToolCallDetail.svelte';
	import FileContentViewer from '$lib/components/common/viewers/FileContentViewer.svelte';
	import TerminalContentViewer from '$lib/components/common/viewers/TerminalContentViewer.svelte';
	import { highlightCode } from '$lib/utils/highlight-code';
	import { truncate } from '$lib/utils/truncate';
	import { parseCodeProgram, planStepTitle } from '$lib/utils/code-programs';
	import { buildDispatchReadView, dispatchRendererKey } from '$lib/utils/dispatch-view';
	import type { DsiCodeDispatch } from '$lib/types';

	let {
		argsRaw,
		resultText,
		dispatches
	}: { argsRaw?: string; resultText?: string; dispatches?: DsiCodeDispatch[] } = $props();

	const program = $derived(parseCodeProgram(argsRaw));
	/** Junk args → plain raw view, no card chrome. */
	const rawOnly = $derived(program === undefined);

	/** Bounded code render: huge programs collapse behind a toggle
		 * (the P3 heredoc outliers — FileContentViewer's RENDER_CAP idiom). */
	const LINES_CAP = 40;
	let expanded = $state(false);
	const lines = $derived(program?.code.split('\n') ?? []);
	const overCap = $derived(lines.length > LINES_CAP);
	const shown = $derived(overCap && !expanded ? lines.slice(0, LINES_CAP) : lines);

	/** Strip args cap — the strip stays one glance; the peek row (120)
	 * and the code block below carry the longer truth. */
	function stripArg(arg: string): string {
		const cut = truncate(arg, 60);
		return cut.head + (cut.truncated ? '…' : '');
	}

	/** Read view per dispatch subCallId — recomputed, never cached across
	 * settles (D4: undefined → the plain fallback). */
	const readViews = $derived(
		new Map((dispatches ?? []).map((d) => [d.subCallId, buildDispatchReadView(d.argsRaw, d.contentText)]))
	);

	/** The placeholder's filename: from the args' file_path (the -start
	 * event carries arguments but no content, so no view exists yet). */
	function dispatchFileName(d: DsiCodeDispatch): string | undefined {
		if (d.argsRaw === undefined) return undefined;
		try {
			const path = (JSON.parse(d.argsRaw) as { file_path?: unknown }).file_path;
			if (typeof path !== 'string' || path.length === 0) return undefined;
			return path.split('/').pop() ?? path;
		} catch {
			return undefined;
		}
	}

	/** Footer (D6): collapsed by default; the only place a program's own
	 * printed/returned output appears. */
	let footerOpen = $state(false);

	let rawOpen = $state(false);

	/** The card element itself — the capture target (ADR-0076: the
	 *  photograph is the code-card, not the popup scroller). */
	let cardEl = $state<HTMLElement | null>(null);

	/**
	 * Prepare hook (ADR-0076 D3): open ALL fold states so the PNG carries
	 * every line, the output footer and the raw panes; wait one microtask
	 * so Svelte flushes the expanded DOM, then hand back the exact
	 * restore — pre-click states verbatim (already-open stays open).
	 */
	async function prepareCapture(): Promise<() => void> {
		const prev = { expanded, footerOpen, rawOpen };
		expanded = true;
		footerOpen = true;
		rawOpen = true;
		await Promise.resolve();
		return () => {
			expanded = prev.expanded;
			footerOpen = prev.footerOpen;
			rawOpen = prev.rawOpen;
		};
	}
</script>

{#if rawOnly}
	<!-- Junk args: the honest raw view, exactly ToolCallDetail's panes. -->
	<div class="p-2">
		{#if argsRaw !== undefined}
			<pre
				data-testid="code-raw-args"
				class="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-surface p-2 font-mono text-[11px] text-text-secondary ring-1 ring-surface-border"
			>{argsRaw}</pre>
		{/if}
		{#if resultText !== undefined}
			<pre
				data-testid="code-raw-result"
				class="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-surface p-2 font-mono text-[11px] text-text-secondary ring-1 ring-surface-border"
			>{resultText}</pre>
		{/if}
	</div>
{:else}
	<div class="p-3" data-testid="code-card" bind:this={cardEl}>
		<div class="flex items-center justify-between gap-1.5 text-xs">
			<div class="flex min-w-0 items-center gap-1.5">
				<Code2 size={12} class="shrink-0 text-accent-purple" aria-hidden="true" />
				<span class="font-medium text-text-primary" data-testid="code-card-title">
					{program?.description ?? t(m.code)}
				</span>
			</div>
			<!-- Capture button (ADR-0076): the whole card as one PNG —
			     prepare opens every fold, restore re-folds in finally. -->
			<CanvasCopyButton
				container={cardEl}
				size={12}
				class="shrink-0 rounded-md p-1 text-text-muted hover:bg-surface-alt hover:text-text-secondary"
				mode="full"
				prepare={prepareCapture}
			/>
		</div>

		{#if program && program.plan.length > 0}
			<!-- Tool-plan strip (ADR-0008): one glance over the program's
			     tool calls — variant title + salient arg, source order. -->
			<div class="mt-1.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 font-mono text-[10px]" data-testid="code-plan">
				{#each program.plan as step, i (i)}
					{#if i > 0}<span class="text-text-muted" aria-hidden="true">→</span>{/if}
					<span class="shrink-0">
						<span class="font-medium text-text-primary">{planStepTitle(step.tool)}</span>
						{#if step.arg !== undefined}
							<span class="text-text-muted"> {stripArg(step.arg)}</span>
						{/if}
					</span>
				{/each}
			</div>
		{/if}

		{#if dispatches !== undefined && dispatches.length > 0}
			<!-- Dispatch sections (ADR D1–D5): one per sub-call, in submission
			     order — the harness-written ground truth, each with the
			     renderer its tool name and file extension select. -->
			<div class="mt-2 space-y-1.5" data-testid="code-dispatches">
				{#each dispatches as d (d.subCallId)}
					{@const view = readViews.get(d.subCallId)}
					{@const renderer = dispatchRendererKey(d.name)}
					{#if !d.settled}
						<!-- D5 placeholder: identity from the -start event; fills on settle. -->
						<div
							class="flex items-center gap-1.5 rounded-lg bg-surface px-2 py-1 font-mono text-[11px] text-text-secondary ring-1 ring-surface-border"
							data-testid="code-dispatch-pending"
							data-sub-tool={d.name}
						>
							<span class="inline-block size-1.5 animate-pulse rounded-full bg-surface-border" aria-hidden="true"></span>
							<span class="font-medium">{planStepTitle(d.name)}</span>
							{#if view !== undefined}
								<span class="truncate">{view.path.split('/').pop() ?? view.path}</span>
							{:else if dispatchFileName(d) !== undefined}
								<span class="truncate">{dispatchFileName(d)}</span>
							{/if}
						</div>
					{:else if renderer === 'file' && view !== undefined}
						<div class="{d.isError === true ? 'ring-1 ring-danger-wash-border' : ''}" data-testid="code-dispatch-file" data-sub-tool={d.name}>
							<FileContentViewer view={view} />
						</div>
					{:else}
						<!-- Terminal family, generic fallback, and file views that could
						     not rebuild — TerminalContentViewer keeps the content honest. -->
						<TerminalContentViewer
							toolName={d.name}
							subTool={d.name}
							content={d.contentText}
							isError={d.isError === true}
							terminal={renderer === 'terminal'}
							source={d.argsRaw}
						/>
					{/if}
				{/each}
			</div>
		{/if}

		<div class="mt-1.5 rounded-lg ring-1 ring-surface-border bg-surface-elevated p-2" data-testid="code-block">
			<!-- eslint-disable-next-line svelte/no-at-html-tags — highlightCode
			     output is escaped/governed by hljs (FileContentViewer contract) -->
			<pre class="overflow-x-auto font-mono text-[11px] leading-relaxed"><code class="hljs">{@html highlightCode(shown.join('\n'), 'typescript')}</code></pre>
			{#if overCap}
				<button
					type="button"
					data-testid="code-block-toggle"
					onclick={() => (expanded = !expanded)}
					class="mt-1 text-[11px] text-text-muted underline hover:text-text-secondary"
				>
					{expanded ? t(m.showLess) : t(() => m.showAllLines({ n: lines.length }))}
				</button>
			{/if}
		</div>

		{#if resultText !== undefined}
			<!-- Program output footer (D6): the model's own curation — collapsed
			     by default, never removed; the only surface for a program's
			     computed return value. -->
			<div class="mt-1" data-testid="code-result-footer">
				<button
					type="button"
					data-testid="code-result-footer-toggle"
					onclick={() => (footerOpen = !footerOpen)}
					class="text-[11px] text-text-muted underline hover:text-text-secondary"
				>
					{footerOpen ? t(m.hideProgramOutput) : t(m.programOutput)}
				</button>
				{#if footerOpen}
					<div class="mt-1" data-testid="code-result-pane">
						<ToolCallDetail {resultText} />
					</div>
				{/if}
			</div>
		{/if}

		<button
			type="button"
			data-testid="code-raw-toggle"
			onclick={() => (rawOpen = !rawOpen)}
			class="mt-1 text-[11px] text-text-muted underline hover:text-text-secondary"
		>
			{rawOpen ? t(m.hideRawJson) : t(m.rawJson)}
		</button>
		{#if rawOpen}
			{#if argsRaw !== undefined}
				<pre
					data-testid="code-raw-args"
					class="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-surface p-2 font-mono text-[11px] text-text-secondary ring-1 ring-surface-border"
				>{argsRaw}</pre>
			{/if}
			{#if resultText !== undefined}
				<pre
					data-testid="code-raw-result"
					class="mt-1 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-surface p-2 font-mono text-[11px] text-text-secondary ring-1 ring-surface-border"
				>{resultText}</pre>
			{/if}
		{/if}
	</div>
{/if}
