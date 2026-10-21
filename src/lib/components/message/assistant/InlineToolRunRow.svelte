<script lang="ts">
	/**
	 * InlineToolRunRow — the wiring seat for one tool-run row (ADR-0033,
	 * 2026-10-21): the transcript renders InlineToolCalls from six sites
	 * whose wiring was byte-identical. This host takes the session-scoped
	 * wiring ONCE as the run object, derives the peek pair from runKey
	 * (peekOpen = run.peekOpenRunKey === runKey), and forwards everything
	 * to the untouched presentation child. Stateless by design — wiring
	 * only, unit-tested with fakes (ADR-0033 D4).
	 */
	import InlineToolCalls from './InlineToolCalls.svelte';
	import type { TurnMember } from '$lib/utils/turn-grouping';
	import type { DsiEntry } from '$lib/types';

	let {
		run,
		entries,
		runKey,
		peekIcon = 'wrench'
	}: {
		/** Session-scoped wiring, computed once per turn by the caller. */
		run: {
			/** The one MANUALLY open chip id across the transcript. */
			openChipId: string | null;
			/** The one open tool-peek run key (null = none). */
			peekOpenRunKey: string | null;
			/** Full render list — paired tool-result lookup crosses run bounds. */
			allEntries: DsiEntry[];
			/** Page-owned chip toggle (an id, or the reasoning form r:ID). */
			ontogglechip: (id: string, autoOpen?: boolean) => void;
			/** Page-owned peek toggle for ANY run key. */
			ontogglepeek: (runKey: string) => void;
			/** Auto-opened live think entry id (transient). */
			autoThinkId?: string | null;
			/** Auto-opened current-plan entry id (STICKY). */
			autoPlanId?: string | null;
			/** Page-owned file-open seat (ADR-0013 D5). */
			onFileOpen?: (path: string) => void;
		};
		/** The run's entries, wire order. */
		entries: TurnMember[];
		/** The run's key — names this row's peek state. */
		runKey: string;
		/** The peek badge's glyph (ADR-0022 I3): 'context' marks an
		 *  escape-strip row — attached context, not work. */
		peekIcon?: 'wrench' | 'context';
	} = $props();
</script>

<InlineToolCalls
	{entries}
	{runKey}
	openChipId={run.openChipId}
	peekOpen={run.peekOpenRunKey === runKey}
	allEntries={run.allEntries}
	ontoggleChip={run.ontogglechip}
	ontogglePeek={() => run.ontogglepeek(runKey)}
	autoThinkId={run.autoThinkId}
	autoPlanId={run.autoPlanId}
	onFileOpen={run.onFileOpen}
	{peekIcon}
/>
