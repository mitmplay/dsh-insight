<script module lang="ts">
	/**
	 * WP4 branch stub — records every mount's home/session facts, then
	 * invokes the page's onOpenFile once on the next microtask (the
	 * real panel never forwards a click to it, so a stub is the only
	 * way to exercise the page-side contract).
	 */
	export const calls: Array<{ home: boolean; session: string | null }> = [];
</script>

<script lang="ts">
	let {
		onOpenFile,
		home,
		sessionId
	}: {
		onOpenFile?: (path: string) => void;
		home?: 'dsi' | 'dsh';
		sessionId?: string | null;
	} = $props();

	// svelte-ignore state_referenced_locally
	calls.push({ home: $state.snapshot(home) !== undefined, session: $state.snapshot(sessionId) ?? null });
	queueMicrotask(() => onOpenFile?.('wp4/README.md'));
</script>

<div data-testid="wp4-explorer-stub" data-home={home ?? ''} data-session={sessionId ?? ''}></div>
