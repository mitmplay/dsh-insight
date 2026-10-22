<script lang="ts">
	/**
	 * AppSidebarHeaderHost — test harness for app-sidebar-header.test.ts:
	 * owns the page-side bindable state (panelWidth/zoom) plus an event
	 * log exposed through a hidden input (GoalBarHost pattern), so the
	 * test can assert the $bindable round-trip and the delegated
	 * onToggleCollapse / onresizeall callbacks.
	 */
	import AppSidebarHeader from '$lib/components/common/layout/AppSidebarHeader.svelte';

	let {
		captureContainer = null,
		trayContainer = null,
		onwidth,
		onzoom
	}: {
		captureContainer?: HTMLElement | null;
		trayContainer?: HTMLElement | null;
		onwidth?: (width: number) => void;
		onzoom?: (zoom: number) => void;
	} = $props();

	let panelWidth = $state(500);
	let zoom = $state(0.5);
	const events = $state<string[]>([]);

	$effect(() => {
		onwidth?.(panelWidth);
	});
	$effect(() => {
		onzoom?.(zoom);
	});
</script>

<AppSidebarHeader
	{captureContainer}
	{trayContainer}
	bind:panelWidth
	bind:zoom
	onresizeall={(width) => {
		events.push('resizeall:' + width);
		panelWidth = width;
	}}
	onToggleCollapse={() => events.push('toggle')}
/>

<input id="host-width" type="hidden" value={panelWidth} />
<input id="host-zoom" type="hidden" value={zoom} />
<input id="host-events" type="hidden" value={events.join(',')} />
