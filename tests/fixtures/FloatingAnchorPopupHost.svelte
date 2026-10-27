<script lang="ts">
	/**
	 * Host fixture for FloatingAnchorContainerPopup tests — mirrors the
	 * leaves' real wiring: the host OWNS open state and binds it through,
	 * with a relative wrapper as triggerEl (PlanPopupHost pattern).
	 */
	import FloatingAnchorContainerPopup from '$lib/components/common/containers/FloatingAnchorContainerPopup.svelte';

	let {
		open = $bindable(false),
		title = undefined,
		titleTestId = undefined,
		placement = undefined
	}: {
		open?: boolean;
		title?: string;
		titleTestId?: string;
		placement?: 'left' | 'right';
	} = $props();

	let triggerEl: HTMLElement | undefined = $state(undefined);
</script>

<div class="relative" bind:this={triggerEl}>
	<button
		type="button"
		data-testid="host-toggle"
		onclick={() => (open = !open)}
	>
		toggle
	</button>
	<FloatingAnchorContainerPopup bind:open {triggerEl} {title} {titleTestId} {placement}>
		<div data-testid="probe-row">a row</div>
	</FloatingAnchorContainerPopup>
</div>
