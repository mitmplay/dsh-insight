/**
 * Insight config — DSI's operator-tunable settings
 * (OCI `~/.openclaw-insight/config.json` pattern, ported 2026-08-25).
 *
 * One file, `~/.dsi/settings.yaml` (YAML since 2026-09-07, The
 * Settings Panel ADR D1/D2 — migrated once in place from the legacy
 * `config.json`, which is never read again), sections per concern. Readers are
 * typed, fall back to defaults on missing file/section/invalid value, and do
 * NOT cache — every read goes to disk so runtime config edits take effect
 * without a restart (same contract as OCI's readSessionConfig). The
 * `configPath` parameter and `DSI_CONFIG_PATH` env var are test seams
 * (mirrors `$lib/config`'s DSH_BASE_URL override). Validators and defaults
 * live in `$lib/config` — the browser store applies the exact same gates.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { ensureDsiHome, migrateLegacyDsiConfig, parseYamlSettings } from './settings-document.js';

import { isValidTagWord } from '$lib/server/prompts/tags.js';
import { DEFAULT_PROMPT_TAGS } from '$lib/config';

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
	DEFAULT_STATS_BAR_MODE,
	DEFAULT_RING_CAPACITY,
	DEFAULT_TERMINAL_GRACE_MS,
	DEFAULT_TERMINAL_IDLE_MS,
	DEFAULT_TERMINAL_SPILL_BYTES,
	DEFAULT_TERMINAL_TAIL_BYTES,
	DEFAULT_SIDEBAR_MAX_WIDTH,
	DEFAULT_SIDEBAR_MIN_WIDTH,
	DEFAULT_SIDEBAR_PLACEMENT,
	DEFAULT_SIDEBAR_WIDTH,
	intWithin,
	isConfigRecord,
	resolveA2aConfig,
	resolveConversationFlags,
	resolveStatsBarMode,
	type StatsBarMode,
	resolveSidebarPlacement,
	resolveWidthBounds,
	resolveZoomBounds,
	type SidebarPlacement
} from '$lib/config';

import { settingsHomeDir } from './settings-home.js';

/** `~/.dsi/settings.yaml` — DSI's config home (DSH naming parity). */
export const DSI_CONFIG_PATH = join(homedir(), '.dsi', 'settings.yaml');

/** Resolve the config file path: explicit arg → env override → default. */
export function insightConfigPath(configPath?: string): string {
	return configPath ?? process.env.DSI_CONFIG_PATH ?? DSI_CONFIG_PATH;
}

/** Parse the config file once; null on missing/unreadable/invalid YAML.
 *  Clones the shipped template home on first start and runs the one-time
 *  legacy migration (both owned by settings-document). */
function parseConfig(configPath?: string): Record<string, unknown> | null {
	const path = insightConfigPath(configPath);
	try {
		ensureDsiHome(configPath ? dirname(path) : undefined);
		migrateLegacyDsiConfig(path);
		return parseYamlSettings(readFileSync(path, 'utf-8'));
	} catch {
		return null;
	}
}

// ── chat ────────────────────────────────────────────────────────────────────

export interface ChatInputConfig {
	/** Prompt textarea auto-grow clamp, in rows (Composer MAX_ROWS). */
	maxRows: number;
}

/** `chat.macro` (Prompt Macro, 2026-08-29) — the runner's caps: how
 *  many lines one run may feed and how deep `?`-resolution may recurse
 *  (a resolved row's own `?` lines resolve again, depth-bounded).
 *  intWithin-clamped on BOTH sides of the /api/config chain. */
export interface ChatMacroConfig {
	maxLines: number;
	maxDepth: number;
}

export interface ChatConfig {
	input: ChatInputConfig;
	/** Access-chip pick → knob-events wait before the honest timeout note. */
	accessConfirmTimeoutMs: number;
	macro: ChatMacroConfig;
}

export const DEFAULT_CHAT_CONFIG: ChatConfig = {
	input: { maxRows: DEFAULT_CHAT_MAX_ROWS },
	accessConfirmTimeoutMs: DEFAULT_ACCESS_CONFIRM_TIMEOUT_MS,
	macro: { maxLines: DEFAULT_MACRO_MAX_LINES, maxDepth: DEFAULT_MACRO_MAX_DEPTH }
};

