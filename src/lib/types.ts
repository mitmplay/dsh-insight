/**
 * DSI domain types — shared by the server wire layer, the conversation
 * store, and the presentational components. Nothing here mentions HTTP or
 * WebSocket: those shapes belong to the server modules.
 */

/**
 * One renderable conversation entry (transcript line, chip, or fallback).
 * Wave-1 tool truth (PRD §3.4): every field traces to a wire field —
 * time ← event.time; argsRaw ← tool/call.data.arguments; status ← computed
 * from tool/result.isError via callId pairing; durationMs ← result.time −
 * call.time; resultText ← tool/result…content[0].content text.
 */
/** Wire: DSH read-result presentation view (view.card === 'read') —
 * the structured line window the harness projects for file reads.
 * Normalized from the ledger view member in dsh-events (BC-11: traces
 * to the wire's presentation meta, never args guessing). 2026-08-22. */
import type { ReloadFeedback } from '$lib/utils/skill-shelf-reload-machine';

export interface DsiReadLine {
	/** 1-based file line number. */
	number: number;
	/** The line's text. */
	text: string;
}

export interface DsiReadView {
	/** The read file's path (model-facing). */
	path: string;
	/** Syntax hint from the file extension (e.g. 'md', 'ts') — omitted when
	 * the extension maps to no known language. */
	lang?: string;
	/** 1-based first line of the window. */
	offset: number;
	/** Exact total line count in the file ("showing N of M"). */
	totalLines: number;
	/** The returned window's lines in file order. */
	lines: DsiReadLine[];
}

/** One PTC sub-call folded onto its parent run_code tool-call entry
 * (ADR D1/D2, 2026-09-05): the dispatch log's per-sub-call record —
 * harness-written ground truth, never model prose. */
export interface DsiCodeDispatch {
	/** Wire: subCallId — `<callId>:code:<n>`, submission order. */
	subCallId: string;
	/** Wire: the sub-called tool's registry name (read, bash, …). */
	name: string;
	/** Wire: dispatch arguments as raw JSON string, unmodified. */
	argsRaw?: string;
	/** False while only the -start event arrived (live placeholder). */
	settled: boolean;
	/** Wire: settled dispatch isError. */
	isError?: boolean;
	/** Wire: settled dispatch content — text parts joined. */
	contentText?: string;
}

/** Wire: TokenUsage on assistant/message (DSH llm types) — disjoint
 * counts: inputTokens is UNCACHED input only; cached input rides the
 * cacheRead/cacheWrite fields. Display truth (context consumption),
 * never billing. 2026-08-23. */
export interface DsiTokenUsage {
	inputTokens: number;
	outputTokens: number;
	/** Wire: provider-reported exact total (prompt + output, all attempts),
	 *  copied verbatim when present — never synthesized (The Exact Total,
	 *  ADR-0012 D1). Includes cached input the provider did not itemize. */
	totalTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	reasoningTokens?: number;
	/** Wire: message.source attribution (DSH turn-usage route parity);
	 *  present only when both parts are non-empty. */
	provider?: string;
	model?: string;
	/** Aggregated per-turn routes (turnUsage only): distinct provider/
	 *  model pairs in wire order — present only when EVERY summed record
	 *  carried attribution (DSH all-or-nothing). */
	routes?: { provider: string; model: string }[];
}

/** Durable image reference mirrored from the wire ImageBlock.attachment
 *  (sessions.schema.ts imageAttachmentRefSchema) — a POINTER, never pixels:
 *  the ledger stores refs; bytes are fetched session-authorized through the
 *  attachment proxy when rendered (Wave 3, BC-A5). */
export interface DsiImageRef {
	attachmentId: string;
	mediaType: string;
	bytes: number;
	width: number;
	height: number;
	name?: string;
}

/**
 * The events poll's `liveStream` value (0.1.3-alpha.1): the in-flight model
 * attempt's FULL accumulated text/reasoning, folded server-side from the
 * follow's seq-less assistant-stream frames. Null = nothing in flight. The
 * client REPLACES its streaming bubble with this value each poll — no
 * fragment algebra across polls, so reconnects and retries converge from
 * the served truth.
 */
export interface DsiLiveStreamTail {
	/** Streaming-bubble merge key (`a:turn:step` — the durable finalize's id). */
	id: string;
	turn: number;
	step: number;
	/** Merge/dedupe token: the attempt's startedAfterSeq — strictly below
	 *  every seq this attempt can settle at. */
	seq: number;
	/** Wire time of the latest folded fragment. */
	time: number;
	text: string;
	/** '' when the attempt has streamed no reasoning. */
	reasoning: string;
}

