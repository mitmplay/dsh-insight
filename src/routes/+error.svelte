<script lang="ts">
	import { t } from '$lib/services/locale/locale-state.svelte';
	import * as m from '$lib/paraglide/messages';
	/**
	 * App-wide error boundary (the Root-is-the-Floor ADR, 2026-09-02):
	 * 404 (session absent — and any retired address), 503 (host down),
	 * 409 (sub-agent ownership). The way back is `/` itself: a bare
	 * arrival restores the persisted desk, so "back" costs nothing.
	 */
	import { page } from '$app/state';
	import { dev } from '$app/environment';
	import { armSelfHeal } from '$lib/utils/error-self-heal';
	import { resolve } from '$app/paths';

	const status = $derived(page.status);
	const message = $derived(page.error?.message ?? 'Something went wrong.');
	// ADR-0075: in dev, a 500 is the HMR rebuild window (agent file edits
	// invalidate the SSR graph for ~5s) — reload once so the operator's
	// tab self-heals. Client-only ($effect never runs on SSR), and
	// non-500 statuses are real states whose evidence a reload erases.
	$effect(() => armSelfHeal(page.status, dev));
</script>

<!-- i18n-skip: brand, never translated -->
<svelte:head><title>{status} — deepseek-insight</title></svelte:head>

<main class="mx-auto flex max-w-3xl flex-col items-center gap-4 px-4 py-16 text-center">
	<p class="text-5xl font-semibold text-text-muted" data-testid="error-status">{status}</p>
	{#if status === 404}
		<h1 class="text-xl font-semibold">{t(m.sessionNotFound)}</h1>
		<p class="text-sm text-text-secondary" data-testid="error-message">{message}</p>
		<p class="text-xs text-text-muted">{t(m.reapedNote)}</p>
	{:else if status === 503}
		<h1 class="text-xl font-semibold">{t(m.dshUnreachable)}</h1>
		<p class="text-sm text-text-secondary" data-testid="error-message">{message}</p>
	{:else}
		<h1 class="text-xl font-semibold">{t(m.unexpectedError)}</h1>
		<p class="text-sm text-text-secondary" data-testid="error-message">{message}</p>
	{/if}
	<a
		href={resolve('/')}
		class="mt-2 rounded-md border border-surface-border px-3 py-1.5 text-sm text-text-secondary hover:bg-surface-alt"
		data-testid="error-back-home"
	>
		{t(m.backToWorkspace)}
	</a>
</main>
