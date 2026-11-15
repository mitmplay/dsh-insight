<script lang="ts">
	/**
	 * LanguageMenu — the generic mount over a LocalePrefs store (ADR-0063 D3).
	 * The base carries NO words and NO skin: the language list and its labels
	 * are consumer props, the trigger icon is a consumer component, colors
	 * cross only through tokens. Native names are NOT translated copy —
	 * every locale shows every name in its own language (that is the point
	 * of a language menu), which is why they arrive as data, not snippets.
	 */
	import type { Component } from 'svelte';

	let {
		/** The consumer's createLocalePrefs instance. */
		prefs,
		/** Locale ids in display order (validated by the store). */
		locales,
		/** Native names per locale id. */
		labels,
		/** aria-label / title for the trigger (consumer's words). */
		triggerLabel,
		/** The trigger icon (consumer's icon set — e.g. a languages glyph). */
		icon,
		/** Open the list upward (rail-bottom mounts). */
		dropUp = false
	}: {
		prefs: {
			readonly locale: string;
			set: (next: string) => void;
		};
		locales: readonly string[];
		labels: Record<string, string>;
		triggerLabel: string;
		icon: Component<{ size?: number }>;
		dropUp?: boolean;
	} = $props();

	let open = $state(false);
	let rootEl = $state<HTMLElement | null>(null);

	// outside click closes — one window listener while open (removed on close)
	$effect(() => {
		if (!open) return;
		const onDocClick = (ev: MouseEvent) => {
			if (rootEl && !rootEl.contains(ev.target as Node)) open = false;
		};
		document.addEventListener('click', onDocClick);
		return () => document.removeEventListener('click', onDocClick);
	});

	function choose(loc: string): void {
		open = false;
		prefs.set(loc);
	}

	const TriggerIcon = $derived(icon);
</script>

<div
	class="cb-language-menu"
	data-testid="language-menu"
	bind:this={rootEl}
>
	<button
		type="button"
		class="cb-language-trigger"
		title={triggerLabel}
		aria-label={triggerLabel}
		aria-expanded={open}
		data-testid="language-menu-trigger"
		onclick={() => (open = !open)}
	>
		<TriggerIcon size={16} />
		<span class="cb-language-code">{prefs.locale.toUpperCase()}</span>
	</button>
	{#if open}
		<div
			class="cb-language-list"
			class:cb-drop-up={dropUp}
			data-testid="language-menu-list"
			role="menu"
		>
			{#each locales as loc (loc)}
				<button
					type="button"
					class="cb-language-option"
					class:cb-option-active={prefs.locale === loc}
					data-testid={'locale-option-' + loc}
					data-active={prefs.locale === loc ? 'true' : 'false'}
					role="menuitem"
					onclick={() => choose(loc)}
				>
					{labels[loc] ?? loc}
					{#if prefs.locale === loc}<span aria-hidden="true">✓</span>{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	/* Structure only — colors cross through tokens (ground rule). */
	.cb-language-menu {
		position: relative;
		display: inline-block;
	}
	.cb-language-trigger {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		border-radius: 0.25rem;
		padding: 0.25rem;
		font-size: 0.75rem;
		font-weight: 500;
		cursor: pointer;
	}
	.cb-language-trigger:hover {
		color: var(--color-text-primary);
	}
	.cb-language-code {
		text-transform: uppercase;
	}
	.cb-language-list {
		position: absolute;
		right: 0;
		z-index: 50;
		width: 9rem;
		overflow: hidden;
		margin-top: 0.25rem;
		padding-top: 0.25rem;
		padding-bottom: 0.25rem;
		border-radius: 0.375rem;
		border: 1px solid var(--color-surface-border);
		background: var(--color-surface-elevated);
		color: var(--color-text-primary);
		box-shadow: 0 4px 6px -1px var(--color-surface-border);
	}
	.cb-language-list.cb-drop-up {
		bottom: 100%;
		margin-top: 0;
		margin-bottom: 0.25rem;
	}
	.cb-language-option {
		display: flex;
		width: 100%;
		align-items: center;
		justify-content: space-between;
		padding: 0.375rem 0.75rem;
		text-align: left;
		font-size: 0.75rem;
		border: none;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}
	.cb-language-option:hover {
		background: var(--color-surface-secondary);
	}
	.cb-language-option.cb-option-active {
		color: var(--color-accent-purple);
		font-weight: 600;
	}
</style>
