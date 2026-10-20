<script lang="ts">
	/**
	 * InlineToolCalls — ONE chip row inside an AssistantTurn (extracted
	 * from the conversation page, 2026-08-23): the ToolPeekButton prefix,
	 * the chip-per-entry row (reasoning · tool call · result · unknown ·
	 * turn-error · absorbed context injection), the peek list popup, and
	 * the open chip's detail popup.
	 *
	 * Absorbed injections (The Turn Kept Whole, D2): a mid-turn notice
	 * the open turn took in (groupTurns D1) renders as a ContextInjection
	 * chip at its wire position in the row — never a separate bubble that
	 * splits the turn; consecutive notices club into this one row.
	 *
	 * Popup state stays PAGE-owned (openChipId / peekOpenRunKey) because
	 * prompt-side context chips share the same one-open-at-a-time
	 * contract — this component receives the derived booleans and fires
	 * the toggles upward. The paired tool-result lookup needs the whole
	 * render list (a call's result may live outside this run), so
	 * allEntries carries it in.
	 */
	import ToolPeekButton from '$lib/components/message/ToolPeekButton.svelte';
	import ReasoningSection from '$lib/components/message/ReasoningSection.svelte';
	import ToolCallChip from '$lib/components/message/chips/ToolCallChip.svelte';
	import ToolCallDetail from '$lib/components/message/ToolCallDetail.svelte';
	import TurnErrorChip from '$lib/components/message/chips/TurnErrorChip.svelte';
	import ChipPopup from './ChipPopup.svelte';
	import ContextInjection from '$lib/components/message/chips/ContextInjectionChip.svelte';
	import ContextSnapshotBody from '$lib/components/message/ContextSnapshotBody.svelte';
	import WorkflowRunCard from '$lib/components/message/cards/WorkflowRunCard.svelte';
	import QuestionCard from '$lib/components/card/QuestionCard.svelte';
	import GoalCard from '$lib/components/message/cards/GoalCard.svelte';
	import CodeCard from '$lib/components/message/cards/CodeCard.svelte';
	import TodoCard from '$lib/components/message/cards/TodoCard.svelte';
	import FilesEditedCard from '$lib/components/message/cards/FilesEditedCard.svelte';
	import MarkdownContent from '$lib/components/common/viewers/MarkdownContent.svelte';
	import ReasoningContentViewer from '$lib/components/common/viewers/ReasoningContentViewer.svelte';
	import type { TurnMember } from '$lib/utils/turn-grouping';
	import { chipNameOf, subagentOpenOf } from '$lib/utils/context-chip';
	import type { DsiEntry } from '$lib/types';
	import { extractArgsPreview } from '$lib/utils/tool-preview';
	import { classifyTool, TOOL_TITLE_MESSAGES } from '$lib/utils/tool-titles';
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	import { answersOutcome, parseAnswers, parseQuestions } from '$lib/utils/questions';
	import { isGoalTool } from '$lib/utils/goals';
	import { codeProgramPreview, isRunCodeTool } from '$lib/utils/code-programs';
	import { isTodoTool, todoListPreview } from '$lib/utils/todo-lists';
	import { createStickToBottom } from '$lib/utils/stick-to-bottom.svelte';

	/** JSON.parse that returns undefined on junk — the popup renders the
	 *  raw view when args are unparseable, never throws. */
	function safeJson(raw: string | undefined): unknown {
		if (raw === undefined) return undefined;
		try {
			return JSON.parse(raw);
		} catch {
			return undefined;
		}
	}

	let {
		entries,
		runKey,
		openChipId,
		peekOpen,
		allEntries,
		ontoggleChip,
		ontogglePeek,
		autoThinkId = null,
		autoPlanId = null,
		onFileOpen = undefined,
		peekIcon = 'wrench'
	}: {
		/** The run's entries, wire order (splitRuns chips branch) — chips
		 *  and the context injections the open turn absorbed. */
		entries: TurnMember[];
		/** The run's key — names this row's peek state. */
		runKey: string;
		/** Page-owned: the one MANUALLY open chip id across the transcript. */
		openChipId: string | null;
		/** Whether THIS run's peek list popup is open. */
		peekOpen: boolean;
		/** Full render list — paired tool-result lookup crosses run bounds. */
		allEntries: DsiEntry[];
		/** Page-owned chip toggle (id, or `r:${id}` for reasoning); the
		 *  second arg flags "this chip is auto-opened" so a collapse
		 *  suppresses the right auto slot (see ConversationPanel). */
		ontoggleChip: (id: string, autoOpen?: boolean) => void;
		/** Page-owned peek toggle for this run. */
		ontogglePeek: () => void;
		/** Auto-opened live think entry id (transient — streaming + stick
		 *  only, closes at turn end); null when idle or suppressed. */
		autoThinkId?: string | null;
		/** Auto-opened current-plan entry id (STICKY — survives newer
		 *  thinks and turn end until superseded or collapsed). */
		autoPlanId?: string | null;
		/** Page-owned file-open seat (ADR-0013 D5): the markdown cards'
		 *  click lands here — the transcript's file-link pipeline. */
		onFileOpen?: (path: string) => void;
		/** The peek badge's glyph (ADR-0022 I3): 'context' marks an
		 *  escape-strip row — attached context, not work. */
		peekIcon?: 'wrench' | 'context';
	} = $props();

	/** Effective open of ONE chip: the manual pick, or its auto slot. */
	function chipOpen(entry: TurnMember): boolean {
		if (entry.kind === 'assistant-message') {
			return openChipId === `r:${entry.id}` || autoThinkId === entry.id;
		}
		if (entry.kind === 'tool-call' && isTodoTool(entry.toolName)) {
			return openChipId === entry.id || autoPlanId === entry.id;
		}
		return openChipId === entry.id;
	}

	/** Peek-list args preview. run_code shows codeProgramPreview — the
	 *  description, else the first plan step (the 8 description-less
	 *  calls in session 1fe381df are schema-error retries whose code
	 *  head is escaped noise, ADR-0008); junk falls to the raw preview. */
	function peekPreview(entry: TurnMember): string {
		if (entry.kind !== 'tool-call') return '';
		if (isRunCodeTool(entry.toolName)) {
			return codeProgramPreview(entry.argsRaw) || extractArgsPreview(entry.toolName, entry.argsRaw);
		}
		if (isTodoTool(entry.toolName)) {
			return todoListPreview(entry.argsRaw) || extractArgsPreview(entry.toolName, entry.argsRaw);
		}
		return extractArgsPreview(entry.toolName, entry.argsRaw);
	}

	/** Args of the LATEST earlier todo_write call (ADR-0009 delta mode's
	 *  pairing: the previous snapshot in wire order, same transcript). */
	function prevTodoArgs(allEntries: DsiEntry[], seq: number): string | undefined {
		let latest: Extract<DsiEntry, { kind: 'tool-call' }> | undefined;
		for (const e of allEntries) {
			if (e.kind === 'tool-call' && isTodoTool(e.toolName) && e.seq < seq) {
				if (latest === undefined || e.seq > latest.seq) latest = e;
			}
		}
		return latest?.argsRaw;
	}

	/** Localized variant title for tool chips (BC-F variant table,
	 * catalog-sourced — the raw wire name never reaches a chip label). */
	function chipToolTitle(name: string): string {
		return t(TOOL_TITLE_MESSAGES[classifyTool(name)]);
	}

	/** Peek-list membership (2026-09-25 bug fix): every chip EXCEPT the
	 *  self-rendering kinds — a files-edited entry IS its own card
	 *  (FilesEditedCard), so counting it as a chip made the peek button
	 *  claim a tool call the row did not show. */
	function isPeekMember(entry: TurnMember): boolean {
		return entry.kind !== 'assistant-message' && entry.kind !== 'files-edited';
	}

	/** Peek-list row label (ToolPeekButton port): match the chip skins. */
	function peekLabel(entry: TurnMember): string {
		if (entry.kind === 'tool-call') return chipToolTitle(entry.toolName);
		if (entry.kind === 'tool-result') return `result · ${chipToolTitle(entry.toolName)}`;
		if (entry.kind === 'turn-error') return entry.code !== undefined ? `turn failed · ${entry.code}` : 'turn failed';
		if (entry.kind === 'unknown-event') return `event · ${entry.eventType}`;
		if (entry.kind === 'user-message') return chipNameOf(entry.meta, entry.metaSource) ?? entry.meta;
		return 'think'; // assistant-message reasoning chip
	}

	/** Peek-list status dot (ToolPeekButton port): OCI statusConfig parity. */
	function peekDotClass(entry: TurnMember): string {
		if (entry.kind === 'tool-call') {
			if (entry.status === 'pass') return 'bg-status-pass/100';
			if (entry.status === 'fail') return 'bg-status-fail';
			return 'bg-status-pending';
		}
		if (entry.kind === 'tool-result') return entry.ok === false ? 'bg-status-fail' : 'bg-status-pass/100';
		if (entry.kind === 'turn-error') return 'bg-status-fail';
		return 'bg-surface-border';
	}

	// ── Think popup stick-to-bottom (2026-08-26) ────────────────────────
	// The shared behavior (utils/stick-to-bottom) on the popup's scroll
	// box: a STREAMING reasoning body lands on the live tail when opened
	// and follows every delta while the reader sits at the bottom;
	// scrolling up releases (never yanked), returning re-engages. A
	// FINISHED think opens at the top — reading from the beginning —
	// and just behaves like any scroll box (nothing grows).
	const thinkStick = createStickToBottom({ thresholdPx: 24 });
	let thinkScroller = $state<HTMLElement | null>(null);
	/** The open reasoning entry's streaming flag — reactive so a
	 *  stream that STARTS while the popup is already open re-attaches
	 *  with the jump (lands on the tail mid-popover). Manual and
	 *  auto-opened thinks qualify alike. */
	const openReasoningStreaming = $derived.by(() => {
		const open = entries.find(
			(e) => e.kind === 'assistant-message' && (openChipId === `r:${e.id}` || autoThinkId === e.id)
		);
		return open?.kind === 'assistant-message' ? (open.reasoningStreaming ?? false) : false;
	});
	/** Every open chip of this run — the manual pick plus the auto slots
	 *  (think body / plan card) — each renders its own popup body. */
	const openEntries = $derived(entries.filter((e) => chipOpen(e)));
	$effect(() => {
		const el = thinkScroller;
		if (!el) return;
		return thinkStick.attachTo(el, { jumpToBottom: openReasoningStreaming });
	});
