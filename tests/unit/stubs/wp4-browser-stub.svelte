<script module lang="ts">
	/**
	 * WP4 branch stub — records every mount's browserSessionId / headedOpen
	 * facts, then fires onclose + onclosed on the next microtask (off the
	 * render tick, like a real wire death would be).
	 */
	export const calls: Array<{ session: string | undefined; headed: boolean }> = [];
</script>

<script lang="ts">
	let {
		browserSessionId,
		headedOpen,
		onclose,
		onclosed
	}: {
		browserSessionId?: string;
		headedOpen?: boolean;
		onclose?: () => void;
		onclosed?: () => void;
	} = $props();

	// svelte-ignore state_referenced_locally
	calls.push({ session: browserSessionId, headed: $state.snapshot(headedOpen) === true });
	queueMicrotask(() => {
		onclose?.();
		onclosed?.();
	});
</script>

<div data-testid="wp4-browser-stub" data-session={browserSessionId ?? ''} data-headed={headedOpen === true ? 'y' : 'n'}></div>
