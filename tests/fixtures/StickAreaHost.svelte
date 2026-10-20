<script lang="ts">
	/**
	 * StickAreaHost — test fixture (scroll-area-branches.test.ts): wraps
	 * ConversationScrollArea with a BINDABLE stick flag the test can flip
	 * after mount, so the outside-in mirror effect (prop write → setStick
	 * jump) can be driven the way the composer toggle drives it.
	 */
	import ConversationScrollArea from '../../src/lib/components/conversation/panel/ConversationScrollArea.svelte';
	import { groupTurns } from '../../src/lib/utils/turn-grouping';
	import type { DsiEntry } from '../../src/lib/types';

	let entries = $state<DsiEntry[]>([]);
	let stick = $state(true);
	let viewport = $state<HTMLElement | undefined>(undefined);

	const groups = $derived(groupTurns(entries));

	export function setEntries(next: DsiEntry[]): void {
		entries = next;
	}
	export function setStick(next: boolean): void {
		stick = next;
	}
	export function stickValue(): boolean {
		return stick;
	}
	export function viewportEl(): HTMLElement | undefined {
		return viewport;
	}
</script>

<ConversationScrollArea
	bind:viewport
	bind:stick
	{entries}
	{groups}
	hasMore={undefined}
	loadingOlder={false}
	olderError={null}
	onloadolder={() => {}}
	openChipId={null}
	ontogglechip={() => {}}
	peekOpenRunKey={null}
	ontogglepeek={() => {}}
	pendingCards={[]}
	settledCards={[]}
	onanswer={() => {}}
	sessionId="sess-stick"
/>
