<script lang="ts">
	import * as m from '$lib/paraglide/messages';
	import { t } from '$lib/services/locale/locale-state.svelte';
	/**
	 * ConversationPanel — one session's full conversation body (extracted
	 * from the conversation page, Panel Floor W2 task 2.1, ADR-0006):
	 * header wiring, chip-popup state, load-older paging, error banner,
	 * answerer cards, context-token derivation, scroll area + floating
	 * anchor, and the footer. Self-contained: the panel CREATES and OWNS
	 * its store + orchestrator (the page no longer holds them), so N
	 * panels can later coexist on the workspace floor (W3) with per-panel
	 * state by construction.
	 *
	 * Zero behavior change at extraction (W2 contract): every moved line
	 * keeps its semantics and every data-testid stays verbatim; the full
	 * e2e suite must pass unmodified.
	 *
	 * BC-2: components + services only — no $lib/server imports. BC-1:
	 * every byte flows through /api/dsh/* (load-older + answer carrier).
	 *
	 * Slash Menu (2026-08-30): the panel bridges the session's host
	 * catalog to the composer (slashCatalog/onslashopen) and routes both
	 * command surfaces — menu picks AND the submit-ladder rung after
	 * parseCommand declines — through executeHostCommand; notes ride the
	 * existing command banner. Catalog reads fire on first menu open,
	 * never at mount (cold sessions stay cold).
	 */
	import { onDestroy, onMount } from 'svelte';
	import { createConversationStore } from '$lib/services/conversation/store.svelte';
	import { createPollingOrchestrator } from '$lib/services/conversation/polling-orchestrator.svelte';
	import { invalidateSessionAttachmentUrls } from '$lib/services/conversation/attachment-urls.svelte';
	import ConversationError from '$lib/components/conversation/ConversationError.svelte';
	import StickToBottomToggle from '$lib/components/composer/sibling/StickToBottomToggle.svelte';
	import StreamingIndicator from '$lib/components/composer/sibling/StreamingIndicator.svelte';
	import ConversationFooter from '$lib/components/conversation/ConversationFooter.svelte';
	import ConversationHeader from '$lib/components/conversation/header/ConversationHeader.svelte';
	import ConversationScrollArea from '$lib/components/conversation/ConversationScrollArea.svelte';
	import ConversationFloatingAnchor from '$lib/components/conversation/ConversationFloatingAnchor.svelte';
	import A2aChipStack from '$lib/components/conversation/A2aChipStack.svelte';
	import ConversationStatsBar from '$lib/components/conversation/ConversationStatsBar.svelte';
	import { deriveSessionStats, statsFromLedger } from '$lib/services/conversation/session-stats';
	import { appConfig } from '$lib/services/config/app-config.svelte';
	import { setPanelMode } from '$lib/services/conversation/panel-context.svelte';
	import { setConversationSession } from '$lib/services/conversation/session-context.svelte';
	import { getCurrentModel } from '$lib/services/conversation/current-model';
	import { directoryFor, type SlashDirectory } from '$lib/services/chat/slash-directory.svelte';
	import { macroRunner, macroRunState } from '$lib/services/chat/macro-runner.svelte';
	import { SubmitLadder } from './submit-ladder.svelte';
	import { Popups } from './popups.svelte';
	import { Paging } from './paging.svelte';
	import MacroBar from '$lib/components/bar/macro-bar/MacroBar.svelte';
	import GoalBar from '$lib/components/bar/goal-bar/GoalBar.svelte';
	import type { DsiPermission } from '$lib/services/conversation/permission-state';
	import type { DshRawEvent } from '$lib/services/conversation/dsh-events';
	import { contextWindowOf } from '$lib/utils/context-window';
	import { groupTurns } from '$lib/utils/turn-grouping';
	import { GoalBarMachine } from './goal-bar.svelte';
	import type { DsiEntry, PendingAnswer, AnsweredSettlement, DsiA2aExchangeView } from '$lib/types';

	let {
		panelId = null,
		sessionId,
		title: initialTitleProp = null,
		workspace = null,
		workspaces = [],
		agent,
		agentDisplay = null,
		subagent = false,
		depth = 0,
		parentSessionId = null,
		entries,
		lastSeq,
		running,
		hasMore = undefined,
		pendingAnswers = [],
		settledAnswers = [],
		permission = null,
		imageLimits = undefined,
		knobEvents = undefined,
		deliverables = undefined,
		a2aRows = [],
		a2aTitles = {},
		onNeedCold = undefined,
		onClose = undefined,
		focusComposer = false,
		oncomposerfocus = undefined,
		focused = false,
		onOpenExplorer = undefined,
		onOpenBrowser = undefined,
		/** File Link Intent (ADR 2026-09-25 D1/D2): transcript file links become
		 *  explorer intents — the route supplies the gated handler. */
		onFileLink = undefined,
		/** Page-owned file-open seat for the markdown cards (ADR-0013 D5). */
		onFileOpen = undefined
	}: {
		/** Owning floor panel's id (the /new successor swap targets it; null
		 * outside a floor — /new then reports it cannot run here). */
		panelId?: string | null;
		/** The DSH session this panel renders (panel identity, W3 key). */
		sessionId: string;
		/** Cold-load title (tail-page projections); null = header falls back to the id. */
		title?: string | null;
		/** The session's workspace (cwd from session.list) — header chip; null = none. */
		workspace?: string | null;
		/** Host workspace registry (spine feed) — the header chip's
		 *  title-first label + ghost authority (ADR D5, 2026-09-07). */
		workspaces?: import('$lib/types').DsiWorkspaceSummary[];
		/** Agent preset id (wire identity — /new creates with it; null = none). */
		agent: string | null;
		/** Header chip display override — the host catalog's name for the
		 *  preset (DSH picker parity: `cordis` reads `Creator mode`); absent
		 *  or null falls back to the raw id. Never crosses the wire. */
		agentDisplay?: string | null;
		/** True for sub-agent sessions (lineage subagentIds): the host's
		 *  generic routing fences them — session.rename and session.prompt
		 *  reject `agent-busy` ("owned by subagent routing") — so the panel
		 *  renders READ-ONLY: plain title, no composer, beige transcript. */
		subagent?: boolean;
		/** Lineage depth (depthById; 0 = root session). Modulates the
		 *  sub-agent transcript tint only — every depth ≥ 1 is equally
		 *  read-only. */
		depth?: number;
		/** The fork source's session id (the spine row's parentSessionId) —
		 *  the header's parent button jump target; null = no button. */
		parentSessionId?: string | null;
		/** Cold-load entries (ledger tail). ABSENT on a runtime-added panel
		 * before its cold fetch (W3 3.1 dual fetch) — the empty store then
		 * fills when the owner remounts the panel with real cold props; an
		 * absent array also fires onNeedCold once at mount. */
		entries?: DsiEntry[];
		/** Cold-load ledger tail seq (buffer truth when present). */
		lastSeq: number;
		/** A turn was already running at cold load. */
		running: boolean;
		/** Ledger says older pages exist (load-older sentinel). */
		hasMore?: boolean;
		/** Pending/settled answers at cold load (a blocked turn was already
		 * waiting when the panel opened). */
		pendingAnswers?: PendingAnswer[];
		settledAnswers?: AnsweredSettlement[];
		/** Access-mode projections baseline at cold load (ADR-0007); null =
		 *  the host ships none and knob events alone decide. */
		permission?: DsiPermission | null;
		/** Host admission numbers from the cold load's imageLimits projection
		 *  (W4 task 4.2) — threaded to the composer's pre-flight; absent →
		 *  the service's DSH documented defaults (BC-A6). */
		imageLimits?: import('$lib/services/conversation/image-limits').DsiImageLimits;
		/** Raw knob events from the cold window (ADR-0007) — the store's
		 *  delta-application base (folded once at seed). */
		knobEvents?: DshRawEvent[];
		/** The cold load's presented-file inventory (ADR-0027f D1) — the
		 *  store's wholesale seed; absent (runtime panel pre-cold) keeps
		 *  the store's empty list until the resync path delivers one. */
		deliverables?: import('$lib/services/conversation/deliverables').PresentedDelivery[];
		/** This panel's delegation-ledger rows (W4 4.2) — the sender-side a2a
		 *  chip join, fed by the page's EXISTING spine-cadence poll of
		 * GET /api/a2a?from=<sessionId>. Read-only; the panel owns no fetch,
		 * no timer (BC-7: zero new client timers). Empty = no chips. */
		a2aRows?: DsiA2aExchangeView[];
		/** Live target titles keyed by sessionId (the spine rows the page
		 *  already holds) — the chips show target titles, not uuids. */
		a2aTitles?: Record<string, string | null>;
		/** Runtime-added panel hook (W3 3.1): fired ONCE at mount when the
		 * panel has no cold data yet — the floor owner then dual-fetches
		 * (events?full=1 + history) and remounts with real props. Never
		 * fires on the SSR seed path (entries always provided). */
		onNeedCold?: (sessionId: string) => void;
		/** Close affordance for the panel header (W3 PanelHeader); unused
		 * while the page embeds a single panel. */
		onClose?: () => void;
		/** The floor marked THIS panel's next mount for the composer focus
		 *  (the /new swap-focus, 2026-08-29): the fresh panel's textarea
		 *  takes the caret once. The route passes it one-shot — a plain
		 *  page load or restored desk never sets it. */
		focusComposer?: boolean;
		/** Fired once after the mount focus landed — the route clears its
		 *  one-shot marker on it. */
		oncomposerfocus?: () => void;
		/** This panel is the floor's focused panel (the route's
		 *  selectedPanelId) — the composer footer tints oldlace. */
		focused?: boolean;
		/** Workspace-chip click intent (Workspace Explorer W3 task 3.2,
		 *  ADR D4) — pass-through to the header's identity cluster. */
		onOpenExplorer?: (sessionId: string, workspace: string) => void;
		/** Browser-chip intent (The Glass Browser spec W2, ADR-0029 D4) —
		 *  the singleton browser panel's opener; absent = no chip (the
		 *  subagent read-only mount never receives it). */
		onOpenBrowser?: () => void;
		onFileLink?: (href: string) => void;
		/** Page-owned file-open seat for the markdown cards (ADR-0013 D5). */
		onFileOpen?: (path: string) => void;
	} = $props();

	// Embedded mode (OCI panel-context port, 2026-08-24 — the per-panel
	// FloatingAnchor fix): a ConversationPanel is ALWAYS a panel on the
	// conversation floor, so descendants (FloatingAnchor) anchor
	// absolutely to this component's `relative` root instead of piling
	// onto the viewport's right-middle when N panels coexist.
	setPanelMode(true);
	// Transcript descendants (FilesEditedCard) derive their fetch target
	// from this — the panel is the sessionId authority (2026-09-25).
	// Intentional initial capture: the page keys this panel by sessionId, so
	// a session change remounts rather than re-initializes.
	// svelte-ignore state_referenced_locally
	setConversationSession(sessionId);

	// Intentional initial capture: the store is bound to THIS session for
	// its lifetime; the conversation layout keys the page by sessionId
	// (and W3's PanelColumn keys the panel by sessionId), so a session
	// change remounts rather than re-initializes.
	// svelte-ignore state_referenced_locally
	const store = createConversationStore(sessionId);
	const orchestrator = createPollingOrchestrator(store);

	// Cold-load seed at init — SSR + first paint render the ledger transcript
	// (same intentional initial capture as above). An absent entries array
	// (runtime-added panel, pre-cold) seeds an empty store instead.
	// svelte-ignore state_referenced_locally
	if (entries !== undefined) store.replaceAll(entries);
	// svelte-ignore state_referenced_locally
	store.applyStatus(running, lastSeq);
	// POC-3 W2 (2.3): cold load may already carry pending answers — seed the
	// cards before the first poll. Intentional initial capture: the ledger's
	// pending snapshot at open.
	// svelte-ignore state_referenced_locally
	store.applyAnswers(pendingAnswers, settledAnswers);
	// ADR-0007 (2026-08-25): the access mode rides the cold load — the
	// projections baseline + the window's raw knob events seed the store
	// once (poll deltas accumulate from here). Intentional initial
	// capture: the cold window's permission facts are load-time constants.
	// svelte-ignore state_referenced_locally
	store.seedPermission(permission, knobEvents);
	// ADR-0027f D1: the cold inventory seeds once (wholesale replace).
	if (deliverables !== undefined) {
		// svelte-ignore state_referenced_locally
		store.seedDeliverables(deliverables);
	}

	/** Chip popup state (2026-08-22, OCI pattern): ONE open chip at a time —
	 * the id of the expanded entry; detail renders AFTER the chip row.
	 * Per-panel by construction (moved here with the block). */
	// ── Popup state (ADR-0022 R2 W2) — moved WHOLE into popups.svelte.ts
	// (ADR-0019): chip/peek mutual exclusion, the think/plan auto-open
	// slots + id-tied suppression, and the sticky plan adoption effect
	// ($effect.root + destroy(), proven-gates §1). The shell keeps the
	// wiring; stick is a LIVE getter. ────────────────────────────────────
	const popups = new Popups({ store, get stick() { return stick; } });

	/** OCI two-group render (2026-08-21): prompt / context / assistant-turn. */
	const groups = $derived(groupTurns(store.renderEntries));

	// ── Paging (ADR-0022 R2 W3) — moved WHOLE into paging.svelte.ts
	// (ADR-0019): hasOlder/loadingOlder/olderError/firstSeq, the in-flight
	// join, loadOlder, and the load-all drain. The shell keeps the wiring;
	// sessionId is a LIVE getter. ─────────────────────────────────────────
	// Intentional initial capture: hasMore is the COLD LOAD's sentinel; later
	// pages refresh it inside the module (same capture the inline code had).
	// svelte-ignore state_referenced_locally
	const paging = new Paging({ store, get sessionId() { return sessionId; } }, hasMore);

	/** Chat transcript viewport element (bound in markup). */
	let viewport = $state<HTMLElement | undefined>(undefined);
	/** Stick-to-bottom mirror (2026-08-26): bound to the scroll area's
	 *  scroll-stick flag, read by the composer toggle. A manual re-engage
	 *  also scrolls to the live end — the toggle's ON promise. */
	let stick = $state(true);

	/** Composer stick flip: OFF just releases; ON re-engages AND jumps
	 *  to the live end (OCI forceStick parity — promising follow without
	 *  going there would be a lying button). The far-edge up jump rides
	 *  the OFF arm first — BackToTheEdgeButton's onleavebottom reports
	 *  before its viewport move (2026-09-08). */
	function onStickToggle(next: boolean): void {
		stick = next;
		if (next && viewport) {
			viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
		}
	}

	// Prepend scroll anchoring moved INTO ConversationScrollArea
	// (2026-08-24, auto load-older): it must coordinate with the stick
	// effect that lives there — the old capture/restore here replayed a
	// RAW scrollTop after the DOM grew, pointing into the freshly
	// prepended page and fighting both native anchoring and stick.


	onMount(() => {
		// Runtime-added panel without cold data (W3 3.1): ask the floor owner
		// for the dual-fetch cold load. The SSR seed path always has entries,
		// so this never fires there.
		if (entries === undefined && onNeedCold) onNeedCold(sessionId);
		void orchestrator.start();
		// OCI percentage parity (2026-08-24): learn the session's model once
		// (cached per session) — the context window resolves from it.
		void getCurrentModel(sessionId).then((m) => {
			currentModel = m;
		});
		return () => {
			orchestrator.stop();
			popups.destroy();
			// BC-A9 (task 3.4): the panel that showed this session's images
			// owns their object URLs — closing it revokes them and bumps the
			// cache generation so in-flight reads never publish.
			invalidateSessionAttachmentUrls(sessionId);
		};
	});

	// ── Submit ladder (ADR-0022 R2 W1) — moved WHOLE into
	// submit-ladder.svelte.ts (ADR-0019): the onsubmit rungs (typed-run,
	// parseCommand intercept, host-command rung, sendPrompt receipt),
	// oncancel, the menu-pick twin, and the command banner. The shell keeps
	// the wiring; deps are LIVE accessors (proven-gates §4). ─────────────
	const ladder = new SubmitLadder({
		ctx: executorCtx,
		orchestrator,
		get slashCatalog() {
			return slashCatalog;
		},
		startMacro
	});

	// ── Goal bar (ADR-0022 R2 W4) — moved WHOLE into goal-bar.svelte.ts
	// (ADR-0019): the goals/* CAS machine (goalBusy, runGoalVerb with the
	// eager RemoteResult apply) and the panel-owned editor (open/edit/
	// diff-submit). noteCommand is INJECTED from W1's ladder, never
	// imported; sessionId is a LIVE getter. ──────────────────────────────
	const goal = new GoalBarMachine({
		store,
		get sessionId() {
			return sessionId;
		},
		noteCommand: (kind, text) => ladder.noteCommand(kind, text)
	});

	/** The executor context this panel's commands run under — live prop
	 *  values read at call time (the /new successor swap may change them
	 *  between one run's lines and the next). */
	function executorCtx() {
		return { sessionId, workspace, agent, panelId, entries: store.entries };
	}

	// ── Slash Menu wiring (Slash Menu ADR, 2026-08-30; task 2.3) ────────
	/** This panel's view of the session's host catalog — component state,
	 *  so menu state DIES with the panel (no cross-panel leakage; the
	 *  strip precedent). The cache itself is the module-level
	 *  slash-directory store; this holds only the reactive read. */
	let slashCatalog = $state<SlashDirectory | null>(null);

	/** The composer's re-query bridge (fires while the menu is open-shaped
	 *  and the query moved — never on mount, so a cold session is woken
	 *  only when the operator actually opens the menu, ADR §3.3). A plain
	 *  re-read: a no-op map lookup while the cache is ready; the
	 *  single-flight fetch kick on first open, after a failure, and on
	 *  the retry read. Write-only on purpose — reading the guarded state
	 *  here would put it inside the caller's effect and loop it. */
	function onslashopen(): void {
		slashCatalog = directoryFor(sessionId);
	}

	/**
	 * ADR-0007 R5 (fixed 2026-08-25) — submit one access-mode pick through
	 * the typed route onto the NATIVE commands/execute wire. Boolean result
	 * for the chip (it owns the optimistic label + the disabled-until-
	 * confirmed state; the poll's knob events are the confirmation).
	 */
	async function onpermission(preset: string): Promise<boolean> {
		try {
			const res = await fetch(`/api/dsh/session/${encodeURIComponent(sessionId)}/permission`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ line: `/permission ${preset}` })
			});
			const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
			return res.ok && body?.ok === true;
		} catch {
			return false;
		}
	}

	/** POC-3 W2 (task 2.3): answer a pending approval/question via the carrier.
	 * A failed delivery is never silent: the card returns to answerable
	 * (orchestrator released the lock) and the failure banner names why —
	 * the user's only alternative was clicking Answer into a void. */
	async function onanswer(rpcId: string, payload: Record<string, unknown>): Promise<void> {
		const result = await orchestrator.respond(rpcId, payload);
		if (!result.ok) {
			store.setError(
				`Answer not delivered — ${result.reason ?? 'unknown reason'}. The question stays answerable; try again.`
			);
		}
	}

	// ── POC-3 W3 (3.1): header inline rename ────────────────────────────────
	/** Title truth: cold-load projections seed, rename receipt updates. A
	 * failed rename reverts to this — the old title is the honest state.
	 * Intentional initial capture: the title seeds from the COLD LOAD and
	 * is then panel-owned (rename receipts update it); a later data swap
	 * must not clobber an in-flight edit. svelte-ignore state_referenced_locally */
	// svelte-ignore state_referenced_locally
	let title = $state(initialTitleProp);

	// ── Live title healing (2026-08-24 header bug): the sidebar row heals
	// its title from the 5s spine refresh, but the panel header kept the
	// ONE-SHOT cold value — a session the host names only AFTER the panel
	// opened (first-turn auto-title) showed the id prefix forever. The
	// `title` prop is now the spine-healed LIVE value; every external
	// change is adopted EXCEPT while a local rename awaits its host echo
	// (plain let on purpose: the guard must not re-run the effect).
	let unechoedRename: string | null = null;

	$effect(() => {
		const ext = initialTitleProp;
		if (unechoedRename !== null) {
			if (ext === unechoedRename) {
				unechoedRename = null; // host echoed — external truth again
				title = ext;
			}
			return; // host not caught up — keep the local rename on screen
		}
		title = ext;
	});

	/** Pending (non-terminal) answer views — the live cards above the input. */
	const pendingCards = $derived(
		store.answerList.filter((a) => a.phase === 'waiting' || a.phase === 'in-flight')
	);

	/** Explanatory terminal cards — the RARE endings that owe the user an
	 *  explanation for why the card stopped being answerable: a lost race
	 *  (answered elsewhere) or a cancelled turn (withdrawn). Our OWN
	 *  settled answer is NOT kept: the receipt, the agent's reply, and the
	 *  transcript chip's QuestionBlock are the record — the card unmounts
	 *  the moment its settlement lands (2026-08-24 fix: the dimmed copy
	 *  used to linger until a manual refresh, which is exactly what a
	 *  refresh shows anyway — nothing). Terminal records stay in the
	 *  store's map (anti-resurrection guard); only this render drops them. */
	const settledCards = $derived(
		store.answerList.filter(
			(a) => a.phase === 'answered-elsewhere' || a.phase === 'withdrawn'
		)
	);

	/** Attachment refusals render at the COMPOSER (2026-08-26): the
	 * drafts they rejected are still attached right there (BC-A3), so
	 * the answer belongs beside them — not one screen up in the
	 * transcript-top banner. One home per error: the top banner keeps
	 * everything else (agent-busy, transport). */
	const composerError = $derived(
		store.error !== null && store.error.code === 'attachment-error' ? store.error : null
	);
	const topError = $derived(
		store.error !== null && store.error.code !== 'attachment-error' ? store.error : null
	);

	/** Context consumption (2026-08-23): the LAST assistant usage record
	 * across the ledger — what the most recent model request consumed
	 * (uncached input + cache-read + cache-write = the full prompt seen).
	 * Wire truth via DsiTokenUsage; undefined until a turn finalizes. */
	const contextTokens = $derived.by(() => {
		for (let i = store.entries.length - 1; i >= 0; i--) {
			const e = store.entries[i];
			if (e.kind === 'assistant-message' && e.usage !== undefined) {
				return e.usage.inputTokens + (e.usage.cacheReadTokens ?? 0) + (e.usage.cacheWriteTokens ?? 0);
			}
		}
		return undefined;
	});

	/** Context window limit (OCI percentage parity, 2026-08-24): the DSH
	 * wire reports usage but NO window, so the limit resolves client-side
	 * from the session's current model id via the local catalog (+ user
	 * overrides in dsi-ctx-windows). Unknown model → undefined → the
	 * footer keeps its honest "≈Nk ctx" no-limit label. */
	let currentModel = $state<string | undefined>(undefined);
	const totalContextLimit = $derived(contextWindowOf(currentModel));

	/** Session baseline (ADR 2026-09-08 "The Stats Bar", D2): this
	 * panel's own pure fold over the ledger entries — turns, steps,
	 * tool time, token totals, cache hit. Null before the first
	 * assistant message (D5: an empty session renders no bar).
	 *
	 * conversation.statsBar 'full-ledger' (the default) replaces this
	 * with the host's whole-log ledger stats (sessionStats + tokenUsage
	 * projections) — the same totals DSH shows, counted over the entire
	 * log including cancelled/failed steps and billed cache input. When
	 * the host pair has not landed (or the mode is 'partial') the
	 * partial fold above stays the honest display. */
	const sessionStats = $derived(
		appConfig().conversation.statsBar === 'full-ledger' &&
		store.ledgerStats !== null &&
		store.ledgerStats.steps > 0
			? statsFromLedger(store.ledgerStats)
			: deriveSessionStats(store.entries)
	);

	// ── Prompt Macro wiring (ADR "The Prompt Macro", 2026-08-29; W2 2.2) ─
	// The runner is module-scope (survives the /new swap by design, D3);
	// THIS panel owns: the start context and the poll truth the sheet
	// reads (running/pendingAnswers — D7: the runner never polls). Chip
	// OWNERSHIP follows the run's target session (2026-08-29 addendum
	// remediation): the /new swap mints a fresh panel id and remounts
	// this component, so a panelId anchor would die mid-run — the runner
	// holds targetSessionId + the ✓/▶ baseline instead, and whichever
	// panel shows that session renders the sheet.

	/** The runner's reactive state — module scope; reading it inside a
	 *  $derived re-renders the sheet when the feeder advances. */
	const macroRun = $derived(macroRunState());

	/** Live assistant-turn group count of the panel's OWN store (the
	 *  transcript's existing prompt↔turn pairing — groupTurns). */
	const assistantTurnCount = $derived(groups.filter((g) => g.kind === 'assistant-turn').length);

	/** Panel-derived landed turns for the sheet: the live count above the
	 *  runner-held baseline of THIS panel's session (clamped at 0). After
	 *  a /new retarget the baseline is 0 against a fresh, empty store —
	 *  every turn that lands is one of the run's, exactly. */
	const macroLanded = $derived(
		macroRun.targetSessionId === sessionId
			? Math.max(0, assistantTurnCount - macroRun.baselineTurns)
			: 0
	);

	/** The sheet renders on the panel showing the run's TARGET session —
	 *  the birth-panelId anchor died at the /new swap (fresh id + remount);
	 *  the successor panel claims the run by session instead. */
	const macroOurs = $derived(macroRun.phase !== 'idle' && macroRun.targetSessionId === sessionId);

	/** Composer run-accept: start the accepted shelf row (`!` mode only —
	 *  find mode stays insert-only, task 2.1). */
	function onrunmacro(index: number): void {
		const row = stripRowsMirror[index];
		if (!row) return;
		startMacro(row, false);
	}

	/** Composer ⏯ Step: same start, HELD — the supervised path (D10). */
	function onstep(index: number): void {
		const row = stripRowsMirror[index];
		if (!row) return;
		startMacro(row, true);
	}

	/** Mirror of the composer's strip rows — refreshed via Composer's
	 *  onrows callback (props-only contract kept: the panel never reaches
	 *  into the component's internals). The accepted index resolves
	 *  against the rows the strip showed at accept time. */
	let stripRowsMirror: Array<{ text: string; id: number }> = [];

	/** Start (or refuse) a run in THIS panel's context; the ✓/▶ baseline
	 *  (this store's assistant-turn count) rides to the RUNNER at start —
	 *  runner-held, so the derivation survives the /new remount (GAP-1:
	 *  the panel's own store, option b). */
	function startMacro(row: { text: string; id: number }, held: boolean): void {
		const result = macroRunner.start(
			row,
			{ sessionId, workspace, agent, panelId, entries: store.entries },
			{ held, baselineTurns: assistantTurnCount }
		);
		// A refused start (live run / empty or over-cap row) returns a state
		// with a note — surface it on the panel's banner so the refusal is
		// VISIBLE (one-run-at-a-time + fail-loud, D6).
		if (result.phase === 'failed') {
			ladder.noteCommand('error', result.note ?? 'macro refused');
			return;
		}
		if (result.note !== null && result.note.includes('already running')) {
			ladder.noteCommand('error', result.note);
		}
	}
