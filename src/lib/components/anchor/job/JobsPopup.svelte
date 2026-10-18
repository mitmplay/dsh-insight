<script lang="ts">
	import JobRosterList from '$lib/components/jobs/JobRosterList.svelte';
	import FloatingAnchorContainerPopup from '$lib/components/common/containers/FloatingAnchorContainerPopup.svelte';
	import type { DsiJobView } from '$lib/types';

	/**
	 * JobsPopup — the popup half of the JobsButton anchor leaf (Job Badge
	 * Wave 3): the shared JobRosterList readout hosted in
	 * FloatingAnchorContainerPopup (The Popup Shell ADR D1) since the
	 * 2026-10-17 placement fix: the hand-rolled absolute popup broke in
	 * embedded panel mode, while the shell's right-full/vertically-centered
	 * placement is the pinned surface the other anchor leaves use.
	 */
	let {
		open = $bindable(),
		triggerEl,
		jobs,
		sessionId
	}: {
		open?: boolean;
		triggerEl: HTMLElement | undefined;
		jobs: DsiJobView[];
		sessionId: string;
	} = $props();
</script>

<FloatingAnchorContainerPopup bind:open {triggerEl} popupTestId="jobs-button-popup">
	<JobRosterList {jobs} {sessionId} />
</FloatingAnchorContainerPopup>
