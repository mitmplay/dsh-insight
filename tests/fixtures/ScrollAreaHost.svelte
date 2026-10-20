<script lang="ts">
	/**
	 * ScrollAreaHost — test fixture (conversation-scroll-area.test.ts):
	 * wraps ConversationScrollArea with $state-backed props and exported
	 * setters, so a test can drive entries growth/prepend, chip ids, and
	 * answerer cards after mount (the ControlBarHarness pattern — bind
	 * targets and callbacks need a writable host the test can read).
	 */
	import ConversationScrollArea from '../../src/lib/components/conversation/panel/ConversationScrollArea.svelte';
	import { groupTurns } from '../../src/lib/utils/turn-grouping';
	import type { DsiEntry } from '../../src/lib/types';
	import type { AnswerView } from '../../src/lib/services/conversation/store.svelte';

	let entries = $state<DsiEntry[]>([]);
	let openChipId = $state<string | null>(null);
	let peekOpenRunKey = $state<string | null>(null);
	let hasMore = $state<boolean | undefined>(undefined);
	let pendingCards = $state<AnswerView[]>([]);
	let settledCards = $state<AnswerView[]>([]);
	let viewport = $state<HTMLElement | undefined>(undefined);

	const answers: Array<{ rpcId: string; payload: Record<string, unknown> }> = [];
	const loads: number[] = [];
	const chipToggles: string[] = [];
	const peekToggles: string[] = [];

	const groups = $derived(groupTurns(entries));

	export function setEntries(next: DsiEntry[]): void {
		entries = next;
	}
	export function setOpenChipId(id: string | null): void {
		openChipId = id;
	}
	export function setPeekRunKey(key: string | null): void {
		peekOpenRunKey = key;
	}
	export function setHasMore(v: boolean | undefined): void {
		hasMore = v;
	}
	export function setCards(pending: AnswerView[], settled: AnswerView[] = []): void {
		pendingCards = pending;
		settledCards = settled;
	}
	export function answerLog(): Array<{ rpcId: string; payload: Record<string, unknown> }> {
		return answers;
	}
	export function loadLog(): number[] {
		return loads;
	}
	export function chipLog(): string[] {
		return chipToggles;
	}
	export function peekLog(): string[] {
		return peekToggles;
	}
</script>

	<!-- openChipId / peekOpenRunKey are CONTROLLED props of the scroll area
	     (read-only inside it; the owner mutates through the toggle callbacks),
	     so they pass one-way — the host's $state + setters drive them, and the
	     callbacks record what the component reported. -->
	<ConversationScrollArea
		bind:viewport
		{entries}
		{groups}
		{hasMore}
		loadingOlder={false}
		olderError={null}
		onloadolder={() => loads.push(1)}
		{openChipId}
		ontogglechip={(id) => chipToggles.push(id)}
		{peekOpenRunKey}
		ontogglepeek={(key) => peekToggles.push(key)}
		{pendingCards}
		{settledCards}
		onanswer={(rpcId, payload) => answers.push({ rpcId, payload })}
		sessionId="sess-test"
	/>