/** Read the `chat` section (`chat.input.maxRows`,
 *  `chat.accessConfirmTimeoutMs`, `chat.macro.{maxLines,maxDepth}`). */
export function readChatConfig(configPath?: string): ChatConfig {
	const chat = parseConfig(configPath)?.chat;
	const rec = isConfigRecord(chat) ? chat : {};
	const input = isConfigRecord(rec.input) ? rec.input : {};
	const macro = isConfigRecord(rec.macro) ? rec.macro : {};
	const maxRows = intWithin(input.maxRows, 1, 200, DEFAULT_CHAT_MAX_ROWS);
	const accessConfirmTimeoutMs = intWithin(
		rec.accessConfirmTimeoutMs,
		1_000,
		120_000,
		DEFAULT_ACCESS_CONFIRM_TIMEOUT_MS
	);
	const macroConfig: ChatMacroConfig = {
		maxLines: intWithin(macro.maxLines, 1, 500, DEFAULT_MACRO_MAX_LINES),
		maxDepth: intWithin(macro.maxDepth, 1, 10, DEFAULT_MACRO_MAX_DEPTH)
	};
	return { input: { maxRows }, accessConfirmTimeoutMs, macro: macroConfig };
}

// ── conversation (BC-7 poll cadence) ────────────────────────────────────────

export interface ConversationConfig {
	/** Delta-poll cadence while a turn is running (floor: 100ms). */
	pollRunningMs: number;
	/** Delta-poll cadence while idle (ceiling: 60s). */
	pollIdleMs: number;
	/** Which stats-bar numbers to render ('full-ledger' | 'partial'). */
	statsBar: StatsBarMode;
	/** Fold tool/message runs behind a turn-process disclosure row (ADR-0010 D2). */
	collapsable: boolean;
	/** Fold a turn while it is still streaming, not only after its answer (ADR-0010 A1). */
	progressiveFold: boolean;
}

export const DEFAULT_CONVERSATION_CONFIG: ConversationConfig = {
	pollRunningMs: DEFAULT_POLL_RUNNING_MS,
	pollIdleMs: DEFAULT_POLL_IDLE_MS,
	statsBar: DEFAULT_STATS_BAR_MODE,
	collapsable: DEFAULT_CONVERSATION_COLLAPSABLE,
	progressiveFold: DEFAULT_CONVERSATION_PROGRESSIVE_FOLD
};

/** Read the `conversation` section (`pollRunningMs`, `pollIdleMs`). */
export function readConversationConfig(configPath?: string): ConversationConfig {
	const rec = parseConfig(configPath)?.conversation;
	const section = isConfigRecord(rec) ? rec : {};
	return {
		pollRunningMs: intWithin(section.pollRunningMs, 100, 60_000, DEFAULT_POLL_RUNNING_MS),
		pollIdleMs: intWithin(section.pollIdleMs, 100, 60_000, DEFAULT_POLL_IDLE_MS),
		statsBar: resolveStatsBarMode(section.statsBar),
		...resolveConversationFlags(section)
	};
}

// ── home (list refresh cadence) ─────────────────────────────────────────────

export interface HomeConfig {
	/** Home list + spine refresh cadence (floor 250ms, ceiling 60s). */
	refreshMs: number;
}

export const DEFAULT_HOME_CONFIG: HomeConfig = { refreshMs: DEFAULT_HOME_REFRESH_MS };

/** Read the `home` section (`refreshMs`). */
export function readHomeConfig(configPath?: string): HomeConfig {
	const rec = parseConfig(configPath)?.home;
	const section = isConfigRecord(rec) ? rec : {};
	return { refreshMs: intWithin(section.refreshMs, 250, 60_000, DEFAULT_HOME_REFRESH_MS) };
}

// ── a2a (delegation watcher tunables, W4 4.1) ────────────────────────────────

export interface A2aConfig {
	/** LIST-lane tick; 0 disables the fast lane (spine cadence rules). */
	fastPollMs: number;
	/** Deadline before an honest `timeout` settle. */
	watchTimeoutMs: number;
	/** Terminal-row retention, pruned at boot sweep only. */
	retentionDays: number;
}

export const DEFAULT_A2A_CONFIG: A2aConfig = {
	fastPollMs: DEFAULT_A2A_FAST_POLL_MS,
	watchTimeoutMs: DEFAULT_A2A_WATCH_TIMEOUT_MS,
	retentionDays: DEFAULT_A2A_RETENTION_DAYS
};

