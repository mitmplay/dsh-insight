/**
 * Shared configuration — single source for every host-facing constant and
 * config-value validator. Wire bytes touch exactly one place outside this
 * file (dsh-rpc); the browser surface reads none of these values directly.
 *
 * Operator config (~/.dsi/settings.yaml, 2026-08-25): every DEFAULT_*
 * below is the fallback the config readers (server insight-config.ts and
 * browser app-config.svelte.ts) fall back to when the file/section/key is
 * missing or invalid. The validators live here too — the exact same gates
 * run server-side (read) and client-side (apply), so a stale or foreign
 * /api/config body can never smuggle a destructive value past the store.
 */

/** Default DSH Host base URL (dsh web loopback). */
export const DSH_DEFAULT_BASE_URL = 'http://127.0.0.1:3080';

/** DSH Host base URL; override with DSH_BASE_URL (tests, alternate hosts). */
export function dshBaseUrl(): string {
	return process.env.DSH_BASE_URL || DSH_DEFAULT_BASE_URL;
}

/** This app's dev port (OCI convention; the README quick start promises :5174). */
export const DSI_DEV_PORT = 5174;

/** ~/.dsi/settings.yaml `chat.input.maxRows` default — the prompt
 *  textarea's auto-grow clamp (Composer MAX_ROWS, user spec 2026-08-23). */
export const DEFAULT_CHAT_MAX_ROWS = 15;

/** `chat.accessConfirmTimeoutMs` default — how long the access chip waits
 *  for knob events after a successful /permission POST before clearing the
 *  pick with an honest "switch not confirmed" note. */
export const DEFAULT_ACCESS_CONFIRM_TIMEOUT_MS = 12_000;

/** `chat.macro.maxLines` default (Prompt Macro, 2026-08-29) — the line cap
 * one run may feed (visited `?`-expansions included). Bounding the walk is
 * the fail-loud contract: a run past the cap stops with the reason on the chip. */
export const DEFAULT_MACRO_MAX_LINES = 25;

/** `chat.macro.maxDepth` default (Prompt Macro, 2026-08-29) — how deep
 * `?`-resolution may recurse (a resolved row's own `?` lines resolve
 * again, depth-bounded; 3 = the ADR's default). */
export const DEFAULT_MACRO_MAX_DEPTH = 3;

/** `jobs.autoClose` default (Job Follower Tab, 2026-10-21 operator spec):
 *  false → a settled -J tab stays until the operator clicks the roster
 *  row's clear button or the roster empties. true → the 25s grace timer. */
export const DEFAULT_JOBS_AUTOCLOSE = false;

/** `conversation.pollRunningMs` / `pollIdleMs` defaults — BC-7 cadence:
 *  500ms while a turn runs, 2000ms idle, no other intervals. */
export const DEFAULT_POLL_RUNNING_MS = 500;
export const DEFAULT_POLL_IDLE_MS = 2000;

/** `conversation.statsBar` — WHICH numbers the stats bar renders:
 *  - 'full-ledger' → the host's durable whole-log projections (sessionStats
 *    + tokenUsage), the same totals the DSH web bar shows (every closed
 *    step incl. cancelled/failed, billed input incl. cache, TTFT/tok-per-s);
 *  - 'partial'     → the panel's own fold over the entries it has seen
 *    (ADR 2026-09-08 "The Stats Bar" D3: only what the ledger delivered).
 *  Missing/foreign values fall back to the full ledger. */
export type StatsBarMode = 'partial' | 'full-ledger';

/** `conversation.statsBar` default — the whole-ledger truth. */
export const DEFAULT_STATS_BAR_MODE: StatsBarMode = 'full-ledger';

/** Literal gate for `conversation.statsBar`: only the two known strings
 *  pass; anything else falls back to the default (same shape as
 *  resolveSidebarPlacement). Both config readers run it. */
export function resolveStatsBarMode(v: unknown): StatsBarMode {
	return v === 'partial' || v === 'full-ledger' ? v : DEFAULT_STATS_BAR_MODE;
}

