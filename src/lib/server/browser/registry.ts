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

import { chromium, type CDPSession, type BrowserContext, type Page } from 'playwright-core';

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
	readonly code: 'NO_SESSION' | 'CLOSED' | 'NO_TARGET';
	constructor(code: 'NO_SESSION' | 'CLOSED' | 'NO_TARGET', message: string) {
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
	/** Birth viewport — the opener measures its BrowserContent box and passes
	 *  it so the glass is born at the size of the panel it will live in
	 *  (BUGFIX round 11: no more desktop-scale first render). */
	width?: number;
	height?: number;
	/** Initial page URL — navigating paints the page, which is what makes
	 *  screencast emit its first frame (a blank page paints nothing). */
	url?: string;
}

/** One attached page of the glass context: its own CDP session + relay
 *  (ADR-0040 D1 — one relay per page; only the ACTIVE tab streams). */
export interface TabHandle {
	targetId: string;
	cdp: CDPSession;
	relay: BrowserRelay;
	/** ADR-0041: the Playwright page — headless viewport changes MUST go
	 *  through Playwright's own API, or its context-level launch viewport
	 *  emulation re-asserts over any raw CDP override (the fight that kept
	 *  innerWidth pinned at the birth size). */
	page: Page;
}

interface RegistryEntry {
	id: string;
	createdAt: string;
	context: BrowserContext;
	/** Attached tab handles keyed by CDP targetId (ADR-0040 D2). */
	tabs: Map<string, TabHandle>;
	/** The active-tab pointer — server-owned, never panel state (D2). */
	activeTargetId: string | null;
	/** Last requested panel viewport, re-applied on every switch (D4). */
	viewport: { width: number; height: number };
	/** ADR-0041: headless glasses drive the page via Emulation (no real
	 *  window to resize); headed ones via Browser.setWindowBounds. */
	headless: boolean;
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
		e.mcpInProcess = null;
		e.mcpHealth = 'down';
		e.mcpError = 'brain re-homed to a newer glass';
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

