<script lang="ts">
	/**
	 * C1ScrollHost — test fixture (c1-scroll-area-branches.test.ts):
	 * wraps ConversationScrollArea with $state-backed props for EVERYTHING
	 * the block reads, including the fork/subagent family the older
	 * ScrollAreaHost fixture does not expose (subagent tint + depth, the
	 * fork-here anchor title/preset, the bindable stick toggle) so the
	 * template conditionals can be driven through BOTH states after a
	 * single mount (the ControlBarHarness pattern).
	 */
	import ConversationScrollArea from '../../src/lib/components/conversation/panel/ConversationScrollArea.svelte';
	import { groupTurns } from '../../src/lib/utils/turn-grouping';
	import type { DsiEntry } from '../../src/lib/types';
	import type { AnswerView } from '../../src/lib/services/conversation/store.svelte';

	let {
		subagent = false,
		depth = 0,
		title = null,
		agentPreset = null
	}: {
		subagent?: boolean;
		depth?: number;
		title?: string | null;
		agentPreset?: string | null;
	} = $props();

	let entries = $state<DsiEntry[]>([]);
	let openChipId = $state<string | null>(null);
	let peekOpenRunKey = $state<string | null>(null);
	let hasMore = $state<boolean | undefined>(undefined);
	let pendingCards = $state<AnswerView[]>([]);
	let settledCards = $state<AnswerView[]>([]);
	let stick = $state(true);
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
	export function setStick(next: boolean): void {
		stick = next;
	}
	export function stickValue(): boolean {
		return stick;
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
</script>

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
	sessionId="sess-c1"
	{subagent}
	{depth}
	{title}
	{agentPreset}
/>