export type DsiEntry =
	| {
			kind: 'user-message';
			id: string;
			seq: number;
			/** Wire: event.time (ms epoch) — every entry is timestamped. */
			time: number;
			text: string;
			/** Wire: user/message with a fixture-pinned harness context-injection
			 * source marker (POC-3 W2 task 2.4 — the FAMILY: runtime-context
			 * plugin snapshot · agent-instructions · skill-catalog ·
			 * skill-invocation · compaction checkpoint · the OPEN fall-through:
			 * any other plugin-kind source ('plugin', named after the wire
			 * plugin), session-reference recall ('recall'), and any further
			 * non-'user' kind ('injected', named after the wire kind)) —
			 * renders as a collapsed attributed chip.
			 * Conservative: undefined = normal user bubble. The value is the
			 * PRODUCER id (chip attribution), never free text. */
			meta?:
				| 'runtime-context'
				| 'instructions'
				| 'skill-catalog'
				| 'skill-invocation'
				| 'user-approval'
				| 'compaction'
				| 'plugin'
				| 'recall'
				| 'injected';
			/** Wire: image blocks in this message's content, in order
			 *  (Wave 3 task 3.1). Undefined for text-only messages — the
			 *  render payload stays lean and text-only entries are
			 *  byte-identical to before. */
			imageRefs?: DsiImageRef[];
			/** Wire: the injection's source object (verbatim) — digest input for
			 * the chip (files changed / skills listed). Present only when meta is
			 * set. POC-3 W2 task 2.4. */
			metaSource?: Record<string, unknown>;
	  }
	| {
			kind: 'assistant-message';
			id: string;
			seq: number;
			/** Wire: event.time (ms epoch) of the latest merged fragment. */
			time: number;
			text: string;
			/** True while chunks are still merging into this bubble. */
			streaming: boolean;
			/** Wire (≤0.1.2): assistant/chunk reasoning-delta fragments, merged
			 * per step exactly like text; finalize replaces the streamed prefix
			 * with the final message's {type:'reasoning'} block (Wave 2, task
			 * 2.3). 0.1.3 ledger v2 streams live via the follow's liveStream
			 * tail instead of durable chunk events. */
			reasoning?: string;
			/** True while reasoning fragments are still merging (parallel to
			 * `streaming`, which tracks TEXT fragments). */
			reasoningStreaming?: boolean;
			/** Wire: assistant/message usage (TokenUsage) — present on the
			 * FINALIZED message when the adapter reported token accounting.
			 * The LAST one across entries is the session's current context
			 * consumption. 2026-08-23. */
			usage?: DsiTokenUsage;
	  }
	| {
			kind: 'tool-call';
			id: string;
			seq: number;
			/** Wire: event.time of the tool/call. */
			time: number;
			callId: string;
			toolName: string;
			summary?: string;
			/** Wire: tool/call.data.arguments — raw JSON string, unmodified. */
			argsRaw?: string;
			/** Computed lifecycle: born pending on tool/call; merge flips to
			 *  pass/fail when the paired tool/result arrives (callId). */
			status: 'pending' | 'pass' | 'fail';
			/** Computed at merge: PTC sub-dispatch list folded onto this call
			 * by parentCallId, subCallId-ordered (ADR D1/D2, 2026-09-05).
			 * Present only for run_code calls with at least one sub-call. */
			dispatches?: DsiCodeDispatch[];
	  }
	| {
			kind: 'tool-result';
			id: string;
			seq: number;
			/** Wire: event.time of the tool/result. */
			time: number;
			callId: string;
			toolName: string;
			ok: boolean;
			summary?: string;
			/** Computed at merge from the paired tool/call's time (result.time
			 *  − call.time, ms). Display metadata, never billing truth. */
			durationMs?: number;
			/** Wire: tool/result.data.message.content[0].content text (first
			 *  text part of the tool-result block). */
			resultText?: string;
			/** Wire: the harness presentation view on a read result (view.card ===
			 * 'read' — structured line window, path, lang). Present only when the
			 * harness provided it; renders as a typed file view (markdown/code)
			 * instead of a flat pre. 2026-08-22. */
			readView?: DsiReadView;
	  }
	| {
			kind: 'code-dispatch';
			id: string;
			seq: number;
			/** Wire: event.time of the dispatch (start or settled) event. */
			time: number;
			/** Wire: tool/ptc-dispatch(-start).parentCallId — the outer
			 * run_code call's callId; the fold key onto the tool-call entry.
			 * (Spelled tool/code-dispatch(-start) before DSH 0.1.5-alpha.1.) */
			parentCallId: string;
			/** Wire: tool/ptc-dispatch(-start).subCallId — `<callId>:ptc:<n>`
			 * (0.1.5-alpha.1; migrated V2 logs keep `<callId>:code:<n>`),
			 * submission order. */
			subCallId: string;
			/** Wire: the sub-called tool's registry name (read, bash, …). */
			name: string;
			/** Wire: dispatch arguments as raw JSON string, unmodified. */
			argsRaw?: string;
			/** False on -start, true on the settled dispatch event. */
			settled: boolean;
			/** Wire: settled dispatch isError. */
			isError?: boolean;
			/** Wire: settled dispatch content — text parts of the content
			 * array joined (the read result's N:-numbered projection text). */
			contentText?: string;
	  }
	| {
			kind: 'turn-error';
			id: string;
			seq: number;
			/** Wire: event.time of the turn/end that carried the error. */
			time: number;
			/** Wire: turn/end reason.error.code (e.g. MISSING_CREDENTIAL). */
			code?: string;
			/** Wire: turn/end reason.error.message, verbatim — the honest surface. */
			message: string;
	  }
	| {
			/** Turn End Stamp (ADR 2026-09-25, D1): a turn bracket marker —
			 *  pipeline-faithful but never rendered; turn-projection.ts folds
			 *  the markers into per-turn lifecycle records the footer reads. */
			kind: 'turn-lifecycle';
			/** `tl:<turn>:<phase>` — merge-stable per bracket event. */
			id: string;
			seq: number;
			/** Wire: event.time of the turn/start or turn/end. */
			time: number;
			/** Wire: data.turn — the harness's own turn number. */
			turn: number;
			phase: 'start' | 'end';
			/** Wire: turn/end reason.kind ('completed' | 'aborted' | 'error');
			 *  absent on phase 'start'. */
			reasonKind?: string;
			/** Wire: reason.reason.kind when reasonKind is 'aborted' (e.g. 'user'). */
			abortKind?: string;
	  }
	| {
			/** Edited-Files Card (ADR 2026-09-25, D1): a completed turn's
			 *  changed-files announcement. The wire payload is { turn } only —
			 *  the summary lives in Host memory and the card borrows it at
			 *  render time through the proxy route (D2); this entry is the
			 *  transcript's pointer, nothing more. */
			kind: 'files-edited';
			/** `fe:<turn>` — merge-stable per turn; a re-announce for the
			 *  same turn REPLACES at merge (D3, mirroring the Host's own
			 *  latest-wins rule). */
			id: string;
			seq: number;
			/** Wire: event.time of the workspace/changes event. */
			time: number;
			/** Wire: data.turn — the summarized turn. Non-numeric wire
			 *  payload folds as 0 with id `fe:unknown` (the honest pointer
			 *  degrades; never dropped). */
			turn: number;
	  }
	| {
			kind: 'workflow-run';
			/** `wf:<runId>` — ONE entry per orchestration run; the four
			 *  tool-workflow/* wire events (run/agent start+end) FOLD into it
			 *  at merge (dsh-events mergeWorkflowRun, 2026-08-31). */
			id: string;
			seq: number;
			/** Wire: event.time of the latest merged workflow event. */
			time: number;
			/** Wire: tool-workflow/run-start.data.runId (stable run identity). */
			runId: string;
			/** Wire: run-start.data.name — the run's display name. */
			name: string;
			/** Computed run lifecycle: born running on run-start; terminal on
			 *  run-end (stopReason mapped: completed → completed, error →
			 *  failed, cancelled → cancelled). */
			status: 'running' | 'completed' | 'failed' | 'cancelled';
			/** The run's members in start order (agent-start appends; agent-end
			 *  settles the matching member by its member seq). */
			agents: DsiWorkflowAgent[];
	  }
	| {
			kind: 'unknown-event';
			id: string;
			seq: number;
			/** Wire: event.time (ms epoch). */
			time: number;
			eventType: string;
			/** Wire: the event's verbatim data, when the wire carried one —
			 *  the honest-inspector payload the popup renders as JSON.
			 *  Absent when the wire event had no data at all. */
			payload?: unknown;
	  }
	| {
			kind: 'system-prompt';
			/** `sp:<seq>` of the request/header that carried it. */
			id: string;
			seq: number;
			/** Wire: event.time of the request/header. */
			time: number;
			/** Wire: request/header.data.header.system — the complete rendered
			 *  system prompt text (model-facing, real line breaks). The 2026-09-01
			 *  un-silencing: DSH's own Chat renders this as a collapsed
			 *  "System prompt" disclosure from the same log-only header event;
			 *  DSI dropped the whole type as SILENT bookkeeping until now.
			 *  Identical-text headers collapse at merge (the store's dedupe),
			 *  so the transcript shows one row and re-shows only on a real
			 *  prompt change. */
			text: string;
	  };