</script>

<div class="flex flex-wrap items-center">
	<!-- ToolPeekButton prefix (OCI port, 2026-08-22): peek-lists the
	     whole row before the chips — pick by reading, not hunting. -->
	{#if entries.some(isPeekMember)}
		{@const chipCount = entries.filter(isPeekMember).length}
		<ToolPeekButton count={chipCount} active={peekOpen} icon={peekIcon} onclick={ontogglePeek} />
	{/if}
	{#each entries as entry (entry.id)}
		{#if entry.kind === 'assistant-message' && entry.reasoning !== undefined && entry.reasoning !== ''}
			<ReasoningSection
				reasoning={entry.reasoning}
				streaming={entry.reasoningStreaming ?? false}
				open={chipOpen(entry)}
				ontoggle={() => ontoggleChip(`r:${entry.id}`, autoThinkId === entry.id)}
			/>
		{:else if entry.kind === 'tool-call' && isTodoTool(entry.toolName)}
			<ToolCallChip
				kind="call"
				toolName={chipToolTitle(entry.toolName)}
				status={entry.status}
				open={chipOpen(entry)}
				ontoggle={() => ontoggleChip(entry.id, autoPlanId === entry.id)}
			/>
		{:else if entry.kind === 'workflow-run'}
		{@const done = entry.agents.filter((a) => a.status !== 'running').length}
		<ToolCallChip
			kind="call"
			toolName={`workflow · ${entry.name} (${done}/${entry.agents.length})`}
			status={entry.status === 'running' ? 'pending' : entry.status === 'completed' ? 'pass' : 'fail'}
			open={chipOpen(entry)}
			ontoggle={() => ontoggleChip(entry.id)}
		/>
	{:else if entry.kind === 'tool-call'}
			<ToolCallChip
				kind="call"
				toolName={chipToolTitle(entry.toolName)}
				status={entry.status}
				open={chipOpen(entry)}
				ontoggle={() => ontoggleChip(entry.id)}
			/>
		{:else if entry.kind === 'tool-result'}
			<ToolCallChip
				kind="result"
				toolName={chipToolTitle(entry.toolName)}
				ok={entry.ok}
				open={openChipId === entry.id}
				ontoggle={() => ontoggleChip(entry.id)}
			/>
		{:else if entry.kind === 'files-edited'}
			<!-- Edited-Files Card (ADR 2026-09-25, D1): a turn-level
			     announcement, not a tool call — renders as its own card,
			     never a chip. sessionId rides session context. -->
			<FilesEditedCard turn={entry.turn} seq={entry.seq} {onFileOpen} />
		{:else if entry.kind === 'unknown-event'}
			<ToolCallChip
				kind="unknown"
				toolName={entry.eventType}
				open={openChipId === entry.id}
				ontoggle={() => ontoggleChip(entry.id)}
			/>
		{:else if entry.kind === 'user-message'}
			<!-- Absorbed context injection (The Turn Kept Whole, D2): the
			     same attributed chip the prompt/context bubbles draw, at
			     its wire position inside the turn's row. -->
			<ContextInjection
				producer={entry.meta}
				text={entry.text}
				name={chipNameOf(entry.meta, entry.metaSource)}
				open={openChipId === entry.id}
				ontoggle={() => ontoggleChip(entry.id)}
				onopen={subagentOpenOf(entry.meta, entry.metaSource)}
			/>
		{:else if entry.kind === 'turn-error'}
			<TurnErrorChip
				message={entry.message}
				code={entry.code}
				open={openChipId === entry.id}
				ontoggle={() => ontoggleChip(entry.id)}
			/>
		{/if}
	{/each}
</div>
{#if peekOpen}
	<!-- Peek list (ToolPeekButton port, 2026-08-22): every chip in the
	     row at a glance — status dot + name + args preview. -->
	<ChipPopup>
		<ul class="py-1" data-testid="tool-peek-list">
			{#each entries as entry (entry.id)}
				{#if isPeekMember(entry)}
					{@const preview = peekPreview(entry)}
					<li class="px-3 py-1 text-xs flex items-center gap-2">
						<span class="w-1.5 h-1.5 rounded-full shrink-0 {peekDotClass(entry)}"></span>
						<span class="font-mono font-medium text-text-primary shrink-0">{peekLabel(entry)}</span>
						{#if preview}
							<!-- min-w-0: the flex item must shrink below content width so
					     break-all can wrap — without it some engines clip the row
					     at the popup edge instead of wrapping. -->
					<span class="text-text-muted break-all min-w-0">{preview}</span>
						{/if}
					</li>
				{/if}
			{/each}
		</ul>
	</ChipPopup>
{/if}
{#each openEntries as openEntry (openEntry.id)}
	{@const tallCap = (openEntry.kind === 'tool-call' || openEntry.kind === 'tool-result')
		&& (isRunCodeTool(openEntry.toolName)
			|| (openEntry.kind === 'tool-call'
				? allEntries.some((e) => e.kind === 'tool-result' && e.callId === openEntry.callId && e.readView !== undefined)
				: openEntry.readView !== undefined))}
	{#if openEntry.kind === 'assistant-message'}
		<!-- The think body has its OWN popup so its scroll box can carry
		     the shared stick-to-bottom (see thinkStick above): the live
		     tail stays in view while reasoning streams. Default cap
		     (max-h-80) — reasoning never carries a read view. -->
		<ChipPopup bind:scroller={thinkScroller}>
			<ReasoningContentViewer content={openEntry.reasoning ?? ''} />
		</ChipPopup>
	{:else if openEntry.kind === 'workflow-run'}
		<!-- The orchestration card (2026-08-31): the run's members and
		     their live statuses — the entry folds the four lifecycle
		     events, so the card updates as members start and settle. -->
		<ChipPopup>
			<WorkflowRunCard entry={openEntry} />
		</ChipPopup>
	{:else if openEntry.kind === 'user-message'}
		<!-- Absorbed injection's body (The Turn Kept Whole, D2): verbatim
		     markdown, escape-first — the same popup shape the prompt/
		     context bubbles render (testid shared with e2e spec 21). -->
		<ChipPopup>
			<div class="p-2" data-testid="context-injection-body">
				<ContextSnapshotBody text={openEntry.text} metaSource={openEntry.metaSource} />
			</div>
		</ChipPopup>
	{:else}
		<ChipPopup maxHeight={tallCap ? 'max-h-[28rem]' : 'max-h-80'}>
			{#if openEntry.kind === 'tool-call'}
				{@const paired = allEntries.find(
					(e): e is Extract<DsiEntry, { kind: 'tool-result' }> =>
						e.kind === 'tool-result' && e.callId === openEntry.callId
				)}
				{#if openEntry.toolName === 'ask_user_question' && paired?.resultText !== undefined}
					<!-- QuestionBlock (OCI parity, 2026-08-24): an ANSWERED ask
					     renders as the designed question card — questions from
					     argsRaw, chosen answers checked — instead of raw JSON.
					     A pending ask keeps the raw view; the live answerer
					     card owns that state. -->
					{@const askQuestions = parseQuestions(safeJson(openEntry.argsRaw))}
					{@const askAnswers = parseAnswers(paired.resultText)}
					<div class="p-3" data-testid="ask-question-block">
						<QuestionCard
							rpcId={openEntry.id}
							questions={askQuestions}
							phase="settled"
							outcome={answersOutcome(askAnswers)}
							answers={askAnswers}
						/>
					</div>
				{:else if isGoalTool(openEntry.toolName)}
					<!-- GoalBlock (2026-08-26): the goal family renders as the
					     compact card — objective as prose ONCE (the result repeats
					     it verbatim), phase/activation badges, one meta line; the
					     verbatim wire stays one disclosure away inside the card. -->
					<GoalCard toolName={openEntry.toolName} argsRaw={openEntry.argsRaw} resultText={paired?.resultText} />
				{:else if isRunCodeTool(openEntry.toolName)}
					<!-- CodeBlock (ADR-0008, 2026-08-26): a run_code program renders
					     as a plan — description title, tool-plan strip, highlighted
					     code — never the escaped one-line JSON blob. Dispatch
					     sections (2026-09-05 ADR D1–D6) render each sub-call with
					     the renderer its tool name and file extension select. -->
					<CodeCard argsRaw={openEntry.argsRaw} resultText={paired?.resultText} dispatches={openEntry.dispatches} />
				{:else if isTodoTool(openEntry.toolName)}
					<!-- TodoBlock (ADR-0009, 2026-08-26): the whole-list snapshot
					     renders as a checkbox plan; delta accents come from the
					     PREVIOUS todo_write snapshot in the transcript. -->
					<TodoCard
						argsRaw={openEntry.argsRaw}
						prevArgsRaw={prevTodoArgs(allEntries, openEntry.seq)}
						resultText={paired?.resultText}
					/>
				{:else}
					<ToolCallDetail argsRaw={openEntry.argsRaw} resultText={paired?.resultText} summary={openEntry.summary} readView={paired?.readView} />
				{/if}
			{:else if openEntry.kind === 'tool-result'}
				{#if openEntry.toolName === 'ask_user_question' && openEntry.resultText !== undefined}
					<!-- Result side of the same QuestionBlock: args come from the
					     paired call entry (the result carries only the answers). -->
					{@const pairedCall = allEntries.find(
						(e): e is Extract<DsiEntry, { kind: 'tool-call' }> =>
							e.kind === 'tool-call' && e.callId === openEntry.callId
					)}
					{@const askQuestions = parseQuestions(safeJson(pairedCall?.argsRaw))}
					{@const askAnswers = parseAnswers(openEntry.resultText)}
					<div class="p-3" data-testid="ask-question-block">
						<QuestionCard
							rpcId={openEntry.id}
							questions={askQuestions}
							phase="settled"
							outcome={answersOutcome(askAnswers)}
							answers={askAnswers}
						/>
					</div>
				{:else if isGoalTool(openEntry.toolName)}
					<!-- Result side of the same GoalBlock: args come from the
					     paired call entry (verb action, asked objective). -->
					{@const pairedCall = allEntries.find(
						(e): e is Extract<DsiEntry, { kind: 'tool-call' }> =>
							e.kind === 'tool-call' && e.callId === openEntry.callId
					)}
					<GoalCard toolName={openEntry.toolName} argsRaw={pairedCall?.argsRaw} resultText={openEntry.resultText} />
				{:else if isRunCodeTool(openEntry.toolName)}
					<!-- Result side of the same CodeBlock: the program (title,
					     strip, code) comes from the paired call entry. -->
					{@const pairedCall = allEntries.find(
						(e): e is Extract<DsiEntry, { kind: 'tool-call' }> =>
							e.kind === 'tool-call' && e.callId === openEntry.callId
					)}
					<CodeCard argsRaw={pairedCall?.argsRaw} resultText={openEntry.resultText} dispatches={pairedCall?.dispatches} />
				{:else if isTodoTool(openEntry.toolName)}
					<!-- Result side of the same TodoBlock: the snapshot comes from
					     the paired call; the digest is this result's own text. -->
					{@const pairedCall = allEntries.find(
						(e): e is Extract<DsiEntry, { kind: 'tool-call' }> =>
							e.kind === 'tool-call' && e.callId === openEntry.callId
					)}
					<TodoCard
						argsRaw={pairedCall?.argsRaw}
						prevArgsRaw={pairedCall !== undefined ? prevTodoArgs(allEntries, pairedCall.seq) : undefined}
						resultText={openEntry.resultText}
					/>
				{:else}
					<ToolCallDetail resultText={openEntry.resultText} summary={openEntry.summary} readView={openEntry.readView} />
				{/if}
			{:else if openEntry.kind === 'unknown-event'}
				<!-- Forward-compat passthrough body (the 2026-09-18 empty-popup
				     fix): the verbatim payload as pretty JSON, escape-first
				     (BC-12 — text nodes only); an honest note when the wire
				     carried no payload at all. -->
				<div class="p-3 text-xs" data-testid="unknown-event-body">
					<p class="text-[10px] uppercase tracking-wide text-text-muted">
						{openEntry.eventType} · seq {openEntry.seq}
					</p>
					{#if openEntry.payload !== undefined}
						<pre class="mt-1 whitespace-pre-wrap break-words font-mono text-[11px] text-text-primary">{JSON.stringify(openEntry.payload, null, 2)}</pre>
					{:else}
						<p class="mt-1 text-text-secondary">{t(m.unknownEventNoPayload)}</p>
					{/if}
				</div>
			{:else if openEntry.kind === 'turn-error'}
				<div class="p-3 text-xs" data-testid="turn-error-body">
					<p class="whitespace-pre-wrap break-words font-mono text-status-fail">{openEntry.message}</p>
					{#if openEntry.code !== undefined}
						<p class="mt-1 text-[10px] uppercase tracking-wide text-text-muted">code: {openEntry.code}</p>
					{/if}
				</div>
			{/if}
		</ChipPopup>
	{/if}
{/each}