/** `conversation.heartbeatType` — WHICH sessions the jobs heartbeat polls
 *  (ADR-0034 D1/D4):
 *  - 'viewport-cap' → active panels + current conversation + the rows on
 *    screen (the operator's attention);
 *  - 'ticker-cap'   → every spine session — today's watch-everything
 *    behavior, kept as an explicit operator escape hatch.
 *  Missing/foreign values fall back to the viewport cap. */
export type HeartbeatType = 'viewport-cap' | 'ticker-cap';

/** `conversation.heartbeatType` default — watch what the operator sees. */
export const DEFAULT_HEARTBEAT_TYPE: HeartbeatType = 'viewport-cap';

/** Literal gate for `conversation.heartbeatType` — same discipline as
 *  resolveStatsBarMode: only the two known strings pass. Both config
 *  readers run it. */
export function resolveHeartbeatType(v: unknown): HeartbeatType {
	return v === 'ticker-cap' || v === 'viewport-cap' ? v : DEFAULT_HEARTBEAT_TYPE;
}

// ── workspace — The Settings Tree ADR 2026-09-18 D1 deleted the
// `workspace.layout` knob: the explorer layout is the ONLY layout, so
// there is no `workspace` section and no gate to maintain. A stale
// `workspace:` block in ~/.dsi/settings.yaml is inert text.

/**
 * `conversation.collapsable` default — OFF (ADR-0010 "The Fold Gate",
 *  2026-09-09, D2): the flat Honest-Inspector transcript stays the default
 *  stance; the fold is an explicit operator opt-in.
 */
export const DEFAULT_CONVERSATION_COLLAPSABLE = false;

/**
 * `conversation.progressiveFold` default — OFF (ADR-0010 A1/D5): a turn
 *  folds only after its answer lands; folding mid-stream is opt-in.
 */
export const DEFAULT_CONVERSATION_PROGRESSIVE_FOLD = false;

/**
 * Boolean gates for the fold flags (ADR-0010 D2/A1): only strict booleans
 *  pass; a missing section or non-boolean key falls back to its default.
 *  Same discipline as resolveStatsBarMode — both config readers run it.
 *
 * @param v the raw `conversation` config section
 * @returns the resolved collapsable/progressiveFold pair
 */
export function resolveConversationFlags(v: unknown): {
	collapsable: boolean;
	progressiveFold: boolean;
	heartbeatType: HeartbeatType;
} {
	const rec = isConfigRecord(v) ? v : {};
	return {
		collapsable:
			typeof rec.collapsable === 'boolean' ? rec.collapsable : DEFAULT_CONVERSATION_COLLAPSABLE,
		progressiveFold:
			typeof rec.progressiveFold === 'boolean'
				? rec.progressiveFold
				: DEFAULT_CONVERSATION_PROGRESSIVE_FOLD,
		heartbeatType: resolveHeartbeatType(rec.heartbeatType)
	};
}

// ── ui.locale (Three Tongues W1, ADR 2026-09-12 D3/D5) — the operator's
// UI language default. Fleet is en/zh/id; en is baseLocale and fallback.
// Same literal-gate discipline as resolveStatsBarMode: only fleet members
// pass, anything else (missing, foreign, garbage) falls back to en.

/** The UI locale fleet — ADR D5. A fourth language is one catalog file
 *  plus one entry here and in project.inlang/settings.json. */
export const UI_LOCALES = ['en', 'zh', 'id', 'es'] as const;
export type UiLocale = (typeof UI_LOCALES)[number];

/** `ui.locale` default — English (ADR D5: baseLocale is the fallback). */
export const DEFAULT_UI_LOCALE: UiLocale = 'en';

/** Literal gate for `ui.locale`: only fleet locales pass. */
export function resolveUiLocale(v: unknown): UiLocale {
	return UI_LOCALES.includes(v as UiLocale) ? (v as UiLocale) : DEFAULT_UI_LOCALE;
}

/** `home.refreshMs` default — home list + spine refresh cadence (BC-7). */
export const DEFAULT_HOME_REFRESH_MS = 5000;

