/**
 * DSH stub host for Playwright e2e — the 0.1.2 wire stand-in (ADR "The
 * Drifted Stand-in", 2026-08-30; migrated from the 0.1.1 wire per
 * dev/gateways/dsh-gateway-0.1.2-wire.md). No live dsh web required.
 *
 * Wire surface (0.1.2 — every shape pinned by the gateway guide + the
 * live-probed builders in src/lib/server/dsh-rpc.ts DSH_METHODS/DSH_ARGS):
 *   GET  /?token=…               → 303 + Set-Cookie (the auth fence; 401 otherwise)
 *   POST /api/<ns>/<method>      → server-response envelope; payload {args:{…}}
 *                                  descriptor-exact (session/list … commands/execute)
 *   POST /api/$events/result     → waterfall answers {clientId, eventId, outcome}
 *   WS   /api/remote.mux         → ONE cookie-authenticated socket multiplexing
 *                                  logical streams: session/follow (snapshot +
 *                                  event items), workspace/follow, session/control,
 *                                  $events (ready/emit/waterfall/cancel/settle)
 *   events.mux / events.host / POST /api/respond are GONE (404).
 *
 * Deterministic scenario, one session:
 *   ledger tail   : user "Hello there" + assistant "Hi! How can I help?"
 *   prompt "Playwright test prompt" → turn goes running:true → assistant-stream
 *   frames (runTurn carries none — delivery is instant) → assistant/message
 *   finalize → running:false
 *
 * Fixture notes:
 *   - Ledger v2 (0.1.3-alpha.1): records are plain {type:'event'} rows and
 *     the turn's stream rides the follow's assistant-stream frames — the
 *     stub never packed chunkrow records, and the v2 wire removed them.
 *   - session/list rows carry the 0.1.2 shape: agentPreset / sessionStats
 *     / title live in projections.values (no top-level fields).
 *   - The /__e2e/state control surface and every fixture knob (promptCalls,
 *     permissionCalls, createCalls, respondCalls, historyPageSize,
 *     olderLedger/seq-15, sessionTurns, imageLimits, …) is preserved
 *     byte-for-byte — the wire rewrite lives beneath it (ADR, load-bearing
 *     fact 3). respondCalls now records $events/result answers (the respond
 *     carrier is gone); field name and shape {rpcId, payload} are unchanged.
 *
 * Browser pages must NEVER talk to this stub directly — the app under test is
 * DSI itself, with DSH_BASE_URL pointed at the stub (BC-1 proof by network
 * log: zero requests to :3080 anywhere).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';

/** The launch token the fence accepts — playwright.config sets DSI_AUTH_TOKEN
 *  to this so the app's DshAuth mints against the stub (Layer 1). */
export const STUB_LAUNCH_TOKEN = 'e2e-stub-launch-token';
/** The minted cookie pair (deterministic; the app echoes it verbatim). */
const STUB_COOKIE_PAIR = 'dsh-auth-e2e=v1.stub.stub';
const STUB_COOKIE_HEADER = `${STUB_COOKIE_PAIR}; Max-Age=2592000; Path=/; HttpOnly; SameSite=Strict`;
const AUTH_401_BODY = 'dsh web authentication required; reopen the URL printed by dsh web.';

export const STUB_SESSION_ID = 'e2e-stub-session-0001';
export const STUB_USER_HELLO = 'Hello there';

/** The 2026-09-01 system-prompt seed: the request/header epoch's rendered
 *  system field, logged at seq 99 — BEFORE the first user/message, the way
 *  the transcript presents it (DSH anchors the opening row above the first
 *  prompt even though the loop logs the header inside its step). */
export const STUB_SYSTEM_PROMPT = 'You are app-dev, an application development agent (stub host prompt).';

/** Workspace-picker fixture (2026-08-23): the blank session in the harness
 *  workspace that session.list always includes as a SECOND row. */
export const STUB_BLANK_SESSION_ID = 'e2e-blank-session-0002';
export const STUB_BLANK_CWD = '/Users/wharsojo/agentic-ai/deepseek-harness';

// ── Workspace Explorer W2 fixture — the stub's in-memory workspace fs ────────

/** The stub workspace root every entry resolves against (POSIX, deterministic). */
export const STUB_WS_ROOT = '/tmp/dsi-e2e-ws';
/** Page cap mirroring the host's maxLines default shape (never hit by specs). */
export const STUB_WS_MAX_LINES = 5000;

/** README the specs open for the md preview/edit tabs. */
export const STUB_WS_README = [
	'# Stub Workspace',
	'',
	'Fixture text for the workspace explorer e2e.',
	''
].join('\n');
/** A non-md file for the edit-only branch. */
export const STUB_WS_NOTES =
	'plain fixture line 1' +
	String.fromCharCode(10) +
	'plain fixture line 2' +
	String.fromCharCode(10);

interface StubWsEntry {
	kind: 'file' | 'dir';
	text: string;
}

/** One workspaceFiles/list row (the host's WorkspaceDirectoryEntry). */
interface StubListRow {
	name: string;
	type: 'file' | 'directory' | 'other';
}

/** Directory levels the list case serves — root '' plus each expandable level. */
const STUB_WS_LEVELS = new Map<string, StubListRow[]>([
	['', [
		{ name: 'README.md', type: 'file' },
		{ name: 'notes', type: 'directory' }
	]],
	['notes', [
		{ name: 'plain.txt', type: 'file' }
	]]
]);

/** The fixture tree: relative path → entry. Directories exist only to refuse reads. */
const STUB_WS_FS: Record<string, StubWsEntry> = {
	'README.md': { kind: 'file', text: STUB_WS_README },
	'notes/plain.txt': { kind: 'file', text: STUB_WS_NOTES },
	notes: { kind: 'dir', text: '' }
};

/**
 * Resolve one workspace-relative path against the fixture. Rejects escapes
 * (../ climbing out of the root) with the host's outside-workspace refusal
 * semantics: null here means the caller throws not-found/outside-workspace.
 */
function stubWorkspaceEntry(relative: string): StubWsEntry | null {
	if (relative.includes('..')) return null; // outside-workspace analog
	return STUB_WS_FS[relative] ?? null;
}

/** W4 spec 08: the tool/call+tool/result pair pinned in the stub tail. */
export const STUB_TOOL_CALL_ID = 'call_stub_0001';

// ── a2a ledger fixture (2026-08-25 Wave 5 task 5.1) ──────────────────────────
// The mention grammar is uuid-strict (command-parser MENTION_RE), so the
// delegation TARGET must be a uuid-shaped session id. The turns watermark
// and flip hook below: target rows list completed-turn counts, the flip
// plants a NEW completed turn whose assistant/message text is the scripted
// reply (whatever tier the test wants the LEDGER lane to classify).

/** Seeded completed-turn count on a2a targets (the send-time watermark). */
export const STUB_A2A_TARGET_TURNS = 3;
/** A target's seeded OLD assistant text (on its ledger before delegation). */
export const STUB_A2A_TARGET_SEED_REPLY = 'Seeded target reply from before the delegation.';
export const STUB_TOOL_NAME = 'grep';
export const STUB_TOOL_ARGS = '{"pattern":"glm-5","path":"/tmp/dsh"}';
export const STUB_TOOL_RESULT_TEXT = 'No matches found';
/** Wire times 481ms apart → ToolCallChip duration label "481ms". */
export const STUB_TOOL_CALL_TIME = 1787212572959;
export const STUB_TOOL_RESULT_TIME = 1787212573440;

/** W4 spec 10: reasoning fragments + finalize text for the push scenario. */
export const STUB_REASONING_1 = 'The user wants files listed. ';
export const STUB_REASONING_2 = 'Use the ls tool.';
export const STUB_REASONING_FINAL = STUB_REASONING_1 + STUB_REASONING_2;
export const STUB_TEXT_1 = 'Listing **files** for you. ';
export const STUB_TEXT_2 = 'Done.';
export const STUB_TEXT_FINAL = 'Listing **files** for you. Done.';

/** W4 spec 13: text on the user bubble living ONLY on the older ledger page. */
export const STUB_OLDER_USER_TEXT = 'Early turn — older ledger page';
/** Shift-drain spec (2026-08-26): the seq-15 user row — page 1's visible
 *  content at historyPageSize 10 (see the olderLedger loop). */
export const STUB_OLDER_PAGE1_TEXT = 'Page one — mid ledger turn';

/** W4 spec 14: presets the host lists (research is default). */
export const STUB_PRESETS = [
	{ id: 'research', name: 'Research', description: 'Search + read agent', trust: 'trusted', isDefault: true },
	{ id: 'main', name: 'Main', description: 'General purpose', trust: 'trusted', isDefault: false }
];
/** session.create with a preset the host does NOT list → this error. */
export const STUB_UNKNOWN_PRESET = 'no-such-preset';

/** W2 attachments: base64 length above which the stub host refuses an
 *  image (image-too-large admission) — sized so a normal 1×1 PNG passes
 *  and a padded multi-KB buffer fails, deterministically. */
export const STUB_MAX_IMAGE_B64 = 10_000;

// ── W3 attachments (task 3.5): the durable read path ────────────────────────
/** 1×1 transparent PNG served by session.attachment (real decodable bytes). */
export const STUB_ATTACHMENT_PNG_B64 =
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
/** Seeded tail attachment — admitted, stored, served. */
export const STUB_ATTACHMENT_ID = 'sha256:stub-image-0001';
/** Seeded tail row referencing THIS id never gets stored — the honest 404. */
export const STUB_ATTACHMENT_MISSING_ID = 'sha256:stub-missing-0002';

// ── Add-workspace folder picker (2026-08-24): the browse tree ──────────────
// A small static filesystem the directoryPicker/list stub serves — home is
// /Users/wharsojo, whose children mirror the fixture workspace paths so the
// e2e browse walk lands on a known adoptable folder.

export const STUB_HOME = '/Users/wharsojo';
/** The folder spec 09 walks to and adopts. */
export const STUB_ADOPT_DIR = '/Users/wharsojo/agentic-ai/openclaw-insight';

type StubEntry = { name: string; path: string; hidden: boolean };

function dir(name: string, path: string, hidden = false): StubEntry {
	return { name, path, hidden };
}

/** level(path) → sorted child rows (crumbs are derived in the case). */
const STUB_DIRECTORY_CHILDREN = new Map<string, StubEntry[]>([
	[STUB_HOME, [dir('agentic-ai', `${STUB_HOME}/agentic-ai`), dir('Desktop', `${STUB_HOME}/Desktop`), dir('Documents', `${STUB_HOME}/Documents`)]],
	[
		`${STUB_HOME}/agentic-ai`,
		[
			dir('ai-proxy', `${STUB_HOME}/agentic-ai/ai-proxy`),
			dir('deepseek-chat', `${STUB_HOME}/agentic-ai/deepseek-chat`),
			dir('deepseek-harness', `${STUB_HOME}/agentic-ai/deepseek-harness`),
			dir('deepseek-insight', `${STUB_HOME}/agentic-ai/deepseek-insight`),
			dir('openclaw-insight', STUB_ADOPT_DIR),
			dir('.config', `${STUB_HOME}/agentic-ai/.config`, true)
		]
	],
	[STUB_ADOPT_DIR, []],
	// Workspace Explorer W3 (2026-09-09): the session cwd (/tmp) subtree —
	// the explorer walks THIS tree one level per expand. README.md /
	// guide.md are file rows (dot names → open intent); docs/src expand.
	[
		'/tmp',
		[dir('dsi-e2e-ws', '/tmp/dsi-e2e-ws'), dir('scratch', '/tmp/scratch')]
	],
	[
		'/tmp/dsi-e2e-ws',
		[
			dir('docs', '/tmp/dsi-e2e-ws/docs'),
			dir('src', '/tmp/dsi-e2e-ws/src'),
			{ name: 'README.md', path: '/tmp/dsi-e2e-ws/README.md', hidden: false }
		]
	],
	[
		'/tmp/dsi-e2e-ws/docs',
		[{ name: 'guide.md', path: '/tmp/dsi-e2e-ws/docs/guide.md', hidden: false }]
	],
	['/tmp/dsi-e2e-ws/src', []],
	['/tmp/scratch', []]
]);

/** Ancestor chain from / to the target inclusive (browse-capability rule). */
function stubCrumbs(target: string): StubEntry[] {
	const crumbs: StubEntry[] = [{ name: '/', path: '/', hidden: false }];
	if (target === '/') return crumbs;
	let current = target;
	const chain: Array<{ name: string; path: string }> = [];
	for (;;) {
		const parent = current.slice(0, current.lastIndexOf('/')) || '/';
		chain.unshift({ name: current.slice(current.lastIndexOf('/') + 1), path: current });
		if (parent === current) break;
		current = parent;
	}
	return [...crumbs, ...chain.map((c) => dir(c.name, c.path))];
}

/** The served listings: DirectoryListing per path (entries name-sorted). */
const STUB_DIRECTORY_TREE = new Map(
	[...STUB_DIRECTORY_CHILDREN.entries()].map(([path, children]) => [
		path,
		{
			path,
			home: STUB_HOME,
			crumbs: stubCrumbs(path),
			entries: [...children].sort((a, b) => a.name.localeCompare(b.name)),
			truncated: false
		}
	])
);

// ── POC-3 W4 (task 4.1): the answerer fixtures (source-pinned shapes) ──────

/** spec 16/17: the approval the stub raises (verbatim card contract). */
export const STUB_APPROVAL_RPC = 'stub-approval-rpc-1';
export const STUB_APPROVAL_ID = 'appr-0001';
export const STUB_APPROVAL_TOOL = 'bash';
export const STUB_APPROVAL_REASON = 'Running `rm -rf /tmp/dsh-scratch` — this is a destructive shell command.';

/** spec 18: the ask() batch the stub raises (one ask, two questions). */
export const STUB_QUESTION_RPC = 'stub-question-rpc-1';
export const STUB_QUESTIONS = [
	{
		id: 'q1',
		question: 'Which scope should the report cover?',
		header: 'Scope',
		detail: 'Affects how deep the search goes.',
		options: [
			{ label: 'Quick scan', description: 'Titles only, fast' },
			{ label: 'Deep dive', description: 'Full text, slower' }
		]
	},
	{
		id: 'q2',
		question: 'Anything else to include?',
		header: 'Extras',
		multiSelect: true,
		options: [
			{ label: 'Costs', description: 'Token estimates' },
			{ label: 'Risks', description: 'Failure modes' },
			{ label: 'Links', description: 'Source URLs' }
		]
	}
];
/** spec 18: what the custom-answer field submits (q1's own answer). */
export const STUB_QUESTION_CUSTOM = 'Include the appendix too';

