/**
 * Browser session registry — the server-side owner of the glass browser
 * (spec 2026-10-19 The Glass Browser, Wave 1 task 1.2; ADR-0029 D2/D5/D8).
 *
 * DSI launches and OWNS the headed Chromium (D2): fixed --remote-debugging-port
 * for the CDP mirror, an isolated --user-data-dir so the automation profile is
 * never the operator's daily Chrome (D5). close() is the owner-release path:
 * dispose the MCP handle (child process when present), close CDP, kill the
 * browser, free the port, delete the entry — idempotent (D8: panel-close kills
 * the browser; double close is a no-op, not an error).
 *
 * State survives vite restarts through the process-global idiom the dsh-host
 * plugin established (module instances die on restart, process survives).
 *
 * This module is the WIRING POINT: transport routes import the singleton;
 * nothing imports a route or a component.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { chromium, type CDPSession, type BrowserContext, type Page } from 'playwright-core';

import { readBrowserConfig, type BrowserConfig } from '$lib/server/insight-config.js';

/** The MCP brain version — PINNED (spec W3 3.1; the ADR-0029 D7 ledger: the
 *  package pins its own playwright copy, never float it). */
export const PLAYWRIGHT_MCP_PIN = '0.0.83';

/** The in-process brain's STABLE listener port — the static preset entry
 *  (dsh-app-dev-preset's mcp-client instance) points here, so the URL never
 *  moves. One brain at a time (the browser panel is a floor singleton). */
export const MCP_BRAIN_PORT = Number(process.env.DSI_MCP_PORT ?? 9515);

/** Layout-scale zoom (ADR-0041 amendment, 2026-10-31): the zoom knob is
 *  LAYOUT SCALE — the emulated viewport is the panel box divided by the
 *  zoom, and the mirror's contain-fit does the visual shrinking. The page
 *  keeps ONE coordinate space (no CSS zoom), so every consumer's own
 *  geometry math — YouTube's seek preview included — stays truthful.
 *  Rejected: documentElement CSS zoom (the 2026-10-28..31 implementation) —
 *  Chromium hit-testing stayed correct but the PAGE's own width perception
 *  split in two, and YouTube's player computed seek previews at exactly
 *  the zoom factor off (54:58 vs 1:08:44 at 0.8). */
export function layoutViewport(width: number, height: number, zoom: number): { width: number; height: number } {
	const z = zoom > 0 ? zoom : 1;
	return {
		width: Math.max(200, Math.min(8192, Math.round(width / z))),
		height: Math.max(120, Math.min(8192, Math.round(height / z)))
	};
}

/** Live zoom slider (2026-10-28): the slider's wire bounds — null when the
 *  value is not a finite number in 0.5..1.25 (the route answers 400). */
export function clampZoom(z: unknown): number | null {
	if (typeof z !== 'number' || !Number.isFinite(z)) return null;
	if (z < 0.5 || z > 1.25) return null;
	return z;
}

import { BrowserRelay, type InputDispatch } from './relay.js';

/** The reaper's ONLY test — pure: a session is reaper-eligible when nobody
 *  watches its stream AND its last MCP tool traffic is older than idleMs.
 *  An active agent (traffic younger than idleMs) is NEVER eligible (D2). */
export function reaperEligible(
	e: Pick<RegistryEntry, 'streamSubscribers' | 'lastMcpActivity'>,
	idleMs: number,
	now: number
): boolean {
	if (e.streamSubscribers > 0) return false;
	return now - e.lastMcpActivity >= idleMs;
}

/** Glass-tab-ids task 1: per-session ordinal tab id seams. Pure map
 *  surgery over RegistryEntry — no CDP, no I/O — so the whole lifecycle
 *  (mint → heal-preserve → retire) is unit-testable without a browser.
 *  Ordinals start at 1 and are NEVER reused within a session. */
export type TabRef = number | 'active' | string;
export type TabIdResolution = { ok: true; targetId: string; tabId: number } | { ok: false; error: string };

type OrdinalEntry = Pick<RegistryEntry, 'tabIds' | 'nextTabId' | 'activeTargetId'>;

/** Mint the next ordinal for targetId (idempotent: an already-minted
 *  targetId returns its existing ordinal — lazy attach and heal re-enter). */
export function mintTabId(entry: OrdinalEntry, targetId: string): number {
	// Lazy init: hand-built test entries and pre-task live entries may not
	// carry the map yet — mint is the seam that creates it, so the other
	// helpers can rely on it existing (empty = no ordinals minted).
	const tabIds = (entry.tabIds ??= new Map<number, string>());
	for (const [ord, tid] of tabIds) {
		if (tid === targetId) return ord;
	}
	entry.nextTabId ??= 1; // hand-built test entries may not carry the counter
	const ord = entry.nextTabId;
	entry.nextTabId = ord + 1;
	entry.tabIds.set(ord, targetId);
	return ord;
}

/** ADR-0040 Amendment 4 (D-A5): the OWNER hand claims a newborn. Called
 *  from the entry's own context 'page' listener — a claimed targetId is
 *  owner-born no matter what the browser-level watcher saw first. Pure. */
export function claimOwnerBirth(entry: RegistryEntry, targetId: string): void {
	(entry.ownBirths ??= new Set<string>()).add(targetId);
}

/** ADR-0040 Amendment 4 (D-A6): a GUEST birth is a citizen without the
 *  throne — mint an ordinal, append tabOrder (lands LAST), and NEVER move
 *  the active pointer (appear without stealing focus). Guards: closed
 *  sessions refuse; a target the entry already knows (or the owner hand
 *  claimed) is a no-op. Pure. Returns true when the guest was admitted. */
export function admitGuestBirth(
	e: Pick<RegistryEntry, 'tabOrder' | 'tabs' | 'closed'> & Partial<Pick<RegistryEntry, 'ownBirths'>>,
	targetId: string
): boolean {
	if (e.closed) return false;
	if (e.ownBirths?.has(targetId)) return false;
	if (e.tabOrder.includes(targetId) || e.tabs.has(targetId)) return false;
	e.tabOrder.push(targetId);
	mintTabId(e as unknown as OrdinalEntry, targetId);
	return true;
}

/** Retire a closed tab: drop both map sides. The ordinal itself is gone —
 *  mintTabId never hands it out again. */
export function retireTabId(entry: OrdinalEntry, targetId: string): void {
	if (!entry.tabIds) return;
	for (const [ord, tid] of entry.tabIds) {
		if (tid === targetId) {
			entry.tabIds.delete(ord);
			return;
		}
	}
}

/** HEAL PRESERVES ORDINALS: healHandles swaps a dead CDP handle for a
 *  fresh session — the tab's ordinal must survive with its value
 *  rewritten to the new targetId. An unknown page (first sight during
 *  heal) falls back to a fresh mint. */
export function healPreserveOrdinal(entry: OrdinalEntry, oldTargetId: string, newTargetId: string): number {
	const tabIds = (entry.tabIds ??= new Map<number, string>());
	for (const [ord, tid] of tabIds) {
		if (tid === oldTargetId) {
			entry.tabIds.set(ord, newTargetId);
			return ord;
		}
	}
	return mintTabId(entry, newTargetId);
}

/** Resolve a tab reference — ordinal (number / numeric string), the
 *  'active' pointer, or a raw targetId — to { targetId, tabId }. A
 *  retired or unknown ordinal is an EXPLICIT error: no silent
 *  nearest-match (glass-tab-ids global constraint). */
export function resolveTab(entry: OrdinalEntry, ref: TabRef): TabIdResolution {
	if (ref === 'active') {
		if (!entry.activeTargetId) return { ok: false, error: 'no active tab' };
		for (const [ord, tid] of entry.tabIds ?? []) {
			if (tid === entry.activeTargetId) return { ok: true, targetId: tid, tabId: ord };
		}
		return { ok: false, error: 'active tab has no ordinal: ' + entry.activeTargetId };
	}
	if (typeof ref === 'number' || /^\d+$/.test(ref)) {
		const ord = Number(ref);
		const tid = entry.tabIds?.get(ord);
		if (tid === undefined) return { ok: false, error: 'unknown or retired tab ordinal: ' + ord };
		return { ok: true, targetId: tid, tabId: ord };
	}
	// raw targetId
	for (const [ord, tid] of entry.tabIds ?? []) {
		if (tid === ref) return { ok: true, targetId: tid, tabId: ord };
	}
	return { ok: false, error: 'unknown tab: ' + ref };
}

export class BrowserRegistryRefusal extends Error {
	readonly code: 'NO_SESSION' | 'CLOSED' | 'NO_TARGET' | 'BUSY';
	constructor(code: 'NO_SESSION' | 'CLOSED' | 'NO_TARGET' | 'BUSY', message: string) {
		super(message);
		this.name = 'BrowserRegistryRefusal';
		this.code = code;
	}
}

export interface BrowserSessionInfo {
	id: string;
	port: number;
	pid: number | null;
	profileDir: string;
	createdAt: string;
	mcp: 'child' | 'in-process' | 'none';
	/** MCP brain liveness: 'up' (child alive / connection open), 'down'
	 *  (child died or create failed) — the mirror works regardless (D7
	 *  fallback contract: the glass never depends on the brain). */
	mcpHealth: 'up' | 'down';
	/** Brain failure reason when health is 'down'; null otherwise. */
	mcpError: string | null;
	/** ADR-0045 amendment 3 D7 — owning harness conversation session id;
	 *  null for legacy sessions. The driver's identity match key. */
	ownerSessionId: string | null;
}

export interface OpenOptions {
	/** Headed is the point (ADR-0029 D1); override only in tests. */
	headless?: boolean;
	/** Test seam: skip the MCP child spawn (Wave 3 wires it for real). */
	spawnMcp?: boolean;
	/** Test seam: fixed port. */
	port?: number;
	/** Birth viewport — the opener measures its BrowserContent box and passes
	 *  it so the glass is born at the size of the panel it will live in
	 *  (BUGFIX round 11: no more desktop-scale first render). */
	width?: number;
	height?: number;
	/** Initial page URL — navigating paints the page, which is what makes
	 *  screencast emit its first frame (a blank page paints nothing). */
	url?: string;
	/** ADR-0045 amendment 3 D7 — the opener panel's harness session id;
	 *  recorded so drivers can claim their OWN glass. */
	ownerSessionId?: string;
}

/** One attached page of the glass context: its own CDP session + relay
 *  (ADR-0040 D1 — one relay per page; only the ACTIVE tab streams). */
export interface TabHandle {
	targetId: string;
	/** Glass-tab-ids task 1: the session-stable ordinal minted by
	 *  mintTabId — the panel-facing tab id (never reused in a session). */
	tabId: number;
	cdp: CDPSession;
	relay: BrowserRelay;
	/** ADR-0041: the Playwright page — headless viewport changes MUST go
	 *  through Playwright's own API, or its context-level launch viewport
	 *  emulation re-asserts over any raw CDP override (the fight that kept
	 *  innerWidth pinned at the birth size). */
	page: Page;
}

