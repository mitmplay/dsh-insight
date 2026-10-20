<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * TerminalContentViewer — settled dispatch text output on a light pastel
	 * block (2026-09-05, extracted from CodeCard's dispatch sections; pastel
	 * restyle + action pair the same day). Terminal family and the generic
	 * fallback share one body; a failed call adds the error ring and the
	 * `failed` badge; the content text always stays visible.
	 *
	 * Top-right hover pair (MarkdownContent's OCI-parity contract): Copy
	 * copies the content; the eye/code toggle flips the body between the
	 * output text and the raw SOURCE (the dispatch's verbatim arguments
	 * JSON, when provided) — for a terminal block there is no "rendered"
	 * form, so source-view is the only flip.
	 *
	 * Presentational — text-node <pre>s only; nothing reaches the DOM as
	 * HTML (the FileContentViewer XSS contract, BC-12 cousin).
	 */
	import { planStepTitle } from '$lib/utils/code-programs';
	import CopyButton from '$lib/components/common/buttons/CopyButton.svelte';
	import RawPreviewToggle from './RawPreviewToggle.svelte';

	let {
		toolName,
		content,
		isError = false,
		terminal = true,
		subTool,
		source
	}: {
		/** Wire tool name — the chip-variant title's source. */
		toolName: string;
		/** The settled dispatch's joined text content. */
		content?: string;
		/** Wire: settled dispatch isError. */
		isError?: boolean;
		/** Terminal family vs the generic fallback (same pastel body). */
		terminal?: boolean;
		/** The dispatch's raw wire tool name for data-sub-tool. */
		subTool?: string;
		/** Raw source to flip to (the dispatch's arguments JSON); omitted
		 * hides the flip and keeps Copy only. */
		source?: string;
	} = $props();

	let showSource = $state(false);
</script>

<div
	class="group/terminal relative rounded-lg px-2 py-1.5 bg-status-pending/10 {terminal
		? 'ring-1 ring-status-pending/30'
		: 'ring-1 ring-surface-border'} {isError ? 'ring-1 ring-status-fail/30' : ''}"
	data-testid={terminal ? 'code-dispatch-terminal' : 'code-dispatch-generic'}
	{...subTool !== undefined ? { 'data-sub-tool': subTool } : {}}
	data-error={isError ? 'true' : undefined}
>
	<div class="mb-0.5 flex items-center gap-1 font-mono text-[10px] text-text-muted">
		<span class="font-medium text-status-pending/80">{planStepTitle(toolName)}</span>
		{#if isError}<span class="text-status-fail">failed</span>{/if}
	</div>
	{#if showSource && source !== undefined}
		<pre
			class="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-text-secondary"
			data-testid="code-dispatch-source"
		>{source}</pre>
	{:else}
		<pre class="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-text-primary">{content ?? t(m.noOutput)}</pre>
	{/if}

	<div
		class="absolute top-1 right-1 flex gap-1 opacity-0 group-hover/terminal:opacity-100 transition-opacity"
		data-testid="code-dispatch-actions"
	>
		<CopyButton
			value={content ?? ''}
			title={t(m.copyOutput)}
			size={12}
			class="p-1 rounded-md bg-surface/60 border border-surface-border/50 text-text-muted hover:text-text-primary hover:bg-surface-hover"
		/>
		{#if source !== undefined}
			<RawPreviewToggle bind:showRaw={showSource} titlePreview="Show output" titleRaw="View source (raw arguments)" />
		{/if}
	</div>
</div>
