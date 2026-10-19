<script lang="ts">
	/**
	 * PlanPopupHost — test fixture for plan-popup.test.ts: wraps PlanPopup
	 * with $state-backed props and an exported `set()` so tests can drive
	 * item-list and open CHANGES after mount (a plain `mount` pins the
	 * initial values, which never exercises the template's update
	 * closures — header totals, glyphs, status classes).
	 */
	import PlanPopup from '$lib/components/anchor/plan-anchor/PlanPopup.svelte';
	import type { TodoItem } from '$lib/utils/todo-lists';

	let {
		initialItems,
		triggerEl,
		open: initialOpen
	}: {
		initialItems: TodoItem[];
		triggerEl: HTMLElement | undefined;
		open: boolean;
	} = $props();

	// Intentional initial capture: mount-time values seed the bridge
	// state; later changes arrive only through set() (test driver).
	// svelte-ignore state_referenced_locally
	let items = $state(initialItems);
	// svelte-ignore state_referenced_locally
	let open = $state(initialOpen);

	export function set(next: { items?: TodoItem[]; open?: boolean }): void {
		if (next.items !== undefined) items = next.items;
		if (next.open !== undefined) open = next.open;
	}
</script>

<PlanPopup {items} {triggerEl} bind:open={open} />