export interface RegistryEntry {
	id: string;
	createdAt: string;
	context: BrowserContext;
	/** Attached tab handles keyed by CDP targetId (ADR-0040 D2). */
	tabs: Map<string, TabHandle>;
	/** Creation order of the session's tabs — the strip's row order (D5
	 *  amendment 2026-10-27): CDP's Target.getTargets order is NOT creation
	 *  order, so the strip appended new tabs wherever Chrome listed them. */
	tabOrder: string[];
	/** Glass-tab-ids task 1: ordinal → targetId. Stable per-session tab
	 *  ids the panel can address: minted on attach, retired on close,
	 *  NEVER reused (resolveTab is the only reader seam). */
	tabIds: Map<number, string>;
	/** Next ordinal mintTabId hands out (starts at 1; only grows). */
	nextTabId: number;
	/** The active-tab pointer — server-owned, never panel state (D2). */
	activeTargetId: string | null;
	/** D5 amendment 2026-10-27: stream subscribers re-bind when the pointer
	 *  moves — a brain-driven activate() must repoint the SSE, not just the
	 *  strip (the panel only reconnects itself on its OWN strip clicks). */
	activeListeners?: Set<(targetId: string) => void>;
	/** ADR-0040 Amendment 4 (D-A4): browser-scoped birth discovery — one
	 *  browser-level CDP session watching Target.targetCreated for THIS
	 *  Chrome only. Optional: hand-built test entries lack it. */
	browserCdp?: CDPSession;
	/** ADR-0040 Amendment 4 (D-A5): targetIds the OWNER hand (the entry's
	 *  own context 'page' event) has claimed. A browser-level birth that
	 *  matches a claim within the grace window is owner-born (follows);
	 *  an unclaimed one is a GUEST — mints WITHOUT moving the pointer
	 *  (appear without stealing focus, operator ruling 2026-10-31). */
	ownBirths?: Set<string>;
	/** Last requested panel viewport, re-applied on every switch (D4). */
	viewport: { width: number; height: number };
	/** Live zoom slider (2026-10-28, operator-approved): the SESSION's
	 *  content zoom — starts at the config default (browser.contentZoom),
	 *  superseded per-session by setZoom(). Hand-built test entries may
	 *  lack it; readers fall back via "e.zoom ?? cfg.contentZoom". */
	zoom: number;
	/** ADR-0041: headless glasses drive the page via Emulation (no real
	 *  window to resize); headed ones via Browser.setWindowBounds. */
	headless: boolean;
	/** BUG 2026-10-26c: the LEARNED OS window chrome offset (outer − page).
	 *  applyPanelViewport's one-shot evaluate can race out and answer 0,
	 *  which strands the page 87px short of the request; the repair's
	 *  feedback loop measures the truth off the surface frames and stores
	 *  it here, so every later resize starts warm. */
	chrome?: { w: number; h: number };
	port: number;
	/** The brain port this session's brain bound (config/env resolved at
	 *  create — per-create read, ADR-0030 D3). */
	brainPort: number;
	/** Reaper inputs (ADR-0030 D2): the stream route notes subscribers,
	 *  MCP tool traffic notes activity. Zero subscribers + idle past
	 *  `browser.idleMs` = reaper-eligible. */
	streamSubscribers: number;
	lastMcpActivity: number;
	pid: number | null;
	profileDir: string;
	mcpChild: ChildProcess | null;
	/** In-process brain (DSI_MCP_IN_PROCESS=1, ADR-0029 D7): the
	 *  createConnection handle + its sibling SSE listener. */
	mcpInProcess: { connection: unknown; httpServer: unknown; port: number; release?: () => void } | null;
	mcpHealth: 'up' | 'down';
	/** Why the brain is down (spawn/connect/bind failure) — surfaces in the
	 *  status strip and list(); null when up or never attempted. */
	mcpError: string | null;
	/** ADR-0045 amendment 3 D7/D8 — the owning harness conversation's session
	 *  id (DSH_SESSION_ID shape, "session-<uuid>"). The OWNERSHIP authority:
	 *  drivers resolve their own glass by this, never by registry index.
	 *  Null for legacy sessions opened before the field existed. */
	ownerSessionId: string | null;
	closed: boolean;
	/** Ghost Glass Fix 2 (RCA 2026-10-31): death-broadcast subscribers —
	 *  the stream route pushes one 'died' SSE event through these before
	 *  teardown. Lives ON the process-global entry, so an HMR reload of
	 *  browser modules (the very thing that severed SSEs this RCA chased)
	 *  cannot strand the registry-side half of the handshake. */
	deathListeners?: Set<(reason: string) => void>;
}

function state(): { entries: Map<string, RegistryEntry>; closed: Set<string> } {
	const p = process as { __DSI_BROWSER_STATE__?: { entries: Map<string, RegistryEntry>; closed: Set<string> } };
	if (!p.__DSI_BROWSER_STATE__) {
		p.__DSI_BROWSER_STATE__ = { entries: new Map(), closed: new Set() };
		sweepOrphanProfiles(new Set([...p.__DSI_BROWSER_STATE__.entries.keys()].map((id) => id.slice(0, 8))));
	}
	return p.__DSI_BROWSER_STATE__;
}

/** Boot-time sweep of profile dirs left by sessions that died without a
 *  close (crash, kill -9, reaper miss). keep = prefixes of LIVE entries —
 *  a module hot reload re-runs state() init against a process-global map
 *  that may hold live sessions, and this sweep must never delete one. */
function sweepOrphanProfiles(keep: Set<string>): void {
	try {
		const root = readBrowserConfig().profileRoot;
		// Fix 2026-11-05 (browser-proxy-verbs profile-dir flake): the DIR arm
		// is gated off under vitest, same authority rule as the kill arm
		// below — a booting worker's keep-set cannot see another worker's
		// LIVE sessions, and its sweep rmSync'd a sibling's freshly opened
		// profile dir mid-test (existsSync flipped false between open() and
		// the assertion). Production keeps ONE registry, so the sweep runs.
		if (process.env.VITEST) return;
		for (const name of readdirSync(root)) {
			if (keep.has(name)) continue;
			// Ghost Glass Fix 3 (RCA 2026-10-31 Bug 3): sweeping the fingerprint
			// is not removing the body — an orphan Chrome keeps a live CDP port
			// forever (proven: PID 3462, port 9549, dir swept, process immortal).
			// Kill the holder BEFORE the dir goes, so the reaper contract ("an
			// invisible browser must not outlive its last driver") holds even on
			// this abnormal-death path.
			// The kill arm is gated off under vitest: each test worker is a
			// legitimate sibling holder — this worker's keep-set cannot see
			// another worker's LIVE sessions, and killing them is the sweep
			// overreaching its per-process authority (observed live: workers
			// SIGKILLed each other's Chromes mid-suite). Production boots have
			// ONE registry; the injected-deps pins carry the correctness proof.
			if (!process.env.VITEST) {
				killOrphanChrome(name, {
					listPids: () => spawnSync('ps', ['axo', 'pid=,command='], { encoding: 'utf8', timeout: 5000 }).stdout ?? '',
					killPid: (pid, sig) => process.kill(pid, sig)
				});
			}
			rmSync(join(root, name), { recursive: true, force: true });
		}
	} catch {
		// no config / no dir / nothing sweepable — a sweep is best-effort
	}
}

/** Ghost Glass Fix 3 (RCA 2026-10-31 Bug 3): PURE matcher — which process
 *  rows hold a Chrome --user-data-dir that ENDS at the swept profile name?
 *  The name must terminate the dir (path separator before it, end/space
 *  after it), so a PREFIX-sharing sibling profile never matches. */
