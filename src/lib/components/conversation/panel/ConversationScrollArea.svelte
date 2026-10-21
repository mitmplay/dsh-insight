<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	/**
	 * ConversationScrollArea — the transcript viewport (extracted from the
	 * conversation page, 2026-08-24): the scrolling `<main>` that renders
	 * the load-older sentinel, the empty state, the turn groups (prompt
	 * bubbles + context-injection chips, assistant turns with inline tool
	 * calls), and the answerer cards (pending above settled). Purely
	 * presentational — data and callbacks arrive as props; the page owns
	 * the store, polling, and chip/peek toggle semantics.
	 *
	 * Scroll-stick rides the SHARED primitive (utils/stick-to-bottom,
	 * 2026-08-26): stick to bottom as entries arrive, but only while the
	 * user is at the bottom — jumping or scrolling up breaks the stick;
	 * scrolling back down re-engages it. Without this guard a jump or
	 * back-to-top would be yanked back by the next poll delta.
	 *
	 * The viewport element is $bindable: the page keeps it for the
	 * floating anchor stack (jumper + back-to-top act on this scroller).
	 */
	import LoadOlderSentinel from '$lib/components/message/LoadOlderSentinel.svelte';
	import PromptBubble from '$lib/components/message/prompt/PromptBubble.svelte';
	import ContextInjection from '$lib/components/message/chips/ContextInjectionChip.svelte';
	import ContextSnapshotBody from '$lib/components/message/ContextSnapshotBody.svelte';
	import SystemPromptChip from '$lib/components/message/chips/SystemPromptChip.svelte';
	import ChipPopup from '$lib/components/message/assistant/ChipPopup.svelte';
	import AssistantTurn from '$lib/components/message/assistant/AssistantTurn.svelte';
	import MarkdownContent from '$lib/components/common/viewers/MarkdownContent.svelte';
	import InlineToolRunRow from '$lib/components/message/assistant/InlineToolRunRow.svelte';
	import TurnProcessDisclosure from '$lib/components/message/assistant/TurnProcessDisclosure.svelte';
	import ApprovalCard from '$lib/components/card/ApprovalCard.svelte';
	import QuestionCard from '$lib/components/card/QuestionCard.svelte';
	import { turnLastTime, turnStartTime, turnUsage, turnText, splitRuns, groupTurns, turnAnchorSeq, turnProcess, type TurnMember, type TurnRun } from '$lib/utils/turn-grouping';
	import { projectTurnLifecycle, lifecycleForGroup } from '$lib/services/conversation/turn-projection';
	import { SvelteSet } from 'svelte/reactivity';
	import { appConfig } from '$lib/services/config/app-config.svelte';
	import { chipNameOf, subagentOpenOf } from '$lib/utils/context-chip';
	import { createStickToBottom } from '$lib/utils/stick-to-bottom.svelte';
	import { untrack } from 'svelte';
	import type { AnswerView } from '$lib/services/conversation/store.svelte';
	import { parseQuestions } from '$lib/utils/questions';
	import type { DsiEntry } from '$lib/types';

	let {
		viewport = $bindable(undefined),
		/** Stick-to-bottom flag — bindable for the composer toggle. */
		stick = $bindable(true),
		entries,
		groups,
		hasMore,
		loadingOlder,
		olderError,
		onloadolder,
		openChipId,
		ontogglechip,
		autoThinkId = null,
		autoPlanId = null,
		peekOpenRunKey,
		ontogglepeek,
		pendingCards,
		settledCards,
		onanswer,
		/** File Link Intent (ADR 2026-09-25 D2): forwarded to assistant markdown
		 *  anchors — the route supplies the gated explorer opener. */
		onFileLink = undefined,
		onFileOpen = undefined,
		sessionId,
		title = null,
		agentPreset = null,
		subagent = false,
		depth = 0
	}: {
		/** The scrolling <main> element — page-bound for the floating anchors. */
		viewport?: HTMLElement;
		/** True while the viewport follows the live bottom (see the
		 *  scroll-stick block — the composer toggle binds it). */
		stick?: boolean;
		/** Raw store entries (empty state + tool-run arg lookup + stick). */
		entries: DsiEntry[];
		/** Derived turn groups (groupTurns over renderEntries — page-owned). */
		groups: ReturnType<typeof groupTurns>;
		/** Ledger says older pages exist (load-older sentinel). */
		hasMore: boolean | undefined;
		loadingOlder: boolean;
		olderError: string | null;
		onloadolder: () => void;
		/** Open context-chip id (null = none) — page-owned exclusivity. */
		openChipId: string | null;
		ontogglechip: (id: string, autoOpen?: boolean) => void;
		/** Auto-opened live think entry id (transient — streaming + stick
		 *  only, closes at turn end); null when idle or suppressed. */
		autoThinkId?: string | null;
		/** Auto-opened current-plan entry id (STICKY — survives newer
		 *  thinks and turn end until superseded or collapsed). */
		autoPlanId?: string | null;
		/** Open tool-peek run key (null = none) — page-owned exclusivity. */
		peekOpenRunKey: string | null;
		ontogglepeek: (runKey: string) => void;
		/** Answerer cards — pending (waiting/in-flight) above settled. */
		pendingCards: AnswerView[];
		settledCards: AnswerView[];
		onanswer: (rpcId: string, payload: Record<string, unknown>) => void;
		onFileLink?: (href: string) => void;
		/** Page-owned file-open seat for the markdown cards (ADR-0013 D5). */
		onFileOpen?: (path: string) => void;
		sessionId: string;
		/** Live title — the fork-here child's best-effort " (fork)" rename
		 *  seed (the header fork button reads the same value). */
		title?: string | null;
		/** Raw preset id — rides the fork-here child onto its panel chip. */
		agentPreset?: string | null;
		/** True for sub-agent sessions — the transcript tints beige: the
		 *  panel is a read-only view (no composer), and the tint says so
		 *  at a glance before the missing input is noticed. */
		subagent?: boolean;
		/** Lineage depth (1 = direct child, 2 = nested under a sub-agent,
		 *  …). Deepens the tint one step per level, capped at 3 so the
		 *  slate transcript text keeps AA contrast; 0/absent behaves
		 *  like 1 when `subagent` is set (orphaned sub-agents degrade
		 *  to root depth but never lose the read-only tint). */
		depth?: number;
	} = $props();

	/** Depth-graded sub-agent tints: beige at depth 1, one step darker
	 *  per nesting level, darkest from depth 3 on (the cap). */
	const SUBAGENT_TINTS = [
		'bg-[var(--color-subagent-tint-1)]',
		'bg-[var(--color-subagent-tint-2)]',
		'bg-[var(--color-subagent-tint-3)]'
	] as const;
	const tint = $derived(
		subagent ? SUBAGENT_TINTS[Math.min(Math.max(depth, 1), 3) - 1] : ''
	);

	// ── Fold gate (ADR-0010, The Fold Gate, 2026-09-09) ─────────────────
	// conversation.collapsable folds each answered turn's intermediate
	// work behind one TurnProcessDisclosure row; progressiveFold lets an
	// in-flight turn fold too (A1/D5). Which turns are OPEN is per-panel,
	// session-only view state (D4) — a SvelteSet of turn keys, never
	// persisted. This component is the fold's only appConfig() reader.
	const conversationConfig = $derived(appConfig().conversation);
	const openTurns = new SvelteSet<string>();
	const toggleTurn = (key: string): void => {
		if (openTurns.has(key)) openTurns.delete(key);
		else openTurns.add(key);
	};
	/** In flight = the transcript's LAST group still moving: a streaming
	 *  message fragment or a pending tool call at its tail. Derived purely
	 *  from entries, re-evaluated on every streaming re-render. */
	const turnInFlight = (entries: TurnMember[], isLast: boolean): boolean =>
		isLast &&
		entries.some(
			(e) =>
				(e.kind === 'assistant-message' && (e.streaming || e.reasoningStreaming)) ||
			(e.kind === 'tool-call' && e.status === 'pending')
		);
	const foldOf = (entries: TurnMember[], isLast: boolean) =>
		conversationConfig.collapsable
			? turnProcess(entries, {
					inFlight: turnInFlight(entries, isLast),
					progressiveFold: conversationConfig.progressiveFold
				})
			: null;
	// ── Scroll-stick (shared primitive, 2026-08-26) ────────────────────
	// The inline block moved to utils/stick-to-bottom.svelte.ts — the
	// same semantics, now generic for ANY scrollable (the think popup
	// rides it too). The bindable `stick` prop bridges both ways:
	//   - scroll-driven flips arrive via onstickchange → the prop (the
	//     composer toggle reads it)
	//   - prop writes from the toggle mirror back in — setStick(true)
	//     JUMPS to the bottom, so the control never lies
	const stb = createStickToBottom({
		onstickchange: (next) => {
			stick = next;
		}
	});
	$effect(() => {
		if (!viewport) return;
		// jumpToBottom while stuck reproduces the old mount behavior:
		// a transcript that mounts with history already in view starts
		// at the live end. Content that arrives later follows via the
		// primitive's MutationObserver — the observer alone would miss
		// mount-time content, which mutates before attach.
		//
		// untrack is LOAD-BEARING: reading stb.stick reactively here
		// would re-run attach on every scroll-driven flip, and attach
		// RESETS the state to engaged — an infinite ping-pong with the
		// mirror effect below. The jump decision is a mount-time
		// snapshot, not a dependency.
		return stb.attachTo(viewport, { jumpToBottom: untrack(() => stb.stick) });
	});
	// Outside-in mirror: the composer toggle flips the PROP — apply it
	// to the behavior. Scroll-driven changes wrote the prop already, so
	// this effect no-ops for them (values agree).
	$effect(() => {
		if (stick !== stb.stick) stb.setStick(stick);
	});

	// ── Prepend anchoring (2026-08-24, auto load-older) ───────────────
	// An older page PREPENDS while the user reads history (stick=false):
	// the content above grows, so the same scrollTop now points into the
	// newly loaded page — without compensation the reading line jumps.
	// The pre-effect captures the geometry BEFORE the DOM grows; the
	// post-effect restores the visual position: scrollTop += Δheight.
	// stick=true is left to the stick-to-bottom effect above (short
	// transcripts filling page by page stay pinned to the latest). This
	// replaces the panel's old rAF anchor, which restored the RAW
	// scrollTop and fought both native anchoring and the stick effect.
	let preHeight = 0;
	let preTop = 0;
	let prevFirstId: string | undefined;
	$effect.pre(() => {
		void entries.length;
		if (!viewport) return;
		preHeight = viewport.scrollHeight;
		preTop = viewport.scrollTop;
	});
	$effect(() => {
		void entries.length;
		if (!viewport) return;
		const firstId = entries[0]?.id;
		const prepended =
			prevFirstId !== undefined && firstId !== undefined && firstId !== prevFirstId;
		if (prepended && !stick) {
			viewport.scrollTop = viewport.scrollHeight - preHeight + preTop;
		}
		prevFirstId = firstId;
	});