/** One workflow member (a spawned child Session) inside a workflow-run
 *  entry. `status` is born 'running' on agent-start and settles on
 *  agent-end (outcome mapped: completed → completed, failed → failed,
 *  cancelled → cancelled). startedAt/endedAt are the wire times of the
 *  paired start/end events — durationMs is display metadata. */
export interface DsiWorkflowAgent {
	/** Wire: agent-start.data.seq — the member sequence (pairs with agent-end). */
	seq: number;
	/** Wire: agent-start.data.label — the member's display label. */
	label: string;
	/** Wire: agent-start.data.childId — the spawned child Session id. */
	childId: string;
	/** Wire: agent-start.data.phase (optional script phase name). */
	phase?: string;
	status: 'running' | 'completed' | 'failed' | 'cancelled';
	/** Wire: agent-start event.time (ms epoch). */
	startedAt: number;
	/** Wire: agent-end event.time; undefined while running. */
	endedAt?: number;
}

/** Session-list card data (from session.list, normalized). */
/** agentPreset.list row (POC-2 W3) — picker-facing preset shape. */
export interface DsiPreset {
	id: string;
	name: string | null;
	description: string | null;
	isDefault: boolean;
}

export interface DsiSessionSummary {
	sessionId: string;
	title: string | null;
	agentPreset: string | null;
	running: boolean;
	blank: boolean;
	updatedAt: number;
	/** Session workspace — the host row's cwd (full path); null when absent. */
	workspace: string | null;
	/** Completed-turn count from the host row's `sessionStats.turns`
	 *  (2026-08-25 a2a watermark, Watcher ADR §2 — live-verified on the
	 *  session.list projection). Null when the host row lacks the field:
	 *  absent-tolerant, never a guess (degrade lane in the watcher). */
	turns: number | null;
	/** Spawner session id — the harness stamps every spawned session
	 *  (lineage sidebar, 2026-08-27). OPTIONAL so existing fixtures keep
	 *  compiling (svelte-check covers tests/**); runtime contract: the
	 *  server boundary normalizes absent → null. Consumers read
	 *  `row.parentSessionId ?? null`. */
	parentSessionId?: string | null;
	/** 'subagent' when the harness spawned this session; null/absent for
	 *  user-created ones (lineage sidebar, 2026-08-27). Same optional-and-
	 *  null-normalized contract as parentSessionId. 'browser' is a SYNTHETIC
	 *  client-side marker (2026-10-22): a folded glass's spine row — not a
	 *  wire session at all; its sessionId is the browser-session registry id,
	 *  and RowSessionItem routes the click to the summon verb, never to a
	 *  conversation open. */
	origin?: 'subagent' | 'browser' | null;
}

