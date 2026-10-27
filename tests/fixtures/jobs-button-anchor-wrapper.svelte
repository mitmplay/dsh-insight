<script lang="ts">
	/**
	 * Test fixture (badge-watch-anchor) — hosts JobsButton under a session
	 * id the test can genuinely change in place (no remount), pinning the
	 * real-id-change re-watch path (ADR-0033 D1, JobsButton arm).
	 */
	import JobsButton from '../../src/lib/components/anchor/job-anchor/JobsButton.svelte';

	let { initial = 'sid-a' }: { initial?: string } = $props();
	// Override state + $derived: the prop is read reactively (no
	// state_referenced_locally initial-capture), setSid wins once called.
	let override = $state<string | undefined>(undefined);
	let sid = $derived(override ?? initial);

	export function setSid(next: string): void {
		override = next;
	}
</script>

<JobsButton sessionId={sid} />
