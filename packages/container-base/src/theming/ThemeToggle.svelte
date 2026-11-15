<script lang="ts">
	/**
	 * ThemeToggle — the generic three-state lamp mount (ADR-0063 D2).
	 * The MECHANISM lives in theming/theme-prefs.svelte.ts; this component
	 * carries NO words and NO skin: every label comes in as a prop, every
	 * icon as a snippet, every color as a token var (boundary suite).
	 * Structure follows the DSI footer lamp: one trigger whose icon is the
	 * current choice, a popup with the three states, check on the active
	 * one, click-outside closes, dropUp for rail-bottom mounts.
	 */
	import type { Component, Snippet } from 'svelte';

	export type ThemeChoice = 'system' | 'light' | 'dark';

	let {
		/** The consumer's ThemePrefs instance (createThemePrefs). */
		prefs,
		/** aria-label / title for the trigger (consumer's words). */
		triggerLabel,
		/** Per-state words (consumer's dictionary). */
		optionLabels,
		/** Per-state icon components (consumer's icon set). */
		icons,
		/** Open the list upward (rail-bottom mounts). */
		dropUp = false
	}: {
		prefs: {
			readonly choice: ThemeChoice;
			set: (c: ThemeChoice) => void;
		};
		triggerLabel: string;
		optionLabels: Record<ThemeChoice, string>;
		icons: Record<ThemeChoice, Component<{ size?: number; 'aria-hidden'?: boolean | 'true' | 'false' }>>;
		dropUp?: boolean;
	} = $props();

	let open = $state(false);
	let rootEl = $state<HTMLElement | null>(null);

	const CHOICES: ThemeChoice[] = ['system', 'light', 'dark'];

	const TriggerIcon = $derived(icons[prefs.choice]);

	function choose(c: ThemeChoice): void {
		open = false;
		prefs.set(c);
	}

	// outside click closes — one window listener while open (removed on close)
	$effect(() => {
		if (!open) return;
		const onDocClick = (ev: MouseEvent) => {
			if (rootEl && !rootEl.contains(ev.target as Node)) open = false;
		};
		document.addEventListener('click', onDocClick);
		return () => document.removeEventListener('click', onDocClick);
	});
</script>

<div
	class="cb-theme-toggle"
	data-testid="cb-theme-toggle"
	bind:this={rootEl}
>
	<button
		type="button"
		class="cb-theme-toggle-trigger"
		title={triggerLabel}
		aria-label={triggerLabel}
		aria-expanded={open}
		data-testid="cb-theme-toggle-trigger"
		onclick={() => (open = !open)}
	>
		<TriggerIcon size={16} />
	</button>
	{#if open}
		<div
			class="cb-theme-toggle-list"
			class:cb-drop-up={dropUp}
			data-testid="cb-theme-toggle-list"
			role="menu"
		>
			{#each CHOICES as c (c)}
				{@const Icon = icons[c]}
				<button
					type="button"
					class="cb-theme-option"
					class:cb-option-active={prefs.choice === c}
					data-testid={'cb-theme-option-' + c}
					data-active={prefs.choice === c ? 'true' : 'false'}
					role="menuitem"
					onclick={() => choose(c)}
				>
					<span class="cb-theme-option-row">
						<Icon size={13} aria-hidden="true" />
						{optionLabels[c]}
					</span>
					{#if prefs.choice === c}<span aria-hidden="true">✓</span>{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	/* Structure only — every color crosses through tokens (ground rule).
	 * The outside-click close effect lives with the consumer host for now
	 * (see tests); the component itself holds no globals. */
	.cb-theme-toggle {
		position: relative;
		display: inline-block;
	}
	.cb-theme-toggle-trigger {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		border: none;
		background: transparent;
		color: var(--color-text-secondary);
		border-radius: 0.25rem;
		padding: 0.25rem;
		cursor: pointer;
	}
	.cb-theme-toggle-trigger:hover {
		color: var(--color-text-primary);
	}
	.cb-theme-toggle-list {
		position: absolute;
		right: 0;
		z-index: 50;
		width: 9rem;
		overflow: hidden;
		margin-top: 0.25rem;
		border-radius: 0.375rem;
		border: 1px solid var(--color-surface-border);
		background: var(--color-surface-elevated);
		color: var(--color-text-primary);
		box-shadow: 0 4px 6px -1px var(--color-surface-border);
	}
	.cb-theme-toggle-list.cb-drop-up {
		bottom: 100%;
		margin-top: 0;
		margin-bottom: 0.25rem;
	}
	.cb-theme-option {
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
	.cb-theme-option:hover {
		background: var(--color-surface-secondary);
	}
	.cb-theme-option.cb-option-active {
		color: var(--color-accent-purple);
		font-weight: 600;
	}
	.cb-theme-option-row {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}
</style>
