<!-- Wave 2 2.2-T: static host for RowSessionItem (a2a-chip pattern — the
	fixture binds the SAME svelte runtime as the test's mount/flushSync; a
	second-instance binding throws effect_orphan and silently kills effects). -->
<script lang="ts">
	import RowSessionItem from '$lib/components/sidebar/session-list/RowSessionItem.svelte';
	import type { DsiSessionSummary, DsiWorkspaceSummary } from '$lib/types';
	let { session, workspaces }: {
		session: DsiSessionSummary;
		workspaces: DsiWorkspaceSummary[];
	} = $props();
</script>

<RowSessionItem {session} {workspaces} />
