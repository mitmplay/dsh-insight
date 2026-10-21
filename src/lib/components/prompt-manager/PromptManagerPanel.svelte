<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * PromptManagerPanel — the CONTENT of the prompts manager (extracted
	 * 2026-09-06 from PromptsManagerDialog ln 256-442): sticky toolbar +
	 * head table, error strip, add-row, body table, footer — plus the
	 * edit dialog, which travels with the panel because its form state
	 * (the editor machine, ADR-0022 W3) is the table's own.
	 *
	 * Presentational: rows arrive via /api/prompts fetch, the panel owns
	 * inline-edit + search + sort + selection state. Callbacks: onclose
	 * (Escape with nothing open — the dialog's backdrop/× own the other
	 * close gestures), onchanged (CRUD happened — host refreshes nothing
	 * eagerly; the strip refetches on the next trigger).
	 *
	 * ALL data flows through the HTTP contract — this component never
	 * imports db.ts (no cross-module bleed; the manager and the strip
	 * family meet only at /api/prompts).
	 */
	import { onMount } from 'svelte';
	import { X } from '@lucide/svelte';
	import { appConfig, loadAppConfig } from '$lib/services/config/app-config.svelte';
	import { getWorkspaceState } from '$lib/services/conversation/workspace-context.svelte';
	import PromptManagerTDLabel from './PromptManagerTDLabel.svelte';
	import PromptManagerHeader from './PromptManagerHeader.svelte';
	import PromptManagerContainer from './PromptManagerContainer.svelte';
	import PromptManagerTDTags from './PromptManagerTDTags.svelte';
	import PromptManagerTDUses from './PromptManagerTDUses.svelte';
	import PromptManagerEdit from './PromptManagerEdit.svelte';
	import PromptManagerAdd from './PromptManagerAdd.svelte';
	import { PromptTable } from './table.svelte';
	import { PromptFilters } from './filters.svelte';
	import { PromptEditor } from './editor.svelte';

		let {
		onclose,
		onchanged,
		escapeScope = 'window',
		host = 'modal'
	}: {
		onclose: () => void;
		onchanged?: () => void;
		/** Escape scope (ADR D3/W4): 'window' — the modal default, one
		 *  global listener closes the (single) manager; 'root' — the
		 *  EMBEDDED host: the panel's own root listens, so two managers
		 *  on the floor each close only themselves. */
		escapeScope?: 'window' | 'root';
		/** Host shape (W4, ADR D8): 'modal' — the default, PromptsManagerDialog
		 *  geometry byte-identical; 'panel' — an embedded floor slot: the edit
		 *  dialog pair portals to document.body (the Loupe/BC-7 pattern —
		 *  fixed layers escape the floor's zoom transform) and the sticky
		 *  header bleeds by --mgr-bleed (default 1rem = the modal rule). */
		host?: 'modal' | 'panel';
	} = $props();

	/** Label/text cell mode (2026-09-19): 'pre' — the raw text, 5 lines
	 *  then scroll (the DEFAULT); 'norm' — the flowing preview. */
	let textMode = $state<'norm' | 'pre'>('pre');
	/** The editor machine (ADR-0022 W3): the edit-dialog + add-row form
	 *  state, the PATCH/POST flows, the 409 duplicate note, the inline
	 *  macro toggle, and the error strip. */
	const editor = new PromptEditor(
		() => table.rows,
		() => onchanged?.(),
		() => table.refresh()
	);
	/** The panel's root element — the CanvasCopyButton capture target. */
	let rootEl = $state<HTMLElement | null>(null);

	// ── Tag filter (The Prompt Tags ADR, 2026-09-14, D5/D11) ──
	// ONE state behind two inputs: the chip row's checked words and the
	// search box's +word tokens. Persisted per profile desk.
	const profile = $derived(getWorkspaceState()?.profile ?? null);
	/** The operator's vocabulary (settings.yaml prompts.tags via /api/config). */
	const vocabulary = $derived(appConfig().prompts.tags);
	/** The filter machine (ADR-0022 W2): searchQ ⇄ tag chips, the 300 ms
	 *  debounce, and the desk-slot persist/restore (D5/D11). It fires the
	 *  table's refresh through the shell callback — no machine-to-machine
	 *  import. */
	const filters = new PromptFilters(() => profile, () => table.refresh());
	/** The table machine (ADR-0022 W1): rows/total/loading, the sort
	 *  cycle, selection, the refresh fetch, bulk delete. Injects the
	 *  filter machine's state, the host callback, and the editor
	 *  machine's error strip setter. */
	const table = new PromptTable(
		() => filters.tagFilter,
		() => filters.plainQuery(),
		() => onchanged?.(),
		(msg) => {
			editor.errorMsg = msg;
		}
	);

	onMount(() => {
		loadAppConfig(); // vocabulary rides the singleton config load
		filters.restore();
		table.refresh();
	});

	/** Escape closes the manager only when no sub-form is open (the
	 *  edit dialog and the add-row keep their own text). Scope per the
	 *  escapeScope prop: the window listener runs for the modal host only
	 *  (ADR D3 — per-mount window listeners multiply with embedded
	 *  instances); the embedded root listens on its own element. */
	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && !editor.addingNew && editor.editingId === null) {
			e.stopPropagation();
			onclose();
		}
	}