// ── a2a (2026-08-25, W4 4.1) — the delegation-watcher tunables. Every value
// rides this shared layer: the server reader (insight-config) and the browser
// store (app-config) run the EXACT same intWithin gates, and the watcher
// syncs them once at boot (spec: PRD "Config contract", binding). ──

/** `a2a.fastPollMs` default — LIST-lane tick (ONE batched session.list for
 *  all waiting targets). 0 = fast lane OFF: the spine's own ~5s cadence
 *  (home.refreshMs) is the only motion — the kill-switch (PRD risk 3). */
export const DEFAULT_A2A_FAST_POLL_MS = 1000;

/** `a2a.watchTimeoutMs` default — deadline before an honest `timeout`
 *  settle (silence is never failure; the row keeps the error text). */
export const DEFAULT_A2A_WATCH_TIMEOUT_MS = 600000;

/** `a2a.retentionDays` default — terminal rows pruned at boot sweep only. */
export const DEFAULT_A2A_RETENTION_DAYS = 90;

/** Resolve the whole `a2a` section at once — the single gate site both
 *  readers share (server read + browser apply): fastPollMs int [0, 60000]
 *  (0 disables the fast lane → spine cadence), watchTimeoutMs int
 *  [60000, 3600000], retentionDays int [1, 3650]; every miss reverts to
 *  its default. A non-record section is just three misses. */
export function resolveA2aConfig(section: unknown): {
	fastPollMs: number;
	watchTimeoutMs: number;
	retentionDays: number;
} {
	const rec = isConfigRecord(section) ? section : {};
	return {
		fastPollMs: intWithin(rec.fastPollMs, 0, 60_000, DEFAULT_A2A_FAST_POLL_MS),
		watchTimeoutMs: intWithin(rec.watchTimeoutMs, 60_000, 3_600_000, DEFAULT_A2A_WATCH_TIMEOUT_MS),
		retentionDays: intWithin(rec.retentionDays, 1, 3_650, DEFAULT_A2A_RETENTION_DAYS)
	};
}

/** `server.ringCapacity` default — entries kept per session in the server
 *  ring buffer for delta polls (dsh-connection RING_CAPACITY). */
export const DEFAULT_RING_CAPACITY = 500;

/**
 * `prompts.tags` default — the tag vocabulary offered by the save popup
 * and the manager chip row (The Prompt Tags ADR, 2026-09-14, D5). The
 * operator overrides the list in settings.yaml; the grammar gate itself
 * lives with the server truth (prompts/tags.ts) and its client mirror
 * (prompt-trigger.ts), so both readers here filter with their side's copy.
 */
export const DEFAULT_PROMPT_TAGS = ['session', 'git', 'plan', 'rca', 'kb'];

/** `panel.*` defaults — the floor's width/zoom bounds (ADR-0006). */
export const DEFAULT_PANEL_WIDTH = 730;
export const DEFAULT_PANEL_MIN_WIDTH = 480;
export const DEFAULT_PANEL_MAX_WIDTH = 860;
export const DEFAULT_PANEL_MIN_ZOOM = 0.25;
export const DEFAULT_PANEL_MAX_ZOOM = 1.25;

/** `sidebar.*` defaults — the rail's width bounds (OCI ControlRail). */
export const DEFAULT_SIDEBAR_WIDTH = 400;
export const DEFAULT_SIDEBAR_MIN_WIDTH = 200;
export const DEFAULT_SIDEBAR_MAX_WIDTH = 500;

/**
 * `sidebar.placement` — WHERE the app sidebar renders (OCI placement
 * split, 2026-08-26):
 *   - 'none'        → beside the floor, OUTSIDE PanelsZoom (the rail
 *                     never scales with zoom, never scrolls away) —
 *                     DSI's by-design default;
 *   - 'panels-zoom' → the FIRST COLUMN INSIDE the zoom row, hosted by
 *                     StickyColumnContainer (OCI ControlRail pattern):
 *                     scales with zoom, scrolls with the floor.
 */
