/**
 * App-config store — the browser half of ~/.dsi/settings.yaml
 * (OCI /api/config client pattern, ported 2026-08-25).
 *
 * One singleton GET /api/config per page load, shared by every consumer
 * on the floor (N panels, one fetch). The root layout awaits this load
 * before the first component mounts (+layout.ts), so layout defaults
 * (panel/sidebar widths, poll cadences) read LANDED values — no flash of
 * code defaults. Values start at the shared defaults ($lib/config) anyway;
 * every failure path keeps them — config is a convenience, never a gate.
 *
 * The apply-side validators are the exact gates the server reader enforces
 * ($lib/config) — a stale or foreign response body can't smuggle a
 * destructive value past the store.
 *
 * BC-2: no $lib/server imports — the server reader (insight-config.ts)
 * owns the file; this store owns only the browser view of GET /api/config.
 */

import {
	DEFAULT_A2A_FAST_POLL_MS,
	DEFAULT_A2A_RETENTION_DAYS,
	DEFAULT_A2A_WATCH_TIMEOUT_MS,
	DEFAULT_ACCESS_CONFIRM_TIMEOUT_MS,
	DEFAULT_CHAT_MAX_ROWS,
	DEFAULT_CONVERSATION_COLLAPSABLE,
	DEFAULT_CONVERSATION_PROGRESSIVE_FOLD,
	DEFAULT_MACRO_MAX_DEPTH,
	DEFAULT_MACRO_MAX_LINES,
	DEFAULT_HOME_REFRESH_MS,
	DEFAULT_PANEL_MAX_WIDTH,
	DEFAULT_PANEL_MAX_ZOOM,
	DEFAULT_PANEL_MIN_WIDTH,
	DEFAULT_PANEL_MIN_ZOOM,
	DEFAULT_PANEL_WIDTH,
	DEFAULT_POLL_IDLE_MS,
	DEFAULT_POLL_RUNNING_MS,
	DEFAULT_HEARTBEAT_TYPE,
	DEFAULT_STATS_BAR_MODE,
	DEFAULT_SIDEBAR_MAX_WIDTH,
	DEFAULT_SIDEBAR_MIN_WIDTH,
	DEFAULT_SIDEBAR_PLACEMENT,
	DEFAULT_SIDEBAR_WIDTH,
	intWithin,
	isConfigRecord,
	resolveConversationFlags,
	resolveHeartbeatType,
	type HeartbeatType,
	resolveStatsBarMode,
	type StatsBarMode,
	resolveA2aConfig,
	resolveSidebarPlacement,
	resolveWidthBounds,
	resolveZoomBounds,
	type SidebarPlacement,
	DEFAULT_PROMPT_TAGS
} from '$lib/config';

import { isValidTagWord } from '$lib/services/chat/prompt-trigger';

export interface AppConfig {
	chat: {
		input: {
			/** Prompt textarea auto-grow clamp, in rows. */
			maxRows: number;
		};
		/** Access-chip pick → knob-events wait before the honest timeout. */
		accessConfirmTimeoutMs: number;
		/** Prompt Macro caps (2026-08-29): run line cap + `?`-resolution
		 *  depth cap — the runner reads them at call time (house idiom). */
		macro: {
			maxLines: number;
			maxDepth: number;
		};
	};
	conversation: {
		/** Delta-poll cadence while a turn runs (BC-7). */
		pollRunningMs: number;
		/** Delta-poll cadence while idle (BC-7). */
		pollIdleMs: number;
		/** Which stats-bar numbers to render ('full-ledger' | 'partial'). */
		statsBar: StatsBarMode;
		/** Fold tool/message runs behind a turn-process disclosure row (ADR-0010 D2). */
		collapsable: boolean;
		/** Fold a turn while it is still streaming (ADR-0010 A1). */
		progressiveFold: boolean;
		/** Which sessions the jobs heartbeat polls (ADR-0034 D1/D4). */
		heartbeatType: HeartbeatType;
	};
	home: {
		/** Home list + spine refresh cadence. */
		refreshMs: number;
	};
	a2a: {
		/** LIST-lane tick (0 = fast lane off — spine cadence rules). */
		fastPollMs: number;
		/** Deadline before an honest `timeout` settle. */
	watchTimeoutMs: number;
		/** Terminal-row retention, pruned at boot sweep only. */
		retentionDays: number;
	};
	panel: {
		defaultWidth: number;
		minWidth: number;
		maxWidth: number;
		minZoom: number;
		maxZoom: number;
	};
	sidebar: {
		defaultWidth: number;
		minWidth: number;
		maxWidth: number;
		/** WHERE the rail renders ('none' outside the zoom | 'panels-zoom'
		 *  first column inside it — OCI placement split). */
		placement: SidebarPlacement;
	};
	prompts: {
		/** The tag vocabulary for the save popup and the manager chip row
		 *  (The Prompt Tags ADR, 2026-09-14, D5). */
		tags: string[];
		/** The prompts.sqlite FULL path (server-expanded homedir) — the
		 *  manager toolbar's label. '' when the server sends none. */
		dbPath: string;
	};
	jobs: {
		/** Job Follower Tab lifecycle (ADR-0035): true → settled -J tabs
		 *  auto-close after the grace timer; false (default) → manual clear
		 *  from the roster row or an empty roster. */
		autoClose: boolean;
	};
	settingsHomes: {
		/** The verbatim settings home roots (The Settings Tree ADR,
		 *  2026-09-18, D2) — the server's homedir truth; tilde fallbacks
		 *  before the config load lands. */
		dsi: string;
		dsh: string;
	};
}