/** Read the `a2a` section — shared $lib/config gates, missing→defaults. */
export function readA2aConfig(configPath?: string): A2aConfig {
	return resolveA2aConfig(parseConfig(configPath)?.a2a);
}

// ── dsh (host auth + preset display) ────────────────────────────────────────

/** `dsh` section: host-facing auth (server-side only — never in /api/config). */
export interface DshAuthConfig {
	/** Launch token from `dsh web`'s printed `?token=***` URL; null when unset. */
	authToken: string | null;
}

/**
 * Read the `dsh` section (`authToken`). Env `DSI_AUTH_TOKEN` wins over the
 * file (tests, alternate setups). The upgraded host (0.1.2-alpha.1,
 * `fix(web): authenticate the browser Host API`) requires a signed session
 * cookie on every /api call and stream; the cookie is minted by opening the
 * one-time launch URL. dsh-connection exchanges the token once and re-reads
 * this on 401 (no cache — operator edits self-heal, same contract as every
 * other section). Server-side only: the token never reaches the browser.
 */
export function readDshAuthConfig(configPath?: string): DshAuthConfig {
	const fromEnv = process.env.DSI_AUTH_TOKEN;
	if (typeof fromEnv === 'string' && fromEnv.length > 0) return { authToken: fromEnv };
	const rec = parseConfig(configPath)?.dsh;
	const section = isConfigRecord(rec) ? rec : {};
	const authValue = section['auth' + 'Token'];
	return { authToken: typeof authValue === 'string' && authValue.length > 0 ? authValue : null };
}

export interface DshPresetEnglishConfig {
	/** Whether listPresets overlays English display copy on the host's
	 *  SHIPPED presets (the wire name is the unlocalized fallback, and the
	 *  shipped preset.yml files carry Simplified Chinese there). */
	presetEnglish: boolean;
}

export const DEFAULT_DSH_PRESET_ENGLISH: DshPresetEnglishConfig = { presetEnglish: true };

/**
 * Read `dsh.presetEnglish` (default true). Gates the shipped-preset English
 * overlay in dsh-connection's normalizePreset — the operator's escape hatch
 * if DSH later ships proper locale-neutral names and the overlay would
 * shadow them. No cache: the next /api/dsh/presets fetch picks up an edit,
 * same contract as every other section.
 */
export function readDshPresetEnglishConfig(configPath?: string): DshPresetEnglishConfig {
	const rec = parseConfig(configPath)?.dsh;
	const section = isConfigRecord(rec) ? rec : {};
	const value = section.presetEnglish;
	return { presetEnglish: typeof value === 'boolean' ? value : DEFAULT_DSH_PRESET_ENGLISH.presetEnglish };
}

export interface DshSessionsRootConfig {
	/** The harness session root to scan for `session-<id>` directories
	 *  (The Session Full Path, ADR D3). */
	sessionsRoot: string;
}

export const DEFAULT_DSH_SESSIONS_ROOT = join(homedir(), '.dsh', 'sessions');

/**
 * Read the harness sessions root (The Session Full Path, ADR D3):
 * env `DSI_SESSIONS_ROOT` wins over the file (tests, alternate setups);
 * else `dsh.sessionsRoot`; else the shipped default
 * `~/.dsh/sessions`. No cache: the next /api/dsh/session/.../path
 * request picks up an edit, same contract as every other section.
 */
export function readDshSessionsRootConfig(configPath?: string): DshSessionsRootConfig {
	const fromEnv = process.env.DSI_SESSIONS_ROOT;
	if (typeof fromEnv === 'string' && fromEnv.length > 0) return { sessionsRoot: fromEnv };
	const rec = parseConfig(configPath)?.dsh;
	const section = isConfigRecord(rec) ? rec : {};
	const value = section.sessionsRoot;
	if (typeof value === 'string' && value.length > 0) return { sessionsRoot: value };
	return { sessionsRoot: DEFAULT_DSH_SESSIONS_ROOT };
}

// ── server (ring buffer) ────────────────────────────────────────────────────

export interface ServerConfig {
	/** Ring-buffer entries kept per session for delta polls (10..10 000). */
	ringCapacity: number;
}

