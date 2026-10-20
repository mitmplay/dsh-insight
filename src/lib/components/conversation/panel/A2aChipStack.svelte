<script lang="ts">
	/**
	 * A2aChipStack — the sender panel's read-only delegation-ledger join
	 * (W4 4.2): one floating chip per recent exchange THIS panel sent,
	 * rendered beside the transcript on the floating-anchor pattern
	 * (right-middle stack, per-panel via the embedded anchor host).
	 *
	 * Honesty contract (PRD risk "Attribution overclaim in UI" + spec-check
	 * GAP-5): chip text derives from the row's `state` VERBATIM, all six
	 * states distinguished — `replied_approx` renders "may have replied",
	 * NEVER the confident "replied" string. The ledger is the truth; this
	 * component claims nothing the row does not say.
	 *
	 * Read-only by construction (BC-2): rows arrive as a prop from the
	 * page's EXISTING spine-cadence poll of GET /api/a2a?from= — the chip
	 * owns NO fetch, NO timer. Click = the existing panel doorway
	 * (addPanelFromSidebar dedupe→select). Dismiss is LOCAL-ONLY visual:
	 * rows are durable; the next poll brings a dismissed chip back only
	 * when it is still in the page's fetched window.
	 */
	import FloatingAnchor from '$lib/components/common/containers/FloatingAnchor.svelte';
	import { addPanelFromSidebar } from '$lib/services/panels/panel-registry';
	import { Check, Hourglass, X } from '@lucide/svelte';
	import type { DsiA2aExchangeView } from '$lib/types';

	let {
		rows,
		titles
	}: {
		/** This sender panel's exchanges, newest first (the page's join). */
		rows: DsiA2aExchangeView[];
		/** Live session titles keyed by sessionId (the spine rows the page
		 *  already holds — the chip shows the target's title, not its uuid). */
		titles: Record<string, string | null>;
	} = $props();

	/** Local-only visual dismissal — rows are durable; the ledger is truth. */
	let dismissed = $state<Set<string>>(new Set());

	/** The cap: newest 3 visible + one overflow indicator (spec 4.2). */
	const CHIP_CAP = 3;

	const visible = $derived(rows.filter((r) => !dismissed.has(r.id)));
	const capped = $derived(visible.slice(0, CHIP_CAP));
	const overflow = $derived(Math.max(visible.length - CHIP_CAP, 0));

	/**
	 * Chip text derives from the state VERBATIM (spec-check GAP-5): every
	 * state distinguished, `replied_approx` hedged as "may have replied" —
	 * never a confident claim the row cannot support.
	 */
	function labelFor(state: DsiA2aExchangeView['state']): string {
		switch (state) {
			case 'waiting':
				return 'waiting';
			case 'replied_exact':
				return 'replied (exact)';
			case 'replied':
				return 'replied';
			case 'replied_approx':
				return 'may have replied';
			case 'timeout':
				return 'no reply (timeout)';
			case 'gone':
				return 'target gone';
		}
	}

	/** The target's display title — the spine title, else the id prefix. */
	function titleFor(toSession: string): string {
		return titles[toSession] ?? toSession.replace(/^session-/, '').slice(0, 8);
	}

	/** Click = the existing selectPanel/addPanel doorway (registry). */
	function open(row: DsiA2aExchangeView): void {
		addPanelFromSidebar({ sessionId: row.toSession, agentPreset: null });
	}

	function dismiss(row: DsiA2aExchangeView): void {
		dismissed = new Set(dismissed).add(row.id);
	}
</script>

{#if visible.length > 0}
	<FloatingAnchor>
		{#each capped as row (row.id)}
			<div class="a2a-chip-wrap" data-testid="a2a-chip" data-a2a-state={row.state} data-a2a-id={row.id}>
				<button
					type="button"
					class="a2a-chip"
					class:tone-waiting={row.state === 'waiting'}
					class:tone-replied-exact={row.state === 'replied_exact'}
					class:tone-replied={row.state === 'replied'}
					class:tone-replied-approx={row.state === 'replied_approx'}
					class:tone-timeout={row.state === 'timeout'}
					class:tone-gone={row.state === 'gone'}
					data-testid="a2a-chip-button"
					title="{titleFor(row.toSession)} — {labelFor(row.state)}"
					onclick={() => open(row)}
				>
					{#if row.state === 'waiting'}
						<Hourglass size={13} />
					{:else if row.state === 'replied_exact' || row.state === 'replied'}
						<Check size={13} />
					{/if}
					<span class="a2a-chip-label">{labelFor(row.state)}</span>
				</button>
				<button
					type="button"
					class="a2a-dismiss"
					data-testid="a2a-chip-dismiss"
					title="hide this chip (the ledger row stays)"
					onclick={() => dismiss(row)}
				>
					<X size={11} />
				</button>
			</div>
		{/each}
		{#if overflow > 0}
			<div class="a2a-chip-overflow" data-testid="a2a-chip-overflow">+{overflow} more</div>
		{/if}
	</FloatingAnchor>
{/if}