function freshDefault(): AppConfig {
	return {
		chat: {
			input: { maxRows: DEFAULT_CHAT_MAX_ROWS },
			accessConfirmTimeoutMs: DEFAULT_ACCESS_CONFIRM_TIMEOUT_MS,
			macro: { maxLines: DEFAULT_MACRO_MAX_LINES, maxDepth: DEFAULT_MACRO_MAX_DEPTH }
		},
		conversation: {
			pollRunningMs: DEFAULT_POLL_RUNNING_MS,
			pollIdleMs: DEFAULT_POLL_IDLE_MS,
			statsBar: DEFAULT_STATS_BAR_MODE,
			collapsable: DEFAULT_CONVERSATION_COLLAPSABLE,
			progressiveFold: DEFAULT_CONVERSATION_PROGRESSIVE_FOLD,
			heartbeatType: DEFAULT_HEARTBEAT_TYPE
		},
		home: { refreshMs: DEFAULT_HOME_REFRESH_MS },
		a2a: {
			fastPollMs: DEFAULT_A2A_FAST_POLL_MS,
			watchTimeoutMs: DEFAULT_A2A_WATCH_TIMEOUT_MS,
			retentionDays: DEFAULT_A2A_RETENTION_DAYS
		},
		panel: {
			defaultWidth: DEFAULT_PANEL_WIDTH,
			minWidth: DEFAULT_PANEL_MIN_WIDTH,
			maxWidth: DEFAULT_PANEL_MAX_WIDTH,
			minZoom: DEFAULT_PANEL_MIN_ZOOM,
			maxZoom: DEFAULT_PANEL_MAX_ZOOM
		},
		sidebar: {
			defaultWidth: DEFAULT_SIDEBAR_WIDTH,
			minWidth: DEFAULT_SIDEBAR_MIN_WIDTH,
			maxWidth: DEFAULT_SIDEBAR_MAX_WIDTH,
			placement: DEFAULT_SIDEBAR_PLACEMENT
		},
		prompts: { tags: [...DEFAULT_PROMPT_TAGS], dbPath: '' },
		jobs: { autoClose: false },
		settingsHomes: { dsi: '~/.dsi', dsh: '~/.dsh' }
	};
}

let config = $state<AppConfig>(freshDefault());
let loadPromise: Promise<void> | undefined;

/**
 * Reactive config view. Read it inside an $effect/$derived — it updates
 * when the load lands (e.g. the prompt clamp re-measures on arrival).
 */
export function appConfig(): AppConfig {
	return config;
}

/**
 * Kick the singleton GET /api/config load (idempotent — every mount may
 * call it). Resolves when the load settles; never rejects — including a
 * fetch that throws synchronously (unresolvable base URL): the
 * Promise.resolve().then wrapper turns that into a caught rejection.
 */
export function loadAppConfig(): Promise<void> {
	loadPromise ??= Promise.resolve()
		.then(() => fetch('/api/config'))
		.then((res) => (res.ok ? res.json() : null))
		.then((body: unknown) => {
			if (isConfigRecord(body)) applyConfig(body);
		})
		.catch(() => {
			// Network/JSON failure — defaults stay; never a user-facing error.
		});
	return loadPromise;
}

