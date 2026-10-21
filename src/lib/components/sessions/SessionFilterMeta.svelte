<script lang="ts">
	/**
	 * SessionFilterMeta — the filter row's meta controls in one
	 * right-pinned container (extracted from SessionFilterRow
	 * 2026-09-04): `All` (SessionFilterClear) beside the
	 * conversation-count/workspace toggle (SessionFilterToggle). These
	 * are NOT dimension pills — they are the row's state verbs: one
	 * resets EVERY dimension, the other sets the count/workspace view.
	 * Both build their FULL next state here and report it upward through
	 * onchange; the owner stays the state choke point.
	 *
	 * The [folder] ghost rule rides along (moved from SessionFilterRow):
	 * the registered-only view excludes ghost sessions, so a selected
	 * GHOST workspace pill would contradict it (and the pill hides) —
	 * selecting [folder] lifts the ghost workspace selection in the SAME
	 * change. Registered selections compose fine and stay.
	 *
	 * The container keeps its natural width (flex-shrink 0) and sits at
	 * the RIGHT end of its parent row — the right alignment comes from
	 * the SIBLING: the header's .head button flexes to fill the free
	 * space (flex: 1 in SessionFilterHeader), not from any margin here.
	 * No styling reaches the wrapped components.
	 */
	import type { BlankMode, FilterOption, SessionFilterState } from '$lib/utils/session-filters';
	import SessionFilterClear from './SessionFilterClear.svelte';
	import SessionFilterToggle from './SessionFilterToggle.svelte';
	import AddWorkspaceButton from '../common/layout/AddWorkspaceButton.svelte';

	let {
		workspaces,
		filter,
		onchange,
		oncreated
	}: {
		workspaces: FilterOption[];
		/** Live filter state — drives both controls' reads. */
		filter: SessionFilterState;
		/** Reports the full next filter state. */
		onchange: (next: SessionFilterState) => void;
		/** Fresh session created in an adopted workspace — the postfix
		 *  AddWorkspaceButton reports it upward (owner adds it to the
		 *  floor). Relayed through Header/Row from SessionsList. */
		oncreated: (sessionId: string, agentPreset: string | null, path: string) => void;
	} = $props();

	/** The no-filter state of every dimension — blankMode's off value is 'any'. */
	function clearAll(): void {
		onchange({ workspace: null, preset: null, blankMode: 'any' });
	}

	/** Set the count/workspace view — lifting a contradictory ghost
	 *  workspace selection with the change. */
	function pickMode(next: BlankMode): void {
		if (
			next === 'workspace' &&
			filter.workspace !== null &&
			workspaces.find((w) => w.key === filter.workspace)?.registered === false
		) {
			onchange({ ...filter, workspace: null, blankMode: next });
			return;
		}
		onchange({ ...filter, blankMode: next });
	}
</script>

<div class="meta">
	<SessionFilterClear {filter} onclear={clearAll} />
	<SessionFilterToggle mode={filter.blankMode} onchange={pickMode} />
	<!-- Postfix (2026-09-12): the workspace adoption control joins the
	     meta verbs — the last control on the header line. The armed
	     agent pill rides along: the fresh session runs THAT agent
	     (2026-09-15 bug: it always landed on the host default). -->
	<AddWorkspaceButton {oncreated} agent={filter.preset} />
</div>

<style>
	/* The meta container (2026-09-04): ONE flex item at the RIGHT end of
	   its parent row. The alignment is NOT ours — the SIBLING .head
	   button flexes to fill the free space (flex: 1 in
	   SessionFilterHeader), pushing this container to the end. Here:
	   keep the natural width (flex-shrink 0 — the header's summary does
	   the squeezing) and the row's pill rhythm. No styling touches the
	   wrapped components. */
	.meta {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		flex-shrink: 0;
	}
</style>