/**
 * One delegation-ledger exchange, BROWSER VIEW (W4 4.2) — the read-only
 * join surface GET /api/a2a?from= serves per sender panel. NOT the
 * server row: browser code never imports $lib/server (BC-2), so the wire
 * view mirrors the serializable subset of the ledger row it needs —
 * state vocabulary identical (A2aState, every state names its certainty).
 */
export interface DsiA2aExchangeView {
	/** The ledger id (a2a-<hex>) — the chip row key. */
	id: string;
	/** Sender session id — the page's per-panel join filters on it
	 *  (GET /api/a2a?from= pins one sender; the view still carries the
	 *  field so a shared window can be sliced client-side). */
	fromSession: string;
	/** Target session id — the chip click doorway (open/select its panel). */
	toSession: string;
	/** Sent message (ledger truth, verbatim). */
	message: string | null;
	/** One honest word per outcome: waiting | replied_exact | replied |
	 *  replied_approx | timeout | gone. Chip text derives VERBATIM. */
	state: 'waiting' | 'replied_exact' | 'replied' | 'replied_approx' | 'timeout' | 'gone';
	/** Send time (ms epoch) — the chip stack sorts newest-first. */
	sentAt: number;
	/** Settle time; null while waiting. */
	settledAt: number | null;
	/** Honest text for timeout/degrade lanes; null otherwise. */
	error: string | null;
}

/** Host workspace-registry row (workspace.list) — the AUTHORITY for the
 *  workspace dimension (2026-08-23 registry parity: DSH groups sessions
 *  by registry membership; sessions outside every workspace are
 *  Ungrouped and render no workspace cue in DSI). */
export interface DsiWorkspaceSummary {
	workspaceId: string;
	title: string;
	path: string;
	sessionIds: string[];
}

/** One directory row from host.listDirectory — a listing child or a
 *  breadcrumb ancestor (the browse capability's DirectoryEntry, verbatim). */
export interface DsiDirectoryEntry {
	name: string;
	path: string;
	hidden: boolean;
}

/** One browsed directory level (host.listDirectory → DirectoryListing). */
export interface DsiDirectoryListing {
	/** Absolute path of the listed directory. */
	path: string;
	/** The host account's home directory (breadcrumb "Home" rooting). */
	home: string;
	/** Ancestor chain from the filesystem root to the listed directory inclusive. */
	crumbs: DsiDirectoryEntry[];
	/** Direct child directories, name-sorted. */
	entries: DsiDirectoryEntry[];
	/** True when the host cut `entries` at its complete-result bound. */
	truncated: boolean;
}

/** Poll delta payload: GET /api/dsh/session/[sessionId]/events?since=N. */
export interface PollResponse {
	entries: DsiEntry[];
	lastSeq: number;
	running: boolean;
	/** POC-3 W1 — additive fields (forward-compat: POC-2 clients ignore them). */
	/** Answerable frames awaiting a human (registry snapshot, replace-by-rpcId client-side). */
	pendingAnswers?: PendingAnswer[];
	/** Recent settlements not yet acknowledged by the client (ring, delivered-then-pruned). */
	settledAnswers?: AnsweredSettlement[];
}

/**
 * POC-3 W1 — a pending approval/question as the POLL carries it (wire-body
 * verbatim; the client renders, never re-fetches). Control state, never a
 * ledger entry (BC-E).
 */
export interface PendingAnswer {
	rpcId: string;
	sessionId: string;
	kind: 'approval' | 'question';
	/** Wire payload verbatim: approval {approvalId, toolName, callId?, reason?} · question {questions:[…]}. */
	body: Record<string, unknown>;
	receivedAt: number;
}

/** A settlement outcome delivered once, then pruned from the ring. */
export interface AnsweredSettlement {
	rpcId: string;
	sessionId: string;
	kind: 'approval' | 'question';
	outcome: string;
	settledAt: number;
}