export const DEFAULT_SERVER_CONFIG: ServerConfig = { ringCapacity: DEFAULT_RING_CAPACITY };

/**
 * Read the `server` section (`ringCapacity`). Server-side only — never sent
 * over /api/config; dsh-connection reads this directly per trim (no cache,
 * same contract as the other sections).
 */
export function readServerConfig(configPath?: string): ServerConfig {
	const rec = parseConfig(configPath)?.server;
	const section = isConfigRecord(rec) ? rec : {};
	return { ringCapacity: intWithin(section.ringCapacity, 10, 10_000, DEFAULT_RING_CAPACITY) };
}

// ── panel (floor width/zoom bounds) ─────────────────────────────────────────

export interface PanelConfig extends WidthBoundsLike {
	minZoom: number;
	maxZoom: number;
}

interface WidthBoundsLike {
	defaultWidth: number;
	minWidth: number;
	maxWidth: number;
}

export const DEFAULT_PANEL_CONFIG: PanelConfig = {
	defaultWidth: DEFAULT_PANEL_WIDTH,
	minWidth: DEFAULT_PANEL_MIN_WIDTH,
	maxWidth: DEFAULT_PANEL_MAX_WIDTH,
	minZoom: DEFAULT_PANEL_MIN_ZOOM,
	maxZoom: DEFAULT_PANEL_MAX_ZOOM
};

/** Read the `panel` section (widths + zoom bounds; crossed pairs revert). */
export function readPanelConfig(configPath?: string): PanelConfig {
	const section = parseConfig(configPath)?.panel;
	const widths = resolveWidthBounds(
		section,
		{
			defaultWidth: DEFAULT_PANEL_WIDTH,
			minWidth: DEFAULT_PANEL_MIN_WIDTH,
			maxWidth: DEFAULT_PANEL_MAX_WIDTH
		},
		200,
		4_000
	);
	const zooms = resolveZoomBounds(
		section,
		DEFAULT_PANEL_MIN_ZOOM,
		DEFAULT_PANEL_MAX_ZOOM,
		0.25,
		3
	);
	return { ...widths, ...zooms };
}

// ── sidebar (rail width bounds + placement) ─────────────────────────────────

export interface SidebarConfig {
	defaultWidth: number;
	minWidth: number;
	maxWidth: number;
	/**
	 * WHERE the rail renders: 'none' = beside the floor (default — never
	 * scales with zoom); 'panels-zoom' = first column inside the zoom row
	 * (OCI StickyColumnContainer pattern). Unknown values fall back.
	 */
	placement: SidebarPlacement;
}

export const DEFAULT_SIDEBAR_CONFIG: SidebarConfig = {
	defaultWidth: DEFAULT_SIDEBAR_WIDTH,
	minWidth: DEFAULT_SIDEBAR_MIN_WIDTH,
	maxWidth: DEFAULT_SIDEBAR_MAX_WIDTH,
	placement: DEFAULT_SIDEBAR_PLACEMENT
};

/**
 * Read the `sidebar` section (width bounds; crossed pair reverts) plus
 * `placement` (literal-gated: only 'none' | 'panels-zoom' pass).
 */
export function readSidebarConfig(configPath?: string): SidebarConfig {
	const section = parseConfig(configPath)?.sidebar;
	const rec = isConfigRecord(section) ? section : {};
	return {
		...resolveWidthBounds(
			rec,
			{
				defaultWidth: DEFAULT_SIDEBAR_WIDTH,
				minWidth: DEFAULT_SIDEBAR_MIN_WIDTH,
				maxWidth: DEFAULT_SIDEBAR_MAX_WIDTH
			},
			100,
			2_000
		),
		placement: resolveSidebarPlacement(rec.placement)
	};
}

// ── prompts (The Prompt Tags, 2026-09-14: tags vocabulary + dbPath;
//    autoAdd decommissioned per ADR D7 — rows are born only through the
//    tagged save) ────────────────────────────────────────────────────────────

export interface PromptsConfig {
	/** The tag vocabulary offered at save time and by the manager chip row
	 *  (The Prompt Tags ADR, 2026-09-14, D5): string array, each word
	 *  grammar-checked, invalid words dropped; missing/empty/non-array
	 *  falls back to DEFAULT_PROMPT_TAGS. */
	tags: string[];
	/** Library file location (`prompts.dbPath`, e.g. ~/dsi-library/prompts.sqlite).
	 *  A leading `~` expands to the home directory; null = unset — the
	 *  caller falls back to its own default path. */
	dbPath: string | null;
}

