<script lang="ts">
	/**
	 * BrowserNew — the tab-strip + chip as a reusable button (extracted from
	 * BrowserPanel 2026-11-02, CloseButton day): ADR-0042 D3's tab CREATE —
	 * an absent-URL opentab; the CALLER owns what creating means and the
	 * chrome (pass Tailwind classes via `class`).
	 *
	 * Icon: lucide Plus at rest, CirclePlus on hover — the hover swap is the
	 * component's own contract (named group `new` on the button itself, so
	 * the swap works wherever the chip mounts, no parent group needed).
	 * CirclePlus is the canonical name — PlusCircle is the deprecated alias.
	 */
	import { Plus, CirclePlus } from '@lucide/svelte';

	let {
		/** Click handler — the caller's create logic. */
		onclick,
		/** Accessible name / tooltip (i18n'd by the caller). */
		label,
		/** The surface's own e2e seam (browser-tab-new). */
		testid,
		disabled = false,
		/** Icon size in px. */
		size = 12,
		/** Caller chrome classes (hit area, muted color, hover surface…). */
		class: className = ''
	}: {
		onclick: () => void;
		label: string;
		testid: string;
		disabled?: boolean;
		size?: number;
		class?: string;
	} = $props();
</script>

<button type="button" class="group/new {className}" data-testid={testid} title={label} aria-label={label} {disabled} {onclick}>
	<Plus {size} class="group-hover/new:hidden" />
	<CirclePlus {size} class="hidden group-hover/new:block" />
</button>
