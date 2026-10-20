<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * SettingsEditorPanel — the settings-editor floor content (The
	 * Settings Panel ADR, 2026-09-07, D3–D6): a Monaco YAML editor over
	 * one target document, loaded through the /api/settings seam. The
	 * browser never learns a filesystem path — the target prop selects
	 * the route parameter, nothing more.
	 *
	 * The document is the authority (ADR D5): GET returns raw text (or
	 * the honest missing marker + default document), PUT sends the WHOLE
	 * buffer; a parse-failed PUT is a 400 with the parser's line and
	 * column, the file stays untouched, and the buffer stays open with
	 * the error surfaced — the editor never silently reverts.
	 *
	 * D8 modal habits, defused: Escape is scoped to this panel's root
	 * (two live editors close independently); no viewport-fixed layers
	 * live here (the save banner is in-flow; Monaco's own widgets are
	 * contained by the editor's DOM); the host owns the scroll box.
	 */
	import { onMount } from 'svelte';
	import { SETTINGS_ROW_TITLE } from '$lib/services/panels/panel-rows';
	// Three Tongues W2 (ADR 2026-09-12): the locale row rides the dsi
	// document through the same /api/settings seam — no side-channel write.
	import LocaleSettingsRow from '$lib/components/language-menu/LocaleSettingsRow.svelte';
	import ThemeSettingsRow from './ThemeSettingsRow.svelte';
	import type { YamlEditorHandle } from '../monaco/settings-monaco';

	let {
		target,
		onclose
	}: {
		/** Which settings document this panel edits ('dsi' | 'dsh'). */
		target: 'dsi' | 'dsh';
		/** Close the floor slot (the sidebar row leaves with it). */
		onclose: () => void;
	} = $props();

	let rootEl = $state<HTMLElement | null>(null);
	let editorHost = $state<HTMLElement | null>(null);
	let editor: YamlEditorHandle | null = null;
	let loaded = $state(false);
	let missing = $state(false);
	/** The buffer as last loaded/saved (dirty = differs from it). */
	let savedText = $state('');
	let dirty = $state(false);
	let saving = $state(false);
	let errorNote = $state<string | null>(null);
	let savedFlash = $state(false);

	const title = $derived(SETTINGS_ROW_TITLE[target]);

	/** Root-scoped Escape (D8): only this panel's keystrokes close it. */
	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') onclose();
	}

	onMount(() => {
		void init();
		return () => {
			editor?.dispose();
			editor = null;
		};
	});

	async function init(): Promise<void> {
		let initial = '';
		try {
			const res = await fetch('/api/settings?target=' + target);
			const body = (await res.json()) as {
				ok: boolean;
				text?: string;
				missing?: boolean;
				defaultText?: string;
			};
			if (body.ok) {
				missing = body.missing === true;
				initial = body.missing ? (body.defaultText ?? '') : (body.text ?? '');
			} else {
				errorNote = 'could not read the settings file (' + target + ')';
			}
		} catch {
			errorNote = 'could not read the settings file (' + target + ')';
		}
		savedText = initial;
		// The lazy Monaco glue — its own chunk (D4), never the floor's paint.
		const { createYamlEditor } = await import('../monaco/settings-monaco');
		if (editorHost !== null) {
			editor = createYamlEditor(editorHost, initial, () => {
				dirty = true;
			});
		}
		loaded = true;
	}

	async function save(): Promise<void> {
		if (editor === null || saving) return;
		saving = true;
		errorNote = null;
		savedFlash = false;
		const text = editor.getValue();
		try {
			const res = await fetch('/api/settings?target=' + target, {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ text })
			});
			if (res.ok) {
				savedText = text;
				dirty = false;
				missing = false;
				savedFlash = true;
			} else {
				const body = (await res.json()) as {
					error?: string;
					line?: number | null;
					column?: number | null;
				};
				const pos = body.line !== null && body.line !== undefined ? ' (line ' + body.line + ')' : '';
				errorNote = 'not saved — invalid YAML' + pos + ': ' + (body.error ?? 'parse error');
			}
		} catch {
			errorNote = 'not saved — the save request failed';
		} finally {
			saving = false;
		}
	}

	function reload(): void {
		editor?.setValue(savedText);
		dirty = false;
		errorNote = null;
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions — the root is a
     LAYOUT container scoping Escape to this panel (Manager ADR D8): every
     real control inside (buttons, the editor) stays itself; the keydown
     is a panel-level close gesture, never an interactive-widget role. -->
<div
	class="settings-editor-body" role="presentation" tabindex="-1"
	data-testid="settings-editor"
	data-target={target}
	bind:this={rootEl}
	onkeydown={handleKeydown}
>
	<div class="settings-toolbar">
		<span class="settings-title">{title}{missing ? ' ' + t(m.newFile) : ''}</span>
		{#if target === 'dsi'}
			<ThemeSettingsRow />
			<LocaleSettingsRow />
		{/if}
		<span class="settings-state" data-testid="settings-state">
			{saving ? 'saving…' : dirty ? 'edited' : savedFlash ? 'saved' : loaded ? 'clean' : 'loading…'}
		</span>
		<button type="button" data-testid="settings-save" onclick={save} disabled={!loaded || saving || !dirty}>
			{t(m.save)}
		</button>
		<button
			type="button"
			data-testid="settings-reload"
			onclick={reload}
			disabled={!loaded || !dirty}
			aria-label={t(m.revertEdits)}
		>
			{t(m.revert)}
		</button>
		<button type="button" data-testid="settings-close" onclick={onclose} aria-label={t(m.closePanel)}>
			×
		</button>
	</div>
	{#if errorNote !== null}
		<p class="settings-error" data-testid="settings-error" role="alert">{errorNote}</p>
	{/if}
	<div class="settings-editor-host" bind:this={editorHost}></div>
</div>

<style>
	.settings-editor-body {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
		overflow: hidden;
	}
	.settings-toolbar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--panel-border, #2a2a2a);
		font-size: 0.85rem;
	}
	.settings-title {
		font-weight: 600;
	}
	.settings-state {
		flex: 1;
		opacity: 0.7;
	}
	.settings-error {
		margin: 0;
		padding: 0.4rem 0.75rem;
		background: var(--color-danger-editor-surface);
		color: var(--color-danger-editor-ink);
		font-size: 0.8rem;
	}
	.settings-editor-host {
		flex: 1;
		min-height: 0;
	}
</style>
