<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * InjectedDocPanel — the injected-doc kind's SINGLE floor content (The
	 * Loadinjected ADR D1/D2): a read-only viewer over one LOGGED payload,
	 * routed by the member's file type — .md renders as markdown through
	 * MarkdownPanel (the transcript's own renderer), everything else opens
	 * in the shared Monaco glue with readOnly (the lazy-chunk gate holds:
	 * the glue is reached only through this dynamic import). The payload
	 * resolves over the source's LIVE transcript (the registered
	 * conversation store — the same data the shelf offered) with the
	 * floor's snapshot as fallback — no fetch, never a live-file read (D1).
	 *
	 * D8 modal habits, defused: Escape is scoped to this panel's root;
	 * the host owns the scroll box; close removes the floor slot.
	 */
	import type { DsiEntry } from '$lib/types';
	import { injectedDocTitle } from '$lib/services/panels/panel-rows';
	import { injectedRecordFor, SYSTEM_PROMPT_DISPLAY_PATH } from '$lib/services/conversation/injected-shelf';
	import { liveConversationEntries } from '$lib/services/conversation/store.svelte';
	import MarkdownPanel from './MarkdownPanel.svelte';
	import type { YamlEditorHandle } from '../common/settings-monaco';

	let {
		sourceSessionId,
		displayPath,
		entries,
		onclose
	}: {
		/** The conversation whose transcript carries the document (the dedupe pair's source half). */
		sourceSessionId: string;
		/** The document's shelf name — also the extension-routing key (D1). */
		displayPath: string;
		/** The conversation's dispatched entries — the record the payload resolves over; no fetch (D1). */
		entries: readonly DsiEntry[];
		/** Close the floor slot (the sidebar row leaves with it). */
		onclose: () => void;
	} = $props();

	const title = $derived(injectedDocTitle(displayPath));
	const isMarkdown = $derived(displayPath.toLowerCase().endsWith('.md'));
	// LIVE-FIRST (the staleness fix, 2026-09-07): the source panel's polled
	// transcript is the same data the shelf offered — the floor's snapshot
	// (entries prop) is the fallback for a restored doc whose source panel
	// is gone. Reading the registered store's $state entries tracks polls.
	const effectiveEntries = $derived(liveConversationEntries(sourceSessionId) ?? entries);
	const record = $derived(injectedRecordFor(effectiveEntries, displayPath));

	let editorHost = $state<HTMLElement | null>(null);
	let editor: YamlEditorHandle | null = null;
	/** Init token — a record change re-running the effect aborts the
	 *  in-flight dynamic import of a superseded init. */
	let initSeq = 0;

	/** Root-scoped Escape (D8): only this panel's keystrokes close it. */
	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') onclose();
	}

	// The Monaco init is REACTIVE over the resolved record: a doc panel
	// mounted before its transcript snapshot filled in still opens the
	// editor when the record arrives (and never double-inits — the token
	// aborts superseded imports). Markdown needs none of this: its surface
	// is a plain reactive wrapper.
	$effect(() => {
		if (isMarkdown) return;
		const text = record?.text;
		const host = editorHost;
		if (text === undefined || host === null || editor !== null) return;
		const token = ++initSeq;
		void (async () => {
			// The lazy Monaco glue — its own chunk, never the floor's paint;
			// readOnly blocks USER edits (D1), programmatic setValue stays.
			const { createYamlEditor } = await import('../common/settings-monaco');
			if (token !== initSeq || editor !== null) return;
			editor = createYamlEditor(host, text, () => {}, { readOnly: true });
		})();
		return () => {
			initSeq++;
			editor?.dispose();
			editor = null;
		};
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions — the root is a
     LAYOUT container scoping Escape to this panel (Manager ADR D8): every
     real control inside stays itself; the keydown is a panel-level close
     gesture, never an interactive-widget role. -->
<div
	class="injected-doc" role="presentation" tabindex="-1"
	data-testid="injected-doc-panel"
	data-display-path={displayPath}
	data-source-session-id={sourceSessionId}
	onkeydown={handleKeydown}
>
	<div class="doc-toolbar">
		<span class="doc-title">{title}</span>
		<span
			class="doc-state"
			data-testid="injected-doc-state"
			title={record === null ? undefined : new Date(record.time).toLocaleString()}
		>
			{#if record === null}
				{t(m.roLogged)}
			{:else if displayPath === SYSTEM_PROMPT_DISPLAY_PATH}
				{t(() => m.roLoggedEpoch({ seq: record.seq }))}
			{:else}
				{t(() => m.roLoggedInjected({ seq: record.seq }))}
			{/if}
		</span>
		<button type="button" data-testid="injected-doc-close" onclick={onclose} aria-label={t(m.closePanel)}>
			×
		</button>
	</div>
	{#if record === null}
		<p class="doc-missing" data-testid="injected-doc-missing">
			{t(m.payloadMissing)}
		</p>
	{:else if isMarkdown}
		<MarkdownPanel content={record.text} />
	{:else}
		<div class="doc-editor-host" bind:this={editorHost}></div>
	{/if}
</div>

<style>
	.injected-doc {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.doc-toolbar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--color-surface-border, #dee2e6);
		font-size: 0.75rem;
	}

	.doc-title {
		font-weight: 600;
		color: var(--color-doc-child); /* the document-child paint (DOC_CHILD_PAINT, ADR D3) */
	}

	.doc-state {
		color: var(--color-text-secondary, #6c757d);
	}

	.doc-toolbar button {
		margin-left: auto;
		border: none;
		background: transparent;
		color: inherit;
		cursor: pointer;
		font-size: 0.875rem;
	}

	.doc-missing {
		padding: 1rem 1.25rem;
		font-size: 0.75rem;
		color: var(--color-text-secondary, #6c757d);
	}

	.doc-editor-host {
		flex: 1;
		min-height: 0;
	}
</style>
