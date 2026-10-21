<script lang="ts">
	/**
	 * SettingsHomeFile — The Settings Tree ADR (2026-09-18, D2): the file
	 * body of a settings-home explorer tab. Edits ride the DSI-local
	 * /api/settings-home plane: load, edit, save, with an honest dirty
	 * indicator. Deliberately NOT the WorkspaceFilePanel — that surface is
	 * session-scoped and git-faced, and a settings home has neither a
	 * session nor git guarantees.
	 *
	 * The editor itself IS the shared lazy Monaco seam (settings-monaco.ts,
	 * createTextEditor) — the RCA of 2026-09-18 ("The Home Tab That Lost Its
	 * Colors") records why the first cut shipped a textarea: the seam was
	 * never named in the ADR's file map. No component imports monaco-editor
	 * directly; the dynamic import keeps the lazy chunk (monaco-lazy-chunk
	 * build gate). Language is guessed from the file extension.
	 */
	import { appConfig } from '$lib/services/config/app-config.svelte';
	import type { YamlEditorHandle } from '../monaco/settings-monaco';
	import SettingsHomeToolbar from './SettingsHomeToolbar.svelte';

	let { home, path }: { home: 'dsi' | 'dsh'; path: string } = $props();

	let editorHost = $state<HTMLDivElement | null>(null);
	let editor: YamlEditorHandle | null = null;
	let saved = $state<string | null>(null);
	let loaded = $state(false);
	let error = $state<string | null>(null);
	let saving = $state(false);
	/** Edit tick — bumped by the editor onChange so `dirty` recomputes. */
	let editTick = $state(0);

	function isDirty(): boolean {
		// reads the non-$state handle directly — recomputable because
		// `editTick` (bumped by the editor's onChange) is the reactive input.
		return editor !== null && saved !== null && editor.getValue() !== saved;
	}
	const dirty = $derived(loaded && editTick >= 0 && isDirty());

	/** Full path for display, tilde-abbreviated: the home root (server
	 *  homedir truth via /api/config, The Settings Tree ADR 2026-09-18
	 *  D2) joined with the home-relative `path` prop, then the operator's
	 *  home directory collapses to `~` — the readout never exposes the
	 *  real home path to the wire/screen. A $derived so a late config
	 *  load re-renders the toolbar's path readout. */
	const fullPath = $derived.by(() => {
		const root = appConfig().settingsHomes[home];
		const full = root.endsWith('/') ? root + path : root + '/' + path;
		// /.dsi or /.dsh ends the root; everything before it is homedir.
		const marker = full.indexOf(home === 'dsi' ? '/.dsi/' : '/.dsh/');
		return marker > 0 ? '~' + full.slice(marker) : full;
	});

	/** Monaco language id from the file extension (built-in ids only;
	 *  anything unknown edits as plaintext — still highlighted-free but
	 *  still a real editor with find/replace and a real buffer). */
	function languageFor(p: string): string {
		const ext = p.split('.').pop()?.toLowerCase() ?? '';
		switch (ext) {
			case 'yaml':
			case 'yml':
				return 'yaml';
			case 'json':
				return 'json';
			case 'ts':
				return 'typescript';
			case 'js':
			case 'mjs':
			case 'cjs':
				return 'javascript';
			case 'css':
			case 'scss':
				return 'css';
			case 'html':
				return 'html';
			case 'md':
				return 'markdown';
			case 'sh':
				return 'shell';
			default:
				return 'plaintext';
		}
	}

	async function load(): Promise<void> {
		error = null;
		try {
			const res = await fetch(
				'/api/settings-home/file?home=' + encodeURIComponent(home) + '&path=' + encodeURIComponent(path)
			);
			const body = (await res.json()) as {
				ok: boolean;
				file?: { content: string };
				error?: { code?: string; message?: string };
			};
			if (!body.ok || !body.file) {
				error = body.error?.message ?? body.error?.code ?? String(res.status);
				loaded = false;
				return;
			}
			saved = body.file.content;
			const host = editorHost;
			if (host !== null) {
				// The shared lazy seam — the ONLY legal route to monaco-editor.
				const { createTextEditor } = await import('../monaco/settings-monaco');
				if (editor !== null) {
					// A tab switch re-runs load() on the SAME instance: the
					// language rides the extension, so dispose + recreate.
					editor.dispose();
					editor = null;
				}
				editor = createTextEditor(host, body.file.content, () => {
					editTick += 1; // makes `dirty` recomputable (RCA: reactive read)
				}, { language: languageFor(path) });
			}
			loaded = true;
		} catch (err) {
			error = err instanceof Error ? err.message : 'network';
		}
	}

	$effect(() => {
		void load();
		return () => {
			editor?.dispose();
			editor = null;
		};
	});

	async function save(): Promise<void> {
		if (editor === null || saving) return;
		saving = true;
		error = null;
		try {
			const res = await fetch('/api/settings-home/file-write', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ home, path, content: editor.getValue() })
			});
			const body = (await res.json()) as { ok: boolean; error?: { message?: string; code?: string } };
			if (!body.ok) {
				error = body.error?.message ?? body.error?.code ?? String(res.status);
				return;
			}
			saved = editor.getValue();
		} catch (err) {
			error = err instanceof Error ? err.message : 'network';
		} finally {
			saving = false;
		}
	}
</script>

<div class="home-file" data-testid="settings-home-file">
	<SettingsHomeToolbar {path} {fullPath} {dirty} {saving} save={() => void save()} />
	{#if error !== null}
		<div class="error" role="alert">{error}</div>
	{/if}
	<div class="editor-host" bind:this={editorHost} data-testid="settings-home-editor"></div>
</div>

<style>
	.home-file {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}
	.error {
		padding: 0.25rem 0.5rem;
		font-size: 0.75rem;
		color: var(--si-run);
		flex-shrink: 0;
	}
	.editor-host {
		flex: 1;
		min-height: 0;
		/* Full border, the WorkspaceFilePanel .file-editor-host grammar —
		   a top rule alone vanished against the bar above it. */
		border: 1px solid var(--color-border, #d0d7de);
		border-radius: 0.25rem;
	}
</style>