</script>

<svelte:head>
	<!-- i18n-skip: brand suffix, never translated -->
	<!-- Optional-chained (2026-09-18): probe-mounted floors render with NO
	     session yet — a bare sessionId.slice crashed the tree unhandled. -->
	<title>{(title ?? (sessionId ? sessionId.slice(0, 12) + '…' : 'deepseek-insight'))}</title>
</svelte:head>

<!-- overflow: auto (Panel Floor, W3): inside PanelColumn's COLUMN-flex
     .body the flex root would otherwise refuse to shrink below content
     (min-height: auto) and overflow: hidden clips the tail — a scroll
     container root bounds the height so the inner ConversationScrollArea
     owns the scrolling again. (The old page's row-flex h-dvh wrapper
     bounded it implicitly; the column embedding needs this.)
     `relative` (2026-08-24, OCI Floating Host discipline): the
     positioned ancestor for the embedded FloatingAnchor — the stack's
     absolute right-middle resolves against THIS panel's box, per panel. -->
<div class="relative flex min-w-0 flex-1 flex-col overflow-auto">
	<ConversationHeader
		{sessionId}
		{title}
		initialTitle={initialTitleProp}
		ontitlechange={(t) => {
			title = t;
			// Optimistic local rename (echo guard): the spine still carries
			// the old title for up to one tick — keep the local truth on
			// screen until the external prop echoes it back.
			unechoedRename = t;
		}}
		{workspace}
		{workspaces}
		access={store.permission?.current ?? null}
		agent={agentDisplay ?? agent}
		agentId={agent}
		isStreaming={store.isStreaming}
		transcript={viewport}
		{subagent}
		plan={store.planMode}
		{parentSessionId}
		{focused}
		{onOpenExplorer}
		{onOpenBrowser}
	/>

	<ConversationError error={topError} />

	<ConversationScrollArea
		bind:viewport
		bind:stick
		entries={store.entries}
		{groups}
		hasMore={paging.hasOlder}
		loadingOlder={paging.loadingOlder}
		olderError={paging.olderError}
		onloadolder={() => void paging.loadOlder()}
		openChipId={popups.openChipId}
		ontogglechip={(id, autoOpen) => popups.toggleChip(id, autoOpen)}
		autoThinkId={popups.autoThinkId}
		autoPlanId={popups.autoPlanId}
		peekOpenRunKey={popups.peekOpenRunKey}
		ontogglepeek={(runKey) => popups.togglePeek(runKey)}
		{pendingCards}
		{settledCards}
		onanswer={(rpcId, payload) => void onanswer(rpcId, payload)}
		onFileLink={onFileLink}
		onFileOpen={onFileOpen}
			sessionId={store.sessionId}
		{title}
		agentPreset={agent}
		{subagent}
		{depth}
	/>

	<ConversationFloatingAnchor
		{groups}
		container={viewport}
		todos={store.todos ?? null}
		deliverables={store.deliverables}
		onfileopen={onFileOpen}
		jobsessionid={sessionId}
		onloadall={() => paging.loadAllOlder()}
		onleavebottom={() => onStickToggle(false)}
		shelfentries={store.entries}
		shelfsessionid={sessionId}
		shelfworkspace={workspace}
		shelfpanelid={panelId}
		onshelfnote={(ok, note) => ladder.noteCommand(ok ? 'ok' : 'error', note)}
	/>

	<!-- W4 4.2: the sender panel's a2a delegation chips — read-only join of
	     its ledger rows (state VERBATIM, replied_approx hedged), on the
	     floating-anchor pattern beside the transcript. -->
	<A2aChipStack rows={a2aRows} titles={a2aTitles} />

	<!-- Slash-command feedback (2026-08-25, OCI banner pattern): the host's
	     own reply text for /permission; /new's failures. 5s auto-dismiss. -->
	{#if ladder.commandNote !== null}
		<div
			class="command-note"
			class:command-note-error={ladder.commandNote.kind === 'error'}
			data-testid="command-note"
			role="status"
		>
			{ladder.commandNote.text}
		</div>
	{/if}

	<!-- Attachment-refusal note (2026-08-26): directly ABOVE the composer —
	     the rejected drafts are still attached right below it (BC-A3). No
	     auto-dismiss: the note is the actionable state (remove the images or
	     switch model) and clears with the next submit attempt. -->
	{#if composerError !== null}
		<div class="command-note command-note-error composer-error" data-testid="composer-error" role="alert">
			<span>{composerError.message}</span>
			{#if composerError.reason === 'MODEL_DOES_NOT_SUPPORT_IMAGES'}
				<span class="composer-error-hint">
					{t(m.imagesKeptHint)}
				</span>
			{/if}
		</div>
	{/if}

	<!-- Session baseline (ADR "The Stats Bar", D4): the numbers line sits
	     OUTSIDE the sub-agent fence — above composer-area on agent panels,
	     the bottom in-flow row on sub-agent panels. The fence gates
	     prompting, not reading; the bar is read-only. -->
	<ConversationStatsBar stats={sessionStats} />

	<!-- Sub-agent fence (2026-08-27): the host's subagent routing owns the
	     child's turn pipe — session.prompt/updateQueue/cancel reject
	     `agent-busy` — so a sub-agent panel mounts NO composer at all;
	     the transcript above is the whole surface (read + approve there
	     still flows through the answerer cards when the host allows). -->
	{#if !subagent}
		<!-- Macro run sheet (Prompt Macro D7/D9, 2026-08-29): chip + sheet
	     directly above the composer — the command-note banner's spot. The
	     sheet renders only on the panel that started the run; poll truth
	     (store.running, pending cards) and the ✓/▶ derivation baseline are
	     THIS panel's own store — no spine fetch, no new plumbing. -->
		{#if macroOurs}
			<MacroBar
				run={macroRun}
				landedTurns={macroLanded}
				running={store.isStreaming}
				pendingAnswers={pendingCards.length}
				onfeednext={() => void macroRunner.feedNext()}
				onrunall={() => void macroRunner.runAll()}
				onabort={() => macroRunner.abort()}
				onrunagain={() => macroRunner.runAgain({ baselineTurns: assistantTurnCount })}
				onclose={() => macroRunner.dismiss()}
			/>
		{/if}
		<!-- Goal bar (ADR "The Goal Bar", 2026-09-08): chip + sheet in the
	     same composer dock, beside the macro sheet. The goal value is
	     THIS panel's store projection; actions ride the host's goals/*
	     Remotes with the CAS ref (paperwork stays silent). -->
		<GoalBar
			goal={store.goal}
			onpause={() => void goal.runGoalVerb('pause')}
			onresume={() => void goal.runGoalVerb('resume')}
			onclear={() => void goal.runGoalVerb('clear')}
			onedit={() => goal.openGoalEditor()}
			editor={goal.goalEditor}
			oneditinput={(field, value) => goal.editGoalField(field, value)}
			oneditsubmit={() => goal.submitGoalEditor()}
			oneditcancel={() => (goal.goalEditor = null)}
		/>
		<!-- Agent panels (2026-09): the stick toggle floats bottom-right
	     OVER the transcript's bottom edge, directly above the composer —
	     absolutely positioned so it costs the scroll viewport zero
	     height. Same stick state + panel handler. -->
		<div class="composer-area">
			{#if agent !== null}
				<div class="composer-stick" data-testid="composer-stick-toggle">
					<StickToBottomToggle {stick} ontoggle={onStickToggle} />
				</div>
			{/if}
			<ConversationFooter
				onsubmit={(text, images) => ladder.onsubmit(text, images)}
				oncancel={() => ladder.oncancel()}
			isStreaming={store.isStreaming}
			sending={ladder.submitted}
			{sessionId}
			{contextTokens}
			{totalContextLimit}
			permission={store.permission}
			{onpermission}
			imageLimits={store.imageLimits ?? imageLimits}
			onrunmacro={onrunmacro}
			onstep={onstep}
			onrows={(rows) => (stripRowsMirror = rows)}
			{slashCatalog}
			{onslashopen}
			onpickcommand={(line) => ladder.onpickcommand(line)}
			focusOnMount={focusComposer}
			onfocused={() => oncomposerfocus?.()}
				{focused}
		/>
		</div>
	{/if}

	<!-- Floating stick-to-bottom toggle (2026-09): sub-agent panels mount
	     no composer, so the toggle gets a floating bottom-right mount of
	     its own — same stick state + panel handler. Positioned against the
	     panel root (the scroll happens inside ConversationScrollArea's
	     viewport, so this does not scroll away). -->
	{#if subagent}
		<div class="floating-stick" data-testid="floating-stick-toggle">
			<StickToBottomToggle {stick} ontoggle={onStickToggle} />
			{#if store.isStreaming}
				<StreamingIndicator title={m.turnInFlight()} />
			{/if}
		</div>
	{/if}
</div>

<style>
	.command-note {
		margin: 0 0.5rem 0.25rem;
		padding: 0.25rem 0.5rem;
		border-radius: 6px;
		font-size: 0.75rem;
		background: rgba(16, 185, 129, 0.12);
		color: var(--color-success-ink);
	}
	.command-note-error {
		background: rgba(239, 68, 68, 0.12);
		color: var(--si-run);
	}
	.composer-error {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}
	.composer-error-hint {
		opacity: 0.85;
	}
	.composer-area {
		position: relative;
	}
	.composer-stick {
		position: absolute;
		right: 0.5rem;
		bottom: 100%;
		margin-bottom: -2rem;
		z-index: 20;
	}
	.floating-stick {
		position: absolute;
		right: 0.5rem;
		bottom: 1.75rem;
		z-index: 20;
		background: var(--color-surface, var(--color-surface-elevated));
		border-radius: 8px;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
		padding: 0.125rem;
	}
	/* Scoped StreamingIndicator nudge for this panel only (base values live
	   in StreamingIndicator.svelte: bottom 1rem, right 0.25rem; the Composer
	   host keeps its defaults). translateY(50%) stays inherited. */
	.floating-stick :global(.streaming-indicator) {
		bottom: calc(1rem - 2px);
		right: calc(0.25rem + 27px);
	}
</style>