export type SidebarPlacement = 'none' | 'panels-zoom';

/** `sidebar.placement` default — the out-of-zoom rail (by-design layout). */
export const DEFAULT_SIDEBAR_PLACEMENT: SidebarPlacement = 'none';

/**
 * Placement literal gate: only the two known strings pass; missing,
 * typo'd, or foreign values fall back to the default. The exact same
 * gate runs server-side (readSidebarConfig) and client-side
 * (applyConfig) — a stale or foreign /api/config body can never smuggle
 * an unknown mode past the store.
 */
export function resolveSidebarPlacement(v: unknown): SidebarPlacement {
	return v === 'panels-zoom' || v === 'none' ? v : DEFAULT_SIDEBAR_PLACEMENT;
}

// ── Config validators (shared by the server reader and the browser store) ──

/** Integer within [min, max], else the fallback. */
export function intWithin(v: unknown, min: number, max: number, fallback: number): number {
	return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : fallback;
}

/** Finite number within [min, max], else the fallback. */
export function numWithin(v: unknown, min: number, max: number, fallback: number): number {
	return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fallback;
}

export interface WidthBounds {
	defaultWidth: number;
	minWidth: number;
	maxWidth: number;
}

/**
 * Resolve a width-bounds triple (panel or sidebar) from a config section:
 * bounds must be integers in [pxMin, pxMax] and crossed bounds (min > max)
 * revert BOTH to defaults (never an inverted clamp). defaultWidth accepts
 * any finite number and CLAMPS into the resolved bounds — the operator's
 * "tighten" intent survives, exactly like the use-site clamp would.
 */
export function resolveWidthBounds(
	section: unknown,
	dflt: WidthBounds,
	pxMin: number,
	pxMax: number
): WidthBounds {
	const rec = isConfigRecord(section) ? section : {};
	let minWidth = intWithin(rec.minWidth, pxMin, pxMax, dflt.minWidth);
	let maxWidth = intWithin(rec.maxWidth, pxMin, pxMax, dflt.maxWidth);
	if (minWidth > maxWidth) {
		minWidth = dflt.minWidth;
		maxWidth = dflt.maxWidth;
	}
	const rawDefault = rec.defaultWidth;
	const defaultWidth =
		typeof rawDefault === 'number' && Number.isFinite(rawDefault) ? rawDefault : dflt.defaultWidth;
	return {
		minWidth,
		maxWidth,
		defaultWidth: Math.max(minWidth, Math.min(maxWidth, defaultWidth))
	};
}

/**
 * Resolve a zoom-bounds pair: finite numbers in [zMin, zMax]; crossed
 * (min > max) reverts both to defaults.
 */
export function resolveZoomBounds(
	section: unknown,
	dfltMin: number,
	dfltMax: number,
	zMin: number,
	zMax: number
): { minZoom: number; maxZoom: number } {
	const rec = isConfigRecord(section) ? section : {};
	let minZoom = numWithin(rec.minZoom, zMin, zMax, dfltMin);
	let maxZoom = numWithin(rec.maxZoom, zMin, zMax, dfltMax);
	if (minZoom > maxZoom) {
		minZoom = dfltMin;
		maxZoom = dfltMax;
	}
	return { minZoom, maxZoom };
}

/** POX guard: is this a plain object (not array/null)? Config sections only. */
export function isConfigRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ── terminal (Web Terminal, spec 2026-09-24; ADR 2026-09-23 D3) ─────────────

/** Terminal retained output tail, in bytes (the spill file holds the head). */
export const DEFAULT_TERMINAL_TAIL_BYTES = 262_144;
/** Terminal full-stream spill cap, in bytes; a larger stream discards its spill. */
export const DEFAULT_TERMINAL_SPILL_BYTES = 33_554_432;
/** TERM-to-KILL cleanup grace for one terminal close ladder. */
export const DEFAULT_TERMINAL_GRACE_MS = 3_000;
/** Output-silence bound a send-wait may settle on as inferred_idle. */
export const DEFAULT_TERMINAL_IDLE_MS = 1_200;