/**
 * The host's durable whole-log ledger stats (conversation.statsBar
 * 'full-ledger'), read from the sessionStats + tokenUsage projections
 * (packages/session/session-stats + token-meter wire views). These are the
 * same totals the DSH web stats bar shows — every closed step (including
 * cancelled/failed), billed input including cache, TTFT and decode
 * throughput — folded over the ENTIRE log, not the panel's visible window.
 */
export interface DsiLedgerStats {
	/** Distinct turns with at least one closed step. */
	turns: number;
	/** Closed steps (step/end lifecycle events, terminal outcomes included). */
	steps: number;
	/** Summed model wall time over message-assembling steps (ms). */
	llmMs: number;
	/** Summed matched tool call→result wall time (ms). */
	toolMs: number;
	/** Summed first-token latency over ttftSteps (ms). */
	ttftMs: number;
	/** Steps carrying a recorded first token. */
	ttftSteps: number;
	/** Summed decode wall time over usage-reporting steps (ms). */
	decodeMs: number;
	/** Summed provider output tokens over the same decode-timed steps. */
	decodeTokens: number;
	/** Billed input buckets (tokenUsage.totals): uncached prompt input. */
	uncachedInputTokens: number;
	/** Billed input buckets: cache reads. */
	cacheReadTokens: number;
	/** Billed input buckets: cache writes. */
	cacheWriteTokens: number;
	/** Provider-reported output tokens (tokenUsage.totals). */
	outputTokens: number;
}

/** POST /api/dsh/session/[sessionId]/respond receipt (BC-B: refused ≠ error). */
export interface RespondOutcome {
	ok: true;
	accepted: boolean;
	reason?: string;
}

// ── POC-3 W3 (3.2) — model directory (client-facing, mirrors SessionModels) ──

/** ModelSelection (sessions.ts): the complete selection for one session. */
export interface DsiModelSelection {
	provider: string;
	model: string;
	reasoningEffort?: string;
}

/** One provider group in the picker: the models it advertised successfully. */
export interface DsiModelGroup {
	id: string;
	name: string | null;
	models: Array<{ id: string; name: string | null; reasoningEfforts?: string[] }>;
}

/** The picker-facing directory (GET /models response body, normalized). */
export interface DsiModelDirectory {
	current: DsiModelSelection | null;
	routable: boolean;
	groups: DsiModelGroup[];
	failures: Array<{ id: string; name: string | null; message: string | null }>;
}

// ── Panel Floor (2026-08-24, ADR-0006) — workspace panel contracts ──

/**
 * One open panel on the conversation workspace floor. Persisted inside the
 * `dsi-panels` blob (panel-prefs.ts) and owned as `$state` by the workspace
 * route — imported-type discipline only (commitment 9, ADR-0005 svelte2tsx
 * inference trap): never re-declare this shape as a local union-of-objects.
 *
 * KIND UNION (2026-09-06, ADR The Manager in the Panel D6): a floor slot is
 * addressed by KIND, not by session. The conversation branch is the legacy
 * shape (a restored pre-D6 blob carries no kind and sanitizes to
 * 'conversation'); the prompt-manager branch hosts the prompts manager
 * content and deliberately has NO sessionId — session-keyed derivations
 * (lineage, cold ladder, spine joins) must narrow to the conversation
 * branch, which the type now enforces at compile time. The
 * settings-editor branch (The Settings Panel ADR, 2026-09-07, D3) hosts a
 * Monaco editor over one target document — no sessionId either; the
 * `target` discriminant selects the file the editor loads. The
 * injected-doc branch (The Loadinjected ADR, 2026-09-07, D2) hosts a
 * read-only viewer over one LOGGED injected document — a lineage CHILD of
 * its conversation at the row level; the pair (sourceSessionId,
 * displayPath) is both its identity and the dedupe key (D5).
 */
export type DsiPanelEntry =
	| DsiConversationPanel
	| DsiTerminalPanel
	| DsiBrowserPanel
	| DsiPromptManagerPanel
	| DsiSettingsPanel
	| DsiInjectedDocPanel
	| DsiSkillShelfPanel
	| DsiPluginRackPanel
	| DsiWorkspaceExplorerPanel
	| DsiWorkspaceFilePanel;

/** The skill-shelf branch (The Skill Shelf ADR, 2026-09-20, D1) — hosts
 *  SettingsSkillsPanel; no session, no preset chip, no cold/spine facts.
 *  The content talks to the DSI-local /api/skills routes itself. */
export interface DsiSkillShelfPanel {
	/** Stable panel identity — selection and close target this. */
	id: string;
	kind: 'skill-shelf';
	/** Panel width in px, always within panel-prefs clamp bounds. */
	width: number;
	/** Persisted chrome (hard-reload survival, the explorer-tab
	 *  pattern): the active pill tab. Junk sanitizes to 'install'. */
	tab?: 'install' | 'uninstall';
	/** Collapsed per-source groups (source ids); junk/absent ⇒ the
	 *  panel's ALL-COLLAPSED default refills it on first load. */
	collapsed?: string[];
	/** The toolbar search box text. */
	searchQ?: string;
	/** Live reload feedback (hard-reload survival — the Reload Rememberer
	 *  ADR D1): a 'loading' blob makes the restored panel re-issue the
	 *  reload; a 'done' blob lives out its remaining 5s window (doneAt =
	 *  ABSOLUTE expiry epoch ms, startedAt = run provenance). Absent = idle. */
	reload?: ReloadFeedback | null;
	/** Session-only refresh counter (BUG 2026-10-05): bumped by the floor
	 *  when /dsi-skills --reload dedupes onto THIS open shelf so the panel
	 *  re-fetches the rebuilt snapshot. Deliberately NOT persisted — the
	 *  sanitizer strips it; a hard reload remounts the panel anyway. */
	refresh?: number;
}