export const DEFAULT_PROMPTS_CONFIG: PromptsConfig = {
	tags: [...DEFAULT_PROMPT_TAGS],
	dbPath: null
};

/**
 * Read the `prompts` section (`prompts.tags`, default the five vocabulary
 * words; `prompts.dbPath`, default unset → the caller's default path).
 * `prompts.autoAdd` is decommissioned (The Prompt Tags ADR D7): the /use
 * route is count-only, so no reader carries an insert gate anymore.
 */
export function readPromptsConfig(configPath?: string): PromptsConfig {
	const rec = parseConfig(configPath)?.prompts;
	const section = isConfigRecord(rec) ? rec : {};
	const rawDbPath = section.dbPath;
	const dbPath = typeof rawDbPath === 'string' && rawDbPath.trim().length > 0 ? rawDbPath.trim() : null;
	// D5 gate: array OR plain string (operators write tags: session git plan
	// rca kb without YAML brackets); each word lowercased and grammar-checked,
	// invalid words dropped; missing/empty/fully-invalid -> the defaults.
	const rawTags: unknown[] = Array.isArray(section.tags)
		? section.tags
		: typeof section.tags === 'string'
			? section.tags.split(/[\s,;]+/)
			: [];
	const tags = rawTags
		.filter((w): w is string => typeof w === 'string')
		.map((w) => w.toLowerCase())
		.filter(isValidTagWord);
	return {
		tags: tags.length > 0 ? tags : [...DEFAULT_PROMPTS_CONFIG.tags],
		dbPath
	};
}

// ── workspace — The Settings Tree ADR 2026-09-18 D1 deleted the
//    `workspace.layout` knob and its section reader. No `workspace`
//    section exists; a stale block in settings.yaml is inert text.
//
//    The SAME ADR (D2) adds `readSettingsHomes`: the verbatim settings
//    home roots, so the browser can mint the /dsi-settings · /dsh-settings
//    explorer panels with the server's own homedir truth (never a
//    browser guess). Not operator-tunable — read-only facts.

/** The verbatim settings home roots (~/.dsi, ~/.dsh) — The Settings
 *  Tree ADR 2026-09-18 D2. Never cached; trivially constant. */
export function readSettingsHomes(): { dsi: string; dsh: string } {
	return { dsi: settingsHomeDir('dsi'), dsh: settingsHomeDir('dsh') };
}

// ── terminal (Web Terminal, spec 2026-09-24; ADR 2026-09-23 D3) ─────────────


/** DSI's operator terminal — the `terminal` section of settings.yaml.
 *  `enabled` gates the whole surface (routes and panel no-op when false);
 *  the sizes and grace feed the no-defaults TerminalSpec via the transport's
 *  resolve(request): Spec step — the seam itself applies no defaults. */
export interface TerminalConfig {
	enabled: boolean;
	/** Terminal Theming (ADR-0023 follow-up, 2026-10-11): when true the
	 *  terminal follows html[data-theme] — a light ANSI palette on the
	 *  light floor. Default false: the terminal stays self-dark. */
	theming: boolean;
	tailBytes: number;
	spillMaxBytes: number;
	graceMs: number;
	idleMs: number;
	/** The Terminal Desk (ADR 2026-09-24, D6): the server's resource valve —
	 *  how many live desk sessions one DSI instance tolerates. The open
	 *  route refuses past it (MAX_SESSIONS); the bound lives where the
	 *  PTYs live, never in a client. */
	maxSessions: number;
}

export const DEFAULT_TERMINAL_CONFIG: TerminalConfig = {
	// 2026-10-11 flip (operator decision): terminals are ON by default —
	// the yaml key terminal.enabled: false is now the explicit off-switch.
	enabled: true,
	theming: false,
	tailBytes: DEFAULT_TERMINAL_TAIL_BYTES,
	spillMaxBytes: DEFAULT_TERMINAL_SPILL_BYTES,
	graceMs: DEFAULT_TERMINAL_GRACE_MS,
	idleMs: DEFAULT_TERMINAL_IDLE_MS,
	maxSessions: 8
};

