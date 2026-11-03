<script lang="ts">
	/**
	 * ReloadButton — the refresh icon with the CanvasCopyButton feedback
	 * machine (extracted from WorkspaceFileToolbar 2026-10-28): idle
	 * RotateCw → busy Loader2 spin → done Check → idle. Presentational
	 * (house button pattern): the CALLER owns the state machine and what
	 * a reload means — the button renders the state and reports the click.
	 *
	 * Styling: no chrome of its own — pass Tailwind classes via `class`
	 * (the CanvasCopyButton pattern); each surface keeps its own chip
	 * grammar and `data-testid`.
	 */
	import { Check, Loader2, RotateCw } from '@lucide/svelte';

	let {
		/** Feedback state: idle arrow, busy spinner, done check. */
		state = 'idle',
		/** Click handler — the caller's reload logic. */
		onclick,
		/** Accessible name / tooltip (i18n'd by the caller). */
		label,
		/** The surface's own e2e seam (file-reload, browser-reload, …). */
		testid,
		disabled = false,
		/** Icon size in px. */
		size = 14,
		/** Caller chrome classes (chip border, padding, hover…). */
		class: className = ''
	}: {
		state?: 'idle' | 'busy' | 'done';
		onclick: () => void;
		label: string;
		testid: string;
		disabled?: boolean;
		size?: number;
		class?: string;
	} = $props();
</script>

<button
	type="button"
	class={className}
	data-testid={testid}
	data-state={state}
	title={label}
	aria-label={label}
	{disabled}
	{onclick}
>
	{#if state === 'done'}
		<Check {size} class="text-status-pass" />
	{:else if state === 'busy'}
		<Loader2 {size} class="animate-spin" />
	{:else}
		<RotateCw {size} />
	{/if}
</button>