/** Plan-review fixture (2026-08-31): the exit_plan_mode-shaped question
 *  waterfall, source-pinned to DSH `plan/plan-mode/src/index.ts` at
 *  0.1.2-alpha.1 (REVIEW_ID 'plan-review', APPROVE_LABEL 'Approve',
 *  KEEP_PLANNING_LABEL 'Keep planning', header 'Plan review', the option
 *  descriptions verbatim, the plan a #-heading markdown body): fixtures
 *  mirror the host, not DSI's convenience (the Drifted Stand-in rule). */
export const STUB_PLAN_REVIEW_RPC = 'stub-plan-review-1';
export const STUB_PLAN_REVIEW_QUESTIONS = [
	{
		id: 'plan-review',
		header: 'Plan review',
		question: 'Approve this plan and leave plan mode?',
		detail: '# The Plan\n\n1. Read the wire\n2. Render the review\n\nThe plan body reads as a document, not a caption.',
		options: [
			{ label: 'Approve', description: 'Leave plan mode; the plan is carried out from the next step.' },
			{ label: 'Keep planning', description: 'Stay in plan mode; feedback goes back to the model.' }
		],
		intent: { kind: 'plan-review', approve: 'Approve' }
	}
];

/** spec 21: the five tailored context-injection producers plus one open-
 *  family member (fixture-pinned shapes from
 *  tests/unit/fixtures/context-injection-sources.json, W1 task 1.4;
 *  skill-invocation pinned 2026-08-30 from live ledger session-9e80de08;
 *  compaction + tool-jobs pinned 2026-08-31 from live ledger
 *  session-dab56419). */
export const STUB_INJECTIONS = {
	'runtime-context': {
		text: 'Current runtime context. cwd /tmp; agent research; 2 sessions open.',
		source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt', form: 'snapshot', sections: [{ name: 'env' }] }
	},
	instructions: {
		text: '<system-reminder>\nThe following workspace instructions may be relevant…</system-reminder>',
		source: {
			kind: 'agent-instructions',
			form: 'instructions',
			baseline: true,
			changes: [{ action: 'set', scope: '.\u0000AGENTS.md', path: 'AGENTS.md', digest: 'ff4b48bfff997c2145f119d02d3f913abdfc5134' }]
		}
	},
	'skill-catalog': {
		text: '<system-reminder>\nA skill is a reusable set of task-specific instruction…</system-reminder>',
		source: {
			kind: 'skill-catalog',
			form: 'catalog',
			entries: [
				{ name: 'dsh-archive-agent-notes', description: 'Use when adding, auditing, pruning…' },
				{ name: 'dsh-code-review', description: 'Use when reviewing a pull request…' },
				{ name: 'dsh-doc-site-sync', description: 'Use when publishing, updating…' }
			]
		}
	},
	'skill-invocation': {
		text: '<skill_content name="dsh-doc">\n<skill_resources>\nBase directory for this skill: /Users/wharsojo/agentic-ai/deepseek-harness/.agents/skills/dsh-doc\n</skill_resources>',
		source: { kind: 'skill-invocation', name: 'dsh-doc', form: 'instructions' }
	},
	compaction: {
		text: 'This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context.\n\n<compacted-summary>\n## Primary Request and Intent\n- User loaded three projects.\n</compacted-summary>',
		source: { kind: 'plugin', plugin: 'compact', compactionId: 'stub-compaction-1', sourceCommandId: 'cmd-stub-compact-1' }
	},
	'tool-jobs': {
		text: 'background job bash-2 (bash: npx vitest run tests/unit) finished [status: completed, exit code: 0].',
		source: { kind: 'plugin', plugin: 'tool-jobs', form: 'notice', summary: 'background job bash-2 finished [status: completed, exit code: 0].' }
	}
} as const;