/** Apply a (server-shaped) body through the shared validators. */
function applyConfig(body: Record<string, unknown>): void {
	// chat
	const chat = isConfigRecord(body.chat) ? body.chat : {};
	const input = isConfigRecord(chat.input) ? chat.input : {};
	config.chat.input.maxRows = intWithin(input.maxRows, 1, 200, config.chat.input.maxRows);
	config.chat.accessConfirmTimeoutMs = intWithin(
		chat.accessConfirmTimeoutMs,
		1_000,
		120_000,
		config.chat.accessConfirmTimeoutMs
	);
	// Prompt Macro caps — the same gates the server reader runs
	// (chat.macro.{maxLines,maxDepth}); bad values keep the landed default.
	const macro = isConfigRecord(chat.macro) ? chat.macro : {};
	config.chat.macro.maxLines = intWithin(
		macro.maxLines,
		1,
		500,
		config.chat.macro.maxLines
	);
	config.chat.macro.maxDepth = intWithin(
		macro.maxDepth,
		1,
		10,
		config.chat.macro.maxDepth
	);

	// conversation
	const conversation = isConfigRecord(body.conversation) ? body.conversation : {};
	config.conversation.pollRunningMs = intWithin(
		conversation.pollRunningMs,
		100,
		60_000,
		config.conversation.pollRunningMs
	);
	config.conversation.pollIdleMs = intWithin(
		conversation.pollIdleMs,
		100,
		60_000,
		config.conversation.pollIdleMs
	);
	config.conversation.statsBar = resolveStatsBarMode(conversation.statsBar);
	Object.assign(config.conversation, resolveConversationFlags(conversation));

	// home
	const home = isConfigRecord(body.home) ? body.home : {};
	config.home.refreshMs = intWithin(home.refreshMs, 250, 60_000, config.home.refreshMs);

	// a2a — the shared gate site ($lib/config resolveA2aConfig): the
	// browser applies the EXACT gates the server reader enforces.
	config.a2a = resolveA2aConfig(body.a2a);

	// panel
	const panel = resolveWidthBounds(
		body.panel,
		{
			defaultWidth: DEFAULT_PANEL_WIDTH,
			minWidth: DEFAULT_PANEL_MIN_WIDTH,
			maxWidth: DEFAULT_PANEL_MAX_WIDTH
		},
		200,
		4_000
	);
	const panelZooms = resolveZoomBounds(body.panel, DEFAULT_PANEL_MIN_ZOOM, DEFAULT_PANEL_MAX_ZOOM, 0.25, 3);
	config.panel = { ...panel, ...panelZooms };

	// sidebar
	const sidebar = isConfigRecord(body.sidebar) ? body.sidebar : {};
	config.sidebar = {
		...resolveWidthBounds(
			sidebar,
			{
				defaultWidth: DEFAULT_SIDEBAR_WIDTH,
				minWidth: DEFAULT_SIDEBAR_MIN_WIDTH,
				maxWidth: DEFAULT_SIDEBAR_MAX_WIDTH
			},
			100,
			2_000
		),
		placement: resolveSidebarPlacement(sidebar.placement)
	};

	// prompts.tags — the same word gate the server reader runs (array OR
	// plain string — see readPromptsConfig), via the client grammar mirror
	// (parity test pins the two); bad words drop, a missing/empty list
	// keeps the landed default.
	const prompts = isConfigRecord(body.prompts) ? body.prompts : {};
	const rawTags: unknown[] = Array.isArray(prompts.tags)
		? prompts.tags
		: typeof prompts.tags === 'string'
			? prompts.tags.split(/[\s,;]+/)
			: [];
	const tags = rawTags
		.filter((w): w is string => typeof w === 'string')
		.map((w) => w.toLowerCase())
		.filter(isValidTagWord);
	if (tags.length > 0) config.prompts.tags = tags;
	// dbPath — read-only labeling fact; a missing/invalid value keeps ''.
	if (typeof prompts.dbPath === 'string' && prompts.dbPath.length > 0) {
		config.prompts.dbPath = prompts.dbPath;
	}

	// jobs (Job Follower Tab): autoClose is a strict boolean
	const jobs = isConfigRecord(body.jobs) ? body.jobs : {};
	config.jobs.autoClose = typeof jobs.autoClose === 'boolean' ? jobs.autoClose : config.jobs.autoClose;

	// settingsHomes (The Settings Tree ADR 2026-09-18 D2): accept only the
	// server's two strings; junk keeps the tilde fallbacks.
	const homes = (body as { settingsHomes?: { dsi?: unknown; dsh?: unknown } }).settingsHomes;
	if (homes && typeof homes.dsi === 'string') config.settingsHomes.dsi = homes.dsi;
	if (homes && typeof homes.dsh === 'string') config.settingsHomes.dsh = homes.dsh;
}

/** Test seam — reset the singleton (state + in-flight dedupe) between tests. */
export function resetAppConfigForTests(): void {
	config = freshDefault();
	loadPromise = undefined;
}