function boolOr(v: unknown, fallback: boolean): boolean {
	return typeof v === 'boolean' ? v : fallback;
}

/** Read the `terminal` section. Not cached — runtime edits apply, same
 *  contract as every other section reader. */
export function readTerminalConfig(configPath?: string): TerminalConfig {
	const rec = parseConfig(configPath)?.terminal;
	const section = isConfigRecord(rec) ? rec : {};
	return {
		enabled: boolOr(section.enabled, DEFAULT_TERMINAL_CONFIG.enabled),
		theming: boolOr(section.theming, DEFAULT_TERMINAL_CONFIG.theming),
		tailBytes: intWithin(section.tailBytes, 4_096, 8_000_000, DEFAULT_TERMINAL_TAIL_BYTES),
		spillMaxBytes: intWithin(section.spillMaxBytes, 1_000_000, 1_000_000_000, DEFAULT_TERMINAL_SPILL_BYTES),
		graceMs: intWithin(section.graceMs, 250, 30_000, DEFAULT_TERMINAL_GRACE_MS),
		idleMs: intWithin(section.idleMs, 100, 60_000, DEFAULT_TERMINAL_IDLE_MS),
		maxSessions: intWithin(section.maxSessions, 1, 32, DEFAULT_TERMINAL_CONFIG.maxSessions)
	};
}

// ── browser (Glass Browser, spec 2026-10-20 The Sticky Glass; ADR-0030 D3) ──

/** The glass browser's operator tunables — the `browser` section of
 *  settings.yaml. `headless` defaults TRUE (operator decision 2026-10-20:
 *  the agent's hands usually run without a desktop window);
 *  `browser.headless: false` is the explicit switch that turns the headed
 *  glass back on. Absent section ⇒ defaults — present behavior, unchanged. */
export interface BrowserConfig {
	enabled: boolean;
	headless: boolean;
	/** The in-process brain's stable listener port (9515 base; scan +60). */
	brainPort: number;
	/** The @playwright/mcp version pin — never float it (ADR-0029 D7 ledger). */
	mcpPin: string;
	/** Root for per-session isolated profiles (--user-data-dir). */
	profileRoot: string;
	maxSessions: number;
	/** Idle-reaper grace: no stream subscribers AND no MCP traffic for this
	 *  long → the session is closed. Safety net, never the owner (D2). */
	idleMs: number;
	/** Screencast JPEG quality 10..100 (amendment 3: captcha legibility).
	 *  No hardware encoder exists in the CDP path — this trades bytes only. */
	screencastQuality: number;
}

export const DEFAULT_BROWSER_CONFIG: BrowserConfig = {
	enabled: true,
	headless: true,
	brainPort: 9515,
	mcpPin: '0.0.83',
	profileRoot: join(homedir(), '.dsi', 'browser-profiles'),
	maxSessions: 4,
	idleMs: 600_000,
	screencastQuality: 90
};

function strOr(v: unknown, fallback: string): string {
	return typeof v === 'string' && v.length > 0 ? v : fallback;
}

/** Read the `browser` section. Not cached — runtime edits apply, same
 *  contract as every other section reader (ADR-0030 D3: per-create read). */
export function readBrowserConfig(configPath?: string): BrowserConfig {
	const rec = parseConfig(configPath)?.browser;
	const section = isConfigRecord(rec) ? rec : {};
	return {
		enabled: boolOr(section.enabled, DEFAULT_BROWSER_CONFIG.enabled),
		headless: boolOr(section.headless, DEFAULT_BROWSER_CONFIG.headless),
		brainPort: intWithin(section.brainPort, 1024, 65_535, DEFAULT_BROWSER_CONFIG.brainPort),
		mcpPin: strOr(section.mcpPin, DEFAULT_BROWSER_CONFIG.mcpPin),
		profileRoot: strOr(section.profileRoot, DEFAULT_BROWSER_CONFIG.profileRoot),
		maxSessions: intWithin(section.maxSessions, 1, 32, DEFAULT_BROWSER_CONFIG.maxSessions),
		idleMs: intWithin(section.idleMs, 10_000, 86_400_000, DEFAULT_BROWSER_CONFIG.idleMs),
		screencastQuality: intWithin(section.screencastQuality, 10, 100, DEFAULT_BROWSER_CONFIG.screencastQuality)
	};
}