/** The plugin-rack branch (The Plugin Rack ADR, 2026-09-27, D1) — hosts
 *  PluginManagerPanel; no session, no preset chip, no cold/spine facts.
 *  The content talks to the DSI-local /api/plugins routes itself. */
export interface DsiPluginRackPanel {
	/** Stable panel identity - selection and close target this. */
	id: string;
	kind: 'plugin-rack';
	/** Panel width in px, always within panel-prefs clamp bounds. */
	width: number;
	/** Persisted chrome (the explorer-tab pattern): the active pill tab.
	 *  Junk sanitizes to 'install'. */
	tab?: 'install' | 'uninstall';
	/** Session-only refresh counter (BUG 2026-10-05, same contract as the
	 *  shelf's): bumped by the floor on /dsi-plugins --reload dedupe. */
	refresh?: number;
}

/** The conversation branch - renders one DSH session's transcript. */
export interface DsiConversationPanel {
	/** Stable panel identity — selection and close target this, not sessionId. */
	id: string;
	kind: 'conversation';
	/** The DSH session whose transcript the panel renders. */
	sessionId: string;
	/** Preset chip in the panel header; null when the row carries none. */
	agentPreset: string | null;
	/** Panel width in px, always within panel-prefs clamp bounds. */
	width: number;
}

/** The terminal branch (Web Terminal spec, 2026-09-24; ADR 2026-09-23) —
 *  hosts TerminalPanel; no session, no preset chip, no cold/spine facts.
 *  The content self-gates on terminal.enabled (its own /api/terminal probe). */
/** The terminal desk's persisted structure (Terminal Desk ADR D3,
 *  Wave 3): the tab/row grouping mirrored into the reload blob. A COPY,
 *  never the authority — the probe's live session list adjudicates on
 *  rebuild. Tokens never persist (a lease is re-minted by re-attach). */
export interface TerminalDeskMirror {
	tabs: Array<{ sessionIds: string[] }>;
	selectedTab: number;
	/** Job Follower Tab amendment (2026-10-21, supersedes the original D5):
	 *  remembered -J tabs survive reload — the rebuild re-opens each follow.
	 *  Absent on legacy mirrors. */
	jobs?: Array<{ owner: string; jobId: string }>;
}

export interface DsiTerminalPanel {
	/** Stable panel identity — selection and close target this. */
	id: string;
	kind: 'terminal';
	/** Panel width in px, always within panel-prefs clamp bounds. */
	width: number;
	/** The desk's structure mirror (Wave 3); absent on legacy entries and
	 *  when the desk has nothing to remember. */
	desk?: TerminalDeskMirror;
}

/** The browser branch (The Glass Browser spec, 2026-10-19; ADR-0029 D4) —
 *  hosts BrowserPanel: the CDP screencast glass over DSI's headed Chromium.
 *  Session-only: the registry session id is deliberately NOT persisted (a
 *  dead id after a server restart is junk; the sanitizer strips it and a
 *  remount opens a fresh session). Singleton via openBrowserPanel(). */
export interface DsiBrowserPanel {
	/** Stable panel identity — selection and close target this. */
	id: string;
	kind: 'browser';
	/** Panel width in px, always within panel-prefs clamp bounds. */
	width: number;
	/** The browser-session registry id (Wire 1); undefined = open on mount. */
	browserSessionId?: string;
	/** The session that opened this glass via its browser chip — recorded
	 *  ONCE at spawn, never rewritten by later clicks (ADR-0036 D1/D2).
	 *  undefined = opened without conversation context (ControlBar). */
	openedBy?: string;
}

/** The prompt-manager branch (ADR D6/D8) — hosts PromptManagerPanel; no
 *  session, no preset chip, no cold/spine facts. */
export interface DsiPromptManagerPanel {
	/** Stable panel identity — selection and close target this. */
	id: string;
	kind: 'prompt-manager';
	/** Panel width in px, always within panel-prefs clamp bounds. */
	width: number;
}

/** The settings-editor branch (The Settings Panel ADR, 2026-09-07, D3) —
 *  hosts SettingsEditorPanel over one target document; no session, no
 *  preset chip, no cold/spine facts. */
export interface DsiSettingsPanel {
	/** Stable panel identity — selection and close target this. */
	id: string;
	kind: 'settings-editor';
	/** Which settings document the editor loads ('dsi' | 'dsh'). */
	target: 'dsi' | 'dsh';
	/** Panel width in px, always within panel-prefs clamp bounds. */
	width: number;
}

/** The injected-doc branch (The Loadinjected ADR, 2026-09-07, D2) — hosts
 *  a read-only viewer over one LOGGED injected document; no preset chip,
 *  no cold/spine facts. The pair (sourceSessionId, displayPath) IS the
 *  dedupe key (D5): two conversations may hold the same file, and their
 *  panels are distinct records. */