	/** The ACTIVE tab's relay — what the stream route binds (ADR-0040 D2). */
	relay(id: string): BrowserRelay {
		const e = this.peek(id);
		const h = e.activeTargetId ? e.tabs.get(e.activeTargetId) : null;
		if (!h) throw new BrowserRegistryRefusal('CLOSED', 'no active tab handle');
		return h.relay;
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
				e.tabs.set(tid, handle);
				if (tid === key) break;
			}
		}
		const h = e.tabs.get(key);
		if (!h) throw new BrowserRegistryRefusal('NO_TARGET', 'no such tab: ' + key);
		return h;
	}

	/** Enumerate the context's page targets (ADR-0040 D5 feed) — type:page
	 *  only; iframes/omnibox/service workers are chrome noise (wire capture
	 *  2026-10-24). Read-only: never attaches, never streams (D1). */
	async listTabs(id: string): Promise<{ targetId: string; url: string; title: string; active: boolean }[]> {
		const e = this.peek(id);
		const src = (e.activeTargetId ? e.tabs.get(e.activeTargetId) : null)?.cdp ?? [...e.tabs.values()][0]?.cdp;
		if (!src) return [];
		const res = (await src.send('Target.getTargets').catch(() => null)) as { targetInfos?: { targetId: string; type: string; url: string; title: string }[] } | null;
		return (res?.targetInfos ?? [])
			.filter((t) => t.type === 'page')
			.map((t) => ({ targetId: t.targetId, url: t.url, title: t.title, active: t.targetId === e.activeTargetId }))
			// CDP does NOT expose Chrome's window tab order (no public API) —
			// sort by title so the strip is deterministic instead of creation-
			// order arbitrary (operator round 3: 'order is not correct').;
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
		'--window-position=-32000,-32000',
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
	context = await launch(false); // no system Chrome — bundled chromium
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
		if (activeTargetId) tabs.set(activeTargetId, { targetId: activeTargetId, cdp, relay, page: context.pages()[0]! });
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
			id, context, tabs, activeTargetId,
			// ADR-0041: the remembered viewport STARTS at the birth size — a
			// 1920x1080 default made activate() resize the window to desktop
			// scale before the panel's first viewport POST arrived.
			viewport: { width: Math.max(200, Math.min(1920, options.width ?? 730)), height: Math.max(120, Math.min(1080, options.height ?? 830)) },
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
			createdAt: new Date().toISOString()
		};
		state().entries.set(id, entry);

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
	 *  damage is the only reliable way to make screencast emit a frame. */
	async navigate(id: string, url: string, opts?: { waitLoad?: boolean; targetId?: string }): Promise<void> {
		const e = this.peek(id);
		const h = await this.handleOf(e, opts?.targetId);
		await h.cdp.send('Page.enable').catch(() => undefined);
		if (opts?.waitLoad) {
			const loaded = this.waitLoad(h);
			await h.cdp.send('Page.navigate', { url });
			await loaded;
			return;
		}
		await h.cdp.send('Page.navigate', { url });
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
		await this.seedAfterResize(handle, prevSeq).catch(() => undefined);
	}

	/** ADR-0041 D3: a resize must REPAINT, not wait for the next page
	 *  change — the screencast speaks only on change, so a static page
	 *  keeps the old-aspect frame letterboxed on the panel forever (the
	 *  operator's black bands, 2026-10-25). Bounded grace for a FRESH
	 *  frame (seq past prevSeq); silence answers with the deterministic
	 *  captureScreenshot seed — activate()'s first-frame idiom re-fired
	 *  for the resize path. Never hangs the verb past the grace. */
	private async seedAfterResize(handle: { cdp: import('playwright-core').CDPSession; relay: BrowserRelay }, prevSeq: number): Promise<void> {
		for (let i = 0; i < 10 && (handle.relay.latestFrame()?.seq ?? -1) === prevSeq; i += 1) {
			await new Promise((r) => setTimeout(r, 100));
		}
		if ((handle.relay.latestFrame()?.seq ?? -1) !== prevSeq) return; // a fresh frame beat the seed
		const cfg: BrowserConfig = readBrowserConfig();
		const shot = (await handle.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: cfg.screencastQuality }).catch(() => null)) as { data?: string } | null;
		if (shot?.data) handle.relay.seed({ seq: 0, jpeg: shot.data, metadata: { seeded: true, resize: true } });
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

	/** Open a NEW tab in the glass at `url` and make it the active face
	 *  (the context menu's 'open in new tab' verbs). Returns the new tab. */
	async openTab(id: string, url: string, opts?: { activate?: boolean }): Promise<{ targetId: string; seq: number; jpeg: string | null; url: string; title: string }> {
		const e = this.peek(id);
		if (e.closed) throw new BrowserRegistryRefusal('CLOSED', 'session is closing');
		const src = (e.activeTargetId ? e.tabs.get(e.activeTargetId) : null)?.cdp ?? [...e.tabs.values()][0]?.cdp;
		if (!src) throw new BrowserRegistryRefusal('CLOSED', 'no tab handle to create from');
		// create BLANK then navigate through the verb seam — createTarget with
		// a URL races its own navigation and lands on chrome-error (observed
		// 2026-10-25); blank + navigate(targetId) is the proven path
		const res = (await src.send('Target.createTarget', { url: 'about:blank' })) as { targetId?: string } | null;
		const targetId = res?.targetId;
		if (!targetId) throw new BrowserRegistryRefusal('NO_TARGET', 'Target.createTarget returned no id');
		await this.navigate(id, url, { waitLoad: true, targetId });
		if (opts?.activate ?? true) await this.activate(id, targetId);
		// boundary payload (ADR-0040 D4): the caller paints THIS frame before
		// its SSE re-attaches, so the mirror never freezes on the old face
		const h = e.tabs.get(targetId);
		const pi = await this.pageInfo(id, targetId).catch(() => ({ url, title: '' }));
		return { targetId, seq: h?.relay.latestFrame()?.seq ?? 0, jpeg: h?.relay.latestFrame()?.jpeg ?? null, url: pi.url || url, title: pi.title };
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
			await Promise.race([
				handle.page.setViewportSize({ width: e.viewport.width, height: e.viewport.height }).catch(() => undefined),
				new Promise((res) => setTimeout(res, 2500))
			]);
			return;
		}
		const race = async (p: Promise<unknown>, fb: unknown): Promise<unknown> => await Promise.race([p.catch(() => fb), new Promise((res) => setTimeout(() => res(fb), 2500))]);
		const anyCdp = handle.cdp as { send: (method: string, params?: unknown) => Promise<unknown> };
		const dims = (await race(anyCdp.send('Runtime.evaluate', { expression: 'JSON.stringify({ oh: window.outerHeight - window.innerHeight, ow: window.outerWidth - window.innerWidth })', returnByValue: true }), null)) as { result?: { value?: string } } | null;
		let chromeH = 0, chromeW = 0;
		try { const d = JSON.parse((dims && dims.result && dims.result.value) || '{}'); chromeH = Number(d.oh) || 0; chromeW = Number(d.ow) || 0; } catch { /* defaults */ }
		const anyCdp2 = handle.cdp as { send: (method: string, params?: unknown) => Promise<unknown> };
		const win = (await race(anyCdp2.send('Target.getWindowForTarget'), null)) as { windowId?: number } | null;
		if (win && win.windowId) {
			await race(anyCdp2.send('Browser.setWindowBounds', { windowId: win.windowId, bounds: { width: Math.max(200, e.viewport.width + chromeW), height: Math.max(120, e.viewport.height + chromeH), windowState: 'normal' } }), null);
			const check = (await race(anyCdp2.send('Browser.getWindowForTarget', { targetId: e.activeTargetId }), null)) as { bounds?: { width?: number; height?: number } } | null;
			console.log('[window] resized ->', JSON.stringify(check && check.bounds ? check.bounds : check), 'want', e.viewport.width + chromeW, 'x', e.viewport.height + chromeH);
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
	async closeTab(id: string, targetId: string): Promise<{ ok: boolean; activeTargetId: string | null }> {
		const e = this.peek(id);
		if (e.closed) throw new BrowserRegistryRefusal('CLOSED', 'session is closing');
		if (e.tabs.size <= 1) throw new BrowserRegistryRefusal('NO_TARGET', 'cannot close the last tab — use the trash to close the glass');
		const victim = e.tabs.get(targetId);
		if (!victim) throw new BrowserRegistryRefusal('NO_TARGET', 'no such tab: ' + targetId);
		victim.relay.stop();
		e.tabs.delete(targetId);
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