</script>

<main
	bind:this={viewport}
	class="flex-1 overflow-x-clip overflow-y-auto px-1 py-1 {tint}"
	data-testid="transcript"
>
	<div class="mx-auto flex max-w-3xl flex-col gap-3">
		<LoadOlderSentinel {hasMore} {loadingOlder} {olderError} onload={onloadolder} />
		{#if entries.length === 0}
			<p data-testid="transcript-empty" class="text-sm text-text-muted">
				{t(m.nothingRecorded)}
			</p>
		{/if}
		{#each groups as group, i (group.key)}
		<div data-group-key={group.key}>
			{#if group.kind === 'system-prompt'}
				<!-- Prompt-side placement (2026-09-01 operator call): the system
					prompt IS sent to the LLM, so it right-aligns with everything
					else that is — the same context-tone bubble the injections
					ride; the chip keeps its own identity inside it. -->
				<PromptBubble
					text={undefined}
					time={group.entry.time}
					tone="context"
					{sessionId}
				>
					<div class="flex flex-wrap items-center gap-x-0.5">
						<SystemPromptChip
							text={group.entry.text}
							open={openChipId === group.entry.id}
							ontoggle={() => ontogglechip(group.entry.id)}
						/>
					</div>
				</PromptBubble>
			{:else if group.kind === 'prompt' || group.kind === 'context'}
				<PromptBubble
					text={group.kind === 'prompt' ? group.entry.text : undefined}
					time={group.kind === 'prompt' ? group.entry.time : group.entries[0]?.time}
					tone={group.kind === 'prompt' ? 'prompt' : 'context'}
					imageRefs={group.kind === 'prompt' ? group.entry.imageRefs : undefined}
					{sessionId}
					{onFileLink}
				>
					{#if group.kind === 'prompt'}
						{#if group.context.length > 0}
							<div class="mt-1 flex flex-wrap items-center gap-x-0.5">
								{#each group.context as ctx (ctx.id)}
									<ContextInjection
										producer={ctx.meta}
										text={ctx.text}
										name={chipNameOf(ctx.meta, ctx.metaSource)}
										open={openChipId === ctx.id}
										ontoggle={() => ontogglechip(ctx.id)}
										onopen={subagentOpenOf(ctx.meta, ctx.metaSource)}
									/>
								{/each}
							</div>
							{#if group.context.some((ctx) => ctx.id === openChipId)}
								{@const ctx = group.context.find((c) => c.id === openChipId)!}
								<ChipPopup>
									<!-- Markdown prose, ToolCallDetail/FileContentViewer parity:
									     injections are markdown sources (AGENTS.md, skill catalog),
									     and the renderer is escape-first so wire noise stays text. -->
									<div data-testid="context-injection-body" class="p-2">
										<ContextSnapshotBody text={ctx.text} metaSource={ctx.metaSource} />
									</div>
								</ChipPopup>
							{/if}
						{/if}
					{:else}
						<div class="flex flex-wrap items-center gap-x-0.5">
							{#each group.entries as ctx (ctx.id)}
								<ContextInjection
									producer={ctx.meta}
									text={ctx.text}
									name={chipNameOf(ctx.meta, ctx.metaSource)}
									open={openChipId === ctx.id}
									ontoggle={() => ontogglechip(ctx.id)}
									onopen={subagentOpenOf(ctx.meta, ctx.metaSource)}
								/>
							{/each}
						</div>
						{#if group.entries.some((ctx) => ctx.id === openChipId)}
							{@const ctx = group.entries.find((c) => c.id === openChipId)!}
							<ChipPopup>
								<!-- Markdown prose, ToolCallDetail/FileContentViewer parity:
								     injections are markdown sources (AGENTS.md, skill catalog),
								     and the renderer is escape-first so wire noise stays text. -->
								<div data-testid="context-injection-body" class="p-2">
									<ContextSnapshotBody text={ctx.text} metaSource={ctx.metaSource} />
								</div>
							</ChipPopup>
						{/if}
					{/if}
				</PromptBubble>
			{:else}
				<!-- fork-here (The Fork-Here Button ADR, 2026-09-02): non-sub-agent
				     panels arm every assistant turn with the fork anchor — the
				     turn's first entry seq — so the click cuts at THAT turn's end.
				     Sub-agent transcripts stay read-only (no fork, no extended row). -->
				<AssistantTurn
					time={turnLastTime(group.entries)}
					start={turnStartTime(group.entries)}
					usage={turnUsage(group.entries)}
					text={turnText(group.entries)}
					lifecycle={lifecycleForGroup(
						projectTurnLifecycle(entries),
						group.entries[0].seq,
						group.entries[group.entries.length - 1].seq
					)}
					fork={subagent
						? null
						: { sessionId, atSeq: turnAnchorSeq(group.entries), title, agentPreset }}
				>
					<!-- Fold gate (ADR-0010): with collapsable on and the turn answered,
					     the work before the last text run folds behind one disclosure
					     row. The ROW STAYS FIRST — position never swaps — and the
					     reasoning pills render right below it while CLOSED (D6 —
					     thinking never hides); while OPEN, the fold body replays the
					     runs IN WIRE ORDER — reasoning pills at their original
					     positions between the tool calls, narration next to what it
					     narrates. Both flags off (the default) takes the original
					     flat path below, byte-for-byte. -->
					{@const fold = foldOf(group.entries, i === groups.length - 1)}
					<!-- ADR-0033: the session wiring every tool-run row shares, built
					     once per turn — rows state only what makes them different. -->
					{@const turnRun = {
						openChipId,
						peekOpenRunKey,
						allEntries: entries,
						ontogglechip,
						ontogglepeek,
						autoThinkId,
						autoPlanId,
						onFileOpen
					}}
					{#if fold?.folds}
						<TurnProcessDisclosure
								toolCallCount={fold.toolCallCount}
								messageCount={fold.messageCount}
								subagentCount={fold.subagentCount}
								open={openTurns.has(group.key)}
								ontoggle={() => toggleTurn(group.key)}
							/>
						{#if fold.escapedInjections.length > 0 && !openTurns.has(group.key)}
							<!-- ADR-0022 D7: what the model was TOLD never hides — the
							     injection strip sits ABOVE the escaped reasoning while
							     the row is closed (operator call, 2026-10-13: the chips
							     read as the turn's inputs, before the thinking) and
							     empties when it opens (the chips then replay at their
							     wire positions in the body). -->
							{@const escInjKey = 'esc-inj:' + group.key}
							<InlineToolRunRow run={turnRun} entries={fold.escapedInjections} runKey={escInjKey} peekIcon="context" />
						{/if}
						{#if fold.escapedReasoning.length > 0 && !openTurns.has(group.key)}
							{@const escKey = 'esc:' + group.key}
							<InlineToolRunRow run={turnRun} entries={fold.escapedReasoning} runKey={escKey} />
						{/if}
						{#if openTurns.has(group.key)}
							<!-- ADR-0022 I3 (operator call, 2026-10-13): the expanded
							     fold reads as TWO rows — the escape cluster (context
							     glyph, same count as closed) ABOVE the work replay.
							     Injections are filtered from the replayed runs, so
							     the cluster row is their ONLY expanded seat — never
							     a duplicate. -->
							{#if fold.escapedInjections.length > 0}
								{@const escInjOpenKey = 'esc-inj-open:' + group.key}
								<InlineToolRunRow run={turnRun} entries={fold.escapedInjections} runKey={escInjOpenKey} peekIcon="context" />
							{/if}
							{#each fold.folded as run (run.key)}
								{@const workEntries = run.kind === 'chips'
									? run.entries.filter((e) =>
											!(e.kind === 'user-message' && e.meta !== undefined) &&
											e.kind !== 'unknown-event')
									: []}
								{#if run.kind === 'text'}
									<MarkdownContent content={run.entry.text} hideToggle {onFileLink} />
								{:else if workEntries.length > 0}
									<InlineToolRunRow run={turnRun} entries={workEntries} runKey={run.key} />
								{/if}
							{/each}
						{/if}
						{#each fold.trailingTextRuns as run (run.key)}
							{#if run.kind === 'text'}
								<MarkdownContent content={run.entry.text} hideToggle {onFileLink} />
							{:else}
								<InlineToolRunRow run={turnRun} entries={run.entries} runKey={run.key} />
							{/if}
						{/each}
					{:else}
						{#each splitRuns(group.entries) as run (run.key)}
							{#if run.kind === 'text'}
								<!-- MarkdownContent lean path (2026-08-22): .md-content
								     skins lists/headings/code — a bare @html div left
								     assistant bullets flat under Tailwind preflight.
								     Streaming dots moved to Composer (OCI placement,
								     2026-08-24) — one indicator, in the input. -->
								<MarkdownContent content={run.entry.text} hideToggle {onFileLink} />
							{:else}
								<InlineToolRunRow run={turnRun} entries={run.entries} runKey={run.key} />
							{/if}
						{/each}
					{/if}
				</AssistantTurn>
			{/if}
		</div>
		{/each}

			{#if pendingCards.length > 0}
			<div class="flex flex-col gap-3" data-testid="answerer-pending">
				{#each pendingCards as answer (answer.rpcId)}
					{#if answer.kind === 'approval'}
						{@const body = answer.body as { approvalId?: unknown; toolName?: unknown; callId?: unknown; reason?: unknown }}
						<ApprovalCard
							rpcId={answer.rpcId}
							approvalId={typeof body.approvalId === 'string' ? body.approvalId : ''}
							toolName={typeof body.toolName === 'string' ? body.toolName : 'unknown tool'}
							callId={typeof body.callId === 'string' ? body.callId : undefined}
							reason={typeof body.reason === 'string' && body.reason.length > 0 ? body.reason : undefined}
							phase={answer.phase}
							outcome={answer.outcome}
							onanswer={(outcome) => onanswer(answer.rpcId, { approvalId: body.approvalId, outcome })}
						/>
					{:else if answer.kind === 'question'}
						{@const questions = parseQuestions(answer.body)}
						<QuestionCard
							rpcId={answer.rpcId}
							{questions}
							phase={answer.phase}
							outcome={answer.outcome}
							onanswer={(a) => onanswer(answer.rpcId, { sessionId, answer: a })}
						/>
					{/if}
				{/each}
			</div>
		{/if}
		{#if settledCards.length > 0}
			<div class="flex flex-col gap-2 opacity-70" data-testid="answerer-settled">
				{#each settledCards as answer (answer.rpcId)}
					{#if answer.kind === 'approval'}
						{@const body = answer.body as { approvalId?: unknown; toolName?: unknown }}
						<ApprovalCard
							rpcId={answer.rpcId}
							approvalId={typeof body.approvalId === 'string' ? body.approvalId : ''}
							toolName={typeof body.toolName === 'string' ? body.toolName : 'unknown tool'}
							phase={answer.phase}
							outcome={answer.outcome}
						/>
					{:else}
						{@const questions = parseQuestions(answer.body)}
						<QuestionCard rpcId={answer.rpcId} {questions} phase={answer.phase} outcome={answer.outcome} />
					{/if}
				{/each}
			</div>
		{/if}
	</div>
</main>