export interface DsiInjectedDocPanel {
	/** Stable panel identity — selection and close target this. */
	id: string;
	kind: 'injected-doc';
	/** The conversation whose transcript carries the document. */
	sourceSessionId: string;
	/** The document's shelf name — the synthetic 'system-prompt.md' or the
	 *  injected file's path as the harness printed it (ADR D7). */
	displayPath: string;
	/** Panel width in px, always within panel-prefs clamp bounds. */
	width: number;
}

/**
 * The workspace-explorer branch (The Workspace Explorer ADR, 2026-09-10, D2;
 * re-keyed by The Shared Tree ADR, 2026-09-17, D1) — hosts a LIVE directory
 * tree over the workspace root, fetched level by level over the HTTP route
 * (BC-1: the browser never touches the DSH host directly). `root` is the
 * dedupe key (Shared Tree D1): ONE explorer per ROOT across ALL sessions —
 * a chip click on any session sharing the root focuses the existing panel.
 * `root` and `expanded` persist so a hard reload restores the tree's
 * open paths; the levels themselves re-fetch on expand (not persisted).
 */
export interface DsiWorkspaceExplorerPanel {
	/** Stable panel identity — selection and close target this. */
	id: string;
	kind: 'workspace-explorer';
	/** The session that OPENED the tree — provenance only (Shared Tree
	 *  ADR D4): kept so the persisted blob and restore path validate
	 *  unchanged; NOT the dedupe key (the `root` is, D1). */
	/** The session that OPENED the tree — provenance only (Shared Tree
	 *  ADR D4; The Settings Tree ADR 2026-09-18 D3): null for a SESSION-LESS
	 *  explorer (the settings-home panels minted by /dsi-settings and
	 *  /dsh-settings). Never the dedupe key (the `root` is, D1). */
	sessionId: string | null;
	/** Verbatim workspace root path — the dedupe key and the panel's
	 *  IDENTITY (Shared Tree ADR D1); also the copy control's clipboard
	 *  value. */
	root: string;
	/** The Settings Tree ADR 2026-09-18 D3: an optional display title —
	 *  the column header and sidebar row print it instead of the root's
	 *  basename. Absent means the basename rule stands. */
	title?: string;
	/** The Settings Tree ADR 2026-09-18 D2: the data plane for a
	 *  session-less explorer — 'dsi' | 'dsh' reads the DSI-local settings
	 *  home routes (/api/settings-home/*) instead of the DSH session-
	 *  scoped workspace routes. Absent means the session plane. */
	home?: 'dsi' | 'dsh';
	/** Root-relative directory paths currently expanded in the tree. */
	expanded: string[];
	/** Git Eye (2026-09-12 operator request): the active toolbar tab,
	 *  PERSISTED so a hard reload restores it. Absent/invalid ⇒ 'explorer'. */
	tab?: 'explorer' | 'changes';
	/** Git Eye (2026-09-13): the collapsed Changes-tab repo rel paths,
	 *  PERSISTED so a hard reload restores them. Absent/empty ⇒ all expanded. */
	collapsedRepos?: string[];
	/** Explorer Layout (amendment 2026-09-16): the OPEN file tabs'
	 *  root-relative paths, PERSISTED so a hard reload restores them —
	 *  same discipline as expanded/tab. Absent/empty ⇒ no tabs. They
	 *  still die with the PANEL (D5): no resurrection after close. */
	openTabs?: string[];
	/** The active file tab's root-relative path, persisted beside
	 *  openTabs. Absent or not in openTabs ⇒ the tree shows alone. */
	activeFile?: string | null;
	/** Panel width in px, always within panel-prefs clamp bounds. */
	width: number;
}

/**
 * The workspace-file branch (The Workspace Explorer ADR, 2026-09-10, D2) —
 * hosts a LIVE view over one real workspace file, fetched over the HTTP
 * route. The pair (sessionId, path) is both its identity and the dedupe
 * key (D5-analog): two sessions sharing a workspace hold distinct file
 * panels. Content re-fetches on mount — a dirty edit dies on reload BY
 * DESIGN, surfaced by a visible dirty indicator, never silently.
 */
export interface DsiWorkspaceFilePanel {
	/** Stable panel identity — selection and close target this. */
	id: string;
	kind: 'workspace-file';
	/** The DSH session the file's explorer belongs to — half the dedupe key. */
	sessionId: string;
	/** Root-relative file path — the other half of the dedupe key. */
	path: string;
	/** The explorer panel this file is a lineage CHILD of (the explorer's
	 *  panel id) — the stored edge behind the below-explorer placement and
	 *  the move-together unit (2026-09-10 lineage fix). Null for a legacy
	 *  blob entry restored before the edge existed; the edge re-mints on
	 *  the file's next tree click. */
	explorerPanelId: string | null;
	/** The File Eye (2026-09-13): diff vs edit view, PERSISTED per panel —
	 *  a hard reload restores it. Absent/invalid ⇒ 'edit'. */
	view?: 'edit' | 'diff';
	/** Panel width in px, always within panel-prefs clamp bounds. */
	width: number;
}