/** spec 19/20: model directory + selections the stub serves. */
export interface StubModelRow {
	id: string;
	name: string | null;
	reasoningEfforts?: string[];
}
export const STUB_MODEL_GROUPS: Array<{ id: string; name: string | null; models: StubModelRow[] }> = [
	{
		id: 'deepseek-official',
		name: 'DeepSeek',
		models: [
			{ id: 'deepseek-chat', name: 'DeepSeek Chat' },
			{ id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', reasoningEfforts: ['low', 'medium', 'high'] }
		]
	},
	{ id: 'local', name: 'Local', models: [{ id: 'qwen3-14b', name: null }] }
];
export const STUB_MODEL_INITIAL = { provider: 'deepseek-official', model: 'deepseek-chat' };

/** approval/requested fixture shape ({sessionId, approvalId, toolName, callId?, reason?}). */
interface StubApprovalRequested {
	type: 'approval/requested';
	sessionId: string;
	approvalId: string;
	toolName: string;
	callId?: string;
	reason?: string;
}
/** question/requested fixture shape ({sessionId, questions:[…]}). */
interface StubQuestionRequested {
	type: 'question/requested';
	sessionId: string;
	questions: unknown[];
}

/** HistoryEntry-shaped ledger rows (dsh-rpc DshHistoryEntry). */
export interface StubLedgerEntry {
	event: { type: string; seq: number; time: number; data?: Record<string, unknown>; view?: unknown };
	view?: unknown;
}

/** One workspace registry row (workspace/follow baseline item). */
interface StubWorkspaceRow {
	workspaceId: string;
	path: string;
	title: string;
	sessionIds: string[];
}

/** Current live state (drives the events route deltas). */
export interface StubState {
	running: boolean;
	lastSeq: number;
	ledger: StubLedgerEntry[];
	buffer: StubLedgerEntry[];
	/** Fail-switches for resilience assertions. */
	rpcDown: boolean;
	muxDropNext: boolean;
	/** W2 attachments: recorded per prompt — image count + media types, and
	 *  the over-limit admission switch (mirrors the host's image-too-large). */
	promptCalls: Array<{ sessionId?: string; text: string; mode: string; imageCount: number; imageMediaTypes: string[] }>;
	cancelCalls: number;
	/** ADR-0007 (access chip): the current preset the stub host serves in the
	 *  permissions projection, flipped by /permission lines. */
	permissionPreset: string;
	/** W3 attachments: the durable store session.attachment serves —
	 *  content-addressed by id (seeded rows + admitted prompt images). */
	attachments: Map<string, { mediaType: string; data: string; width: number; height: number; name?: string }>;
	/** W4 (task 4.3): the imageLimits projection the host serves — the
	 *  host's admission numbers. Defaults are the DSH documented values so
	 *  sibling specs stay green; the limits spec tightens via setImageLimits. */
	imageLimits: {
		maxImageBytes: number;
		maxImagesPerMessage: number;
		maxMessageImageBytes: number;
		maxImagePixels: number;
		maxImageDimension: number;
		mediaTypes: string[];
	};
	/** Recorded /permission command lines (the pick receipts, in order). */
	permissionCalls: string[];
	/** Slash Menu (2026-08-30): recorded /compact·/plan execute lines — the
	 *  catalog rung's verbatim receipts, in order (the command, hint, and
	 *  collision journeys assert against this log; passthrough asserts its
	 *  absence). */
	commandExecuteCalls: string[];
	/** Goal Bar (2026-09-08): recorded /goal command lines, in order (the
	 *  bar's action receipts). */
	goalCalls: string[];
	/** Goal Bar: the `goal` projection value the stub serves — undefined =
	 *  key ABSENT (byte-neutral default, no-goal specs see nothing); null =
	 *  the clear tombstone; else the host's GoalProjection shape
	 *  (packages/goal/goal/src/types.ts). */
	goal?: {
		goal: {
			id: string;
			revision: number;
			objective: string;
			phase: 'active' | 'paused' | 'blocked' | 'complete';
			maxGoalRounds: number;
		};
		roundsStarted: number;
		createdAt: number;
		updatedAt: number;
	} | null;
	baselines: Array<{ sessionId: string; lastSeq: number }>;
	/** W4: session.create call log (spec 14 asserts it). */
	createCalls: Array<{ agentPreset: string | null; cwd: string | null }>;
	/** Workspace adoption log (Add workspace spec, 2026-08-23). */
	workspaceCreateCalls: string[];
	/** Workspace Command W4 (2026-09-15): the focused list row's cwd
	 *  override — null = the fresh-install analog (no workspace), absent
	 *  = the default /tmp. Set through POST /__e2e/state. */
	focusedCwd?: string | null;
	/** Chip Menu (2026-09-05): workspace/rename receipts, in order. */
	workspaceRenameCalls: Array<{ workspaceId: string; title: string }>;
	/** Chip Menu (2026-09-05): workspace/delete receipts, in order. */
	workspaceDeleteCalls: string[];
	/** Directory-browse call log (Add workspace folder picker, 2026-08-24) —
	 *  the paths directoryPicker/list was asked for, in order. */
	listDirectoryCalls: Array<string | null>;
	/** Which picker capability the composed host serves (auto backend:
	 *  local darwin → native; tests default to browse). */
	pickerCapability: 'browse' | 'native';
	/** directoryPicker/pick scripted result — the picked path, or null when
	 *  the operator cancels the OS dialog. */
	pickDirectoryResult: string | null;
	/** session/page size (shift-drain spec, 2026-08-26): default 100 keeps
	 *  every existing spec byte-identical (the whole older ledger arrives in
	 *  one page); a spec POSTs a smaller number to make the ledger genuinely
	 *  multi-page. A page call's maxMessages overrides when present. */
	historyPageSize: number;
	/** directoryPicker/pick call count (native-picker spec). */
	pickDirectoryCalls: number;
	/** Artificial dialog latency (ms) — a real OS chooser takes seconds;
	 *  the instant stub would resolve before the panel can paint. */
	pickDirectoryDelayMs: number;
	/** W4: created sessions get ledger rows too (spec 14 chats on the fresh id). */
	createdSessions: string[];
	/** W5 a2a: sessionStats.turns per session id (absent key → no stats value
	 *  on the wire row — the absent-tolerant normalizer arm). */
	sessionTurns: Record<string, number>;
	/** W5 a2a: session.prompt auto-runs the canned scenario (default true —
	 *  byte-neutral for every pre-existing spec; a2a specs switch it off). */
	promptAutoTurn: boolean;
	/** W4: which session session.list answers with (spec 14 flips it to created). */
	listSessionId: string;
	/** Panel Floor W3 (spec-check GAP-5): extra session rows — each id gets
	 *  its OWN ledger seeded here (a sessions map beside the shared one), so
	 *  multiple sessions with content coexist for multi-panel specs. */
	extraSessions: Array<{ sessionId: string; title: string; agentPreset: string | null; cwd: string; ledger: Array<{ event: { type: string; seq: number; time: number; data: Record<string, unknown> } }>; ageMs?: number; /** Edited-Files Card (2026-09-25): per-event summaries + per-file diffs the GET routes serve, keyed by the announcing event's seq. */ changes?: Array<{ seq: number; summary: Record<string, unknown>; diffs: Record<number, Record<string, unknown>> }> }>;
	/** Lineage sidebar W5 (task 5.1): spawned-session fixture rows —
	 *  each maps to a session.list row carrying parentSessionId +
	 *  origin 'subagent' (superset; default [] is byte-neutral for every
	 *  pre-existing spec). Children own an EMPTY ledger (ledgerFor), so
	 *  adopt's cold load succeeds honestly. */
	lineageSessions: Array<{ sessionId: string; parentSessionId: string; title: string; running?: boolean; cwd?: string; ageMs?: number }>;
	/** The Fork Button ADR (2026-09-01): forked children — session.list rows
	 *  carrying parentSessionId (origin ABSENT: a fork child is an ordinary
	 *  wire session) and a COPIED source ledger (createdLedgers). */
	forkedSessions: Array<{ sessionId: string; parentSessionId: string; title: string; ageMs?: number }>;
	/** Scheduled Mark (ADR-0057, task 2.3): scheduler-born fixture rows —
	 *  session.list rows carrying origin 'scheduled' and NO parentSessionId
	 *  (D1: top-level). Empty default is byte-neutral for every pre-existing
	 *  spec; seeded via POST /__e2e/state like lineageSessions. */
	scheduledSessions: Array<{ sessionId: string; title: string; ageMs?: number; cwd?: string }>;
	/** Scheduler Shelf (ADR-0058, task 3.1): fixture schedule/list rows —
	 *  verbatim ScheduleCatalogEntry shapes (host
	 *  packages/schedule/schedule/src/types.ts 452-528). Empty default is
	 *  byte-neutral for every pre-existing spec; seeded via POST
	 *  /__e2e/state like scheduledSessions. */
	scheduleTasks: Array<Record<string, unknown>>;
	/** session/fork call log (spec assertions; atSeq null = omitted). */
	forkCalls: Array<{ sessionId: string; atSeq: number | null }>;
	/** POC-3 W4: pending answerable waterfalls keyed by eventId (replayed on
	 *  $events stream open — host behavior). */
	pendingFrames: Map<string, StubApprovalRequested | StubQuestionRequested>;
	/** Answer call log — the 0.1.2 carrier is POST /api/$events/result (the
	 *  0.1.1 /api/respond carrier is gone); rpcId IS the waterfall eventId.
	 *  Field name/shape kept byte-identical for the specs (ADR, fact 3). */
	respondCalls: Array<{ rpcId: string; payload: Record<string, unknown> }>;
	/** Answered eventIds — a second answer on these is refused (host-honest
	 *  ok:false not-pending; first claimant wins). */
	responded: Set<string>;
	/** POC-3 W4: talk-back state — current title + model selection (host-side truth). */
	title: string;
	modelSelection: { provider: string; model: string; reasoningEffort?: string };
	/** Workspace registry rows (the workspace/follow baseline's items; the
	 *  0.1.1 workspace.list RPC is gone — W2 moved the read side to the
	 *  stream). workspace.create appends + pushes an upsert frame. */
	workspaces: StubWorkspaceRow[];
}


/** The one live stub per worker process. */
export let stub: DshStubHost | undefined;

// Runtime hooks the Playwright spec uses to drive the stub (bound in start()).
export let stubRuntime: {
	getState: () => StubState;
	setRunning: (running: boolean) => void;
	forceMuxDrop: () => void;
	pushEvent: (event: StubLedgerEntry['event']) => Promise<void>;
	/** W4: push one event for a specific session (fresh-session prompts). */
	pushEventFor: (sessionId: string, event: StubLedgerEntry['event']) => Promise<void>;
	/** W4: turn the deterministic tool/reasoning scenario loose. */
	runInspectorScenario: () => void;
	/** W5 a2a: flip ONE new completed turn on a session with a scripted
	 *  assistant reply (bumps sessionStats.turns) — the watcher's gate. */
	flipA2aTurn: (sessionId: string, replyText: string) => Promise<void>;
	/** W5 a2a: whether session.prompt auto-runs the canned turn scenario
	 *  (a2a specs switch it OFF — the test flips turns itself). */
	setPromptAutoTurn: (auto: boolean) => void;
	/** W4 (task 4.3): tighten/loosen the imageLimits projection BEFORE page
	 *  navigation — the cold load bakes it into the composer's pre-flight. */
	setImageLimits: (limits: {
		maxImageBytes: number;
		maxImagesPerMessage: number;
		maxMessageImageBytes: number;
		maxImagePixels: number;
		maxImageDimension: number;
		mediaTypes: string[];
	}) => void;
	/** Goal Bar (2026-09-08): plant the goal projection (undefined = key
	 *  absent again) and broadcast it to the follow streams. */
	setGoal: (value: {
		goal: {
			id: string;
			revision: number;
			objective: string;
			phase: 'active' | 'paused' | 'blocked' | 'complete';
			maxGoalRounds: number;
		};
		roundsStarted: number;
		createdAt: number;
		updatedAt: number;
	} | null) => void;
	/** W4: push the fixture-pinned runtime-context user message (optional
	 *  sections override — Section Split wave 2). */
	pushRuntimeContextEvent: (sections?: unknown) => Promise<void>;
	/** W4: point session.list at a different (e.g. created) session. */
	focusSession: (sessionId: string) => void;
} | undefined;

// Runtime hooks for the POC-3 W4 answerer specs (bound in start()).
export let stubAnswerer: {
	/** Raise an approval request ($events waterfall push, stable eventId). */
	requestApproval: (opts?: { rpcId?: string; approvalId?: string; toolName?: string; reason?: string }) => string;
	/** Raise a question batch ($events waterfall push, stable eventId). */
	requestQuestions: (opts?: { rpcId?: string; questions?: unknown[]; sessionId?: string }) => string;
	/** Raise the exit_plan_mode-shaped plan review (STUB_PLAN_REVIEW_QUESTIONS). */
	requestPlanReview: (opts?: { rpcId?: string; sessionId?: string }) => string;
	/** Settle as if answered elsewhere (host-side settle frame; pending stays OUT of replay). */
	settleElsewhere: (rpcId: string, outcome?: string) => void;
	/** Host-side cancel WITHOUT claiming (turn cancelled → withdrawn). */
	settleCancelled: (rpcId: string) => void;
	/** Test-only view of the pending-frame registry (replay assertions). */
	pendingRpcIds: () => string[];
	/** Prompt-macro spec hygiene (2026-08-29): clear the answer registry —
	 *  pendingFrames (Map), responded (Set), respondCalls. The /__e2e/state
	 *  POST cannot do this (JSON round-trips Map/Set as arrays and breaks
	 *  the stub's methods); ghosts from earlier files ride every poll for
	 *  STUB_SESSION_ID into later specs otherwise. */
	resetAnswerRegistry: () => void;
} | undefined;

/** Turn-scenario events the stub streams after a prompt (seq = base + n).
 *  W3: admitted images ride the scenario's OWN durable user/message as
 *  ImageBlock refs (images first, text part omitted when empty — the wire's
 *  own order), so one turn = one user message, never duplicates. */
function turnScenario(baseSeq: number, text: string, imageBlocks: Array<Record<string, unknown>> = []): StubLedgerEntry[] {
	const mk = (n: number, type: string, data: Record<string, unknown>): StubLedgerEntry => ({
		event: { type, seq: baseSeq + n, time: Date.now(), data }
	});
	return [
		mk(1, 'turn/start', {}),
		mk(2, 'user/message', {
			content: [...imageBlocks, ...(text === '' ? [] : [{ type: 'text', text }])],
			id: 'e2e-user-1'
		}),
		// Ledger v2: no durable chunk events — the settlement's message
		// carries the step's stream; live text rode the assistant-stream
		// frames (instant here, so the fold converges before any poll).
		mk(3, 'assistant/message', {
			turn: 1,
			step: 1,
			message: { content: [{ type: 'text', text: 'The quick brown fox.' }] }
		}),
		mk(4, 'turn/end', {})
	];
}

/** A live logical stream on the mux socket (client-opened; 0.1.2 protocol). */
interface StubStream {
	ws: WebSocket;
	kind: 'follow' | 'events' | 'workspaces' | 'control';
	/** follow streams only — the subscribed session. */
	sessionId?: string;
}

export class DshStubHost {
	readonly port: number;
	state: StubState;
	private server: ReturnType<typeof createServer>;
	private wss: WebSocketServer;
	private muxSockets = new Set<WebSocket>();
	/** Live logical streams by client streamId (demux target for pushes). */
	private streams = new Map<string, StubStream>();
	/** ClientIds this stub has minted via $events READY frames — answers bind
	 *  to a generation, but a reconnect may answer through a stale id before
	 *  the new READY lands; every minted id is honored. */
	private readonly knownClientIds = new Set<string>();
	private clientSeq = 0;
	private closed = false;
	/** W4 spec 13: rows only beforeSeq paging reaches (seq 1–20, head at 1). */
	private olderLedger: StubLedgerEntry[] = [];
	/** Lazy per-created-session ledgers (spec 14). */
	private readonly createdLedgers = new Map<string, StubLedgerEntry[]>();

	constructor(port: number) {
		this.port = port;
		this.state = {
			running: false,
			lastSeq: 111, // max seeded seq — W3 tail rows 109–111 carry image truth
			ledger: [
				{
					event: {
						type: 'request/header',
						seq: 99,
						time: Date.now() - 61_000,
						data: {
							header: {
								config: { provider: 'deepseek', model: 'deepseek-chat' },
								system: STUB_SYSTEM_PROMPT
							},
							reason: 'initial'
						}
					}
				},
				{
					event: {
						type: 'user/message',
						seq: 100,
						time: Date.now() - 60_000,
						data: { content: [{ type: 'text', text: STUB_USER_HELLO }], id: 'e2e-user-0' }
					}
				},
				{ event: { type: 'turn/start', seq: 101, time: Date.now() - 59_000, data: {} } },
				{
					event: {
						type: 'assistant/message',
						seq: 102,
						time: Date.now() - 58_000,
						data: { turn: 0, step: 1, message: { content: [{ type: 'text', text: 'Hi! How can I help?' }] } }
					}
				},
				{ event: { type: 'turn/end', seq: 103, time: Date.now() - 57_000, data: {} } },
				{ event: { type: 'session/title', seq: 104, time: Date.now() - 57_000, data: { title: 'Stub conversation' } } },
				// ── W4 task 4.1: tool truth in the TAIL (live-capture shape, 481ms pair) ──
				{
					event: {
						type: 'tool/call',
						seq: 105,
						time: STUB_TOOL_CALL_TIME,
						data: { turn: 1, step: 1, callId: STUB_TOOL_CALL_ID, name: STUB_TOOL_NAME, arguments: STUB_TOOL_ARGS },
						view: { for: 'call', view: { title: 'Grep glm-5 in /tmp/dsh', kind: 'search', rawInput: 'glm-5' } }
					} as StubLedgerEntry['event'] & { view?: unknown }
				},
				{
					event: {
						type: 'tool/result',
						seq: 106,
						time: STUB_TOOL_RESULT_TIME,
						data: {
							turn: 1,
							step: 1,
							message: {
								source: { kind: 'tool', callId: STUB_TOOL_CALL_ID },
								content: [
									{
											type: 'tool-result',
											toolCallId: STUB_TOOL_CALL_ID,
											content: [{ type: 'text', text: STUB_TOOL_RESULT_TEXT }],
											isError: false
										}
									],
								role: 'user',
								id: 'stub-result-1'
							},
							meta: { shape: 'matches', files: [], truncated: false, total: 0 }
						},
						sourceEventSeqs: [105],
						surfaceOp: 'append'
					} as StubLedgerEntry['event'] & { sourceEventSeqs?: unknown; surfaceOp?: unknown }
				},
				{ event: { type: 'turn/end', seq: 107, time: STUB_TOOL_RESULT_TIME + 1000, data: {} } },
				// W4: cold-load hasMore driver — rows below seq 100 live on the
				// older ledger page (head at seq 1), so the tail call reports
				// hasMore:true and the sentinel shows (spec 13).
				{ event: { type: 'turn/start', seq: 108, time: Date.now() - 50_000, data: {} } },
				// ── W3 task 3.5: durable image truth in the TAIL ── an admitted
				// message carrying ImageBlock refs (served), and one whose ref was
				// never stored (the honest 404 → failure card).
				{
					event: {
						type: 'user/message',
						seq: 109,
						time: Date.now() - 40_000,
						data: {
							id: 'e2e-user-img',
							content: [
								{
									type: 'image',
									attachment: {
										attachmentId: STUB_ATTACHMENT_ID,
										mediaType: 'image/png',
										bytes: 96,
										width: 1,
										height: 1,
										name: 'seeded-shot.png'
									}
								},
								{ type: 'text', text: 'Shared a screenshot earlier' }
							]
						}
					}
				},
				{
					event: {
						type: 'user/message',
						seq: 110,
						time: Date.now() - 39_000,
						data: {
							id: 'e2e-user-img-missing',
							content: [
								{
									type: 'image',
									attachment: {
										attachmentId: STUB_ATTACHMENT_MISSING_ID,
										mediaType: 'image/png',
										bytes: 96,
										width: 1,
										height: 1
									}
								},
								{ type: 'text', text: 'This one vanished upstream' }
							]
						}
					}
				},
				{ event: { type: 'turn/end', seq: 111, time: Date.now() - 38_000, data: {} } }
			],
			buffer: [],
			attachments: new Map([
				[
					STUB_ATTACHMENT_ID,
					{ mediaType: 'image/png', data: STUB_ATTACHMENT_PNG_B64, width: 1, height: 1, name: 'seeded-shot.png' }
				]
			]),
			imageLimits: {
				maxImageBytes: 20 * 1024 * 1024,
				maxImagesPerMessage: 20,
				maxMessageImageBytes: 200 * 1024 * 1024,
				maxImagePixels: 64_000_000,
				maxImageDimension: 8192,
				mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
			},
			rpcDown: false,
			muxDropNext: false,
			promptCalls: [],
			permissionPreset: 'workspace-write',
			permissionCalls: [],
			commandExecuteCalls: [],
			goalCalls: [],
			goal: undefined,
			cancelCalls: 0,
			baselines: [],
			createCalls: [],
			workspaceCreateCalls: [],
			workspaceRenameCalls: [],
			workspaceDeleteCalls: [],
			listDirectoryCalls: [],
			pickerCapability: 'browse',
			pickDirectoryResult: null,
			historyPageSize: 100,
			pickDirectoryCalls: 0,
			pickDirectoryDelayMs: 0,
			createdSessions: [],
			sessionTurns: {},
			promptAutoTurn: true,
			listSessionId: STUB_SESSION_ID,
			extraSessions: [],
			lineageSessions: [],
			scheduledSessions: [],
			scheduleTasks: [],
			forkedSessions: [],
			forkCalls: [],
			pendingFrames: new Map(),
			respondCalls: [],
			responded: new Set(),
			title: 'E2E stub conversation',
			modelSelection: { ...STUB_MODEL_INITIAL },
			// Registry parity: membership mirrors the fixture rows — the blank
			// session belongs to deepseek-harness, the chat-side row to
			// deepseek-chat; the current /tmp session is Ungrouped.
			workspaces: [
				{
					workspaceId: 'ws-stub-harness',
					path: '/Users/wharsojo/agentic-ai/deepseek-harness',
					title: 'deepseek-harness',
					sessionIds: [STUB_BLANK_SESSION_ID]
				},
				{
					workspaceId: 'ws-stub-chat',
					path: '/Users/wharsojo/agentic-ai/deepseek-chat',
					title: 'deepseek-chat',
					sessionIds: ['e2e-chat-session-0003']
				}
			]
		};

		// W4 spec 13: the OLDER ledger page — rows a tail call never returns
		// (seq 1–20, head at 1) but beforeSeq paging reaches. Mirrors the live
		// host: the tail serves the last page; older turns wait behind beforeSeq.
		this.olderLedger = [];
		for (let seq = 1; seq <= 20; seq += 1) {
			if (seq === 10) {
				this.olderLedger.push({
					event: {
						type: 'user/message',
						seq,
						time: Date.now() - 600_000,
						data: { content: [{ type: 'text', text: STUB_OLDER_USER_TEXT }], id: 'e2e-user-old' }
					}
				});
			} else if (seq === 15) {
				// Shift-drain spec (2026-08-26): page 1 (seq 11–20 at page size
				// 10) needs VISIBLE content — without it the first page is all
				// zero-height turn markers, the transcript never grows, and the
				// sentinel chains to the head before Shift+click can prove
				// anything. This row makes page 1 tall; seq 10 stays spec 13's.
				this.olderLedger.push({
					event: {
						type: 'user/message',
						seq,
						time: Date.now() - 600_000,
						data: { content: [{ type: 'text', text: STUB_OLDER_PAGE1_TEXT }], id: 'e2e-user-old-p1' }
					}
				});
			} else {
				this.olderLedger.push({ event: { type: seq % 2 === 1 ? 'turn/start' : 'turn/end', seq, time: Date.now() - 600_000, data: {} } });
			}
		}

		this.server = createServer((req, res) => this.onRequest(req, res));
		this.server.on('upgrade', (req, socket, head) => this.onUpgrade(req, socket, head));
		this.wss = new WebSocketServer({ noServer: true });
	}

	/** Boot and wait until the port answers. */
	async start(): Promise<void> {
		await new Promise<void>((resolve) => this.server.listen(this.port, '127.0.0.1', resolve));
		await fetch(`http://127.0.0.1:${this.port}/__e2e/health`).then((r) => r.json());
		stub = this;
		stubRuntime = {
			getState: () => this.getState(),
			setRunning: (r) => this.setRunning(r),
			forceMuxDrop: () => this.forceMuxDrop(),
			pushEvent: (e) => this.pushEvent(e),
			pushEventFor: (sessionId, e) => this.pushEventFor(sessionId, e),
			runInspectorScenario: () => this.runInspectorScenario(),
			pushRuntimeContextEvent: (sections?: unknown) => this.pushRuntimeContextEvent(sections),
			flipA2aTurn: (sessionId, replyText) => this.flipA2aTurn(sessionId, replyText),
			setPromptAutoTurn: (auto) => {
				this.state.promptAutoTurn = auto;
			},
			setImageLimits: (limits) => {
				this.state.imageLimits = limits;
				this.broadcastProjection('imageLimits', this.state.imageLimits);
			},
			// Goal Bar (2026-09-08): plant/clear the goal projection BEFORE
			// navigation (the follow snapshot bakes it in) or mid-session
			// (the broadcast advances the bar on the next poll).
			setGoal: (value) => {
				this.state.goal = value;
				this.broadcastProjection('goal', value ?? null);
			},
			focusSession: (sessionId) => this.focusSession(sessionId)
		};
		stubAnswerer = {
			requestApproval: (opts) => this.requestApproval(opts),
			requestQuestions: (opts) => this.requestQuestions(opts),
			requestPlanReview: (opts) => this.requestPlanReview(opts),			settleElsewhere: (rpcId, outcome) => this.settleElsewhere(rpcId, outcome),
			settleCancelled: (rpcId) => this.settleCancelled(rpcId),
			pendingRpcIds: () => [...this.state.pendingFrames.keys()],
			resetAnswerRegistry: () => {
				this.state.pendingFrames = new Map();
				this.state.responded = new Set();
				this.state.respondCalls = [];
			}
		};
	}

	/** Current public state (for /__e2e/state). */
	getState(): StubState {
		return { ...this.state, ledger: [...this.state.ledger], buffer: [...this.state.buffer], promptCalls: [...this.state.promptCalls], permissionCalls: [...this.state.permissionCalls], baselines: [...this.state.baselines], createCalls: [...this.state.createCalls], workspaceCreateCalls: [...this.state.workspaceCreateCalls], workspaceRenameCalls: [...this.state.workspaceRenameCalls], workspaceDeleteCalls: [...this.state.workspaceDeleteCalls], listDirectoryCalls: [...this.state.listDirectoryCalls], createdSessions: [...this.state.createdSessions], workspaces: [...this.state.workspaces], forkedSessions: [...this.state.forkedSessions], forkCalls: [...this.state.forkCalls] };
	}

	async stop(): Promise<void> {
		this.closed = true;
		for (const ws of [...this.muxSockets]) ws.close();
		this.wss.close();
		await new Promise<void>((resolve) => this.server.close(() => resolve()));
		stub = undefined;
		stubRuntime = undefined;
		stubAnswerer = undefined;
	}

	// ── Layer 1 — the auth fence ─────────────────────────────────────────

	/** Cookie check for every DSH-wire surface (/api/* POSTs + mux upgrade). */
	private authorized(req: IncomingMessage): boolean {
		const header = req.headers.cookie;
		return typeof header === 'string' && header.split(';').some((c) => c.trim() === STUB_COOKIE_PAIR);
	}

	private deny(res: ServerResponse): void {
		res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
		res.end(AUTH_401_BODY);
	}

	/** The launch-token exchange: ONE GET /?token=… mints the cookie (303). */
	private exchange(req: IncomingMessage, res: ServerResponse): void {
		const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`);
		const token = url.searchParams.get('token');
		if (token !== STUB_LAUNCH_TOKEN) {
			this.deny(res);
			return;
		}
		res.writeHead(303, { location: '/', 'set-cookie': STUB_COOKIE_HEADER });
		res.end();
	}

	// ── HTTP: RPC methods + test control surface ─────────────────────────

	private onRequest(req: IncomingMessage, res: ServerResponse): void {
		const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`);

		// Test control surface (NOT part of the DSH wire — Playwright-only,
		// never fenced: specs drive it without a cookie).
		if (url.pathname === '/__e2e/health') {
			json(res, 200, { ok: true });
			return;
		}
		if (url.pathname === '/__e2e/state' && req.method === 'GET') {
			json(res, 200, this.getState());
			return;
		}
		if (url.pathname === '/__e2e/state' && req.method === 'POST') {
			readBody(req)
				.then((body) => {
					Object.assign(this.state, JSON.parse(body));
					json(res, 200, this.state);
				})
				.catch((err) => json(res, 400, { ok: false, error: String(err) }));
			return;
		}

		// The auth fence: the exchange lives on GET / (exactly one token query
		// param — guide Part 1); no API endpoint performs it.
		if (url.pathname === '/' && req.method === 'GET') {
			this.exchange(req, res);
			return;
		}

		// DSH wire: POST /api/{ns}/{method} — cookie-authenticated (401 otherwise;
		// DSI's DshAuth re-mints once on the 401 and retries).
		if (!url.pathname.startsWith('/api/')) {
			json(res, 404, { ok: false, error: `stub: no such path ${url.pathname}` });
			return;
		}
		// Edited-Files Card (2026-09-25): the Host serves the summary and
		// per-file diffs over authenticated GETs — same cookie fence.
		if (url.pathname === '/api/changes.summary' && req.method === 'GET') {
			if (!this.authorized(req)) return this.deny(res);
			const sid = url.searchParams.get('sessionId');
			const seq = Number(url.searchParams.get('seq'));
			const seed = this.state.extraSessions.find((r) => r.sessionId === sid);
			const announced = seed?.changes?.find((c) => c.seq === seq);
			if (seed === undefined || announced === undefined) {
				json(res, 404, 'Change summary unavailable.');
				return;
			}
			json(res, 200, announced.summary);
			return;
		}
		if (url.pathname === '/api/changes.diff' && req.method === 'GET') {
			if (!this.authorized(req)) return this.deny(res);
			const sid = url.searchParams.get('sessionId');
			const seq = Number(url.searchParams.get('seq'));
			const index = Number(url.searchParams.get('index'));
			const seed = this.state.extraSessions.find((r) => r.sessionId === sid);
			const announced = seed?.changes?.find((c) => c.seq === seq);
			const file = announced?.diffs?.[index];
			if (seed === undefined || announced === undefined || file === undefined) {
				json(res, 404, 'Change summary unavailable.');
				return;
			}
			json(res, 200, file);
			return;
		}
		if (req.method !== 'POST' || !this.authorized(req)) {
			this.deny(res);
			return;
		}
		readBody(req)
			.then(async (body) => {
				const env = JSON.parse(body) as {
					type: string;
					rpcId: string;
					method: string;
					payload?: { args?: Record<string, unknown> };
				};
				if (env?.type !== 'client-request') {
					json(res, 400, { ok: false, error: 'stub: expected client-request' });
					return;
				}
				try {
					// 0.1.2: the args live in payload.args (assertExactArguments —
					// the descriptor-exact keys are each case's own business).
					const value = await this.dispatch(env.method, env.payload?.args ?? {});
					// server-response envelope with rpcId echo (dsh-rpc parseResponse contract)
					json(res, 200, { type: 'server-response', rpcId: env.rpcId, result: { ok: true, value } });
				} catch (err) {
					// Business failures ride the SAME envelope as successes (the
					// real host's fetch handler): ok:false RpcResult with the
					// code/message/details the client branches on — e.g. DSI's
					// native-picker fallback on directory-picker/unavailable
					// details.capability.
					const e =
						err !== null && typeof err === 'object' && 'code' in err
							? (err as { code: string; message?: string; details?: unknown })
							: { code: 'internal', message: String(err) };
					json(res, 200, {
						type: 'server-response',
						rpcId: env.rpcId,
						result: {
							ok: false,
							error: {
								code: e.code,
								message: e.message ?? String(err),
								...(e.details !== undefined ? { details: e.details } : {})
							}
						}
					});
				}
			})
			.catch((err) => json(res, 500, { ok: false, error: String(err) }));
	}

	/** The permissions projection value (ADR-0007; options are the shipped trio). */
	private permissionsValue(): Record<string, unknown> {
		return {
			options: [
				{ value: 'read-only', name: 'read-only', description: 'Look, do not touch.' },
				{ value: 'workspace-write', name: 'workspace-write', description: 'Write inside the workspace.' },
				{ value: 'danger-full-access', name: 'danger-full-access', description: 'Full file access without approval prompts.' }
			],
			currentValue: this.state.permissionPreset
		};
	}

	/** The live cursor for a session: the max seq its LEDGER covers (the
	 *  host's asOfSeq — session/page throughSeq is validated against it).
	 *  Deliberately NOT state.lastSeq: specs inflate that field as a push
	 *  waterline (resetState's 1e6), and a wire cursor above the real ledger
	 *  would jump the app's buffer waterline past every later live event. */
	private cursorFor(sessionId: unknown): number {
		if (sessionId === STUB_SESSION_ID) return this.maxSeqOf(this.state.ledger);
		const extra = typeof sessionId === 'string' ? this.state.extraSessions.find((r) => r.sessionId === sessionId) : undefined;
		if (extra) return this.maxSeqOf(extra.ledger as unknown as StubLedgerEntry[]);
		// The Fork Button ADR: forked children resolve their COPIED ledger.
		const forked = typeof sessionId === 'string' ? this.state.forkedSessions.find((r) => r.sessionId === sessionId) : undefined;
		if (forked) return this.maxSeqOf(this.createdLedgers.get(forked.sessionId) ?? []);
		const created = typeof sessionId === 'string' ? this.createdLedgers.get(sessionId) : undefined;
		if (created) return this.maxSeqOf(created);
		return 0;
	}

	private maxSeqOf(rows: StubLedgerEntry[]): number {
		return rows.reduce((m, r) => Math.max(m, r.event.seq), 0);
	}

	/** One 0.1.2 session.list row: agentPreset / sessionStats / title live in
	 *  projections.values (the 0.1.1 top-level fields are gone). */
	private listRow(row: {
		sessionId: string;
		agentPreset: string | null;
		running: boolean;
		blank: boolean;
		updatedAt: number;
		// string | null: a null cwd IS a meaningful wire row (the fresh-install
		// analog) — the consumer treats a non-string cwd as no workspace.
		cwd: string | null;
		title?: string;
		parentSessionId?: string;
		origin?: 'subagent' | 'scheduled';
	}): Record<string, unknown> {
		const values: Record<string, unknown> = {
			...(row.title !== undefined ? { title: row.title } : {}),
			...(row.agentPreset !== null ? { agentPreset: row.agentPreset } : {})
		};
		const turns = this.state.sessionTurns[row.sessionId];
		if (turns !== undefined) values.sessionStats = { turns };
		return {
			sessionId: row.sessionId,
			running: row.running,
			blank: row.blank,
			updatedAt: row.updatedAt,
			cwd: row.cwd,
			...(row.parentSessionId !== undefined ? { parentSessionId: row.parentSessionId } : {}),
			...(row.origin !== undefined ? { origin: row.origin } : {}),
			projections: { asOfSeq: this.cursorFor(row.sessionId), values }
		};
	}

	/** One RPC method → value (throws {code,message} → ok:false result). */
	private async dispatch(method: string, args: Record<string, unknown>): Promise<unknown> {
		if (this.state.rpcDown) {
			throw { code: 'stub-transport-down', message: 'stub host is down (test-controlled)' };
		}
		const req = (args.request ?? {}) as Record<string, unknown>;
		switch (method) {
			case 'session/list': {
				// The real host lists EVERY persisted session (recency order) —
				// 0.1.2 history() takes each session's throughSeq from its list
				// row, so a session missing from the list is unloadable. The
				// fixture mirrors that: the focused row + every known session.
				type RowCfg = Parameters<DshStubHost['listRow']>[0];
				const cfgs: RowCfg[] = [];
				const focused = this.state.listSessionId;
				// The focused session (hottest — the desk just interacted with it).
				cfgs.push({
					sessionId: focused,
					agentPreset: focused === STUB_SESSION_ID ? 'main' : 'research',
					running: this.state.running,
					blank: false,
					updatedAt: Date.now(),
					// null IS a meaningful override (the fresh-install analog) —
					// only an ABSENT knob falls back to /tmp.
					cwd: this.state.focusedCwd !== undefined ? this.state.focusedCwd : '/tmp',
					title: focused === STUB_SESSION_ID ? 'E2E stub conversation' : 'Fresh stub conversation'
				});
				// The seeded main session (absent when the focused list point
				// moved to a created session — still listed: it persists).
				if (focused !== STUB_SESSION_ID) {
					cfgs.push({
						sessionId: STUB_SESSION_ID,
						agentPreset: 'main',
						running: this.state.running,
						blank: false,
						updatedAt: Date.now() - 1000,
						cwd: '/tmp',
						title: 'E2E stub conversation'
					});
				}
				// Created sessions (spec 14 chats on the fresh id). An UNFOCUSED
				// still-blank created session stays UNLISTED — sidebar spec 07
				// pins blank-filter totals against lingering never-prompted
				// creates (the old focused-only list behavior for blanks).
				const createdCwd = new Map(this.state.createCalls.map((c, i) => [this.state.createdSessions[i], c.cwd]));
				const seenCreated = new Set<string>();
				for (const sessionId of this.state.createdSessions) {
					if (seenCreated.has(sessionId) || sessionId === focused) continue;
					seenCreated.add(sessionId);
					const rows = this.createdLedgers.get(sessionId);
					if ((rows ?? []).length === 0) continue;
					cfgs.push({
						sessionId,
						agentPreset: 'main',
						running: false,
						blank: false,
						updatedAt: Date.now() - 1000,
						cwd: createdCwd.get(sessionId) ?? '/tmp'
					});
				}
				// Workspace-aware picker fixture (2026-08-23): a blank
				// never-prompted session in ANOTHER workspace — exercises
				// workspace chips/pills, the hide-empty default, and the
				// pinned-current exemption (current is never filtered).
				cfgs.push({
					sessionId: STUB_BLANK_SESSION_ID,
					agentPreset: 'app-dev',
					running: false,
					blank: true,
					updatedAt: Date.now() - 3_600_000,
					cwd: STUB_BLANK_CWD
				});
				// Third workspace row — pills only render when a
				// dimension actually discriminates (2+ values among
				// pickable rows, current excluded).
				cfgs.push({
					sessionId: 'e2e-chat-session-0003',
					agentPreset: 'main',
					running: false,
					blank: false,
					updatedAt: Date.now() - 7_200_000,
					cwd: '/Users/wharsojo/agentic-ai/deepseek-chat',
					title: 'Chat side session'
				});
				// Panel Floor W3 (GAP-5): extra multi-panel fixture rows — each
				// carries its own ledger (see ledgerFor) so N panels can show
				// real transcripts side by side.
				for (const row of this.state.extraSessions) {
					if (row.sessionId === focused) continue;
					cfgs.push({
						sessionId: row.sessionId,
						agentPreset: row.agentPreset,
						running: false,
						blank: row.ledger.length === 0,
						updatedAt: Date.now() - (row.ageMs ?? 0),
						cwd: row.cwd,
						title: row.title
					});
				}
				// Lineage sidebar W5 (task 5.1): spawned children — the
				// harness stamps parentSessionId + origin on spawned
				// sessions; the stub mirrors the same wire shape.
				for (const row of this.state.lineageSessions) {
					if (row.sessionId === focused) continue;
					cfgs.push({
						sessionId: row.sessionId,
						agentPreset: 'main',
						running: row.running ?? false,
						blank: false,
						updatedAt: Date.now() - (row.ageMs ?? 0),
						cwd: row.cwd ?? '/tmp',
						title: row.title,
						parentSessionId: row.parentSessionId,
						origin: 'subagent'
					});
				}
				// Scheduled Mark (ADR-0057 D1): scheduler-born rows — origin
				// 'scheduled', NO parentSessionId (top-level), like the host
				// runtime stamps at delivery (Wave 1).
				for (const row of this.state.scheduledSessions) {
					if (row.sessionId === focused) continue;
					cfgs.push({
						sessionId: row.sessionId,
						agentPreset: 'main',
						running: false,
						blank: false,
						updatedAt: Date.now() - (row.ageMs ?? 0),
						cwd: row.cwd ?? '/tmp',
						title: row.title,
						origin: 'scheduled'
					});
				}
				// The Fork Button ADR (2026-09-01): forked children — ordinary
				// rows (origin absent) that carry parentSessionId, so the
				// lineage sidebar files them under the fork source.
				for (const row of this.state.forkedSessions) {
					if (row.sessionId === focused) continue;
					cfgs.push({
						sessionId: row.sessionId,
						agentPreset: 'main',
						running: false,
						blank: false,
						updatedAt: Date.now() - (row.ageMs ?? 0),
						cwd: '/tmp',
						title: row.title,
						parentSessionId: row.parentSessionId
					});
				}
				return {
					items: cfgs
						.map((cfg) => this.listRow(cfg))
						// Real-host parity (apiproxy sessions.ts: "Lists persisted
						// sessions (updatedAt descending)") — the wire order is
						// RECENCY, never fixture array order. Stable, so equal
						// timestamps keep their planted sequence.
						.toSorted((a, b) => (b.updatedAt as number) - (a.updatedAt as number))
				};
			}
			// session.history's successor (0.1.2): paged records. A tail call
			// carries {address, throughSeq} and serves the SESSION ledger's
			// last page only — the olderLedger rows wait behind beforeSeq
			// (spec 13: the tail reports hasMore, the sentinel loads them).
			// A beforeSeq page ends at beforeSeq−1 over the merged pool. NO
			// projections block — the live permissions/imageLimits ride the
			// streams (guide Part 2).
			case 'session/page': {
				const address = (req.address ?? {}) as { sessionId?: unknown };
				const sessionId = address.sessionId;
				const rows = this.ledgerFor(sessionId);
				const throughSeq = Number(req.throughSeq);
				if (!Number.isFinite(throughSeq)) {
					throw { code: 'arguments-invalid', message: 'stub: session/page needs a numeric throughSeq' };
				}
				const cursor = this.cursorFor(sessionId);
				if (throughSeq > cursor) {
					throw { code: 'past-cursor', message: 'throughSeq is past the live cursor' };
				}
				// The TAIL serves the session ledger's last 100 rows (the 0.1.1
				// hardcoded tail — historyPageSize deliberately does NOT shrink
				// it: the shift-drain spec's knob governs OLDER pages only, and
				// the drain chain's first anchor is the cold tail's oldest seq).
				const shared = rows === this.state.ledger;
				const before =
					req.beforeSeq !== undefined && Number.isFinite(Number(req.beforeSeq))
						? Number(req.beforeSeq)
						: null;
				let page: StubLedgerEntry[];
				let hasMore: boolean;
				if (before === null) {
					const size = Math.max(1, Number(req.maxMessages) || 100);
					const tail = rows.filter((r) => r.event.seq <= throughSeq).slice(-size);
					const oldestTail = tail.length > 0 ? (tail[0] as StubLedgerEntry).event.seq : 0;
					const hasHead = shared
						? this.olderLedger.length > 0 || oldestTail > 1
						: oldestTail > 1;
					page = tail;
					hasMore = rows.length > size || hasHead;
				} else {
					// Load-older: the merged pool (older ledger + this session's
					// ledger), ending at beforeSeq−1.
					// historyPageSize (shift-drain spec): the default 100 serves
					// the whole remaining window in one page (existing specs); a
					// spec lowers it to make the ledger genuinely multi-page.
					// The seq-15 bubble rides ONLY the knob: the sentinel
					// auto-loads the older page in any spec whose transcript
					// shows it, and a VISIBLE prepend reflows mid-test reads
					// (spec 08's boundingBox pair drifted 65px) — the default
					// page stays all zero-height markers, invisible on arrival.
					const size = Math.max(1, Number(req.maxMessages) || this.state.historyPageSize || 100);
					const older = size >= 100 ? this.olderLedger.filter((r) => r.event.seq !== 15) : this.olderLedger;
					const pool = shared ? [...older, ...rows] : rows;
					const window = pool.filter((r) => r.event.seq <= throughSeq && r.event.seq < before);
					page = window.slice(-size);
					const oldest = page.length > 0 ? (page[0] as StubLedgerEntry).event.seq : 0;
					hasMore = page.length > 0 && oldest > 1;
				}
				return {
					records: page.map((r) => ({ type: 'event', event: r.event })),
					hasMore
				};
			}
			case 'session/prompt': {
				this.ledgerFor(req.sessionId); // throws session-not-found for unknown ids
				const content = Array.isArray(req.content)
					? (req.content as Array<{ type: string; text?: string; mediaType?: string; data?: string; name?: string }>)
					: [];
				const text = content.find((c) => c.type === 'text')?.text ?? '';
				// W2 attachments: image parts ride the same content array —
				// record their facts and run the host's admission posture,
				// mirroring the REAL host's AttachmentError mapping (api-proxy:
				// code 'attachment-error' + details.reason; 2026-08-26 alignment) —
				// the client routes these to the composer note, drafts survive.
				const images = content.filter((c) => c.type === 'image');
				for (const image of images) {
					if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(String(image.mediaType))) {
						throw {
							code: 'attachment-error',
							message: 'stub: unsupported image media type',
							details: { reason: 'UNSUPPORTED_IMAGE_TYPE' }
						};
					}
					if (typeof image.data !== 'string' || image.data.length === 0) {
						throw {
							code: 'attachment-error',
							message: 'stub: image data missing',
							details: { reason: 'INVALID_IMAGE_BASE64' }
						};
					}
					if (image.data.length > STUB_MAX_IMAGE_B64) {
						throw {
							code: 'attachment-error',
							message: 'stub: image exceeds limit',
							details: { reason: 'IMAGE_TOO_LARGE' }
						};
					}
				}
				this.state.promptCalls.push({
					sessionId: String(req.sessionId ?? ''),
					text,
					mode: String(req.mode ?? 'queue'),
					imageCount: images.length,
					imageMediaTypes: images.map((image) => String(image.mediaType))
				});
				// 2026-08-25 RCA: session.prompt has NO slash interception on the
				// real host — a /permission line sent through it runs as an
				// ordinary model turn. The stub mirrors that honestly; the
				// command surface lives in commands/execute below.
				if (this.state.running) {
					throw { code: 'agent-busy', message: 'stub: agent is busy' };
				}
				// W3 (task 3.5) — the honest echo: admission STORES the admitted
				// images content-addressed; the turn scenario's OWN durable
				// user/message carries the ImageBlock REFS (never bytes — DSH
				// parity), and the durable twin replaces the optimistic bubble
				// by (text, count). One user message per turn — no duplicates.
				const imageBlocks: Array<Record<string, unknown>> = [];
				for (const image of images) {
					const n = this.state.attachments.size + 1;
					const attachmentId = 'sha256:stub-admitted-' + n + '-' + String(image.mediaType).replaceAll('/', '');
					this.state.attachments.set(attachmentId, {
						mediaType: String(image.mediaType),
						data: String(image.data ?? ''),
						width: 1,
						height: 1,
						...(typeof image.name === 'string' ? { name: image.name } : {})
					});
					imageBlocks.push({
						type: 'image',
						attachment: {
							attachmentId,
							mediaType: image.mediaType,
							bytes: Math.floor((String(image.data ?? '').length * 3) / 4),
							width: 1,
							height: 1,
							...(image.name !== undefined ? { name: image.name } : {})
						}
					});
				}
				if (this.state.promptAutoTurn) this.runTurn(String(req.sessionId ?? STUB_SESSION_ID), text, imageBlocks);
				return { accepted: true };
			}
			// W3 (task 3.5) — the session-authorized durable image read: the
			// store is per-stub-host; ids not admitted here refuse loud (the
			// honest 404 → DSI failure card), foreign sessions not-found.
			case 'session/attachment': {
				this.ledgerFor(req.sessionId); // throws session-not-found
				const attachmentId = String(req.attachmentId ?? '');
				const stored = this.state.attachments.get(attachmentId);
				if (stored === undefined) {
					throw { code: 'attachment-not-found', message: 'stub: no such attachment' };
				}
				return {
					attachment: {
						attachmentId,
						mediaType: stored.mediaType,
						bytes: Math.floor((stored.data.length * 3) / 4),
						width: stored.width,
						height: stored.height,
						...(stored.name !== undefined ? { name: stored.name } : {})
					},
					data: stored.data
				};
			}
			// Slash Menu (2026-08-30): the two host catalogs the composer's `/`
		// menu reads. commands/list resolves through the shared agent lookup
		// (may resume a cold session — DSI fetches on first menu open only);
		// skills/list reads projections and never activates anything. Row
		// shapes mirror the wire doc: name-sorted command rows (one carrying
		// an input.hint), user-invocable skill rows (one modelInvocable:
		// false), and `compact` deliberately lives in BOTH — the collision
		// journey's twin (the ladder must resolve it to the COMMAND).
		case 'commands/list': {
			this.ledgerFor(args.agentId); // throws session-not-found for unknown ids
			return [
				{ name: 'compact', description: 'Compact the session context' },
				{ name: 'plan', description: 'Plan the next turn', input: { hint: '<goal>' } }
			];
		}
		case 'skills/list': {
			this.ledgerFor(req.sessionId); // never activates — resolves read-only
			return {
				skills: [
					{ name: 'dsh-doc', description: 'Answer from the DSH docs', modelInvocable: true },
					{
						name: 'compact',
						description: 'Compact — the skill twin (collision fixture)',
						modelInvocable: false
					}
				]
			};
		}
		// Scheduler Shelf (ADR-0058, task 3.1): the unary ledger reads —
		// request-wrapped like skills/list (descriptor parameter 'request').
		// list answers the paged ScheduleListResult (active first); view
		// answers the entry or the host's 200 body-miss discriminator —
		// never a thrown error for a plain miss.
		case 'schedule/list': {
			const items = this.state.scheduleTasks;
			return { items, shown: items.length, total: items.length, limit: 100, offset: 0 };
		}
		case 'schedule/view': {
			const id = String(req.id ?? '');
			return (
				this.state.scheduleTasks.find((task) => task.id === id) ?? { id, code: 'schedule_not_found' }
			);
		}
		// Workspace Explorer W2 (2026-09-09): flat args — agentId/path/range,
		// NO request wrapper (descriptor-exact). The in-memory fs fixture
		// mirrors the host's refusal vocabulary so the file panel's failure
		// lines render keylessly in e2e.
		case 'workspaceFiles/read': {
			// The scope key is workspaceFileScopeId since the host's 0.1.5-rc.1
			// rename (was agentId) — read both, new key first (Git Eye W4).
			this.ledgerFor(args.workspaceFileScopeId ?? args.agentId); // throws session-not-found for unknown ids
			const rawPath = String(args.path ?? '');
			const range = (args.range ?? {}) as { offset?: number; limit?: number };
			const entry = stubWorkspaceEntry(rawPath);
			if (entry === null) {
				throw { code: 'workspace-file/not-found', message: 'no entry', details: { path: rawPath } };
			}
			if (entry.kind === 'dir') {
				throw {
					code: 'workspace-file/not-regular-file',
					message: 'not a regular file',
					details: { path: rawPath, kind: 'directory' }
				};
			}
			const linesAll = entry.text.split('\n');
			const offset = range.offset ?? 1;
			const limit = range.limit ?? STUB_WS_MAX_LINES;
			if (offset > linesAll.length) {
				return { absolutePath: STUB_WS_ROOT + '/' + rawPath, version: 'v1', offset, text: '', lines: 0, eof: true };
			}
			const page = linesAll.slice(offset - 1, offset - 1 + limit);
			return {
				absolutePath: STUB_WS_ROOT + '/' + rawPath,
				version: 'v1',
				offset,
				text: page.join('\n'),
				lines: page.length,
				eof: offset - 1 + page.length >= linesAll.length
			};
		}
		// Workspace Explorer bugfix (2026-09-09): the LIVE tree lists through
		// workspaceFiles/list (the picker's browse capability is native-only
		// on real hosts). path is workspace-relative; '' = the root.
		case 'workspaceFiles/list': {
			this.ledgerFor(args.workspaceFileScopeId ?? args.agentId); // throws session-not-found for unknown ids
			const raw = String(args.path ?? '');
			// Absolute forms (the root listing sends the session cwd) normalize
			// to workspace-relative; relative paths pass through.
			const rel = raw === '/tmp' ? '' : raw.startsWith('/tmp/') ? raw.slice(5) : raw;
			if (rel.includes('..')) {
				throw { code: 'workspace-file/outside-workspace', message: 'escape', details: { path: rel } };
			}
			const levelRows = STUB_WS_LEVELS.get(rel);
			if (!levelRows) {
				throw { code: 'workspace-file/not-found', message: 'no entry', details: { path: rel } };
			}
			const entry = STUB_WS_FS[rel];
			if (entry !== undefined && entry.kind !== 'dir') {
				throw { code: 'workspace-file/not-directory', message: 'not a directory', details: { path: rel, kind: 'file' } };
			}
			return { path: rel, entries: levelRows, truncated: false };
		}
		// The NATIVE command surface (2026-08-25 fix): the Typert Gateway
			// remote the host's own web GUI uses. /permission flips the mode,
			// appends command/run + the three knob events + command/done (the
			// poll's confirming deltas); a bare /permission reports the current
			// preset without events; other lines are an admission miss
			// (ok:true, no value).
			case 'commands/execute': {
				this.ledgerFor(args.agentId); // throws session-not-found for unknown ids
				const line = String(args.line ?? '');
				const permissionLine = /^\/permission( (\S+))?$/.exec(line);
				if (permissionLine === null) {
					// Slash Menu (2026-08-30): /compact and /plan are REAL stub
					// commands — receipt + the run/done ledger pair (mirroring
					// the permission branch's shape). The line is recorded
					// VERBATIM for the journeys. Anything else — /nope, a
					// typo'd token — stays an admission miss (ok:true, no
					// value), the host's null-on-miss quirk the command route
					// maps to {ok:true, executed:false}.
					const host = /^\/(compact|plan)( [\s\S]*)?$/.exec(line);
					if (host === null) return undefined;
					const sid = String(args.agentId ?? STUB_SESSION_ID);
					const cmdN = this.state.commandExecuteCalls.length + 1;
					this.state.commandExecuteCalls.push(line);
					const base = this.state.lastSeq;
					const t = Date.now();
					void this.pushEventFor(sid, { type: 'command/run', seq: base + 1, time: t, data: { commandId: `cmd-stub-host-${cmdN}`, name: host[1], args: host[2] ?? '', source: { kind: 'user' } } });
					void this.pushEventFor(sid, { type: 'command/done', seq: base + 2, time: t, data: { commandId: `cmd-stub-host-${cmdN}`, kind: 'success', text: host[1] === 'compact' ? 'context compacted' : 'plan armed' } });
					return {
						commandId: `cmd-stub-host-${cmdN}`,
						result: { kind: 'success', text: host[1] === 'compact' ? 'context compacted' : 'plan armed' }
					};
				}
				const sid = String(args.agentId ?? STUB_SESSION_ID);
				const cmdN = this.state.permissionCalls.length + 1;
				this.state.permissionCalls.push(line);
				if (permissionLine[2] === undefined) {
					// bare /permission — print the current preset (no state change)
					return { commandId: `cmd-stub-${cmdN}`, result: { kind: 'success', text: `current preset ${this.state.permissionPreset}` } };
				}
				const preset = permissionLine[2];
				const knob: Record<string, { sandbox: string; approval: string }> = {
					'read-only': { sandbox: 'read-only', approval: 'ask' },
					'workspace-write': { sandbox: 'workspace-write', approval: 'ask' },
					'danger-full-access': { sandbox: 'danger-full-access', approval: 'never' }
				};
				const bundle = knob[preset];
				if (bundle === undefined) {
					return { commandId: `cmd-stub-${cmdN}`, result: { kind: 'error', text: `unknown preset "${preset}" (available: read-only, workspace-write, danger-full-access)` } };
				}
				this.state.permissionPreset = preset;
				const base = this.state.lastSeq;
				const t = Date.now();
				void this.pushEventFor(sid, { type: 'command/run', seq: base + 1, time: t, data: { commandId: `cmd-stub-${cmdN}`, name: 'permission', args: ` ${preset}`, source: { kind: 'user' } } });
				void this.pushEventFor(sid, { type: 'permission/preset', seq: base + 2, time: t, data: { preset } });
				void this.pushEventFor(sid, { type: 'sandbox/mode', seq: base + 3, time: t, data: { mode: bundle.sandbox } });
				void this.pushEventFor(sid, { type: 'approval/policy', seq: base + 4, time: t, data: { policy: bundle.approval } });
				void this.pushEventFor(sid, { type: 'command/done', seq: base + 5, time: t, data: { commandId: `cmd-stub-${cmdN}`, kind: 'success', text: `preset ${preset}` } });
				// The live projection rides session/control (the chip's fresh
				// read on the next poll — newest-wins with the knob events).
				this.broadcastProjection('permissions', this.permissionsValue(), sid);
				return { commandId: `cmd-stub-${cmdN}`, result: { kind: 'success', text: `preset ${preset}` } };
			}
			// Goal Bar (2026-09-08): the goals/* Remotes — the SAME verbs DSH's
			// own web client drives, CAS by ref {id, revision}. A stale ref
			// loses (throw → DshRpcError → the route's 409); the mutation
			// commits a durable goal/change (transcript-silent) and the folded
			// key rides session/control.
			case 'goals/pause':
			case 'goals/resume':
			case 'goals/clear': {
				const verb = method.split('/')[1];
				const sid = String(args.agentId ?? STUB_SESSION_ID);
				const ref = (args.ref ?? {}) as { id?: unknown; revision?: unknown };
				this.state.goalCalls.push(verb);
				const g = this.state.goal;
				if (g === undefined || g === null) {
					throw { code: 'goal/not-found', message: `no goal to ${verb}` };
				}
				if (ref.id !== g.goal.id || ref.revision !== g.goal.revision) {
					throw { code: 'goal/stale-ref', message: `goal ref mismatch — the goal moved (host revision ${g.goal.revision})` };
				}
				if (verb === 'clear') {
					// The host writes a revisioned tombstone; the projection
					// folds to null (no goal).
					this.state.goal = null;
				} else {
					g.goal.phase = verb === 'pause' ? 'paused' : 'active';
					g.goal.revision += 1;
					g.updatedAt = Date.now();
				}
				const base = this.state.lastSeq;
				const t = Date.now();
				void this.pushEventFor(sid, { type: 'goal/change', seq: base + 1, time: t, data: { operation: verb } });
				this.broadcastProjection('goal', this.state.goal, sid);
				return { ok: true, value: this.state.goal };
			}
			case 'goals/edit': {
				// Goal Editor (2026-09-09): the changed-fields request mutates
				// objective and/or maxGoalRounds, bumps the revision, keeps the
				// phase — mirroring packages/goal/goal edit(). The stale-ref and
				// not-found refusals match the phase-verb arms above.
				const sid = String(args.agentId ?? STUB_SESSION_ID);
				const ref = (args.ref ?? {}) as { id?: unknown; revision?: unknown };
				this.state.goalCalls.push('edit');
				const g = this.state.goal;
				if (g === undefined || g === null) {
					throw { code: 'goal/not-found', message: 'no goal to edit' };
				}
				if (ref.id !== g.goal.id || ref.revision !== g.goal.revision) {
					throw { code: 'goal/stale-ref', message: `goal ref mismatch — the goal moved (host revision ${g.goal.revision})` };
				}
				const request = (args.request ?? {}) as { objective?: unknown; maxGoalRounds?: unknown };
				if (typeof request.objective !== 'string' && typeof request.maxGoalRounds !== 'number') {
					throw { code: 'goal/invalid-edit', message: 'edit requires objective and/or maxGoalRounds' };
				}
				if (typeof request.objective === 'string') g.goal.objective = request.objective;
				if (typeof request.maxGoalRounds === 'number') g.goal.maxGoalRounds = request.maxGoalRounds;
				g.goal.revision += 1;
				g.updatedAt = Date.now();
				const baseEditSeq = this.state.lastSeq;
				const editTime = Date.now();
				void this.pushEventFor(sid, { type: 'goal/change', seq: baseEditSeq + 1, time: editTime, data: { operation: 'edit' } });
				this.broadcastProjection('goal', this.state.goal, sid);
				return { ok: true, value: this.state.goal };
			}
			case 'session/cancel': {
				this.state.cancelCalls += 1;
				this.state.running = false;
				this.emitSessionStatus(String(req.sessionId ?? STUB_SESSION_ID), false);
				return { accepted: false };
			}
			// Add-workspace folder picker (2026-08-24): directoryPicker/list —
			// the browse capability's DirectoryListing over a small static
			// tree mirroring the fixture paths (home = /Users/wharsojo).
			// A native-capability host REFUSES the browse method — the real
			// api-proxy refusal, details and all (DSI's fallback key).
			case 'directoryPicker/list': {
				if (this.state.pickerCapability !== 'browse') {
					throw {
						code: 'directory-picker/unavailable',
						message: `stub: directoryPicker/list needs the browse capability; the composed picker serves "${this.state.pickerCapability}"`,
						details: { capability: this.state.pickerCapability }
					};
				}
				const asked = typeof args.path === 'string' && args.path.length > 0 ? args.path : null;
				this.state.listDirectoryCalls.push(asked);
				const level = STUB_DIRECTORY_TREE.get(asked ?? STUB_HOME);
				if (!level) {
					throw { code: 'directory-unreadable', message: `stub: cannot list "${asked ?? STUB_HOME}"` };
				}
				return level;
			}
			// Native picker (2026-08-24): directoryPicker/pick — the OS dialog
			// on the host display resolves the scripted path (null = cancel),
			// after the scripted latency (a real chooser takes seconds).
			case 'directoryPicker/pick': {
				this.state.pickDirectoryCalls += 1;
				if (this.state.pickDirectoryDelayMs > 0) {
					await new Promise((resolve) => setTimeout(resolve, this.state.pickDirectoryDelayMs));
				}
				// Wire truth (DirectoryPickerController.pick): the value IS the
				// picked absolute path — a bare string, null on cancel. The old
				// {path} wrapper mirrored DSI's misread and hid the 2026-09-11 bug.
				return this.state.pickDirectoryResult;
			}
			// Add-workspace flow (2026-08-23): adopt a directory into the host
			// workspace registry — schema-pinned shape (api/workspace.schema.ts).
			// The registry's live read side is workspace/follow: the adopted
			// row rides an upsert frame (the 0.1.1 workspace.list RPC is gone).
			case 'workspace/create': {
				const pth = typeof req.path === 'string' ? req.path.trim() : '';
				if (pth.length === 0) {
					throw { code: 'bad-path', message: 'stub: path must be a non-empty string' };
				}
				this.state.workspaceCreateCalls.push(pth);
				const view = {
					workspaceId: `ws-stub-${String(this.state.workspaceCreateCalls.length).padStart(3, '0')}`,
					path: pth,
					title: pth.split('/').filter(Boolean).at(-1) ?? pth,
					sessionIds: [],
					createdAt: new Date().toISOString(),
					updatedAt: new Date().toISOString()
				};
				this.state.workspaces.push({
					workspaceId: view.workspaceId,
					path: view.path,
					title: view.title,
					sessionIds: []
				});
				for (const [, stream] of this.streams) {
					if (stream.kind === 'workspaces') {
						stream.ws.send(JSON.stringify({ type: 'item', streamId: this.streamIdOf(stream.ws, 'workspaces'), value: { type: 'upsert', workspace: view } }));
					}
				}
				return { workspace: view, created: true };
			}
			// Chip Menu (2026-09-05): workspace/rename — semantics copied from
			// the harness client fixture (connection fixture.client.spec.ts
			// 1187-1216): trim; not-found; name-conflict against another
			// row title; a trimmed-equal no-op succeeds WITHOUT a frame;
			// an effective rename rewrites the row and rides an upsert.
			case 'workspace/rename': {
				const wid = typeof req.workspaceId === 'string' ? req.workspaceId : '';
				const title = typeof req.title === 'string' ? req.title.trim() : '';
				const row = this.state.workspaces.find((w) => w.workspaceId === wid);
				if (row === undefined) {
					throw { code: 'workspace/not-found', message: 'stub: no workspace ' + wid };
				}
				if (this.state.workspaces.some((w) => w.workspaceId !== wid && w.title === title)) {
					throw { code: 'workspace/name-conflict', message: 'stub: title ' + title + ' taken' };
				}
				this.state.workspaceRenameCalls.push({ workspaceId: wid, title });
				if (row.title !== title) {
					row.title = title;
					for (const [, stream] of this.streams) {
						if (stream.kind === 'workspaces') {
							stream.ws.send(JSON.stringify({ type: 'item', streamId: this.streamIdOf(stream.ws, 'workspaces'), value: { type: 'upsert', workspace: row } }));
						}
					}
				}
				return { workspace: row };
			}
			// Chip Menu (2026-09-05): workspace/delete — removes ONLY the
			// registry row (sessions survive, fixture 1292-1303) and rides a
			// remove frame on workspace/follow.
			case 'workspace/delete': {
				const wid = typeof req.workspaceId === 'string' ? req.workspaceId : '';
				const row = this.state.workspaces.find((w) => w.workspaceId === wid);
				if (row === undefined) {
					throw { code: 'workspace/not-found', message: 'stub: no workspace ' + wid };
				}
				this.state.workspaceDeleteCalls.push(wid);
				this.state.workspaces = this.state.workspaces.filter((w) => w.workspaceId !== wid);
				for (const [, stream] of this.streams) {
					if (stream.kind === 'workspaces') {
						stream.ws.send(JSON.stringify({ type: 'item', streamId: this.streamIdOf(stream.ws, 'workspaces'), value: { type: 'remove', workspaceId: wid } }));
					}
				}
				return { workspaceId: wid };
			}
			// ── W4 task 4.1: self-sufficiency RPCs (live-probed shapes) ─────────
			case 'agentPresets/list':
				return { presets: STUB_PRESETS };
			case 'session/create': {
				const preset = typeof req.agentPreset === 'string' && req.agentPreset !== '' ? req.agentPreset : null;
				if (preset !== null && !STUB_PRESETS.some((x) => x.id === preset)) {
					throw { code: 'preset-not-found', message: `stub: unknown preset ${preset}` };
				}
				this.state.createCalls.push({ agentPreset: preset, cwd: typeof req.cwd === 'string' ? req.cwd : null });
				const sessionId = `e2e-created-${String(this.state.createCalls.length).padStart(4, '0')}`;
				this.state.createdSessions.push(sessionId);
				this.state.listSessionId = sessionId; // home list follows the create (host behavior)
				return { sessionId, agentPreset: preset ?? 'main' };
			}
			// ── The Fork Button ADR (2026-09-01): session/fork — live-pinned
			// 2026-09-01 (args descriptor exact-matches {request:{sessionId}};
			// a turn-less source refuses session/fork-unavailable; the success
			// shape {sessionId: <child>} per the harness client fixture). ──
			case 'session/fork': {
				const sessionId = typeof req.sessionId === 'string' && req.sessionId !== '' ? req.sessionId : null;
				if (sessionId === null) {
					throw { code: 'gateway/arguments-invalid', message: 'stub: session/fork needs request.sessionId' };
				}
				this.state.forkCalls.push({ sessionId, atSeq: typeof req.atSeq === 'number' ? req.atSeq : null });
				const known =
					sessionId === STUB_SESSION_ID ||
					sessionId === STUB_BLANK_SESSION_ID ||
					this.state.extraSessions.some((r) => r.sessionId === sessionId) ||
					this.state.createdSessions.includes(sessionId) ||
					this.state.forkedSessions.some((r) => r.sessionId === sessionId);
				if (!known) {
					throw { code: 'session/not-found', message: `stub: session "${sessionId}" not found` };
				}
				// Host contract: the cut is completed-turns-only — a turn-less
				// source refuses rather than forking an empty prefix.
				const sourceLedger = this.ledgerFor(sessionId);
				if (sourceLedger.length === 0) {
					throw { code: 'session/fork-unavailable', message: `session "${sessionId}" has no completed turn to fork from` };
				}
				const childId = `e2e-forked-${String(this.state.forkedSessions.length + 1).padStart(4, '0')}`;
				// The seed IS the transcript: the child's ledger is a COPY of the
				// source's completed events (createdLedgers is the runtime map
				// ledgerFor already resolves for open/page).
				this.createdLedgers.set(
					childId,
					sourceLedger.map((row) => structuredClone(row))
				);
				// The child inherits the source title DURABLY (host behavior);
				// DSI's best-effort " (fork)" rename lands via session/rename.
				this.state.forkedSessions.push({ sessionId: childId, parentSessionId: sessionId, title: 'E2E stub conversation' });
				return { sessionId: childId };
			}
			// ── POC-3 W4 (task 4.1): talk-back RPCs (W3 live-probed shapes) ────
			case 'session/rename': {
				const title = typeof req.title === 'string' ? req.title : '';
				const normalized = title.trim();
				if (normalized.length === 0) {
					throw { code: 'title-invalid', message: 'stub: title normalizes to empty' };
				}
				// The Fork Button ADR: a fork child's rename is PER-SESSION —
				// the child row's title updates on the next list poll (the
				// legacy global-title path stays the focused session's).
				const forkChild = this.state.forkedSessions.find((r) => r.sessionId === req.sessionId);
				if (forkChild !== undefined) {
					forkChild.title = normalized;
					return { title: normalized, seq: ++this.state.lastSeq };
				}
				this.state.title = normalized; // host adopts the NORMALIZED title
				return { title: normalized, seq: ++this.state.lastSeq };
			}
			// session.models → session/modelCatalog (0.1.2 rename): a
			// host-generation catalog — `default` stands in for the per-session
			// current, routableProviders lists the routable ids.
			case 'session/modelCatalog':
				return {
					default: { ...this.state.modelSelection },
					routableProviders: STUB_MODEL_GROUPS.map((g) => g.id),
					groups: STUB_MODEL_GROUPS.map((g) => ({ ...g, models: g.models.map((m) => ({ ...m })) })),
					failures: []
				};
			case 'session/selectModel': {
				const provider = typeof req.provider === 'string' ? req.provider : '';
				const model = typeof req.model === 'string' ? req.model : '';
				const group = STUB_MODEL_GROUPS.find((g) => g.id === provider);
				const hasModel = group?.models.some((m) => m.id === model) ?? false;
				if (!group || !hasModel) {
					throw { code: 'model-not-found', message: `stub: ${provider}/${model} not in catalog` };
				}
				const m = group.models.find((x) => x.id === model)!;
				const efforts = m.reasoningEfforts;
				const effort = typeof req.reasoningEffort === 'string' ? req.reasoningEffort : undefined;
				if (effort !== undefined && !(efforts ?? []).includes(effort)) {
						throw { code: 'bad-reasoningEffort', message: `stub: effort ${effort} not offered` };
				}
				this.state.modelSelection = { provider, model, ...(effort !== undefined ? { reasoningEffort: effort } : {}) };
				return { selected: this.state.modelSelection };
			}
			// POC-3 W1 → 0.1.2: the answer carrier. {clientId, eventId, outcome}
			// — clientId must be a READY-minted id, eventId the waterfall's.
			// respondCalls keeps its byte-identical {rpcId, payload} shape: the
			// payload is enriched with the pending request's fields exactly as
			// the host consumes them (specs 16–18, prompt-macro).
			case '$events/result': {
				const clientId = String(args.clientId ?? '');
				const eventId = String(args.eventId ?? '');
				const outcome = (args.outcome ?? {}) as { kind?: string; value?: unknown };
				if (!this.knownClientIds.has(clientId)) {
					throw { code: 'not-pending', message: `stub: unknown $events clientId ${clientId}` };
				}
				const frame = this.state.pendingFrames.get(eventId);
				if (frame === undefined || this.state.responded.has(eventId)) {
					// First claimant wins — a refused answer is ok:false not-pending
					// (the honest host arm; DSI's respond surfaces it upstream).
					throw { code: 'not-pending', message: `stub: no pending waterfall ${eventId}` };
				}
				const value = outcome.value;
				// The host consumes the outcome value VERBATIM as the answerer
				// waterfall's return: ask_user_question crashes on anything but
				// {answers:[…]}, so the stub refuses other question shapes the
				// way the live host fails to honor them (found live 2026-08-31:
				// the legacy {answer:{answers}} wrapper destroyed the answer).
				if (
					frame.type !== 'approval/requested'
					&& (value === null || typeof value !== 'object' || !Array.isArray((value as { answers?: unknown }).answers))
				) {
					throw { code: 'bad-response', message: 'stub: question answer value must be {answers:[…]}' };
				}
				const payload: Record<string, unknown> =
					frame.type === 'approval/requested'
						? { sessionId: frame.sessionId, approvalId: frame.approvalId, toolName: frame.toolName, ...(frame.callId !== undefined ? { callId: frame.callId } : {}), ...(frame.reason !== undefined ? { reason: frame.reason } : {}), outcome: value }
						: { sessionId: frame.sessionId, ...(value as Record<string, unknown>) };
				this.state.respondCalls.push({ rpcId: eventId, payload });
				this.state.responded.add(eventId);
				this.state.pendingFrames.delete(eventId); // accepted → no longer pending (stops replay)
				this.sendToEventsStreams({ type: 'settle', eventId, outcome: typeof value === 'string' ? value : 'answered' });
				return {};
			}
			default:
				throw { code: 'method-not-found', message: `stub: no method ${method}` };
			}
	}

	/** Stream the canned turn: running flip, chunks, finalize, idle flip —
	 *  at the session that was PROMPTED (the host replies where you ask; the
	 *  0.1.1 stub hardcoded the seed session, so spec 14's created-session
	 *  prompt silently streamed its turn into the wrong ledger). */
	private runTurn(sessionId: string, text: string, imageBlocks: Array<Record<string, unknown>> = []): void {
		const baseSeq = this.cursorFor(sessionId);
		const events = turnScenario(baseSeq, text, imageBlocks);
		const focused = sessionId === this.state.listSessionId;

		if (focused) this.state.running = true;
		this.emitSessionStatus(sessionId, true);
		// Delivery rides pushEventFor (ledger + buffer + follow streams) — a
		// bare state.buffer push leaves subscribers blind: the page's
		// poll reads DSI-server buffers that fill ONLY from follow event
		// items. Found by attachments-send 01, the first e2e ever to await
		// a prompt-triggered turn end-to-end.
		for (const e of events) void this.pushEventFor(sessionId, e.event);
		if (focused) this.state.running = false;
		this.emitSessionStatus(sessionId, false);
	}

	// ── WebSockets: the ONE remote.mux downlink (0.1.2) ──────────────────

	private onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
		const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`);
		if (url.pathname !== '/api/remote.mux') {
			socket.destroy();
			return;
		}
		// The upgrade is cookie-authenticated (guide Part 3) — a refused
		// upgrade surfaces as close+error on the client (the reconnect
		// ladder survives both firing).
		if (!this.authorized(req)) {
			socket.write('HTTP/1.1 401 Unauthorized\r\ncontent-type: text/plain; charset=utf-8\r\nconnection: close\r\n\r\n' + AUTH_401_BODY);
			socket.destroy();
			return;
		}
		this.wss.handleUpgrade(req, socket, head, (ws) => this.onMuxConnection(ws));
	}

	private onMuxConnection(ws: WebSocket): void {
		this.muxSockets.add(ws);
		ws.on('close', () => {
			this.muxSockets.delete(ws);
			for (const [streamId, stream] of [...this.streams]) {
				if (stream.ws === ws) this.streams.delete(streamId);
			}
		});
		ws.on('message', (data) => {
			try {
				this.onClientFrame(ws, JSON.parse(String(data)) as { type?: string; streamId?: string; endpoint?: string; payload?: { args?: Record<string, unknown> } });
			} catch {
				// A malformed client frame kills the stream, not the socket —
				// answered per-stream when a streamId is known; here: ignore.
			}
		});

		if (this.state.muxDropNext) {
			// Test-controlled downlink drop: accept the socket then kill it
			// without a baseline (simulates mux loss before subscription).
			this.state.muxDropNext = false;
			ws.close(1011, 'stub: forced drop');
		}
	}

	/** Client → server mux frames: {open, streamId, endpoint, payload} / {cancel}. */
	private onClientFrame(
		ws: WebSocket,
		frame: { type?: string; streamId?: string; endpoint?: string; payload?: { args?: Record<string, unknown> } }
	): void {
		if (typeof frame.streamId !== 'string') return;
		if (frame.type === 'cancel') {
			this.streams.delete(frame.streamId);
			return;
		}
		if (frame.type !== 'open') return;
		const streamId = frame.streamId;
		switch (frame.endpoint) {
			case 'session/follow': {
				const request = (frame.payload?.args?.request ?? {}) as { address?: { sessionId?: unknown } };
				const sessionId = request.address?.sessionId;
				let rows: StubLedgerEntry[];
				try {
					rows = this.ledgerFor(sessionId);
				} catch (err) {
					ws.send(JSON.stringify({ type: 'error', streamId, error: err }));
					return;
				}
				const pool = rows === this.state.ledger ? [...this.olderLedger, ...rows] : rows;
				const snapshotRows = rows.slice(-200); // follow args carry maxMessages: 200
				const cursor = this.cursorFor(sessionId);
				this.streams.set(streamId, { ws, kind: 'follow', sessionId: String(sessionId) });
				this.state.baselines.push({ sessionId: String(sessionId), lastSeq: cursor });
				const values: Record<string, unknown> = {
					permissions: this.permissionsValue(),
					imageLimits: this.state.imageLimits
				};
				// Goal Bar: the goal key rides the baseline only when the spec
				// planted one (undefined stays absent — the no-goal default).
				if (this.state.goal !== undefined && this.state.goal !== null) values.goal = this.state.goal;
				if (String(sessionId) === this.state.listSessionId) values.title = this.state.title;
				ws.send(
					JSON.stringify({
						type: 'item',
						streamId,
						value: {
							type: 'snapshot',
							header: { kind: 'session', sessionId },
							cursor,
							records: snapshotRows.map((r) => ({ type: 'event', event: r.event })),
							hasMore: pool.length > snapshotRows.length,
							projections: { asOfSeq: cursor, values }
						}
					})
				);
				return;
			}
			case '$events': {
				this.streams.set(streamId, { ws, kind: 'events' });
				this.clientSeq += 1;
				const clientId = `e2e-events-${this.clientSeq}`;
				this.knownClientIds.add(clientId);
				ws.send(JSON.stringify({ type: 'item', streamId, value: { type: 'ready', clientId, host: { home: STUB_HOME } } }));
				// Replay still-pending waterfalls with the SAME eventId (the
				// host's refresh-recovery baseline). Claimed ids never replay
				// (BC-C idempotence: replay must overwrite, never duplicate —
				// the client registry keys by eventId).
				for (const [eventId, pending] of this.state.pendingFrames) {
					if (this.state.responded.has(eventId)) continue;
					ws.send(JSON.stringify({ type: 'item', streamId, value: this.waterfallItem(eventId, pending) }));
				}
				return;
			}
			case 'workspace/follow': {
				this.streams.set(streamId, { ws, kind: 'workspaces' });
				ws.send(
					JSON.stringify({
						type: 'item',
						streamId,
						value: { type: 'baseline', value: { items: this.state.workspaces.map((w) => ({ ...w })), archivedSessionIds: [] } }
					})
				);
				return;
			}
			case 'session/control': {
				this.streams.set(streamId, { ws, kind: 'control' });
				const projections: Record<string, unknown> = {};
				const ids = new Set<string>([
					this.state.listSessionId,
					STUB_SESSION_ID,
					STUB_BLANK_SESSION_ID,
					'e2e-chat-session-0003',
					...this.state.createdSessions,
					...this.state.extraSessions.map((r) => r.sessionId),
					...this.state.lineageSessions.map((r) => r.sessionId)
				]);
				for (const id of ids) {
					// Goal Bar: the control baseline RESTATES the whole projections
					// block (the connection's newest-wins fold replaces the follow
					// snapshot), so the planted goal must ride here too.
					const values: Record<string, unknown> = {
						permissions: this.permissionsValue(),
						imageLimits: this.state.imageLimits
					};
					if (this.state.goal !== undefined && this.state.goal !== null) values.goal = this.state.goal;
					projections[id] = { asOfSeq: this.cursorFor(id), values };
				}
				ws.send(
					JSON.stringify({
						type: 'item',
						streamId,
						value: { type: 'baseline', value: { queues: {}, jobs: {}, projections } }
					})
				);
				return;
			}
			default:
				ws.send(JSON.stringify({ type: 'error', streamId, error: { code: 'method-not-found', message: `stub: no stream endpoint ${String(frame.endpoint)}` } }));
		}
	}

	/** The $events waterfall wire item for one pending frame (request stripped
	 *  of type/sessionId — projectRemoteEventRequest's shape; agentId IS the
	 *  sessionId). */
	private waterfallItem(eventId: string, frame: StubApprovalRequested | StubQuestionRequested): Record<string, unknown> {
		const { type, sessionId, ...request } = frame;
		return {
			type: 'waterfall',
			event: type === 'approval/requested' ? 'approval/request' : 'user-questions/request',
			eventId,
			agentId: sessionId,
			request
		};
	}

	/** The client streamId for one of this socket's streams (upsert pushes). */
	private streamIdOf(ws: WebSocket, kind: StubStream['kind']): string {
		for (const [streamId, stream] of this.streams) {
			if (stream.ws === ws && stream.kind === kind) return streamId;
		}
		return '';
	}

	// ── Live-state broadcasts (the streams DSI keeps open) ───────────────

	/** session/follow event item → every stream subscribed to that session. */
	private sendToFollowStreams(sessionId: string, event: StubLedgerEntry['event']): void {
		for (const [streamId, stream] of this.streams) {
			if (stream.kind === 'follow' && stream.sessionId === sessionId) {
				stream.ws.send(JSON.stringify({ type: 'item', streamId, value: { type: 'event', event } }));
			}
		}
	}

	/** $events item → every open $events stream (status emits, settles). */
	private sendToEventsStreams(value: Record<string, unknown>): void {
		for (const [streamId, stream] of this.streams) {
			if (stream.kind === 'events') {
				stream.ws.send(JSON.stringify({ type: 'item', streamId, value }));
			}
		}
	}

	/** api-session/status emit (positional args) — the running transitions
	 *  the 0.1.1 host/session-status socket used to carry. */
	private emitSessionStatus(sessionId: string, running: boolean): void {
		this.sendToEventsStreams({ type: 'emit', event: 'api-session/status', args: [sessionId, running] });
	}

	/** session/control projection frame — single-key, newest wins. */
	private broadcastProjection(key: string, value: unknown, sessionId = this.state.listSessionId): void {
		for (const [streamId, stream] of this.streams) {
			if (stream.kind === 'control') {
				stream.ws.send(JSON.stringify({ type: 'item', streamId, value: { type: 'projection', sessionId, key, value, seq: this.state.lastSeq } }));
			}
		}
	}

	// ── Test control helpers (used by the spec) ──────────────────────────

	/** Simulate a mux downlink drop then reconnect (re-subscribe + replay). */
	forceMuxDrop(): void {
		this.state.muxDropNext = true;
		for (const ws of [...this.muxSockets]) ws.close(1011, 'stub: forced drop');
		this.muxSockets.clear();
		this.streams.clear();
	}

	/** Append a ledger event and push it over the follow streams (gap-then-heal scenarios). */
	async pushEvent(event: StubLedgerEntry['event']): Promise<void> {
		await this.pushEventFor(STUB_SESSION_ID, event);
	}

	/** W4: push for a SPECIFIC session (created-session prompts, spec 14). */
	async pushEventFor(sessionId: string, event: StubLedgerEntry['event']): Promise<void> {
		const rows = this.ledgerFor(sessionId);
		rows.push({ event });
		this.state.buffer.push({ event });
		if (sessionId === this.state.listSessionId && event.seq > this.state.lastSeq) this.state.lastSeq = event.seq;
		this.sendToFollowStreams(sessionId, event);
	}

	/** Push one seq-less assistant-stream frame to a session's follow
	 *  streams (0.1.3-alpha.1) — presentation only: no ledger, no buffer,
	 *  no cursor movement, exactly like the host's own channel. */
	pushAssistantFrameFor(sessionId: string, frame: Record<string, unknown>): void {
		for (const [streamId, stream] of this.streams) {
			if (stream.kind === 'follow' && stream.sessionId === sessionId) {
				stream.ws.send(JSON.stringify({ type: 'item', streamId, value: { type: 'assistant-stream', frame } }));
			}
		}
	}

	/** Live-tail scenario, phase 1 (spec 04): open the attempt and stream one
	 *  partial text chunk. The DSI server folds it into its live tail; the
	 *  page's next poll renders the streaming bubble. */
	pushLiveStreamingStart(): void {
		this.pushAssistantFrameFor(STUB_SESSION_ID, {
			type: 'start', attemptId: 'att-e2e-live', revision: 1, startedAfterSeq: this.cursorFor(STUB_SESSION_ID), turn: 9, step: 1
		});
		this.pushAssistantFrameFor(STUB_SESSION_ID, {
			type: 'chunk', attemptId: 'att-e2e-live', revision: 1, index: 0, time: Date.now(),
			chunk: { type: 'text-delta', index: 0, text: 'streaming…' }
		});
	}

	/** Live-tail scenario, phase 2 (spec 04): commit the attempt — the end
	 *  frame clears the server tail and the durable message finalizes the
	 *  bubble (the store's finalize-wins rule on the same a:9:1 id). */
	async pushLiveStreamingFinalize(): Promise<void> {
		const seq = this.cursorFor(STUB_SESSION_ID) + 1;
		this.pushAssistantFrameFor(STUB_SESSION_ID, {
			type: 'end', attemptId: 'att-e2e-live', revision: 1, index: 1,
			outcome: { kind: 'committed', eventType: 'assistant/message', seq }
		});
		await this.pushEventFor(STUB_SESSION_ID, {
			type: 'assistant/message', seq, time: Date.now(),
			data: { turn: 9, step: 1, message: { content: [{ type: 'text', text: 'streaming… (finalized)' }] } }
		});
	}

	/** Live-tail scenario, abandoned arm phase 1 (spec 04): open attempt
	 *  'att-e2e-gone' and stream a partial — the bubble renders. */
	pushAbandonedStart(): void {
		this.pushAssistantFrameFor(STUB_SESSION_ID, {
			type: 'start', attemptId: 'att-e2e-gone', revision: 1, startedAfterSeq: this.cursorFor(STUB_SESSION_ID), turn: 10, step: 1
		});
		this.pushAssistantFrameFor(STUB_SESSION_ID, {
			type: 'chunk', attemptId: 'att-e2e-gone', revision: 1, index: 0, time: Date.now(),
			chunk: { type: 'text-delta', index: 0, text: 'vanishing…' }
		});
	}

	/** Abandoned arm phase 2: the attempt settles WITHOUT a message — the
	 *  server tail clears, the poll's null liveStream drops the partial. */
	pushAbandonedEnd(): void {
		this.pushAssistantFrameFor(STUB_SESSION_ID, {
			type: 'end', attemptId: 'att-e2e-gone', revision: 1, index: 1, outcome: { kind: 'abandoned' }
		});
	}

	/** The ledger rows for a session — the shared one, or a fresh-session
	 *  ledger seeded on first touch (created sessions start EMPTY: a blank
	 *  conversation, exactly what session.create gives on the real host). */
	private ledgerFor(sessionId: unknown): StubLedgerEntry[] {
		if (sessionId === STUB_SESSION_ID) return this.state.ledger;
		// The never-prompted blank fixture (The Fork Button ADR's refusal
		// path): a known session with NO completed turn.
		if (sessionId === STUB_BLANK_SESSION_ID) return [];
		// Panel Floor W3 (GAP-5): extra fixture sessions keep their own ledgers.
		if (typeof sessionId === 'string') {
			const extra = this.state.extraSessions.find((row) => row.sessionId === sessionId);
			if (extra) return extra.ledger as unknown as StubLedgerEntry[];
		}
		// The Fork Button ADR: forked children carry a COPY of the source
		// ledger (createdLedgers) — resolvable like any runtime session.
		if (typeof sessionId === 'string' && this.state.forkedSessions.some((row) => row.sessionId === sessionId)) {
			return this.createdLedgers.get(sessionId) ?? [];
		}
		// Lineage sidebar W5: spawned fixture children are REAL sessions —
		// empty ledger (blank transcript), never session-not-found.
		if (typeof sessionId === 'string' && this.state.lineageSessions.some((row) => row.sessionId === sessionId)) {
			return [];
		}
		// Scheduled Mark (ADR-0057): scheduler-born fixture sessions are REAL
		// sessions — empty ledger, never session-not-found.
		if (typeof sessionId === 'string' && this.state.scheduledSessions.some((row) => row.sessionId === sessionId)) {
			return [];
		}
		if (typeof sessionId === 'string' && this.state.createdSessions.includes(sessionId)) {
			const existing = this.createdLedgers.get(sessionId);
			if (existing) return existing;
			const fresh: StubLedgerEntry[] = [];
			this.createdLedgers.set(sessionId, fresh);
			return fresh;
		}
		throw { code: 'session-not-found', message: `stub: unknown session ${String(sessionId)}` };
	}

	/** W4 specs 09+10: push a full reasoning-then-text step through the wire —
	 *  the attempt streams over assistant-stream frames (ledger v2: no
	 *  durable chunk events), then the finalize message whose
	 *  {type:'reasoning'} block replaces the streamed prefix. */
	runInspectorScenario(): void {
		const t0 = Date.now();
		// POC-3 W4: later specs (21/22) push seqs up to 961 — the scenario must
		// ride ABOVE the poll waterline (since=lastSeq filters lower seqs out).
		const base = Math.max(this.state.lastSeq + 1, 920);
		const mk = (n: number, type: string, data: Record<string, unknown>): StubLedgerEntry['event'] => ({
				type, seq: base + n, time: t0 + base + n, data
			});
		// The attempt's live frames: reasoning deltas then text deltas, dense
		// from index 0 (instant delivery — the tail clears before any poll).
		const attemptId = 'att-e2e-inspector';
		this.pushAssistantFrameFor(STUB_SESSION_ID, {
			type: 'start', attemptId, revision: 1, startedAfterSeq: base - 1, turn: 7, step: 1
		});
		const liveChunks: Array<Record<string, unknown>> = [
			{ type: 'reasoning-delta', index: 0, text: STUB_REASONING_1 },
			{ type: 'reasoning-delta', index: 0, text: STUB_REASONING_2 },
			{ type: 'text-delta', index: 1, text: STUB_TEXT_1 },
			{ type: 'text-delta', index: 1, text: STUB_TEXT_2 }
		];
		liveChunks.forEach((chunk, index) => {
			this.pushAssistantFrameFor(STUB_SESSION_ID, {
				type: 'chunk', attemptId, revision: 1, index, time: t0 + base + index, chunk
			});
		});
		this.pushAssistantFrameFor(STUB_SESSION_ID, {
			type: 'end', attemptId, revision: 1, index: liveChunks.length,
			outcome: { kind: 'committed', eventType: 'assistant/message', seq: base + 4 }
		});
		void this.pushEventFor(STUB_SESSION_ID, mk(4, 'assistant/message', { turn: 7, step: 1, message: { content: [
				{ type: 'reasoning', text: STUB_REASONING_FINAL },
				{ type: 'text', text: STUB_TEXT_FINAL }
			] } }));
		// W4 spec 09: the FAIL turn — same shape as the seed pair, isError:true.
		// Seqs stay ABOVE the seeded/turn seqs (≥900): polls filter since=lastSeq,
		// so a below-water push would honestly never deliver (learned run 1).
		const t1 = t0 + 10_000;
		void this.pushEventFor(STUB_SESSION_ID, { type: 'tool/call', seq: base + 5, time: t1, data: { turn: 8, step: 1, callId: 'call_stub_fail', name: 'shell', arguments: '{"cmd":"ls /nope"}' } });
		void this.pushEventFor(STUB_SESSION_ID, {
				type: 'tool/result',
				seq: base + 6,
				time: t1 + 250,
				data: {
					turn: 8,
					step: 1,
					message: {
						source: { kind: 'tool', callId: 'call_stub_fail' },
						content: [{ type: 'tool-result', toolCallId: 'call_stub_fail', content: [{ type: 'text', text: 'boom: path not found' }], isError: true }],
						role: 'user',
						id: 'stub-result-fail'
					}
				}
			});
	}

	/** W4 spec 14: repoint session.list at a session (e.g. after create). */
	focusSession(sessionId: string): void {
		this.state.listSessionId = sessionId;
	}

	/**
	 * W5 a2a (task 5.1): flip ONE new completed turn on a session — the
	 * assistant/message carries the scripted reply text (whatever the test
	 * wants the LEDGER lane to classify) and sessionStats.turns bumps by 1
	 * (the watermark crossing). Seqs ride above the session's ledger tail.
	 */
	async flipA2aTurn(sessionId: string, replyText: string): Promise<void> {
		const rows = this.ledgerFor(sessionId);
		const maxSeq = rows.reduce((m, r) => Math.max(m, r.event.seq), 0);
		const base = Math.max(maxSeq, this.state.lastSeq) + 1;
		const t = Date.now();
		const turn = (this.state.sessionTurns[sessionId] ?? 0) + 5;
		await this.pushEventFor(sessionId, { type: 'turn/start', seq: base, time: t, data: { turn } });
		await this.pushEventFor(sessionId, {
			type: 'assistant/message',
			seq: base + 1,
			time: t + 10,
			data: { turn, step: 1, message: { content: [{ type: 'text', text: replyText }] } }
		});
		await this.pushEventFor(sessionId, { type: 'turn/end', seq: base + 2, time: t + 20, data: { turn } });
		this.state.sessionTurns[sessionId] = (this.state.sessionTurns[sessionId] ?? 0) + 1;
	}

	/** W4 spec 12: push the fixture-pinned runtime-context user message
	 *  (structural marker + text prefix — exactly what dsh-events detects).
	 *  Optional sections override (Section Split wave 2): pass a proper
	 *  [{name,text}] list for the section-aware body specs; the default
	 *  ['env'] is deliberately malformed and pins the all-or-nothing
	 *  fallback. */
	async pushRuntimeContextEvent(sections: unknown = ['env']): Promise<void> {
		await this.pushEventFor(STUB_SESSION_ID, {
				type: 'user/message',
				seq: Math.max(this.state.lastSeq + 1, 930),
				time: Date.now(),
				data: {
					// Unique per push: DSI merges chip entries by wire message id, so a
					// repeated id would keep the FIRST source (the malformed default)
					// and the section-aware spec would never see its sections.
					id: 'stub-rc-' + Math.max(this.state.lastSeq + 1, 930),
					source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt', form: 'snapshot', sections },
					content: [
						{ type: 'text', text: 'Current runtime context. cwd /tmp; agent research; 2 sessions open.' }
					]
				}
			});
		}

	// ── POC-3 W4 (task 4.1): answerable waterfall mechanics (host behavior) ──

	/** Per-spec eventId suffix — specs share one stub (workers:1), so each spec
	 * raises its OWN eventId to avoid cross-spec settlement-ring residue. */
	private answerSeq = 0;

	/** Raise an approval request; registers it for $events-open replay (stable eventId). */
	requestApproval(opts?: { rpcId?: string; approvalId?: string; toolName?: string; reason?: string }): string {
		this.answerSeq += 1;
		const rpcId = opts?.rpcId ?? `${STUB_APPROVAL_RPC}-${this.answerSeq}`;
		const frame: StubApprovalRequested = {
			type: 'approval/requested',
			sessionId: STUB_SESSION_ID,
			approvalId: opts?.approvalId ?? `${STUB_APPROVAL_ID}-${this.answerSeq}`,
			toolName: opts?.toolName ?? STUB_APPROVAL_TOOL,
			callId: 'call_stub_approval',
			reason: opts?.reason ?? STUB_APPROVAL_REASON
		};
		this.state.pendingFrames.set(rpcId, frame);
		this.sendToEventsStreams(this.waterfallItem(rpcId, frame));
		return rpcId;
	}

	/** Raise a question batch; registers it for $events-open replay (stable eventId). */
	requestQuestions(opts?: { rpcId?: string; questions?: unknown[]; sessionId?: string }): string {
		this.answerSeq += 1;
		const rpcId = opts?.rpcId ?? `${STUB_QUESTION_RPC}-${this.answerSeq}`;
		const frame: StubQuestionRequested = {
			type: 'question/requested',
			sessionId: opts?.sessionId ?? STUB_SESSION_ID,
			questions: opts?.questions ?? STUB_QUESTIONS
		};
		this.state.pendingFrames.set(rpcId, frame);
		this.sendToEventsStreams(this.waterfallItem(rpcId, frame));
		return rpcId;
	}

	/** Raise the exit_plan_mode-shaped plan review — the same question
	 *  channel, fixture-pinned to the host producer (Drifted Stand-in rule). */
	requestPlanReview(opts?: { rpcId?: string; sessionId?: string }): string {
		return this.requestQuestions({
			rpcId: opts?.rpcId ?? STUB_PLAN_REVIEW_RPC,
			questions: STUB_PLAN_REVIEW_QUESTIONS,
			sessionId: opts?.sessionId
		});
	}

	/** Another UI answered first: pending gone, a host-side settle frame
	 *  lands on us (the 0.1.2 settle-elsewhere arm). */
	settleElsewhere(rpcId: string, outcome = 'allowed-once'): void {
		this.state.pendingFrames.delete(rpcId);
		this.state.responded.add(rpcId);
		this.sendToEventsStreams({ type: 'settle', eventId: rpcId, outcome });
	}

	/** Turn cancelled: a cancel frame keyed by the same eventId — the card withdraws. */
	settleCancelled(rpcId: string): void {
		this.state.pendingFrames.delete(rpcId);
		this.sendToEventsStreams({ type: 'cancel', eventId: rpcId });
	}

	/** Live status flip without a turn (drives UI streaming states). */
	setRunning(running: boolean): void {
		this.state.running = running;
		this.emitSessionStatus(STUB_SESSION_ID, running);
	}
}

function json(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
	res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on('data', (c: Buffer) => chunks.push(c));
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		req.on('error', reject);
	});
}

/** Global setup export for playwright.config.ts (one stub per worker batch). */
export async function startGlobalStub(port: number): Promise<DshStubHost> {
	const s = new DshStubHost(port);
	await s.start();
	return s;
}

export async function stopGlobalStub(s: DshStubHost): Promise<void> {
	await s.stop();
}
