<script lang="ts">
	/**
	 * Test fixture (badge-watch-anchor) — hosts JobsButton under a session
	 * id the test can genuinely change in place (no remount), pinning the
	 * real-id-change re-watch path (ADR-0033 D1, JobsButton arm).
	 */
	import JobsButton from '../../src/lib/components/anchor/job-anchor/JobsButton.svelte';

	let { initial = 'sid-a' }: { initial?: string } = $props();
	let sid = $state<string>(initial);

	export function setSid(next: string): void {
		sid = next;
	}
</script>

<JobsButton sessionId={sid} />
