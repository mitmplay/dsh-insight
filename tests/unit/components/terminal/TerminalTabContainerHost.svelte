<script lang="ts">
	import TerminalTabContainer from '$lib/components/terminal/TerminalTabContainer.svelte';
	// Real children snippet: the host passes live markup so the
	// container's {@render children()} runs for real in both lanes.
	let { visible, index = 1 }: { visible: boolean; index?: number } = $props();
</script>

<TerminalTabContainer {index} {visible}>
	<p data-testid="tab-body-marker">alive</p>
</TerminalTabContainer>