export function orphanChromePids(psOutput: string, profileName: string): number[] {
	const needle = '--user-data-dir=';
	const pids: number[] = [];
	for (const line of psOutput.split('\n')) {
		const at = line.indexOf(needle);
		if (at === -1) continue;
		const rest = line.slice(at + needle.length);
		const end = rest.search(/[\s"']/);
		const dir = (end === -1 ? rest : rest.slice(0, end)).replace(/\/+$/, '');
		if (!dir.endsWith('/' + profileName)) continue;
		const pid = Number.parseInt(line.trimStart(), 10);
		if (Number.isFinite(pid)) pids.push(pid);
	}
	return pids;
}

/** Ghost Glass Fix 3: the sweep kill arm with the OS injected — SIGKILL
 *  every holder of the profile dir. Best-effort both ways: a failed ps
 *  listing or an already-dead pid (ESRCH) never blocks the dir sweep. */
export function killOrphanChrome(
	profileName: string,
	deps: { listPids: () => string; killPid: (pid: number, signal: NodeJS.Signals) => void }
): void {
	let out: string;
	try {
		out = deps.listPids();
	} catch {
		return;
	}
	for (const pid of orphanChromePids(out, profileName)) {
		try {
			deps.killPid(pid, 'SIGKILL');
		} catch {
			// ESRCH / EPERM — the orphan already died or is unkillable; sweep on
		}
	}
}


/** Brain re-homing (BUGFIX 2026-10-25): release the stable brain port
 *  from any OTHER live session so the NEWEST glass binds it. The DSH
 *  preset's brain URL is static (9515) — without this, the agent keeps
 *  driving an older glass while the operator watches the new one. The
 *  evicted glass mirrors fine; its status strip honestly reports the
 *  brain down (ADR-0029 D7: the mirror never depends on the brain). */
function evictBrainPort(brainPort: number, exceptId: string): void {
	for (const e of state().entries.values()) {
		if (e.id === exceptId || !e.mcpInProcess || e.mcpInProcess.port !== brainPort) continue;
		const brain = e.mcpInProcess as {
			connection?: { close?: () => Promise<void> };
			httpServer?: { closeAllConnections?: () => void; close?: (cb?: () => unknown) => unknown };
		};
		void (async () => {
			try {
				await new Promise<void>((res) => {
					brain.httpServer?.closeAllConnections?.();
					brain.httpServer?.close?.(() => res());
					setTimeout(res, 1500);
				});
				await brain.connection?.close?.();
			} catch {
				// eviction is best-effort — the port scan then frees the seat
			}
		})();
		e.mcpInProcess?.release?.(); // A6 D7e: drop the process-level guard with the brain
		e.mcpInProcess = null;
		e.mcpHealth = 'down';
		e.mcpError = 'brain re-homed to a newer glass';
	}
}

/** A6 D7e — the built floor now carries the brain, so a LATE failure must
 *  demote the brain, never kill the floor. Two guards per brain:
 *  1. an 'error' listener on the sibling http listener (node's default for a
 *     stray server error event is a process exit — that default is fatal to a
 *     production floor);
 *  2. a scoped unhandledRejection guard for the brain's lifetime, filtering
 *     to brain-sourced rejections (playwright/mcp or MCP-SDK frames in the
 *     stack) so unrelated crashes still surface loudly. release() removes the
 *     process-level guard at teardown (evict + D8 close call it). */
export function attachBrainGuards(entry: RegistryEntry): void {
	const brain = entry.mcpInProcess;
	if (!brain) return;
	const demote = (what: string, err: unknown): void => {
		entry.mcpHealth = 'down'; // the mirror keeps working — graceful (D7 fallback)
		entry.mcpError = what + ': ' + (err instanceof Error ? err.message : String(err));
		entry.mcpInProcess = null;
		release();
	};
	const isBrainSourced = (reason: unknown): boolean => {
		const stack = reason instanceof Error ? (reason.stack ?? '') : String(reason);
		return stack.includes('@playwright/mcp') || stack.includes('modelcontextprotocol') || stack.includes('startInProcessMcp');
	};
	const rejectionGuard = (reason: unknown): void => {
		if (entry.mcpInProcess !== brain) return; // the brain was already released
		if (isBrainSourced(reason)) demote('unhandled rejection', reason);
	};
	const release = (): void => {
		process.off('unhandledRejection', rejectionGuard);
		if (entry.mcpInProcess === brain) brain.release = undefined;
	};
	// PREPEND: a host (vitest, a supervisor) may register its own
	// unhandledRejection handler that rethrows — registering first keeps the
	// demotion deterministic even when a later handler throws.
	process.prependListener('unhandledRejection', rejectionGuard);
	brain.release = release;
	(brain.httpServer as { on?: (ev: string, cb: (e: unknown) => void) => void }).on?.('error', (e) => demote('brain listener', e));
}

/** The in-process brain (D7): createConnection attached to the SAME headed
 *  browser via cdpEndpoint, served over a SIBLING http listener (SSE +
 *  messages endpoints) so a streamable-http MCP client (the DSH agent) can
 *  reach it without a child process. Port = session port + 100 (9501...):
 *  unique per session, out of the debug-port range. */
async function startInProcessMcp(browserPort: number, brainPort: number, onTraffic?: () => void): Promise<{ connection: unknown; httpServer: unknown; port: number }> {
	const [{ createConnection }, { StreamableHTTPServerTransport }, http] = await Promise.all([
		import('@playwright/mcp'),
		import('@modelcontextprotocol/sdk/server/streamableHttp.js'),
		import('node:http')
	]);
	const connection = await createConnection({
		browser: { cdpEndpoint: 'http://127.0.0.1:' + browserPort }
	});
	// STREAMABLE-HTTP (not the legacy SSE pair): the DSH mcp-client speaks
	// StreamableHTTPClientTransport — ONE endpoint, POST initialize/tools,
	// JSON responses. Stateless (no session id): each POST carries its own
	// initialize per the SDK's stateless mode; the connection+browser are
	// shared, only the transport lifecycle is per-request.
	const transport = new StreamableHTTPServerTransport({
		sessionIdGenerator: undefined,
		enableJsonResponse: true
	});
	await connection.connect(transport);
	const server = http.createServer(async (req, res) => {
		const url = new URL(req.url ?? '/', 'http://127.0.0.1');
		if (url.pathname !== '/sse') {
			res.statusCode = 404;
			res.end();
			return;
		}
		// SDK 1.25.x unified API: handleRequest dispatches on req.method
		// (the old handlePost/Get/DeleteRequest trio does not exist and its
		// absence threw inside the handler → empty 200s — the operator's bug)
		// Every request is MCP tool traffic — the reaper's idle clock
		// resets here, so an agent mid-task is NEVER reaped (ADR-0030 D2).
		onTraffic?.();
		try {
			await transport.handleRequest(req, res);
		} catch {
			if (!res.writableEnded) res.end();
		}
	});
	// ALL brain ports live in ONE range (9515..9575): the stable primary is
	// the singleton floor brain; additional concurrent brains scan upward.
	// Never the debug-port neighborhood — a live floor's brains would
	// collide with unit tests and other sessions binding +100.
	let port: number;
	try {
		port = await listen(server, brainPort);
	} catch {
		let lastErr: unknown = null;
		port = 0;
		for (let p = brainPort + 1; p <= brainPort + 60; p++) {
			try {
				port = await listen(server, p);
				break;
			} catch (e) {
				lastErr = e;
			}
		}
		if (port === 0) throw lastErr ?? new Error('no free brain port in ' + brainPort + '+ range');
	}
	return { connection, httpServer: server, port };
}

const listen = (server: import('node:http').Server, port: number): Promise<number> =>
	new Promise((res, rej) => {
		const onError = (): void => {
			server.off('listening', onListen);
			rej(new Error('EADDRINUSE ' + port));
		};
		const onListen = (): void => {
			server.off('error', onError);
			const a = server.address();
			res(typeof a === 'object' && a ? a.port : port);
		};
		server.once('error', onError);
		server.once('listening', onListen);
		server.listen(port, '127.0.0.1');
	});

function pidOfPort(port: number): number | null {
	const p = spawnSync('lsof', ['-ti', 'tcp:' + port, '-sTCP:LISTEN'], { stdio: 'pipe' });
	return p.status === 0 ? Number(p.stdout.toString().trim().split('\n')[0]) : null;
}

function portFree(port: number): boolean {
	return spawnSync('lsof', ['-ti', 'tcp:' + port, '-sTCP:LISTEN'], { stdio: 'pipe' }).status !== 0;
}

function freePort(preferred?: number): number {
	if (preferred && portFree(preferred)) return preferred;
	for (let p = 9400; p < 9500; p++) if (portFree(p)) return p;
	throw new Error('no free debug port in 9400..9499');
}


class BrowserRegistry {
	list(): BrowserSessionInfo[] {
		return [...state().entries.values()].map((e) => ({
			id: e.id,
			port: e.port,
			pid: e.pid,
			profileDir: e.profileDir,
			createdAt: e.createdAt,
			ownerSessionId: e.ownerSessionId ?? null,
			mcp: e.mcpChild ? ('child' as const) : e.mcpInProcess ? ('in-process' as const) : ('none' as const),
			mcpHealth: e.mcpHealth,
			mcpError: e.mcpError
		}));
	}

	peek(id: string): RegistryEntry {
		const e = state().entries.get(id);
		if (!e) throw new BrowserRegistryRefusal('NO_SESSION', 'no such browser session');
		return e;
	}

	/** The brain's live SSE URL — the ACTUAL bound port (stable 9515 in the
	 *  common case, session-relative in the rare fallback). */
	mcpBrainUrl(id: string): string {
		const e = this.peek(id);
		const port = e.mcpInProcess?.port ?? e.brainPort;
		return 'http://127.0.0.1:' + port + '/sse';
	}

	/** True when the id was closed (tombstoned) — routes use it to answer
	 *  409 CLOSED instead of a misleading 404. */
	isClosed(id: string): boolean {
		return state().closed.has(id);
	}

	/** Re-bind lookup (ADR-0030 D1): does this persisted id still own a live
	 *  session? Pure read — never creates, never throws. */
	findLive(id: string | null | undefined): boolean {
		if (!id) return false;
		return state().entries.has(id) && !state().closed.has(id);
	}

	/** Reaper inputs — the routes call these so the registry never imports a
	 *  route (the wiring-point rule stays one-directional). */
	noteStreamOpen(id: string): void {
		const e = state().entries.get(id);
		if (e) e.streamSubscribers += 1;
	}

	noteStreamClose(id: string): void {
		const e = state().entries.get(id);
		if (e) e.streamSubscribers = Math.max(0, e.streamSubscribers - 1);
	}

	noteMcpTraffic(id: string): void {
		const e = state().entries.get(id);
		if (e) e.lastMcpActivity = Date.now();
	}

	/** The idle reaper (ADR-0030 D2): a SAFETY NET, never the owner. A
	 *  session with zero stream subscribers and no MCP tool traffic for
	 *  `browser.idleMs` is closed through the SAME idempotent close(id) the
	 *  panel-close click uses. Headless-default makes this a correctness
	 *  requirement: an invisible browser must not outlive its last driver. */
	private ensureReaper(idleMs: number): void {
		const s = state() as { reaperTimer?: ReturnType<typeof setInterval> };
		if (s.reaperTimer) return;
		s.reaperTimer = setInterval(
			() => {
				const now = Date.now();
				for (const e of state().entries.values()) {
					if (!reaperEligible(e, idleMs, now)) continue;
					void this.close(e.id, 'reaped').catch(() => undefined);
				}
			},
			Math.min(idleMs / 2, 30_000)
		);
		s.reaperTimer.unref?.();
	}

	/** The ACTIVE tab's relay — what the stream route binds (ADR-0040 D2). */
	relay(id: string): BrowserRelay {
		const e = this.peek(id);
		const h = e.activeTargetId ? e.tabs.get(e.activeTargetId) : null;
		if (!h) throw new BrowserRegistryRefusal('CLOSED', 'no active tab handle');
		return h.relay;
	}

	/** D5 amendment 2026-10-27: watch the active pointer. The stream route
	 *  re-binds its relay on every fire so a brain-driven activate (creation
	 *  auto-focus) repoints the MIRROR, not just the strip highlight. */
	/** Ghost Glass Fix 2 (RCA 2026-10-31): the death handshake's registry
	 *  side. Subscribers hear ONE reason ('closed' human, 'reaped' reaper);
	 *  subscribing to an already-dead id hears the truth immediately instead
	 *  of polling a ghost. Same shape as onActiveChange. */
	onDeath(id: string, cb: (reason: string) => void): () => void {
		const e = state().entries.get(id);
		if (!e || e.closed) {
			cb('closed');
			return () => undefined;
		}
		(e.deathListeners ??= new Set()).add(cb);
		return () => {
			e.deathListeners?.delete(cb);
		};
	}

	onActiveChange(id: string, cb: (targetId: string) => void): () => void {
		const e = this.peek(id);
		(e.activeListeners ??= new Set()).add(cb);
		return () => {
			e.activeListeners?.delete(cb);
		};
	}

	/** Resolve a verb's target handle: explicit targetId, else the active tab
	 *  (ADR-0040 D3 — one verb seam, optional pointer). An ENUMERATED but
	 *  not-yet-attached target attaches lazily here — attach is not stream
	 *  (D1): verbs may reach any tab the strip can list. */
	private async handleOf(e: RegistryEntry, targetId?: string): Promise<TabHandle> {
		const key = targetId ?? e.activeTargetId ?? undefined;
		if (!key) throw new BrowserRegistryRefusal('NO_TARGET', 'no active tab');
		const have = e.tabs.get(key);
		if (have) return have;
		// name every unmapped page's target: newCDPSession then
		// Target.getTargetInfo (no args = the session's own target).
		// RETRY window: a tab opened via raw CDP (the brain's PUT /json/new)
		// can lag Playwright's pages() by a beat — the headed proof caught a
		// first-tick NO_TARGET race (bugfix 2026-10-24).
		for (let attempt = 0; attempt < 5 && !e.tabs.has(key); attempt += 1) {
			if (attempt > 0) await new Promise((r) => setTimeout(r, 400));
			for (const page of e.context.pages()) {
				const scdp = await e.context.newCDPSession(page);
				let tid: string | null = null;
				try {
					const info = (await scdp.send('Target.getTargetInfo')) as { targetInfo?: { targetId?: string } };
					tid = info.targetInfo?.targetId ?? null;
				} catch {
					// unreachable target — drop the probe session, keep walking
				}
				if (!tid || e.tabs.has(tid)) {
					await scdp.detach().catch(() => undefined);
					continue;
				}
				const cfg: BrowserConfig = readBrowserConfig();
				const handle = { targetId: tid, cdp: scdp, relay: new BrowserRelay(scdp, cfg.screencastQuality, cfg.screencastMaxFps), page };
				void this.applyPanelViewport(e, handle).catch(() => undefined);
				// BUGFIX round 8: brain-created tabs must render at the PANEL's
				// viewport from birth — without this they sat at the 1920x1080
				// launch default and the mirror showed them small and cut off
				await scdp.send('Page.enable').catch(() => undefined);
				await this.applyPanelViewport(e, { cdp: scdp, relay: handle.relay, page }).catch(() => undefined);
				const ord = mintTabId(e, tid);
				e.tabs.set(tid, { ...handle, tabId: ord });
				(e.tabOrder ??= []).push(tid); // self-heals hand-built test entries
				if (tid === key) break;
			}
		}
		const h = e.tabs.get(key);
		if (!h) throw new BrowserRegistryRefusal('NO_TARGET', 'no such tab: ' + key);
		return h;
	}

	/** BUG 2026-10-27 (brain churn leaves stale handles): the registry's
	 *  cached CDP sessions can DIE while the pages live on (brain re-home,
	 *  MCP client reconnect) — listTabs then answers empty, every verb
	 *  NO_TARGETs, and the mirror starves on one frozen frame. Heal: re-probe
	 *  every live page with a FRESH CDP session, replace dead handles, and
	 *  remap the pointer when its target is gone. Called from listTabs when
	 *  enumeration comes back empty — the panel's 2s poll then heals the
	 *  whole session without operator action. */
	private async healHandles(e: RegistryEntry): Promise<void> {
		for (const page of e.context.pages()) {
			let scdp: CDPSession | null = null;
			let tid: string | null = null;
			try {
				scdp = await e.context.newCDPSession(page);
				const info = (await scdp.send('Target.getTargetInfo')) as { targetInfo?: { targetId?: string } };
				tid = info.targetInfo?.targetId ?? null;
			} catch {
				continue; // page unreachable — leave it to the next poll
			}
			if (!tid || !scdp) {
				await scdp?.detach().catch(() => undefined);
				continue;
			}
			const old = e.tabs.get(tid);
			if (old) {
				const dead = await old.cdp.send('Target.getTargetInfo').then(() => false).catch(() => true);
				if (!dead) {
					await scdp.detach().catch(() => undefined);
					continue; // cached handle healthy — nothing to heal
				}
				old.relay.stop();
				await old.cdp.detach().catch(() => undefined);
				const cfg: BrowserConfig = readBrowserConfig();
				// Glass-tab-ids: the fresh handle keeps the tab's ordinal — the
				// value is rewritten to the new targetId, the key never moves.
				const ord = healPreserveOrdinal(e, tid, tid);
				e.tabs.set(tid, { targetId: tid, tabId: ord, cdp: scdp, relay: new BrowserRelay(scdp, cfg.screencastQuality, cfg.screencastMaxFps), page });
				if (!e.tabOrder.includes(tid)) e.tabOrder.push(tid);
			} else {
				// unknown live page — drop the probe; handleOf attaches lazily
				await scdp.detach().catch(() => undefined);
			}
		}
		if (e.activeTargetId && !e.tabs.has(e.activeTargetId)) {
			e.activeTargetId = [...e.tabs.keys()][0] ?? null;
		}
	}

	/** Enumerate the context's page targets (ADR-0040 D5 feed) — type:page
	 *  only; iframes/omnibox/service workers are chrome noise (wire capture
	 *  2026-10-24). Mirror-lifecycle (ADR "The Mirror Must Face a Living
	 *  Tab", D1/D2): enumeration ADOPTS unknown live pages (mint + lazy
	 *  seam — survivors' ordinals never move) and RE-POINTS the active
	 *  pointer when its target is gone, re-seeding the mirror through
	 *  activate's idiom — the panel never faces a corpse (the 2026-10-28
	 *  frozen-frame bug). */
	async listTabs(id: string): Promise<{ tabId: number; targetId: string; url: string; title: string; active: boolean }[]> {
		const e = this.peek(id);
		const pickSrc = (): CDPSession | null =>
			(e.activeTargetId ? e.tabs.get(e.activeTargetId) : null)?.cdp ?? [...e.tabs.values()][0]?.cdp ?? null;
		const readTargets = async (h: CDPSession): Promise<{ targetId: string; type: string; url: string; title: string }[] | null> => {
			const res = (await h.send('Target.getTargets').catch(() => null)) as { targetInfos?: { targetId: string; type: string; url: string; title: string }[] } | null;
			return res?.targetInfos ?? null; // null = the handle itself is dead
		};
		let src = pickSrc();
		let infos = (src ? await readTargets(src) : null) ?? [];
		if (infos === null || (infos.length === 0 && e.context.pages().length > 0)) {
			// stale-handle state (brain churn, target death) — heal known
			// handles once, then re-read; adoption below covers survivors the
			// map never knew (the 2026-10-28 gap: heal dropped unknowns).
			await this.healHandles(e);
			src = pickSrc();
			infos = (src ? await readTargets(src) : null) ?? [];
		}
		let pages = infos.filter((t) => t.type === 'page');
		if (pages.length === 0 && e.context.pages().length > 0) {
			// D1's source of truth when enumeration cannot see: probe the
			// context's LIVE pages directly — a dead-faced session must still
			// learn who survives (the 2026-10-28 frozen-frame gap).
			const probed: { targetId: string; type: string; url: string; title: string }[] = [];
			for (const page of e.context.pages()) {
				try {
					const scdp = await e.context.newCDPSession(page);
					const info = (await scdp.send('Target.getTargetInfo')) as { targetInfo?: { targetId?: string; url?: string; title?: string } };
					await scdp.detach().catch(() => undefined);
					if (info.targetInfo?.targetId) {
						probed.push({ targetId: info.targetInfo.targetId, type: 'page', url: info.targetInfo.url ?? page.url(), title: info.targetInfo.title ?? '' });
					}
				} catch {
					continue; // unreachable this poll — the next poll retries
				}
			}
			pages = probed;
		}
		// D1: ADOPT unknown live pages — a page the glass holds that the map
		// never minted (fixture tabs, post-churn births) joins the strip with
		// the next ordinal; survivors' ordinals never move.
		const known = new Set(e.tabs.keys());
		const unknown = pages.filter((t) => !known.has(t.targetId));
		if (unknown.length > 0) {
			const cfg: BrowserConfig = readBrowserConfig();
			for (const page of e.context.pages()) {
				let tid: string | null = null;
				let scdp: CDPSession | null = null;
				try {
					scdp = await e.context.newCDPSession(page);
					const info = (await scdp.send('Target.getTargetInfo')) as { targetInfo?: { targetId?: string } };
					tid = info.targetInfo?.targetId ?? null;
				} catch {
					continue; // unreachable this poll — the next poll retries
				}
				if (!tid || !unknown.some((u) => u.targetId === tid)) {
					await scdp.detach().catch(() => undefined);
					continue;
				}
				const ord = mintTabId(e, tid);
				if (!e.tabOrder.includes(tid)) e.tabOrder.push(tid);
				e.tabs.set(tid, { targetId: tid, tabId: ord, cdp: scdp, relay: new BrowserRelay(scdp, cfg.screencastQuality, cfg.screencastMaxFps), page });
			}
		}
		const out = pages
			// Glass-tab-ids: every listed row is addressable by its session-stable
			// ordinal — mint is idempotent, so first-sight here is the same lazy
			// seam handleOf uses (no CDP attach happens in this read-only path).
			.map((t) => ({ tabId: mintTabId(e, t.targetId), targetId: t.targetId, url: t.url, title: t.title, active: t.targetId === e.activeTargetId }))
			// D5 amendment 2026-10-27: CDP does NOT expose Chrome's window tab
			// order — sort by the registry's OWN creation record (tabOrder) so a
			// created tab lands LAST like a real browser's. (The old comment
			// promised a title sort that was never written; getTargets order is
			// enumeration-arbitrary — the bug behind 'order is not correct'.)
			.sort((a, b) => {
				const order = e.tabOrder ?? [];
				const ia = order.indexOf(a.targetId);
				const ib = order.indexOf(b.targetId);
				return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
			});
		// D2: the pointer must face a target getTargets still lists. A dead
		// face re-points to the birth-ordered first survivor, re-seeded through
		// activate's own idiom (viewport, zoom, boundary frame) — the operator
		// sees a tab switch, never a corpse. Zero survivors: pointer null, the
		// empty strip is the honest answer.
		if (e.activeTargetId && !out.some((r) => r.targetId === e.activeTargetId)) {
			const survivor = out[0]?.targetId ?? null;
			if (survivor) {
				await this.activate(id, survivor).catch(() => undefined);
				for (const r of out) r.active = r.targetId === e.activeTargetId;
			} else {
				e.activeTargetId = null;
			}
		}
		return out;
	}

	/** Attach (lazily), seed the first frame, re-apply the viewport, and move
	 *  the active pointer (ADR-0040 D1/D2/D4). The OLD active relay pauses —
	 *  only the active tab streams. Returns the boundary payload. */
	async activate(id: string, targetId: string): Promise<{ targetId: string; seq: number; jpeg: string | null; url: string; title: string }> {
		const e = this.peek(id);
		if (e.closed) throw new BrowserRegistryRefusal('CLOSED', 'session is closing');
		const h = await this.handleOf(e, targetId);
		// pause the outgoing face BEFORE moving the pointer (D1 wire economics)
		const old = e.activeTargetId ? e.tabs.get(e.activeTargetId) : null;
		if (old && old.targetId !== targetId) await old.relay.pause().catch(() => undefined);
		await h.cdp.send('Page.enable').catch(() => undefined);
		await this.applyPanelViewport(e, h);
		// ADR-0040 D4: start lazily-attached relays, resume paused ones —
		// a switch must STREAM, not paint one seeded frame and freeze
		// raise the tab to Chrome's FOREGROUND — Chrome composites only the
		// active tab, so a background tab's screencast is silent (the freeze).
		// The window itself stays parked off-screen; the panel is its face.
		await h.cdp.send('Page.bringToFront').catch(() => undefined);
				await h.relay.ensureStreaming().catch(() => undefined);
		// per-switch first-frame contract (D4): the open() idiom re-fired —
		// bounded grace, then a deterministic captureScreenshot seed
		if (h.relay.latestFrame() === null) {
			for (let i = 0; i < 10 && h.relay.latestFrame() === null; i += 1) {
				await new Promise((r) => setTimeout(r, 100));
			}
		}
		if (h.relay.latestFrame() === null) {
			const cfg: BrowserConfig = readBrowserConfig();
			const shot = (await h.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: cfg.screencastQuality }).catch(() => null)) as { data?: string } | null;
			if (shot?.data) h.relay.seed({ seq: 0, jpeg: shot.data, metadata: { seeded: true } });
		}
		e.activeTargetId = targetId;
		for (const l of e.activeListeners ?? []) {
			try {
				l(targetId);
			} catch {
				// a dead listener must not break the switch
			}
		}
		let url = '';
		let title = '';
		try {
			const pi = await this.pageInfo(id, targetId);
			url = pi.url;
			title = pi.title;
		} catch {
			// a hostile page blocking evaluate must not fail the switch
		}
		return { targetId, seq: h.relay.latestFrame()?.seq ?? 0, jpeg: h.relay.latestFrame()?.jpeg ?? null, url, title };
	}

	async open(options: OpenOptions = {}): Promise<BrowserSessionInfo> {
		const cfg: BrowserConfig = readBrowserConfig();
		const id = randomUUID();
		const port = freePort(options.port);
		const profileDir = join(cfg.profileRoot, id.slice(0, 8));
		mkdirSync(profileDir, { recursive: true });

		// launchPersistentContext is the ONLY way to hand a profile dir to
		// playwright (launch() refuses --user-data-dir in args).
		// Anti-bot hardening (bug 2026-10-20: YouTube kills playback with
		// "Something went wrong" on automation-flagged browsers): drop
		// --enable-automation, mask navigator.webdriver, and prefer the REAL
		// Google Chrome (channel: 'chrome' — full codecs/Widevine; Chrome for
		// Testing lacks them). Falls back to the bundled chromium if no
		// system Chrome exists.
		// RCA 2026-10-28 (The Scrollbars Playwright Silenced): Playwright's
		// headless branch appends --hide-scrollbars to EVERY headless launch
		// (playwright-core coreBundle.js:42534) — the mirror keeps its scroll
		// behavior but loses every bar visual, and app.css's themed rails
		// cannot paint over a hidden bar. Veto it by name; the launch gate
		// below proves the veto landed.
		const ignoreDefaultArgs = ['--enable-automation', '--mute-audio', '--hide-scrollbars'];
		const launch = (useChrome: boolean) => chromium.launchPersistentContext(profileDir, {
	...(useChrome ? { channel: 'chrome' as const } : {}),
	headless: options.headless ?? cfg.headless,
	ignoreDefaultArgs,
	args: [
		'--no-first-run',
		'--remote-debugging-port=' + port,
		// occlusion kills compositing — a covered window stops painting,
		// and the screencast (and the glass) freezes: keep it compositing.
		// OFF-screen parking: the panel is the browser's face, the OS window
		// is the chassis
		'--disable-dev-shm-usage',
		'--disable-renderer-backgrounding',
		'--disable-background-timer-throttling',
		'--disable-backgrounding-occluded-windows',
		'--disable-blink-features=AutomationControlled',
		'--disable-features=IsolateOrigins,site-per-process',
		// the glass has no physical keys: page media must autoplay WITH
		// sound (operator report 2026-10-20 — silent headless YouTube)
		'--autoplay-policy=no-user-gesture-required',
		// '--window-position=-32000,-32000', //# if on will failed the yt video
		'--window-size=' + (Math.max(200, Math.min(1920, options.width ?? 730)) + 6) + ',' + (Math.max(120, Math.min(1080, options.height ?? 830)) + 70)
	],
	// ADR-0041 root-cause fix (2026-10-25, the black bands): a FIXED context
	// viewport is a per-session emulation override Playwright owns and
	// re-asserts — it pinned the page at 730x830 FOREVER, so the round-10
	// window resize moved the chassis while the page never followed, and
	// every panel whose box differed letterboxed (top/bottom black bands).
	// HEADED: the WINDOW is the instrument — viewport:null lets the page
	// track Browser.setWindowBounds natively. HEADLESS keeps emulation
	// (headless has no real window to resize).
	viewport: (options.headless ?? cfg.headless)
		? { width: Math.max(200, Math.min(1920, options.width ?? 730)), height: Math.max(120, Math.min(1080, options.height ?? 830)) }
		: null,
	userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
	timezoneId: 'America/New_York',
	locale: 'en-US'
});
let context: BrowserContext;
try {
	context = await launch(true); // real Chrome: full codecs/Widevine
} catch (chromeErr) {
	// The Glass Bootstrap honest error (ADR 2026-11-05, D5): a raw Playwright
	// "Executable doesn't exist" names no cure — rethrow with the revision
	// family and BOTH cures, keeping the originals for the stack reader.
	try {
		context = await launch(false); // no system Chrome — bundled chromium
	} catch (chromiumErr) {
		throw new Error(
			'Glass browser: no browser binary. System Google Chrome failed (' +
				String((chromeErr as Error)?.message ?? chromeErr).slice(0, 120) +
				') and the bundled chromium is missing (' +
				String((chromiumErr as Error)?.message ?? chromiumErr).slice(0, 120) +
				'). Cures: install Google Chrome, or run `npx playwright@<playwright-core version from package.json> install chromium` ' +
				'(the revision must match this playwright-core pin).'
		);
	}
}
const browser = context.browser();
		// persistent contexts do not expose .process(); the pid comes from the
		// port we own (lsof) — the same handle close() verifies with.
		const pid = pidOfPort(port);
		const cdp = await context.newCDPSession(context.pages()[0] ?? (await context.newPage()));
		const relay = new BrowserRelay(cdp, cfg.screencastQuality, cfg.screencastMaxFps);
		// ADR-0040: the birth page is the first tab handle; the pointer starts on it.
		const tabs = new Map<string, TabHandle>();
		let activeTargetId: string | null = null;
		try {
			const info = (await cdp.send('Target.getTargetInfo')) as { targetInfo?: { targetId?: string } };
			activeTargetId = info.targetInfo?.targetId ?? null;
		} catch {
			// best-effort — listTabs/activate recover ids via Target.getTargets later
		}
		// Glass-tab-ids (fix round 1): mint the birth ordinal BEFORE the handle
		// literal — the handle carries tabId from birth (never transiently
		// tabId-less, tsc-clean) and the maps flow straight into the entry.
		const tabIds = new Map<number, string>();
		let nextTabId = 1;
		if (activeTargetId) {
			tabIds.set(1, activeTargetId);
			nextTabId = 2;
			tabs.set(activeTargetId, { targetId: activeTargetId, tabId: 1, cdp, relay, page: context.pages()[0]! });
		}
		await relay.start();
		// A fresh profile window often shows NO first paint until interaction —
		// and screencast emits only on paint. Guarantee the first frame (and
		// give the glass a starter page) by navigating to a tiny new-tab page.
		const start = options.url ?? 'data:text/html,<title>Glass Browser</title><body style="font-family:system-ui;color:gray;display:grid;place-items:center;height:100vh;margin:0">Glass Browser — waiting for the agent</body>';
		await cdp.send('Page.enable').catch(() => undefined);
		await cdp.send('Page.navigate', { url: start }).catch(() => undefined);
		await new Promise((r) => setTimeout(r, 600)); // first paint → first frame
		// First frame is a CONTRACT, not a side effect (RCA 2026-10-23 — The
		// First Frame That Never Knocked): with pipe + --remote-debugging-port
		// both alive, Chrome sometimes starves the screencast's initial frame,
		// and screencast stays silent until the page changes → the ring is born
		// empty forever and the glass freezes on "waiting for frames…". Give a
		// healthy screencast a bounded grace, then synthesize the first frame
		// with a plain captureScreenshot and seed the ring. The port flag STAYS
		// — close()'s pid-via-lsof verification depends on it.
		if (relay.latestFrame() === null) {
			for (let i = 0; i < 10 && relay.latestFrame() === null; i += 1) {
				await new Promise((r) => setTimeout(r, 100));
			}
		}
		if (relay.latestFrame() === null) {
			const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: cfg.screencastQuality }).catch(() => null);
			if (shot) relay.seed({ seq: 0, jpeg: shot.data, metadata: { seeded: true } });
		}
		// Scrollbar-visibility gate (RCA 2026-10-28 — The Scrollbars Playwright
		// Silenced): ignoreDefaultArgs vetoes --hide-scrollbars, but that veto
		// matches by exact flag string — a Playwright rename or bundling would
		// re-hide every bar in the mirror with no error anywhere. Prove the
		// veto landed: a bare overflow:auto probe div must carry a real
		// scrollbar footprint in a HEADLESS launch (headed launches never get
		// the flag). Evaluate failures are skipped — this gate judges paint,
		// not page health; only a DEFINITIVE zero footprint throws.
		if (options.headless ?? cfg.headless) {
			const birth = context.pages()[0];
			if (birth && typeof (birth as unknown as { evaluate?: unknown }).evaluate === 'function') {
				const foot = await birth.evaluate(
					() => {
						const d = document.createElement('div');
						d.style.cssText = 'position:fixed;left:-100px;top:0;width:50px;height:50px;overflow:auto';
						d.innerHTML = '<div style="width:200px;height:200px"></div>';
						document.body.appendChild(d);
						const f = d.offsetHeight - d.clientHeight;
						d.remove();
						return f;
					}
				).catch(() => null);
				if (foot === 0) {
					throw new Error(
						'glass scrollbar gate: bar footprint is 0 in a headless launch — --hide-scrollbars leaked past ignoreDefaultArgs (RCA 2026-10-28)'
					);
				}
			}
		}

		// Env override beats the yaml default (DSI_MCP_PORT; tests live in the
		// isolated 19515 range) — the operator's explicit env is still the
		// sharpest instrument (ADR-0030 D3).
		const brainPort = Number(process.env.DSI_MCP_PORT ?? cfg.brainPort);
		if (cfg.enabled) this.ensureReaper(cfg.idleMs);
		const entry: RegistryEntry = {
			id, context, tabs, activeTargetId,
			// the birth page is tab 0 (D5 amendment 2026-10-27: creation order)
			tabOrder: activeTargetId ? [activeTargetId] : [],
			// Glass-tab-ids: the birth page's ordinal was minted pre-literal
			tabIds,
			nextTabId,
			// ADR-0041: the remembered viewport STARTS at the birth size — a
			// 1920x1080 default made activate() resize the window to desktop
			// scale before the panel's first viewport POST arrived.
			// 2026-10-28 revert (operator screenshot): the acae5c47 1280x800
			// downscale default LETTERBOXED portrait panels — the viewport
			// follows the panel box (syncViewport); the birth default is back
			// at the 730x830 clamps.
			viewport: { width: Math.max(200, Math.min(1920, options.width ?? 730)), height: Math.max(120, Math.min(1080, options.height ?? 830)) },
			// zoom slider: the session starts at the config knob (superseded by setZoom)
			zoom: cfg.contentZoom,
			headless: options.headless ?? cfg.headless,
			port, pid, profileDir,
			brainPort,
			streamSubscribers: 0,
			lastMcpActivity: Date.now(),
			mcpChild: null,
			mcpInProcess: null,
			mcpHealth: 'up',
			mcpError: null,
			closed: false,
			ownerSessionId: options.ownerSessionId ?? null,
			// ADR-0040 Amendment 4 (D-A5): the owner-hand claim set — targetIds
			// born through THIS entry's own context (the 'page' listener below).
			ownBirths: new Set<string>(),
			createdAt: new Date().toISOString()
		};
		state().entries.set(id, entry);
		// D5 amendment 2026-10-27 — a CREATED tab is followed. The brain creates
		// pages through raw Playwright (browser_tabs new), bypassing openTab's
		// activate — the operator asked for the strip to land the new tab LAST
		// AND focus it: a newborn tab is the agent's new working surface. A
		// brain tab SWITCH is still NOT followed (the original D5 rejection
		// stands — the operator's view never moves under them mid-task).
		// typeof-guard: real Playwright contexts always carry .on; the branch
		// tests' minimal fake contexts do not, and the listener is not their subject.
		if (typeof (context as unknown as { on?: unknown }).on === 'function') {
		context.on('page', (page) => {
			void (async () => {
				for (let i = 0; i < 10; i += 1) {
					await new Promise((r) => setTimeout(r, 300));
					try {
						const scdp = await context.newCDPSession(page);
						const info = (await scdp.send('Target.getTargetInfo').catch(() => null)) as { targetInfo?: { targetId?: string } } | null;
						await scdp.detach().catch(() => undefined);
						const tid = info?.targetInfo?.targetId;
						if (!tid) continue;
						if (!entry.tabOrder.includes(tid)) entry.tabOrder.push(tid);
						mintTabId(entry, tid);
						// Amendment 4 (D-A5): the owner hand claims its birth — the
						// browser-level watcher must not re-classify it as a guest.
						claimOwnerBirth(entry, tid);
						// ADR-0040 D2/D3: the follow follows only UNENGAGED tabs. If the
						// operator (or a verb) already attached this tab via handleOf and
						// moved the pointer elsewhere, the pointer must NOT be yanked back
						// when this late retry loop lands. A raw brain-created tab is never
						// pre-attached, so the original D5 amendment intent is unchanged.
						if (entry.activeTargetId !== tid && !entry.closed && !entry.tabs.has(tid)) await this.activate(id, tid);
						return;
					} catch {
						// target not ready yet — retry inside the loop
					}
				}
			})();
		});
		}
		// ADR-0040 Amendment 4 (D-A4/D-A5) — browser-scoped birth discovery:
		// Target.targetCreated on THIS entry's browser sees pages born through
		// ANY CDP connection (glass-url driver, future tools). A birth the
		// owner hand claims within the grace window is owner-born (the
		// 'page' listener above minted + activated it); an unclaimed birth is
		// a GUEST: mint + tabOrder append, pointer NEVER moves (appear
		// without stealing focus — operator ruling 2026-10-31). typeof-guards
		// keep the tests' fake contexts (no .browser()) on the old path.
		try {
			const browser = (context as { browser?: () => unknown }).browser?.() as
				| { newBrowserCDPSession?: () => Promise<CDPSession> }
				| undefined;
			if (browser && typeof browser.newBrowserCDPSession === 'function') {
				const bcdp = await browser.newBrowserCDPSession();
				entry.browserCdp = bcdp;
				await bcdp.send('Target.setDiscoverTargets', { discover: true }).catch(() => undefined);
				bcdp.on(
					'Target.targetCreated',
					(evt: { targetInfo?: { targetId?: string; type?: string } }) => {
						const tid = evt?.targetInfo?.targetId;
						if (!tid || evt.targetInfo?.type !== 'page') return;
						if (entry.tabOrder.includes(tid) || entry.tabs.has(tid)) return;
						void (async () => {
							// grace match: give the owner hand its bounded window to
							// claim the birth (the 300ms x 10 retry idiom).
							for (let g = 0; g < 10; g += 1) {
								await new Promise((r) => setTimeout(r, 300));
								if (entry.closed) return;
								if (entry.ownBirths?.has(tid)) return; // owner path won
								if (entry.tabOrder.includes(tid) || entry.tabs.has(tid)) return;
							}
							admitGuestBirth(entry, tid);
						})();
					}
				);
			}
		} catch {
			// discovery is best-effort — listTabs' poll adoption remains the net
		}
		// BUG 2026-10-26c (the born-banded glass): the launch line guesses the
		// chrome offset (+6/+70) and the REAL chrome costs more - the birth
		// frame came back shorter than the panel and the bands were there
		// from frame one. Measure and compensate exactly like the resize
		// path (headed only; headless has no window to size).
		if (!entry.headless) {
			await this.applyPanelViewport(entry, { cdp, relay }).catch(() => undefined);
			// the ring holds the PRE-resize birth frame and the starter page
			// never repaints - reseed with a capture at the corrected size so
			// the FIRST frame the panel ever paints is already native scale
			const birthShot = (await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: cfg.screencastQuality }).catch(() => null)) as { data?: string } | null;
			if (birthShot?.data) relay.reseed({ seq: 0, jpeg: birthShot.data, metadata: { seeded: true, birth: true } });
		}

		if (options.spawnMcp ?? true) {
			if (process.env.DSI_MCP_IN_PROCESS === '1') {
				// BUGFIX 2026-10-25 (operator report: brain tabs land in a glass the
				// operator is not watching): the stable brain port (9515) is the DSH
				// preset's FIXED URL — a second glass used to scan to 9516 and the
				// agent kept driving the OLD glass. The brain is a FLOOR SINGLETON
				// (ADR-0030): a new glass RE-HOMES it — the previous holder's brain
				// is released (honestly surfaced as down) and 9515 binds HERE.
				evictBrainPort(brainPort, id);
				// D7 dev shape: the brain runs IN this process (createConnection
				// + sibling SSE listener, the README programmatic pattern)
				try {
					entry.mcpInProcess = await startInProcessMcp(entry.port, brainPort, () => {
						entry.lastMcpActivity = Date.now();
					});
					attachBrainGuards(entry);
				} catch (e) {
					entry.mcpHealth = 'down'; // graceful: the mirror still works
					entry.mcpError = (e as Error).message;
				}
			} else {
				this.spawnMcpChild(entry, cfg.mcpPin);
			}
		}
		return {
			id, port, pid, profileDir, createdAt: entry.createdAt,
			ownerSessionId: entry.ownerSessionId,
			mcp: entry.mcpChild ? 'child' : entry.mcpInProcess ? 'in-process' : 'none',
			mcpHealth: entry.mcpHealth,
			mcpError: entry.mcpError
		};
	}

	/** Wave 3 (3.1) owns the real arg matrix; Wave 1 wires the spawn so close
	 *  ordering (mcp child → cdp → browser) is pinned from day one. */
	private spawnMcpChild(entry: RegistryEntry, mcpPin: string): void {
		const child = spawn(
			'npx',
			['@playwright/mcp@' + mcpPin, '--cdp-endpoint', 'http://127.0.0.1:' + entry.port],
			{ stdio: 'ignore', detached: false }
		);
		entry.mcpChild = child;
		child.on('error', (e) => {
			entry.mcpHealth = 'down'; // mirror still works — graceful (D7 fallback)
			entry.mcpError = String(e);
		});
		child.on('exit', (code) => {
			if (entry.mcpChild === child) {
				entry.mcpHealth = 'down';
				entry.mcpError = 'mcp child exited code ' + code;
			}
		});
	}

	/** D8 owner-release. Idempotent: closing a closed id resolves cleanly. */
	async close(id: string, reason = 'closed'): Promise<{ ok: boolean; alreadyClosed: boolean }> {
		const entry = state().entries.get(id);
		if (!entry) return { ok: true, alreadyClosed: true };
		if (entry.closed) {
			state().entries.delete(id);
			return { ok: true, alreadyClosed: true };
		}
		entry.closed = true;
		state().closed.add(id);
		// Ghost Glass Fix 2 (RCA 2026-10-31): a death decided server-side is a
		// death nobody believes until it is ANNOUNCED. Fire the death broadcast
		// FIRST — before any teardown — so the stream route can deliver one
		// honest 'died' SSE event to the operator's panel. A listener bomb
		// must never break the close path.
		for (const cb of entry.deathListeners ?? []) {
			try {
				cb(reason);
			} catch {
				// the broadcast is best-effort; the teardown below is not optional
			}
		}
		// Amendment 4: the browser-level birth watcher dies with the session
		// (best-effort — the browser itself is about to close anyway).
		await entry.browserCdp?.detach().catch(() => undefined);
		if (state().closed.size > 256) state().closed.delete(state().closed.values().next().value as string);
		const errs: unknown[] = [];
		// D8 close ORDER: brain first (it holds the cdpEndpoint), then the
		// mirror, then the browser
		if (entry.mcpInProcess) {
			try {
				const brain = entry.mcpInProcess as {
					connection?: { close?: () => Promise<void> };
					httpServer?: { closeAllConnections?: () => void; close?: (cb?: () => unknown) => unknown };
				};
				// OUR listener first, connections force-dropped (an open SSE
				// client would hold server.close() forever), then the brain
				await new Promise<void>((res) => {
					brain.httpServer?.closeAllConnections?.();
					brain.httpServer?.close?.(() => res());
					setTimeout(res, 2000); // never let teardown wedge the close
				});
				await brain.connection?.close?.();
				brain.release?.(); // A6 D7e: drop the process-level guard with the brain
				entry.mcpInProcess = null;
			} catch (e) {
				errs.push(e);
			}
		}
		if (entry.mcpChild?.pid) {
			try {
				entry.mcpChild.kill('SIGTERM');
			} catch (e) {
				errs.push(e);
			}
		}
		try {
			// every tab handle dies with the session (ADR-0040: tabs live inside
			// ONE context — the kill ladder is unchanged)
			for (const h of entry.tabs.values()) h.relay.stop();
			entry.tabs.clear();
		} catch (e) {
			errs.push(e);
		}
		try {
			await entry.context.close();
		} catch (e) {
			errs.push(e);
		}
		// profile cleanup (operator report 2026-10-20): the isolated
		// --user-data-dir (D5) is session-scoped — closed means GONE, or
		// ~/.dsi/browser-profiles fills with leftovers
		try {
			rmSync(entry.profileDir, { recursive: true, force: true });
		} catch (e) {
			errs.push(e);
		}
		state().entries.delete(id);
		return { ok: errs.length === 0, alreadyClosed: false };
	}

	/** Wait for the page's next load event, capped — the navigate idiom
	 *  (a send races the context teardown otherwise) shared by reload and
	 *  history travel (ADR-0031 D3/D4). */
	private async waitLoad(h: TabHandle, capMs = 3000): Promise<void> {
		await new Promise<void>((res) => {
			const on = (p: { loadEventFired?: unknown }) => {
				h.cdp.off('Page.loadEventFired', on as never);
				res();
			};
			h.cdp.on('Page.loadEventFired', on as never);
			setTimeout(res, capMs);
		});
	}

	/** Navigate the session's active page — public because causing page
	 *  damage is the only reliable way to make screencast emit a frame.
	 *  BUGFIX (ADR-0039 follow-up, 2026-10-25): at a paced cadence finer than
	 *  everyNthFrame=2 (e.g. the operator's live screencastMaxFps: 10 →
	 *  everyNthFrame 3), a HEADLESS single-damage navigate composites only
	 *  1–2 frames and Chrome emits NOTHING — the glass froze on the old face
	 *  after every header navigate. A bounded no-frame grace re-fires the
	 *  deterministic captureScreenshot seed (the activate()/resize idiom):
	 *  pacing still governs LIVE video; a discrete navigation always lands. */
	async navigate(id: string, url: string, opts?: { waitLoad?: boolean; targetId?: string }): Promise<void> {
		const e = this.peek(id);
		const h = await this.handleOf(e, opts?.targetId);
		await h.cdp.send('Page.enable').catch(() => undefined);
		const prevSeq = h.relay.latestFrame()?.seq ?? -1;
		if (opts?.waitLoad) {
			const loaded = this.waitLoad(h);
			await h.cdp.send('Page.navigate', { url });
			await loaded;
		} else {
			await h.cdp.send('Page.navigate', { url });
		}
		void this.seedAfterNavigate(h, prevSeq).catch(() => undefined);
	}

	/** Match the page viewport to the panel's glass box (ADR-0031
	 *  amendment 2): the screencast frame then equals the panel size, so
	 *  the mirror shows content at native scale instead of zooming a
	 *  fixed default viewport. CDP-side clamps keep hostile sizes out. */
	async setViewport(id: string, width: number, height: number, targetId?: string): Promise<void> {
		console.log('[viewport] set', id.slice(0, 8), width + 'x' + height, 'target', targetId ?? 'active');
		const w = Math.max(200, Math.min(8192, Math.round(width)));
		const h = Math.max(120, Math.min(8192, Math.round(height)));
		const e = this.peek(id);
		// remembered so activate() re-applies the panel size on switch (D4)
		e.viewport = { width: w, height: h };
		const handle = await this.handleOf(e, targetId);
		await handle.cdp.send('Page.enable').catch(() => undefined);
		// the seq BEFORE the resize: freshness below is measured as "the ring
		// moved past this", not "a frame exists" — an old-aspect frame must
		// not count as a repaint (ADR-0041 D3)
		const prevSeq = handle.relay.latestFrame()?.seq ?? -1;
		await this.applyPanelViewport(e, handle);
		await this.repairSurfaceAfterResize(e, handle, prevSeq).catch(() => undefined);
	}

	/** Layout-scale zoom (ADR-0041 amendment, 2026-10-31): store the session
	 *  scale and re-apply the panel viewport — the emulation is box/zoom, so
	 *  the slider's LIVE effect rides the resize. Bad input (clampZoom null)
	 *  KEEPS the current zoom and returns silently: unreachable from the wire
	 *  (the route's clampZoom already answered 400) — documented keep. */
	async setZoom(id: string, zoom: number): Promise<void> {
		const e = this.peek(id);
		if (e.closed) throw new BrowserRegistryRefusal('CLOSED', 'session is closing');
		const clamped = clampZoom(zoom);
		if (clamped === null) return; // bad input — keep the current zoom
		e.zoom = clamped;
		const handle = await this.handleOf(e);
		await this.applyPanelViewport(e, handle);
	}
	/** The window id, retried — Target.getWindowForTarget on a Playwright
	 *  page session races out on a COLD headed launch (measured in the
	 *  surface-lag test: both resizes skipped, the birth window kept its
	 *  size). Three bounded tries; the caller's race caps still apply. */
	private async windowIdOf(
		anyCdp: { send: (method: string, params?: unknown) => Promise<unknown> },
		race: (p: Promise<unknown>, fb: unknown) => Promise<unknown>,
		targetId?: string
	): Promise<{ windowId?: number } | null> {
		for (let i = 0; i < 3; i += 1) {
			// Two protocol spellings: a Playwright page session does NOT carry
			// Target.getWindowForTarget (measured — the method is missing), the
			// flat browser-session attach does; Browser.getWindowForTarget is
			// the inverse. Try both before giving up.
			const t = (await race(anyCdp.send('Target.getWindowForTarget'), null)) as { windowId?: number } | null;
			if (t && t.windowId) return t;
			const b = (await race(anyCdp.send('Browser.getWindowForTarget', targetId ? { targetId } : {}), null)) as { windowId?: number } | null;
			if (b && b.windowId) return b;
			await new Promise((r) => setTimeout(r, 500));
		}
		return null;
	}

	/** ADR-0041 D3 + the surface-lag repair (BUG 2026-10-26): a resize must
	 *  REPAINT at the REQUESTED size, not just emit SOME fresh frame. Two
	 *  failure shapes live here:
	 *  1. the SILENT page — the screencast speaks only on change, so a
	 *     static page never repaints (the 2026-10-25 black bands);
	 *  2. the STALE SURFACE — a headed off-screen window takes the new
	 *     RENDERER size but macOS never reallocates the compositor surface:
	 *     every frame (even captureScreenshot) keeps arriving at the OLD
	 *     height, and the panel letterboxes it (the operator's top/bottom
	 *     bands at every height grow). Measured: 53 frames over 6s all at
	 *     the old 832 while innerHeight was 919; captureScreenshot agreed
	 *     with the stale surface. A window-state BOUNCE (minimize ->
	 *     normal — invisible at -32000,-32000) forces the window server to
	 *     reallocate; frames then arrive at the requested size.
	 *  Ladder: grace for a frame whose JPEG dims MATCH the request ->
	 *  bounce (headed only) -> second grace -> deterministic
	 *  captureScreenshot reseed (reseed: a stale REAL frame may sit atop
	 *  the ring, and seed() refuses to cover one). Capped throughout —
	 *  nothing here may hang the verb (the 2.5s rule). */
	private async repairSurfaceAfterResize(e: RegistryEntry, handle: { cdp: import('playwright-core').CDPSession; relay: BrowserRelay; page?: Page }, prevSeq: number): Promise<void> {
		const want0 = { w: e.viewport.width, h: e.viewport.height };
		// BUG 2026-11-02b (live glass, RCA Bug 3 round 2): the frames that
		// arrive are the EMULATED viewport's size (layoutViewport = box/zoom,
		// ADR-0041 amendment 2) — comparing them against the raw BOX made
		// matched() impossible under contentZoom != 1: the ladder exhausted
		// on every resize, its chrome learning never stuck (observed: bounds
		// frozen at lv+15 while the real chrome is 87), and the mirror
		// letterboxed forever. The ladder speaks the emulation's units: want
		// IS the layout viewport now (bounds math, match gate, learning).
		const lvw = layoutViewport(want0.w, want0.h, e.zoom ?? readBrowserConfig().contentZoom);
		const want = { w: lvw.width, h: lvw.height };
		// JPEG SOF scan - every frame's true pixel dims, with or without
		// screencast metadata. The first cut treated unknown dims as FRESH;
		// the birth reseed (no deviceWidth in its metadata) then matched its
		// own stale surface and the repair skipped itself (operator sc#3:
		// surface 733x782 under inner 733x869).
		const dimsOf = (f: ReturnType<BrowserRelay['latestFrame']>): { w: number; h: number } | null => {
			if (!f) return null;
			const md = f.metadata as { deviceWidth?: unknown; deviceHeight?: unknown } | undefined;
			const mw = Number(md?.deviceWidth);
			const mh = Number(md?.deviceHeight);
			if (Number.isFinite(mw) && Number.isFinite(mh) && mw > 0 && mh > 0) return { w: mw, h: mh };
			const b = Buffer.from(f.jpeg, 'base64');
			let i = 2;
			while (i < b.length - 9) {
				if (b[i] !== 0xff) { i += 1; continue; }
				const marker = b[i + 1];
				if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
					return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
				}
				i += Math.max(2, b.readUInt16BE(i + 2));
			}
			return null;
		};
		// The match gate carries the SAME +-2px tolerance as the panel's
		// viewport gate (BUGFIX 2026-10-26b, operator sc#1: a 1px width
		// drift fired the bounce, and the minimize/restore came back SHORT —
		// the cure became the cutoff). A resize is only 'stale' when the
		// surface misses the request by a VISIBLE margin.
		const matched = (): boolean => {
			const f = handle.relay.latestFrame();
			if (!f || f.seq === prevSeq) return false; // no fresh frame yet
			const d = dimsOf(f);
			return d !== null && Math.abs(d.w - want.w) < 3 && Math.abs(d.h - want.h) < 3; // unknown dims = NOT matched (never skip the repair)
		};
		for (let i = 0; i < 10 && !matched(); i += 1) {
			await new Promise((r) => setTimeout(r, 100));
		}
		if (matched()) return;
		if (e.headless) {
			// HEADLESS backstop: no window to bounce or flash — the forcing
			// move is the explicit override (see applyPanelViewport). Left in
			// place; Playwright's own setViewportSize asserts the same size.
			const raceH = async <T>(p: Promise<T>, fb: T): Promise<T> => {
				const timeout = new Promise<T>((res) => setTimeout(() => res(fb), 2500));
				return await Promise.race([p.catch(() => fb), timeout]);
			};
			// Pin through PLAYWRIGHT only (BUG 2026-11-01): the raw sibling-
			// session Emulation override this used to send races the Playwright
			// connection's own writes — cross-connection CDP order is not
			// guaranteed, and under full-suite load the stale zoom-scaled size
			// (box/zoom = 625x500 for a 500x400 box at contentZoom 0.8)
			// executed last, settling innerWidth at 625 forever. One writer
			// (Playwright) makes the final state deterministic: 500x400.
			if (handle.page) await raceH(handle.page.setViewportSize({ width: want.w, height: want.h }).catch(() => undefined).then(() => null as null), null);
			await new Promise((r) => setTimeout(r, 400));
			const shotH = (await raceH(handle.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: readBrowserConfig().screencastQuality }).catch(() => null), null)) as { data?: string } | null;
			if (shotH?.data) handle.relay.reseed({ seq: 0, jpeg: shotH.data, metadata: { seeded: true, resize: true } });
			return;
		}
		if (!e.headless) {
			const race = async <T>(p: Promise<T>, fb: T): Promise<T> => {
				const timeout = new Promise<T>((res) => setTimeout(() => res(fb), 2500));
				return await Promise.race([p.catch(() => fb), timeout]);
			};
			const anyCdp = handle.cdp as { send: (method: string, params?: unknown) => Promise<unknown> };
			const win = await this.windowIdOf(anyCdp, race, e.activeTargetId ?? undefined);
			if (win?.windowId) {
				// STEP 1 — the chrome-offset FEEDBACK loop (operator sc#4, the
				// decisive find): bounds can already be CORRECT (733x869) while
				// the surface shows 733x782 — the one-shot chrome measurement
				// answered 0 and the window's PAGE area is 87px short. The
				// renderer's innerHeight lies; the SURFACE frame is the truth.
				// captureScreenshot forces a fresh surface read even on a static
				// page, so the loop verifies against CAPTURES, not stream frames:
				// adjust the learned offset by the miss and re-set, up to 3 times.
				let cw = e.chrome?.w ?? 0;
				let ch = e.chrome?.h ?? 0;
				console.log('[surface] ladder start want', want.w + 'x' + want.h, 'learned chrome', cw + '/' + ch);
				for (let i = 0; i < 3; i += 1) {
					await race(anyCdp.send('Browser.setWindowBounds', { windowId: win.windowId, bounds: { width: Math.max(200, want.w + cw), height: Math.max(120, want.h + ch), windowState: 'normal' } }), null);
					await new Promise((r) => setTimeout(r, 350));
					const shot = (await race(anyCdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 60 }), null)) as { data?: string } | null;
					// FALLBACK: a failed/timed-out capture on this connection must
					// not corrupt the chrome learning (observed: ch frozen at 15
					// while the real chrome is 87) — the relay's latest STREAM
					// frame is the same surface truth.
					let d = shot?.data ? dimsOf({ jpeg: shot.data, metadata: {} } as ReturnType<BrowserRelay['latestFrame']>) : null;
					if (!d) d = dimsOf(handle.relay.latestFrame());
					if (d && Math.abs(d.w - want.w) < 3 && Math.abs(d.h - want.h) < 3) {
						console.log('[surface] iter', i, 'converged: capture', d.w + 'x' + d.h, 'chrome', cw + '/' + ch);
						e.chrome = { w: cw, h: ch }; // learned — later resizes start warm
						// a STATIC page never repaints: the ring still holds the
						// pre-resize frame — reseed with the verified capture so the
						// mirror actually shows the corrected surface
						if (shot?.data) handle.relay.reseed({ seq: 0, jpeg: shot.data, metadata: { seeded: true, resize: true } });
						return;
					}
					console.log('[surface] iter', i, 'miss: capture', d ? d.w + 'x' + d.h : 'null', 'at bounds', (want.w + cw) + 'x' + (want.h + ch));
					if (!d) continue; // a failed capture must not end the loop
					// ABSOLUTE correction (not accumulated deltas): the REAL chrome
					// offset is exactly currentBounds − capturedSurface. Derive it
					// and set want + realChrome in one shot — immune to compounding
					// errors when a capture lags a beat behind the resize.
					const cur = (await race(anyCdp.send('Browser.getWindowForTarget', { targetId: e.activeTargetId }), null)) as { bounds?: { width?: number; height?: number } } | null;
					if (cur?.bounds?.width && cur?.bounds?.height) {
						cw = Math.max(0, cur.bounds.width - d.w);
						ch = Math.max(0, cur.bounds.height - d.h);
					} else {
						cw += Math.max(0, want.w - d.w);
						ch += Math.max(0, want.h - d.h);
					}
				}
				e.chrome = { w: cw, h: ch };
				// STEP 2 — the surface BOUNCE: with the bounds correct and the
				// surface still stale, force the window server to reallocate.
				await race(anyCdp.send('Browser.setWindowBounds', { windowId: win.windowId, bounds: { windowState: 'minimized' } }), null);
				await race(anyCdp.send('Browser.setWindowBounds', { windowId: win.windowId, bounds: { windowState: 'normal' } }), null);
				// re-assert the exact bounds AFTER restore — the restore itself
				// may have landed short
				await race(anyCdp.send('Browser.setWindowBounds', { windowId: win.windowId, bounds: { width: Math.max(200, want.w + cw), height: Math.max(120, want.h + ch), windowState: 'normal' } }), null);
				await new Promise((r) => setTimeout(r, 300));
				for (let i = 0; i < 10 && !matched(); i += 1) {
					await new Promise((r) => setTimeout(r, 100));
				}
				if (matched()) return;
				// STEP 3 — the on-screen FLASH (operator sc#5): a window resized
				// while parked at -32000 can leave even the PAINT stale — renderer
				// and layout correct, compositor showing an old-era frame, and
				// minimize/restore does not heal it (measured live: bounds and
				// layout 859x905, the mirror painting a 500px-era page). macOS
				// resizes reliably only what it can see: flash the window
				// on-screen ~400ms, then re-park. LAST RESORT — it briefly shows
				// a Chrome window, accepted only after steps 1-2 failed.
				const parked = { width: Math.max(200, want.w + cw), height: Math.max(120, want.h + ch), windowState: 'normal' };
				await race(anyCdp.send('Browser.setWindowBounds', { windowId: win.windowId, bounds: { ...parked, left: 10, top: 10 } }), null);
				await new Promise((r) => setTimeout(r, 400));
				await race(anyCdp.send('Browser.setWindowBounds', { windowId: win.windowId, bounds: { ...parked, left: -32000, top: -32000 } }), null);
				await new Promise((r) => setTimeout(r, 300));
				for (let i = 0; i < 10 && !matched(); i += 1) {
					await new Promise((r) => setTimeout(r, 100));
				}
				if (matched()) return;
				console.log('[surface] ladder exhausted: bounce+flash ran, stream frames still', (() => { const d = dimsOf(handle.relay.latestFrame()); return d ? d.w + 'x' + d.h : 'unknown'; })());
			}
		}
		const cfg: BrowserConfig = readBrowserConfig();
		const shot = (await handle.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: cfg.screencastQuality }).catch(() => null)) as { data?: string } | null;
		const fd = shot?.data ? dimsOf({ jpeg: shot.data, metadata: {} } as ReturnType<BrowserRelay['latestFrame']>) : null;
		console.log('[surface] final reseed capture:', fd ? fd.w + 'x' + fd.h : 'null', 'want', want.w + 'x' + want.h);
		if (shot?.data) handle.relay.reseed({ seq: 0, jpeg: shot.data, metadata: { seeded: true, resize: true } });
	}

	/** The navigate path's seed arm (ADR-0039 follow-up): same bounded grace,
	 *  but the synthesized replacement must land OVER the opener's synthesized
	 *  frame — seed() refuses that, reseed() is the honest verb (the mirror
	 *  froze on the old face after every paced navigate otherwise). */
	private async seedAfterNavigate(handle: { cdp: import('playwright-core').CDPSession; relay: BrowserRelay }, prevSeq: number): Promise<void> {
		for (let i = 0; i < 10 && (handle.relay.latestFrame()?.seq ?? -1) === prevSeq; i += 1) {
			await new Promise((r) => setTimeout(r, 100));
		}
		if ((handle.relay.latestFrame()?.seq ?? -1) !== prevSeq) return; // a real frame beat the seed
		const cfg: BrowserConfig = readBrowserConfig();
		const shot = (await handle.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: cfg.screencastQuality }).catch(() => null)) as { data?: string } | null;
		if (shot?.data) handle.relay.reseed({ seq: 0, jpeg: shot.data, metadata: { seeded: true, navigate: true } });
	}

	/** The history position (ADR-0031): every proxy-verb answer carries it
	 *  so the header's back/forward buttons stay honest at the ends. */
	async navInfo(id: string, targetId?: string): Promise<{ currentIndex: number; entryCount: number }> {
		const e = this.peek(id);
		const h = await this.handleOf(e, targetId);
		await h.cdp.send('Page.enable').catch(() => undefined);
		const hist = (await h.cdp.send('Page.getNavigationHistory', {})) as unknown as {
			currentIndex: number;
			entries: unknown[];
		};
		return { currentIndex: hist.currentIndex, entryCount: hist.entries.length };
	}

	/** The FULL navigation history of one tab (long-press dropdown,
	 *  operator-approved 2026-10-28): the attached CDP session's
	 *  Page.getNavigationHistory, entries as { index, url, title } — index
	 *  is the LIST position the UI filters by, id is the CDP entryId the
	 *  travel verb needs. Read-only; the same handleOf refusals as navInfo. */
	async navEntries(id: string, targetId?: string): Promise<{ currentIndex: number; entries: { index: number; url: string; title: string }[] }> {
		const e = this.peek(id);
		const h = await this.handleOf(e, targetId);
		await h.cdp.send('Page.enable').catch(() => undefined);
		const hist = (await h.cdp.send('Page.getNavigationHistory', {})) as unknown as {
			currentIndex: number;
			entries: { id: number; url: string; title: string }[];
		};
		return {
			currentIndex: hist.currentIndex,
			entries: hist.entries.map((en, index) => ({ index, url: en.url, title: en.title }))
		};
	}

	/** TRUE history travel (long-press dropdown, operator-approved
	 *  2026-10-28): Page.navigateToHistoryEntry to the entry AT the list
	 *  position — never a fresh navigate, which would append a new entry
	 *  and desync the dropdown from Chrome's own back/forward list. A
	 *  position outside the list is an explicit refusal. */
	async historyTravel(id: string, index: number, targetId?: string): Promise<{ currentIndex: number; entryCount: number }> {
		const e = this.peek(id);
		const h = await this.handleOf(e, targetId);
		await h.cdp.send('Page.enable').catch(() => undefined);
		const hist = (await h.cdp.send('Page.getNavigationHistory', {})) as unknown as {
			currentIndex: number;
			entries: { id: number }[];
		};
		if (!Number.isInteger(index) || index < 0 || index >= hist.entries.length) {
			throw new BrowserRegistryRefusal('NO_TARGET', 'HISTORY_INDEX — no entry at index ' + index + ' of ' + hist.entries.length);
		}
		const loaded = this.waitLoad(h);
		await h.cdp.send('Page.navigateToHistoryEntry', { entryId: hist.entries[index].id });
		await loaded;
		return { currentIndex: index, entryCount: hist.entries.length };
	}

	/** Reload the session's active page (ADR-0031 D4): Page.reload keeps
	 *  the history entry, unlike re-navigating the current URL. */
	async reload(id: string, targetId?: string): Promise<{ url: string; title: string }> {
		const e = this.peek(id);
		const h = await this.handleOf(e, targetId);
		await h.cdp.send('Page.enable').catch(() => undefined);
		const loaded = this.waitLoad(h);
		await h.cdp.send('Page.reload', {});
		await loaded;
		return this.pageInfo(id, targetId);
	}

	/** Travel the browser's OWN back/forward list (ADR-0031 D3):
	 *  Page.getNavigationHistory picks the entry, Page.navigateToHistoryEntry
	 *  is the browser's travel verb — never Runtime.evaluate('history.back()'),
	 *  which races the teardown and lies about the browser-level list.
	 *  Bounds refusals keep the header buttons honest at the list ends. */
	async pageHistory(id: string, dir: 'back' | 'forward', targetId?: string): Promise<{ url: string; title: string; currentIndex: number; entryCount: number }> {
		const e = this.peek(id);
		const h = await this.handleOf(e, targetId);
		await h.cdp.send('Page.enable').catch(() => undefined);
		const hist = (await h.cdp.send('Page.getNavigationHistory', {})) as unknown as {
			currentIndex: number;
			entries: { id: number }[];
		};
		const target = dir === 'back' ? hist.currentIndex - 1 : hist.currentIndex + 1;
		if (target < 0 || target >= hist.entries.length) {
			throw new BrowserRegistryRefusal('CLOSED', 'HISTORY_END — cannot go ' + dir + ' from index ' + hist.currentIndex + ' of ' + hist.entries.length);
		}
		const loaded = this.waitLoad(h);
		await h.cdp.send('Page.navigateToHistoryEntry', { entryId: hist.entries[target].id });
		await loaded;
		return { ...(await this.pageInfo(id, targetId)), currentIndex: target, entryCount: hist.entries.length };
	}

	/** Race an evaluate against a cap — a hung evaluate must never wedge a
	 *  route (the navigate-hang finding, spec W2 2.3 debugging). */
	private async evaluateCapped(cdp: import('playwright-core').CDPSession, expr: string, capMs = 3000): Promise<string | null> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const cap = new Promise<null>((res) => {
			timer = setTimeout(() => res(null), capMs);
		});
		try {
			const res = (await Promise.race([cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true }), cap])) as { result?: { value?: string } } | null;
			return res ? String(res.result?.value ?? '') : null;
		} finally {
			if (timer) clearTimeout(timer);
		}
	}

	/** The active page's url + title + inner viewport — the status strip's
	 *  location read, the e2e's DOM-truth channel (the glass proves clicks
	 *  by effects the page itself reports), and the viewport-follow witness
	 *  (innerWidth/innerHeight prove the emulation landed, amend 2). */
	async pageInfo(id: string, targetId?: string): Promise<{ url: string; title: string; dpr: number; innerWidth: number; innerHeight: number; playerError: string | null; mediaErrorCode: number | null }> {
		const e = this.peek(id);
		const h = await this.handleOf(e, targetId);
		// playerError/mediaErrorCode (amendment 5): the page's OWN failure
		// text (e.g. YouTube's .ytp-error-content) + the MediaError code, so
		// a site refusal is diagnosable instead of a mystery
		const raw = await this.evaluateCapped(h.cdp, 'JSON.stringify({ url: location.href, title: document.title, dpr: window.devicePixelRatio, innerWidth: window.innerWidth, innerHeight: window.innerHeight, playerError: (document.querySelector(".ytp-error-content-wrap-reason, .ytp-error-content, [role=alert]")?.textContent || "").trim() || null, mediaErrorCode: (document.querySelector("video")?.error?.code) ?? null })', 3000);
		if (raw === null) return { url: '(busy)', title: '(busy)', dpr: 1, innerWidth: 0, innerHeight: 0, playerError: null, mediaErrorCode: null };
		return JSON.parse(raw) as { url: string; title: string; dpr: number; innerWidth: number; innerHeight: number; playerError: string | null; mediaErrorCode: number | null };
	}

	/** The page element under viewport coords — the glass context menu's
	 *  data pass (BUGFIX 2026-10-25: Chrome's NATIVE right-click menu is
	 *  browser UI and never renders in the screencast, so DSI supplies its
	 *  own menu; this tells it what the right-click landed on). */
	async elementAt(id: string, x: number, y: number, targetId?: string): Promise<{ href: string | null; src: string | null; text: string | null }> {
		const e = this.peek(id);
		const h = await this.handleOf(e, targetId);
		const expr = 'JSON.stringify((() => { const el = document.elementFromPoint(' + Number(x) + ',' + Number(y) + '); if (!el) return { href: null, src: null, text: null }; const a = el.closest("a"); const img = el.closest("img"); return { href: a ? a.href : null, src: img ? (img.currentSrc || img.src) : null, text: (a && a.textContent || "").trim().slice(0, 80) || null }; })())';
		const raw = await this.evaluateCapped(h.cdp, expr, 2000);
		if (raw === null) return { href: null, src: null, text: null };
		try {
			return JSON.parse(raw) as { href: string | null; src: string | null; text: string | null };
		} catch {
			return { href: null, src: null, text: null };
		}
	}

	/** Open a NEW tab in the glass and make it the active face. With a
	 *  `url`: the context-menu open-link/image path — create BLANK then
	 *  navigate through the verb seam (createTarget with a URL races its own
	 *  navigation and lands on chrome-error, observed 2026-10-25). WITHOUT a
	 *  url (ADR-0042 D2, the + chip): createTarget ONLY — the birth state
	 *  again, no navigation. Either way activate() applies the first-frame
	 *  contract (ADR-0040 D4 / ADR-0042 D4: grace, then a captureScreenshot
	 *  seed) and returns the boundary payload the caller paints. */
	async openTab(id: string, url?: string, opts?: { activate?: boolean }): Promise<{ tabId: number; targetId: string; seq: number; jpeg: string | null; url: string; title: string }> {
		const e = this.peek(id);
		if (e.closed) throw new BrowserRegistryRefusal('CLOSED', 'session is closing');
		const src = (e.activeTargetId ? e.tabs.get(e.activeTargetId) : null)?.cdp ?? [...e.tabs.values()][0]?.cdp;
		if (!src) throw new BrowserRegistryRefusal('CLOSED', 'no tab handle to create from');
		const res = (await src.send('Target.createTarget', { url: 'about:blank' })) as { targetId?: string } | null;
		const targetId = res?.targetId;
		if (!targetId) throw new BrowserRegistryRefusal('NO_TARGET', 'Target.createTarget returned no id');
		if (url) await this.navigate(id, url, { waitLoad: true, targetId });
		// Glass-tab-ids: the ordinal is minted by activate's attach (idempotent
		// re-mint here is free) — the wire contract says the opener learns tabId.
		const tabId = mintTabId(e, targetId);
		if (opts?.activate ?? true) {
			const b = await this.activate(id, targetId);
			return { ...b, targetId, tabId };
		}
		// no-activate caller: report whatever the fresh face has so far
		const h = e.tabs.get(targetId);
		return { tabId, targetId, seq: h?.relay.latestFrame()?.seq ?? 0, jpeg: h?.relay.latestFrame()?.jpeg ?? null, url: url ?? 'about:blank', title: '' };
	}

	/** Apply the remembered panel viewport by RESIZING THE WINDOW (round 10:
	 *  emulation-on-headed renders the page centered in the big off-screen
	 *  window — the small/cut-off mirror). Also clears any stale override. */
	/** Resize the glass's WINDOW to the panel size and clear emulation.
	 *  ROUND 10 (the REAL small/cut-off root cause, headed-proven):
	 *  Emulation.setDeviceMetricsOverride on HEADED chrome renders the
	 *  emulated viewport CENTERED INSIDE the physical off-screen window
	 *  (black around it) and the screencast captures the whole window —
	 *  the mirror shows a tiny page. Resizing the WINDOW itself makes the
	 *  page fill it natively; the panel is the window's face (ADR-0029 D1).
	 *  Re-asserted on every attach/switch/setViewport (round 11: something
	 *  re-expands the window — the mirror shrinks again — so this is now
	 *  idempotent and called from all three paths). */
	private async applyPanelViewport(e: RegistryEntry, handle: { cdp: import('playwright-core').CDPSession; relay?: BrowserRelay; page?: Page }): Promise<void> {
		await handle.cdp.send('Page.enable').catch(() => undefined);
		// ADR-0041 headless arm: headless Chrome has no real window AND
		// Playwright owns the launch viewport emulation - a raw CDP override
		// from a sibling session gets re-asserted over (innerWidth stayed
		// pinned at the birth size in the live proof). The viewport MUST go
		// through the Playwright API on the handle, whose state stays
		// authoritative - no fight, no re-assert.
		if (e.headless && handle.page) {
			// Layout-scale zoom (ADR-0041 amendment): emulate box/zoom — the
			// mirror's contain-fit does the visual shrinking; the page keeps ONE
			// coordinate space (no CSS zoom to split its geometry math).
			const lv = layoutViewport(e.viewport.width, e.viewport.height, e.zoom ?? readBrowserConfig().contentZoom);
			// BUG 2026-11-01 (full-suite only): the 2.5s race below ABANDONED a
			// slow setViewportSize — but the call keeps flying and its own
			// internal Emulation.setDeviceMetricsOverride then lands OVER the
			// pinned override the resize repair sets next. Under CPU load
			// innerWidth settled at 625 = 500/0.8 (the layout viewport) instead
			// of the requested 500. Hold the promise and drain the straggler
			// (bounded ceiling) before this method returns.
			const resized = handle.page.setViewportSize({ width: lv.width, height: lv.height }).catch(() => undefined);
			await Promise.race([resized, new Promise((res) => setTimeout(res, 2500))]);
			await Promise.race([resized, new Promise((res) => setTimeout(res, 5000))]);
			// BUG 2026-10-26 (operator sc#7, THE headless root cause): the
			// compositor surface lags the emulation resize — inner said 869
			// while every frame stayed 782, so the mirror letterboxed forever.
			// The raw sibling-session override this arm used to also send is
			// GONE as of 2026-11-01: it rode a SECOND CDP connection, and
			// cross-connection ordering is not guaranteed — under full-suite
			// load it landed AFTER the repair's pin and rolled the page back
			// (innerWidth settled at 625 = 500/0.8).
			// BUG 2026-11-02 (live glass, RCA Bug 3): setViewportSize alone is
			// NOT enough — measured live, the surface stayed 87px short of the
			// metrics (inner 552x698, frames 552x611) across every resize, the
			// headed ladder cannot run here (headless window bounds are PINNED
			// to the emulated viewport — setWindowBounds past it is refused),
			// and the bounce does not heal it. The cure, re-proven live:
			// re-assert Emulation.setDeviceMetricsOverride after the drained
			// resize — the surface repaints at the requested size on the next
			// capture. Sent on a PAGE-SCOPED session (one connection, ordered
			// with Playwright's own writes), never the sibling connection —
			// the 2026-11-01 ordering trap does not apply.
			try {
				const cdp = await handle.page.context().newCDPSession(handle.page);
				const dprEval = await Promise.race([
					handle.page.evaluate('devicePixelRatio').catch(() => 1),
					new Promise((res) => setTimeout(() => res(1), 500))
				]);
				await cdp.send('Emulation.setDeviceMetricsOverride', {
					width: lv.width,
					height: lv.height,
					deviceScaleFactor: typeof dprEval === 'number' && dprEval > 0 ? dprEval : 1,
					mobile: false
				}).catch(() => undefined);
			} catch {
				// best-effort: a unit-mock page has no context(), a dead page has
				// no surface — setViewportSize already ran, the verb still holds
			}
			return;
		}
		const race = async (p: Promise<unknown>, fb: unknown): Promise<unknown> => await Promise.race([p.catch(() => fb), new Promise((res) => setTimeout(() => res(fb), 2500))]);
		const anyCdp = handle.cdp as { send: (method: string, params?: unknown) => Promise<unknown> };
		const dims = (await race(anyCdp.send('Runtime.evaluate', { expression: 'JSON.stringify({ oh: window.outerHeight - window.innerHeight, ow: window.outerWidth - window.innerWidth })', returnByValue: true }), null)) as { result?: { value?: string } } | null;
		// start from the LEARNED offset (the repair's feedback loop may have
		// measured the real one) and refine with a live evaluate when it answers
		let chromeH = e.chrome?.h ?? 0;
		let chromeW = e.chrome?.w ?? 0;
		try { const d = JSON.parse((dims && dims.result && dims.result.value) || '{}'); const oh = Number(d.oh) || 0; const ow = Number(d.ow) || 0; if (oh > 0 || ow > 0) { chromeH = oh; chromeW = ow; } } catch { /* keep learned */ }
		const anyCdp2 = handle.cdp as { send: (method: string, params?: unknown) => Promise<unknown> };
		const win = await this.windowIdOf(anyCdp2, race);
		if (win && win.windowId) {
			const lv = layoutViewport(e.viewport.width, e.viewport.height, e.zoom ?? readBrowserConfig().contentZoom);
			await race(anyCdp2.send('Browser.setWindowBounds', { windowId: win.windowId, bounds: { width: Math.max(200, lv.width + chromeW), height: Math.max(120, lv.height + chromeH), windowState: 'normal' } }), null);
			if (chromeW > 0 || chromeH > 0) e.chrome = { w: chromeW, h: chromeH }; // remember the real offset
			const check = (await race(anyCdp2.send('Browser.getWindowForTarget', { targetId: e.activeTargetId }), null)) as { bounds?: { width?: number; height?: number } } | null;
			console.log('[window] resized ->', JSON.stringify(check && check.bounds ? check.bounds : check), 'want', lv.width + chromeW, 'x', lv.height + chromeH);
		} else {
			console.log('[window] no windowId — resize skipped (raced out)');
		}
		await race(anyCdp2.send('Emulation.clearDeviceMetricsOverride'), null);
	}
	/** Close ONE tab (the strip X): Target.closeTarget, stop its relay,
	 *  drop the handle — and if it was the active face, the pointer moves
	 *  to the first surviving tab (re-activated, first-frame contract
	 *  re-fired). Closing the LAST tab is refused: the kill ladder owns
	 *  session death (the trash is the operator-facing kill). */
	async closeTab(id: string, ref: TabRef): Promise<{ ok: boolean; activeTargetId: string | null }> {
		const e = this.peek(id);
		if (e.closed) throw new BrowserRegistryRefusal('CLOSED', 'session is closing');
		// Glass-tab-ids: the ref may be a session ordinal. An ordinal MUST
		// resolve — retired/unknown is an EXPLICIT NO_TARGET, never a silent
		// nearest-match (global constraint). A non-numeric string stays the
		// raw-targetId path (hand-built test entries and legacy callers).
		let targetId = ref as string;
		if (typeof ref === 'number' || /^\d+$/.test(ref as string)) {
			const r = resolveTab(e, ref);
			if (!r.ok) throw new BrowserRegistryRefusal('NO_TARGET', r.error);
			targetId = r.targetId;
		}
		if (e.tabs.size <= 1) throw new BrowserRegistryRefusal('NO_TARGET', 'cannot close the last tab — use the trash to close the glass');
		const victim = e.tabs.get(targetId);
		if (!victim) throw new BrowserRegistryRefusal('NO_TARGET', 'no such tab: ' + targetId);
		victim.relay.stop();
		e.tabs.delete(targetId);
		// Glass-tab-ids: retire the ordinal (never reused) and drop the
		// creation-order record so the strip sorts the survivors cleanly.
		retireTabId(e, targetId);
		const ordIdx = (e.tabOrder ?? []).indexOf(targetId);
		if (ordIdx !== -1) e.tabOrder.splice(ordIdx, 1);
		await victim.cdp.send('Target.closeTarget', { targetId }).catch(() => undefined);
		await victim.cdp.detach().catch(() => undefined);
		if (e.activeTargetId === targetId) {
			const next = [...e.tabs.keys()][0] ?? null;
			e.activeTargetId = next;
			if (next) await this.activate(id, next).catch(() => undefined);
			else e.activeTargetId = null;
		}
		return { ok: true, activeTargetId: e.activeTargetId };
	}

	async dispatch(id: string, input: InputDispatch, targetId?: string): Promise<void> {
		// A closed id is a TOMBSTONED id — the panel gets 409 CLOSED (its
		// signal to stop), never a 404 masquerading as a typo (D8).
		if (!state().entries.has(id) && state().closed.has(id)) {
			throw new BrowserRegistryRefusal('CLOSED', 'session was closed');
		}
		const e = this.peek(id);
		if (e.closed) throw new BrowserRegistryRefusal('CLOSED', 'session is closing');
		// async (not promise-returning) so NO_TARGET lands as a REJECTION,
		// not a synchronous throw across the route boundary
		await (await this.handleOf(e, targetId)).relay.dispatch(input);
	}
}

export const browserRegistry = new BrowserRegistry();