/**
 * Host command-catalog row, BROWSER VIEW (Slash Menu W1) — mirrors the
 * dsh-rpc wire row DshCommandRow (commands/list; live-pinned 2026-08-30,
 * 5 name-sorted rows on the app-dev preset). Browser code never imports
 * $lib/server (BC-2), so the view mirrors the serializable shape
 * verbatim; the catalog route serves rows as-is — this interface is the
 * client-side reading contract, never a second authority (ADR §4.2).
 */
export interface DsiCommandRow {
	/** Command token — what the ladder matches and the menu inserts after `/`. */
	name: string;
	/** One-line human description (menu row primary text). */
	description: string;
	/** Present when the command takes arguments; hint renders as the row's
	 *  secondary line, images marks image-accepting commands. */
	input?: { hint: string; images?: boolean };
}

/**
 * Host skill-catalog row, BROWSER VIEW (Slash Menu W1) — mirrors the
 * dsh-rpc wire row DshSkillRow (skills/list; live-pinned 2026-08-30,
 * 10 rows, whenToUse absent on every live row — optional). Same BC-2
 * mirror contract as DsiCommandRow; host order is kept verbatim.
 */
export interface DsiSkillRow {
	/** Skill name — the menu inserts `/name ` and the operator's Enter sends it. */
	name: string;
	/** One-line human description (menu row primary text). */
	description: string;
	/** Optional host guidance text (absent on every live row to date). */
	whenToUse?: string;
	/** False = operator-invocable only (still listed; host filters the catalog). */
	modelInvocable: boolean;
}

/**
 * One DSI client-gesture row (Slash Menu layer A, ADR §1.1) — the
 * composer gestures `command-parser` owns, surfaced in the menu beside
 * the host's two catalogs. Not a wire row: derived client-side from the
 * parser's own vocabulary (zero new names, ADR §4.2).
 */
export interface DsiGestureRow {
	/** Bare gesture name — the filter matcher's key ('new', '@mention'). */
	name: string;
	/** Verbatim display token — `/new` for slash gestures, `@mention` for
	 *  the mention; rendered as-is, never re-prefixed with `/`. */
	display: string;
	/** What a pick lands into the draft (the two-press seed) — the
	 *  operator's own Enter is press 2 through the existing ladder. */
	seed: string;
	/** One-line human description — the help card's summary, verbatim. */
	description: string;
}

// ── Jobs (ADR-0026 D2/D3) ────────────────────────────────────────────────
// Mirrored verbatim from the host's client-safe vocabulary
// (deepseek-harness packages/jobs/jobs/src/view.ts JobView and
// packages/api/job-controller/src/types.ts JobListFrame/JobKillValue,
// dsh-v0.2.1-alpha.4). DSI never invents settlement data: finishedAt
// arrives only when the registry itself reports it (ADR fact 10).

/** Job lifecycle: running, optionally stopping, then exactly one terminal status. */
export type DsiJobStatus = 'running' | 'stopping' | 'completed' | 'killed' | 'failed';

/**
 * Read-only projection of one job — the host registry's fresh object per
 * frame, never live registry state. Identity is (ownerSessionId, jobId);
 * owner is absent for an unowned job, which every session's roster lists
 * (ADR-0026 flowchart ANY/POP).
 */
export interface DsiJobView {
	/** The registry-issued id (kind-short-uuid). */
	id: string;
	/** Producer kind the job was registered with (open string — plugins merge kinds). */
	kind: string;
	/** The producer-supplied one-line label. */
	label: string;
	/** Owning session; absent for an unowned job. */
	owner?: string;
	/** Current lifecycle state. */
	status: DsiJobStatus;
	/** The producer's live progress line; cleared at settlement. */
	progress?: string;
	/** Terminal reason (exit code: 3); a recorded kill reason is merged in. */
	detail?: string;
	/** Epoch ms when the job was registered. */
	startedAt: number;
	/** Epoch ms when the job settled; absent while live — never synthesized. */
	finishedAt?: number;
	/** Output ring coordinates: total bytes written, oldest retained byte. */
	output: { total: number; earliest: number };
}

/**
 * One job.list frame: the COMPLETE set the session can see — its own jobs
 * plus every unowned job — after a lifecycle change. Whole-set replacement:
 * the store overwrites, never merges (host JobListFrame contract).
 */
export interface DsiJobListFrame {
	jobs: DsiJobView[];
}

/**
 * Job Follower Tab (ADR-0035): a job tab is a READ-ONLY view over one job's
 * output ring, relayed from the host's job.follow stream. Never a shell
 * lease — no token, no input, no mirror persistence (D5).
 */
export interface DsiJobFollowChunk {
	/** Plain decoded text of the chunk (the relay decodes bytes). */
	text: string;
}

/** One follower frame as the browser sees it (server relay → SSE). */
export type DsiJobFollowEvent =
	| { type: 'opened'; job: DsiJobView; from: number }
	| { type: 'output'; text: string; next: number; lossy?: true }
	| { type: 'status'; job: DsiJobView }
	| { type: 'error'; code?: string; message?: string };
/** Receipt after the registry accepted the human kill request. */
export interface DsiJobKillResult {
	outcome: 'requested' | 'already-finished';
}