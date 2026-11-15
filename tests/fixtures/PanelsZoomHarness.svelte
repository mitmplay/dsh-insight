<script lang="ts">
	/**
	 * PanelsZoomHarness — test fixture (panels-row.test.ts): wraps PanelsZoom
	 * with $state-backed props and an exported `set()` — Svelte 5 mount()
	 * instances take prop values at mount only, so tests drive changes
	 * through this bridge (no $set in runes mode).
	 */
	import PanelsZoom from '../../packages/container-base/src/components/PanelsZoom.svelte';
	import type { Snippet } from 'svelte';

	let {
		zoom = 1,
		panels,
		railWidth = null,
		selectedPanelId = null,
		children
	}: {
		zoom?: number;
		panels: Array<{ id: string; width: number }>;
		railWidth?: number | null;
		selectedPanelId?: string | null;
		children: Snippet;
	} = $props();

	// Intentional initial capture: mount-time values seed the bridge state;
	// later changes arrive ONLY through set() (the test's driver).
	// svelte-ignore state_referenced_locally
	let z = $state(zoom);
	// svelte-ignore state_referenced_locally
	let p = $state(panels);
	// svelte-ignore state_referenced_locally
	let rw = $state<number | null>(railWidth);
	// svelte-ignore state_referenced_locally
	let sel = $state<string | null>(selectedPanelId);

	export function set(next: {
		zoom?: number;
		panels?: Array<{ id: string; width: number }>;
		railWidth?: number | null;
		selectedPanelId?: string | null;
	}): void {
		if (next.zoom !== undefined) z = next.zoom;
		if (next.panels !== undefined) p = next.panels;
		if (next.railWidth !== undefined) rw = next.railWidth;
		if (next.selectedPanelId !== undefined) sel = next.selectedPanelId;
	}
</script>

<PanelsZoom zoom={z} panels={p} railWidth={rw} selectedPanelId={sel} {children} />
