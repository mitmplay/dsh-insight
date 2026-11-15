<script lang="ts">
	/**
	 * SettingsHomeToolbar — the bar of a settings-home file tab: path
	 * readout, dirty indicator, and the save button. Extracted from
	 * SettingsHomeFile (2026-09-18); state stays with the file body —
	 * the toolbar is a pure view of (fullPath, dirty, saving) plus a
	 * save callback. The readout shows the FULL path (home root +
	 * relative path) that SettingsHomeFile resolves from the config
	 * store's server homedir truth (The Settings Tree ADR, D2); the
	 * `path` prop remains the API contract for the file body itself.
	 */
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	import { CanvasCopyButton } from '@deepseek-insight/container-base';
	
	// The canvas-copy capture target: the owning PanelColumn — the same
	// ancestor-walk grammar as WorkspaceFileToolbar (no new prop threading
	// through SettingsHomeFile just to name an ancestor).
	let toolbarEl = $state<HTMLDivElement>();
	let columnEl = $state<HTMLElement | null>(null);
	$effect.pre(() => {
		columnEl = null;
		let el: HTMLElement | null = toolbarEl ?? null;
		while (el) {
			if (el.dataset.testid === 'panel-column') {
				columnEl = el;
				break;
			}
			el = el.parentElement;
		}
	});

	let { path, fullPath, dirty, saving, save }: {
		path: string;
		fullPath: string;
		dirty: boolean;
		saving: boolean;
		save: () => void;
	} = $props();
</script>

<div class="bar" bind:this={toolbarEl}>
	<span class="path" title={fullPath}>{fullPath}</span>
	{#if dirty}<span class="dirty" data-testid="settings-home-dirty">●</span>{/if}
	<button class="save" disabled={!dirty || saving} onclick={save}>
		{t(m.save)}
	</button>
	<!-- Capture the owning panel column as a PNG: click copies,
	     Shift+Click saves (same grammar as WorkspaceFileToolbar). -->
	<span class="copy-slot">
		<CanvasCopyButton container={columnEl} title={t(m.workspacePanelCommonCopyColumn)} size={12} />
	</span>
</div>

<style>
	.bar {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.25rem 0.5rem;
		flex-shrink: 0;
	}
	.path {
		font-size: 0.75rem;
		color: var(--color-text-secondary, #6c757d);
		word-break: break-all;
		flex: 1;
	}
	.dirty {
		color: var(--color-accent-amber-ink);
		font-size: 0.75rem;
	}
	.save {
		font: inherit;
		font-size: 0.75rem;
		padding: 0.1rem 0.5rem;
		border: 1px solid var(--color-border, #d0d7de);
		border-radius: 0.25rem;
		background: var(--color-surface-secondary, #f1f3f5);
		cursor: pointer;
	}
	.save:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.copy-slot {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
	}
</style>