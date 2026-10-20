<!--
	BrowserHeader — the status strip + proxy controls of BrowserPanel
	(The Glass Browser spec Wave 2, task 2.1; ADR-0029; extended by
	ADR-0031 D1/D2, amended 2 — the header SPEAKS: standard address-bar
	order (back, forward, reload, then the search-style URL input that
	clears on the panel's answer, never on Enter); no title label. The
	panel ACTS: no POST lives here. data-status / data-rebound stay the
	e2e seams).
-->
<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	let {
		/** Panel session state — drives the dot color and testid data. */
		status,
		/** True when mount re-bound to a surviving session (ADR-0030 D1). */
		reBound = false,
		/** Registry id; null = session not opened yet (no id shown). */
		sessionId = null,
		/** Double-invocation guard mirrored from the panel while closing. */
		closing = false,
		/** A proxy verb is in flight (panel-owned) — buttons go quiet. */
		busy = false,
		/** History bounds from the panel's last navigate answer (ADR-0031
		 *  give-up: only as fresh as the last answer). */
		canBack = false,
		canForward = false,
		/** Owner-release click (D8): the panel performs the actual close. */
		onclose,
		/** Proxy intents (ADR-0031 D1): reported upward, never performed. */
		onnavigate,
		onreload,
		onhistory
	}: {
		status: 'opening' | 'connecting' | 'live' | 'failed' | 'closed';
		reBound?: boolean;
		sessionId?: string | null | undefined;
		closing?: boolean;
		busy?: boolean;
		canBack?: boolean;
		canForward?: boolean;
		onclose?: () => void;
		onnavigate?: (text: string) => void;
		onreload?: () => void;
		onhistory?: (dir: 'back' | 'forward') => void;
	} = $props();

	/** Ephemeral intent, never state (D2): the panel clears it on the
	 *  route ANSWER via clearInput() — success or refusal both answer. */
	let urlText = $state('');

	/** The panel's handle: clears the box when the navigate route answers. */
	export function clearInput(): void {
		urlText = '';
	}

	function submit(): void {
		const t = urlText.trim();
		if (!t) return; // empty Enter is a no-op
		onnavigate?.(t);
	}
</script>

<div class="flex items-center gap-2 border-b border-surface-border px-2 py-1 text-xs">
	<span class="flex min-w-0 flex-1 items-center gap-2">
		<!-- proxy controls (ADR-0031 D1): outside the glass input surface -->
		<button
			class="rounded px-1 hover:bg-surface-active disabled:opacity-40"
			data-testid="browser-back"
			aria-label={m.browserBack()}
			disabled={busy || !canBack}
			onclick={() => onhistory?.('back')}
		>←</button>
		<button
			class="rounded px-1 hover:bg-surface-active disabled:opacity-40"
			data-testid="browser-forward"
			aria-label={m.browserForward()}
			disabled={busy || !canForward}
			onclick={() => onhistory?.('forward')}
		>→</button>
		<button
			class="rounded px-1 hover:bg-surface-active disabled:opacity-40"
			data-testid="browser-reload"
			aria-label={m.browserReload()}
			disabled={status !== 'live' || busy}
			onclick={() => onreload?.()}
		>⟳</button>
		<input
			class="min-w-0 flex-1 rounded border border-surface-border bg-surface px-2 py-0.5"
			type="text"
			data-testid="browser-url-input"
			placeholder={m.browserUrlPlaceholder()}
			disabled={status !== 'live' || busy}
			bind:value={urlText}
			onkeydown={(e) => {
				if (e.key === 'Enter') submit();
			}}
		/>
	</span>
	<span class="flex items-center gap-2" data-testid="browser-status" data-status={status} data-rebound={reBound}>
		<span class="inline-block h-2 w-2 rounded-full {status === 'live' ? 'bg-emerald-500' : status === 'failed' || status === 'closed' ? 'bg-red-500' : 'bg-amber-400'}"></span>
		{#if sessionId}<span class="rounded-t-md border border-b-0 border-surface-border bg-surface-elevated px-2 py-0.5 font-mono text-[10px] opacity-80" data-testid="browser-session-tab">{sessionId.slice(0, 8)}</span>{/if}
		<button
			class="rounded px-1 hover:bg-surface-active"
			data-testid="panel-close"
			disabled={closing}
			onclick={() => onclose?.()}
		>✕</button>
	</span>
</div>
