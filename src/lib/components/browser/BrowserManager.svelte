<!-- BrowserManager (extracted from +page.svelte's browser branch, 2026-10-21):
     the ONE panel-manager body for a browser slot — the glass
     (BrowserPanel) owns its session lifecycle, panel-close / unmount
     both release it (Glass Browser ADR-0029 D4/D8); the floor just
     removes the slot. -->
<script lang="ts">
	import BrowserPanel from './BrowserPanel.svelte';

	let {
		browserSessionId,
		onclose,
		openedBy = undefined,
		parentTitle = null,
		depth = 0,
		onsession,
		onclosed
	}: {
		browserSessionId?: string;
		onclose: () => void;
		/** Provenance pass-through (ADR-0036 D3) — the thin shell owns no
		 *  lineage state; the route resolves, the glass displays. */
		openedBy?: string | undefined;
		parentTitle?: string | null;
		depth?: number;
		/** Session write-back (Amendment 3): the glass reports its resolved
		 *  browser-session id; the floor entry carries it for the slot list. */
		onsession?: (id: string) => void;
		/** The death notice pass-through (Glass Close Ladder D4): a touch
		 *  answered 409 CLOSED — the route prunes the slot entry. */
		onclosed?: () => void;
	} = $props();
</script>

<div class="panel-manager-body" data-testid="panel-browser-slot">
	<BrowserPanel {browserSessionId} {onclose} {openedBy} {parentTitle} {depth} {onsession} {onclosed} />
</div>
<style>
	/* Same rule as +page.svelte's scoped .panel-manager-body (RCA
	   2026-10-22): Svelte scoping is per-component — the page's rule
	   stopped matching this div the moment the branch became its own
	   component, and the glass lost its height/scroll host. Kept in sync
	   with the page copy; the slot owns its vertical scroll. */
	.panel-manager-body {
		height: 100%;
		overflow-y: auto;
		padding: 0;
		font-size: 0.8125rem;
		--mgr-bleed: 0rem;
	}
</style>