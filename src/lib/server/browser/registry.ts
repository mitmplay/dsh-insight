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
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { chromium, type CDPSession, type BrowserContext } from 'playwright-core';

import { readBrowserConfig, type BrowserConfig } from '$lib/server/insight-config.js';

/** The MCP brain version — PINNED (spec W3 3.1; the ADR-0029 D7 ledger: the
 *  package pins its own playwright copy, never float it). */
export const PLAYWRIGHT_MCP_PIN = '0.0.83';

/** The in-process brain's STABLE listener port — the static preset entry
 *  (dsh-app-dev-preset's mcp-client instance) points here, so the URL never
 *  moves. One brain at a time (the browser panel is a floor singleton). */
export const MCP_BRAIN_PORT = Number(process.env.DSI_MCP_PORT ?? 9515);

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

export class BrowserRegistryRefusal extends Error {
	readonly code: 'NO_SESSION' | 'CLOSED';
	constructor(code: 'NO_SESSION' | 'CLOSED', message: string) {
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
}

export interface OpenOptions {
	/** Headed is the point (ADR-0029 D1); override only in tests. */
	headless?: boolean;
	/** Test seam: skip the MCP child spawn (Wave 3 wires it for real). */
	spawnMcp?: boolean;
	/** Test seam: fixed port. */
	port?: number;
	/** Initial page URL — navigating paints the page, which is what makes
	 *  screencast emit its first frame (a blank page paints nothing). */
	url?: string;
}

interface RegistryEntry {
	id: string;
	createdAt: string;
	context: BrowserContext;
	cdp: CDPSession;
	relay: BrowserRelay;
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
	mcpInProcess: { connection: unknown; httpServer: unknown; port: number } | null;
	mcpHealth: 'up' | 'down';
	/** Why the brain is down (spawn/connect/bind failure) — surfaces in the
	 *  status strip and list(); null when up or never attempted. */
	mcpError: string | null;
	closed: boolean;
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
		for (const name of readdirSync(root)) {
			if (!keep.has(name)) rmSync(join(root, name), { recursive: true, force: true });
		}
	} catch {
		// no config / no dir / nothing sweepable — a sweep is best-effort
	}
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
					void this.close(e.id).catch(() => undefined);
				}
			},
			Math.min(idleMs / 2, 30_000)
		);
		s.reaperTimer.unref?.();
	}

	relay(id: string): BrowserRelay {
		return this.peek(id).relay;
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
		const ignoreDefaultArgs = ['--enable-automation', '--mute-audio'];
		const launch = (useChrome: boolean) => chromium.launchPersistentContext(profileDir, {
	...(useChrome ? { channel: 'chrome' as const } : {}),
	headless: options.headless ?? cfg.headless,
	ignoreDefaultArgs,
	args: [
		'--remote-debugging-port=' + port,
		'--no-first-run',
		// occlusion kills compositing — a covered window stops painting,
		// and the screencast (and the glass) freezes: keep it compositing.
		// OFF-screen parking: the panel is the browser's face, the OS window
		// is the chassis
		'--disable-blink-features=AutomationControlled',
		'--disable-features=IsolateOrigins,site-per-process',
		'--disable-dev-shm-usage',
		'--disable-backgrounding-occluded-windows',
		'--disable-renderer-backgrounding',
		'--disable-background-timer-throttling',
		// the glass has no physical keys: page media must autoplay WITH
		// sound (operator report 2026-10-20 — silent headless YouTube)
		'--autoplay-policy=no-user-gesture-required',
		'--window-position=-32000,-32000'
	],
	viewport: {width: 1920, height: 1080},
	userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
	timezoneId: 'America/New_York',
	locale: 'en-US'
});
let context: BrowserContext;
try {
	context = await launch(true); // real Chrome: full codecs/Widevine
} catch (chromeErr) {
	context = await launch(false); // no system Chrome — bundled chromium
}
const browser = context.browser();
		// persistent contexts do not expose .process(); the pid comes from the
		// port we own (lsof) — the same handle close() verifies with.
		const pid = pidOfPort(port);
		const cdp = await context.newCDPSession(context.pages()[0] ?? (await context.newPage()));
		const relay = new BrowserRelay(cdp, cfg.screencastQuality, cfg.screencastMaxFps);
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

		// Env override beats the yaml default (DSI_MCP_PORT; tests live in the
		// isolated 19515 range) — the operator's explicit env is still the
		// sharpest instrument (ADR-0030 D3).
		const brainPort = Number(process.env.DSI_MCP_PORT ?? cfg.brainPort);
		if (cfg.enabled) this.ensureReaper(cfg.idleMs);
		const entry: RegistryEntry = {
			id, context, cdp, relay, port, pid, profileDir,
			brainPort,
			streamSubscribers: 0,
			lastMcpActivity: Date.now(),
			mcpChild: null,
			mcpInProcess: null,
			mcpHealth: 'up',
			mcpError: null,
			closed: false,
			createdAt: new Date().toISOString()
		};
		state().entries.set(id, entry);

		if (options.spawnMcp ?? true) {
			if (process.env.DSI_MCP_IN_PROCESS === '1') {
				// D7 dev shape: the brain runs IN this process (createConnection
				// + sibling SSE listener, the README programmatic pattern)
				try {
					entry.mcpInProcess = await startInProcessMcp(entry.port, brainPort, () => {
						entry.lastMcpActivity = Date.now();
					});
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
	async close(id: string): Promise<{ ok: boolean; alreadyClosed: boolean }> {
		const entry = state().entries.get(id);
		if (!entry) return { ok: true, alreadyClosed: true };
		if (entry.closed) {
			state().entries.delete(id);
			return { ok: true, alreadyClosed: true };
		}
		entry.closed = true;
		state().closed.add(id);
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
			entry.relay.stop();
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
	private async waitLoad(e: RegistryEntry, capMs = 3000): Promise<void> {
		await new Promise<void>((res) => {
			const on = (p: { loadEventFired?: unknown }) => {
				e.cdp.off('Page.loadEventFired', on as never);
				res();
			};
			e.cdp.on('Page.loadEventFired', on as never);
			setTimeout(res, capMs);
		});
	}

	/** Navigate the session's active page — public because causing page
	 *  damage is the only reliable way to make screencast emit a frame. */
	async navigate(id: string, url: string, opts?: { waitLoad?: boolean }): Promise<void> {
		const e = this.peek(id);
		await e.cdp.send('Page.enable').catch(() => undefined);
		if (opts?.waitLoad) {
			const loaded = this.waitLoad(e);
			await e.cdp.send('Page.navigate', { url });
			await loaded;
			return;
		}
		await e.cdp.send('Page.navigate', { url });
	}

	/** Match the page viewport to the panel's glass box (ADR-0031
	 *  amendment 2): the screencast frame then equals the panel size, so
	 *  the mirror shows content at native scale instead of zooming a
	 *  fixed default viewport. CDP-side clamps keep hostile sizes out. */
	async setViewport(id: string, width: number, height: number): Promise<void> {
		const w = Math.max(200, Math.min(8192, Math.round(width)));
		const h = Math.max(120, Math.min(8192, Math.round(height)));
		const e = this.peek(id);
		await e.cdp.send('Page.enable').catch(() => undefined);
		await e.cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 0, mobile: false });
	}

	/** The history position (ADR-0031): every proxy-verb answer carries it
	 *  so the header's back/forward buttons stay honest at the ends. */
	async navInfo(id: string): Promise<{ currentIndex: number; entryCount: number }> {
		const e = this.peek(id);
		await e.cdp.send('Page.enable').catch(() => undefined);
		const hist = (await e.cdp.send('Page.getNavigationHistory', {})) as unknown as {
			currentIndex: number;
			entries: unknown[];
		};
		return { currentIndex: hist.currentIndex, entryCount: hist.entries.length };
	}

	/** Reload the session's active page (ADR-0031 D4): Page.reload keeps
	 *  the history entry, unlike re-navigating the current URL. */
	async reload(id: string): Promise<{ url: string; title: string }> {
		const e = this.peek(id);
		await e.cdp.send('Page.enable').catch(() => undefined);
		const loaded = this.waitLoad(e);
		await e.cdp.send('Page.reload', {});
		await loaded;
		return this.pageInfo(id);
	}

	/** Travel the browser's OWN back/forward list (ADR-0031 D3):
	 *  Page.getNavigationHistory picks the entry, Page.navigateToHistoryEntry
	 *  is the browser's travel verb — never Runtime.evaluate('history.back()'),
	 *  which races the teardown and lies about the browser-level list.
	 *  Bounds refusals keep the header buttons honest at the list ends. */
	async pageHistory(id: string, dir: 'back' | 'forward'): Promise<{ url: string; title: string; currentIndex: number; entryCount: number }> {
		const e = this.peek(id);
		await e.cdp.send('Page.enable').catch(() => undefined);
		const hist = (await e.cdp.send('Page.getNavigationHistory', {})) as unknown as {
			currentIndex: number;
			entries: { id: number }[];
		};
		const target = dir === 'back' ? hist.currentIndex - 1 : hist.currentIndex + 1;
		if (target < 0 || target >= hist.entries.length) {
			throw new BrowserRegistryRefusal('CLOSED', 'HISTORY_END — cannot go ' + dir + ' from index ' + hist.currentIndex + ' of ' + hist.entries.length);
		}
		const loaded = this.waitLoad(e);
		await e.cdp.send('Page.navigateToHistoryEntry', { entryId: hist.entries[target].id });
		await loaded;
		return { ...(await this.pageInfo(id)), currentIndex: target, entryCount: hist.entries.length };
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
	async pageInfo(id: string): Promise<{ url: string; title: string; dpr: number; innerWidth: number; innerHeight: number; playerError: string | null; mediaErrorCode: number | null }> {
		const e = this.peek(id);
		// playerError/mediaErrorCode (amendment 5): the page's OWN failure
		// text (e.g. YouTube's .ytp-error-content) + the MediaError code, so
		// a site refusal is diagnosable instead of a mystery
		const raw = await this.evaluateCapped(e.cdp, 'JSON.stringify({ url: location.href, title: document.title, dpr: window.devicePixelRatio, innerWidth: window.innerWidth, innerHeight: window.innerHeight, playerError: (document.querySelector(".ytp-error-content-wrap-reason, .ytp-error-content, [role=alert]")?.textContent || "").trim() || null, mediaErrorCode: (document.querySelector("video")?.error?.code) ?? null })', 3000);
		if (raw === null) return { url: '(busy)', title: '(busy)', dpr: 1, innerWidth: 0, innerHeight: 0, playerError: null, mediaErrorCode: null };
		return JSON.parse(raw) as { url: string; title: string; dpr: number; innerWidth: number; innerHeight: number; playerError: string | null; mediaErrorCode: number | null };
	}

	dispatch(id: string, input: InputDispatch): Promise<void> {
		// A closed id is a TOMBSTONED id — the panel gets 409 CLOSED (its
		// signal to stop), never a 404 masquerading as a typo (D8).
		if (!state().entries.has(id) && state().closed.has(id)) {
			throw new BrowserRegistryRefusal('CLOSED', 'session was closed');
		}
		const e = this.peek(id);
		if (e.closed) throw new BrowserRegistryRefusal('CLOSED', 'session is closing');
		return e.relay.dispatch(input);
	}
}

export const browserRegistry = new BrowserRegistry();