</script>

<!-- One window listener, gated by scope (D3): the modal host ('window')
     registers it; the embedded host ('root') leaves it ABSENT — its own
     root element listens below, so N managers never multiply window
     listeners. -->
<svelte:window onkeydown={escapeScope === 'window' ? onKeydown : undefined} />

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<!-- The root-scoped Escape target (D3/W4): a composite region, not a
     control — the keydown closes the manager when no sub-form is open,
     and focus reaches it through the column's focus-follow selection. -->
<div
	bind:this={rootEl}
	class="mgr-panel-root"
	role="region"
	aria-label={t(m.promptsManager)}
	tabindex={escapeScope === 'root' ? -1 : undefined}
	onkeydown={escapeScope === 'root' ? onKeydown : undefined}
>
	<!-- Header (the former PromptManagerStickyHeader, now normal flow): the panel
	     keeps the state (selection, search, sort, add-mode); the component
	     renders the toolbar + head table rows. -->
	<PromptManagerHeader
		selectedCount={table.selected.size}
		{vocabulary}
		dbPath={appConfig().prompts.dbPath}
		tagFilter={filters.tagFilter}
		sortState={table.sortState}
		bind:textMode
		loading={table.loading}
		hasRows={table.rows.length > 0}
		addingNew={editor.addingNew}
		bind:searchQ={filters.searchQ}
		ontoggle={(word) => filters.toggleTag(word)}
		onsearchinput={() => filters.onSearchInput()}
		ondeleteselected={() => table.deleteSelected()}
		onunselectall={() => {
			table.selected.clear();
		}}
		onsort={(col) => table.sortByCol(col)}
		onadd={() => editor.openAdd()}
		oncanceladd={() => editor.cancelAdd(false)}
	/>

	{#if editor.errorMsg}
		<!-- The NewChatButton selection-alert grammar: role=alert + a
		     × dismiss (lucide X, aria-hidden, labeled button). Closing
		     only hides the message — the next failing refresh re-raises. -->
		<div class="mgr-error" role="alert">
			<span class="mgr-error-msg">{editor.errorMsg}</span>
			<button
				type="button"
				class="mgr-error-close"
				aria-label={t(m.dismissAlert)}
				title={t(m.dismiss)}
				onclick={() => (editor.errorMsg = null)}
			>
				<X size={11} aria-hidden="true" />
			</button>
		</div>
	{/if}

	{#if editor.addingNew}
		<!-- Add-row extracted to PromptManagerAdd (D8 seam): the panel keeps
		     addingNew + the POST; the component owns the form. -->
		<PromptManagerAdd
			bind:uses={editor.newUses}
			bind:macro={editor.newMacro}
			bind:text={editor.newText}
			bind:label={editor.newLabel}
			bind:tags={editor.newTags}
			portal={host === 'panel'}
			onsave={() => editor.addPrompt()}
			oncancel={() => editor.cancelAdd(true)}
		/>
	{/if}

	<PromptManagerContainer>
		{#if table.loading}
			<div class="mgr-loading">{t(m.loading)}</div>
		{:else if table.rows.length === 0}
			<div class="mgr-empty">{filters.searchQ ? t(m.noPromptsMatch) : t(m.noPromptsYet)}</div>
		{:else}
			<table class="mgr-table mgr-body-table">
			<tbody>
				{#each table.visibleRows as row (row.id)}
					{#if editor.editingId === row.id}
						<!-- Editing: row highlighted, fields live in the dialog form.
						     The row is INERT (D9) — the dialog is the only edit surface. -->
						<tr class="mgr-editing">
							<td></td>
							<td>{row.use_count}</td>
							<PromptManagerTDLabel {row} {textMode} />
							<td class="mgr-macro-col">{row.macro === 1 ? '✓' : '—'}</td>
							<PromptManagerTDTags {row} />
						</tr>
					{:else}
						<!-- D9: the ROW is the edit affordance — a body-row click opens
						     the edit dialog; the checkbox cell is EXEMPT (selection-only).
						     The tr/td handlers are pointer-only supplements to the dialog's
						     own keyboard path (its Save/Cancel are real buttons). -->
						<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
						<tr class:sel={table.selected.has(row.id)} onclick={() => editor.startEdit(row)}>
							<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
							<td
								class="mgr-sel-col"
								onclick={(e) => e.stopPropagation()}
							>
								<input
									type="checkbox"
									class="mgr-check"
									checked={table.selected.has(row.id)}
									onchange={() => table.toggleSelected(row.id)}
									aria-label="Select prompt"
								/>
							</td>
							<PromptManagerTDUses {row} />
							<PromptManagerTDLabel {row} {textMode} />
							<td class="mgr-macro-col">
								<button
									type="button"
									class="mgr-macro-toggle"
									class:on={row.macro === 1}
									aria-pressed={row.macro === 1}
									title={row.macro === 1 ? 'Macro — click to turn off' : 'Not a macro — click to turn on'}
									onclick={(e) => { e.stopPropagation(); editor.toggleMacro(row); }}
								>{row.macro === 1 ? '✓' : '—'}</button
								>
							</td>
							<PromptManagerTDTags {row} />
						</tr>
					{/if}
				{/each}
			</tbody>
		</table>
			{#if table.total > table.rows.length}
				<div class="mgr-footer">{table.total - table.rows.length} {t(m.moreRefine)}</div>
			{/if}
		{/if}
	</PromptManagerContainer>
	</div>

{#if editor.editingRow}
	<!-- Edit dialog extracted to PromptManagerEdit (D8 seam): the panel keeps
	     the dialog STATE (editUses/editMacro/editLabel/editText via $bindable),
	     the component owns the form + portal pair. -->
	<PromptManagerEdit
		row={editor.editingRow}
		bind:uses={editor.editUses}
		bind:macro={editor.editMacro}
		bind:label={editor.editLabel}
		bind:text={editor.editText}
		bind:tags={editor.editTags}
		portal={host === 'panel'}
		onsave={() => editor.saveEdit(editor.editingRow!.id)}
		oncancel={() => editor.cancelEdit()}
	/>
{/if}

<style>
	/* Flex column (2026-09-19 rework): the header row on top (flex:none),
	   PromptManagerContainer below taking the rest and owning the scroll.
	   height:100% chains from the dialog's .mgr-dialog-body flex item. */
	.mgr-panel-root {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}

	.mgr-error {
		padding: 0.375rem 0.5rem;
		margin-bottom: 0.5rem;
		background: var(--color-danger-wash);
		border: 1px solid var(--color-danger-wash-border);
		border-radius: 0.25rem;
		color: var(--si-run);
		/* alert row: message left, × dismiss right (NewChatButton grammar) */
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.75rem;
	}
	.mgr-error-close {
		flex-shrink: 0;
		border: none;
		background: transparent;
		cursor: pointer;
		padding: 0.125rem;
		line-height: 1;
		border-radius: 0.25rem;
		color: var(--si-run);
		display: inline-flex;
		align-items: center;
	}
	.mgr-error-close:hover {
		background: var(--color-danger-wash-border);
		color: var(--color-danger-wash-ink);
	}

	/* Add-row styles moved to PromptManagerAdd.svelte */

	/* Markdown-table theme (mirrors .md-content table in app.css) */
	.mgr-table {
		width: 100%;
		border-collapse: collapse;
		table-layout: fixed;
		margin: 0 0 0.5em 0;
		background: rgba(139, 92, 246, 0.04);
		border: 1px solid rgba(139, 92, 246, 0.2);
		border-radius: 0.5em;
		overflow: hidden;
	}
	/* Column width contract, td half (the th half moved to
	   PromptManagerHeader with the head table). The td half is
	   :global because the body cells come from child components
	   (PromptManagerTDUses/TDLabel) and carry no panel scope class —
	   without it, fixed layout re-splits those columns (310px regression). */
	.mgr-table :global(td:nth-child(1)) {
		width: 2rem;
	}
	.mgr-table :global(td:nth-child(2)) {
		width: 2.5rem; /* matches the th half — fixed-layout contract */
	}
	/* Uses count rides the right edge of its column. Declared HERE, not
	   in TDUses: this rule out-specifies the child's own .mgr-count. */
	.mgr-table :global(td:nth-child(2)) {
		text-align: right;
	}
	.mgr-table :global(td:nth-child(3)) {
		width: auto;
	}
	.mgr-table :global(td:nth-child(4)) {
		width: 2.25rem; /* Macro: 'MCR' title-width only; the space goes to label/text */
	}
	/* nth-child(5) — the tags column (The Prompt Tags D4) — has NO width
	   entry: it inherits the leftover of the fixed layout, and the contract
	   drops from five pinned widths to four. */
	/* :global(td) — the body cells come from child components
	   (TDUses/TDLabel/TDTags) and carry no panel scope class. */
	.mgr-table :global(td) {
		padding: 0.35em 0.6em;
		border: 1px solid rgba(139, 92, 246, 0.15);
		text-align: left;
		vertical-align: top;
	}
	.mgr-body-table tbody tr:nth-child(even) {
		background: rgba(139, 92, 246, 0.03);
	}
	.mgr-body-table tbody tr:hover :global(td) {
		background: rgba(139, 92, 246, 0.08);
	}
	.mgr-table tr.sel td {
		background: color-mix(in srgb, var(--color-accent-blue, #3b82f6) 14%, rgba(139, 92, 246, 0.04));
	}

	.mgr-sel-col {
		width: 2rem;
	}
	.mgr-check {
		cursor: pointer;
		accent-color: var(--color-accent-blue, #3b82f6);
	}


	.mgr-macro-toggle {
		border: none;
		background: transparent;
		cursor: pointer;
		font-size: 0.75rem;
		line-height: 1;
		padding: 0.25rem 0.5rem;
		border-radius: 0.25rem;
		color: var(--color-text-muted, #888);
	}
	.mgr-macro-toggle:hover {
		background: var(--color-surface-alt, #f1f3f5);
	}
	.mgr-macro-toggle.on {
		color: var(--color-accent-blue, #3b82f6);
		font-weight: 600;
	}
	.mgr-macro-col {
		white-space: nowrap;
		text-align: center;
		color: var(--color-text-muted, #888);
		font-size: 0.75rem;
	}
	/* Row being edited — highlighted while the dialog is open.
	   Dialog chrome lives in PromptManagerEdit.svelte now. */
	.mgr-editing :global(td) {
		background: rgba(139, 92, 246, 0.16) !important;
	}

	.mgr-footer {
		padding: 0.5rem;
		text-align: center;
		color: var(--color-text-muted, #888);
		font-size: 0.6875rem;
	}

	.mgr-loading,
	.mgr-empty {
		padding: 2rem;
		text-align: center;
		color: var(--color-text-muted, #888);
	}
</style>
