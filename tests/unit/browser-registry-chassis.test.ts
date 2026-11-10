/**
 * Registry CHASSIS branch pins (spec 2026-11-08 Glass Chassis Remote CDP,
 * task 1.3-T; ADR-0054 D1/D2/D5). The companion is a mocked HTTP fetch and
 * playwright is mocked — the pins judge BRANCH SELECTION, return-shape
 * equality, and the honest chassis-down throw. The unset-local-launch
 * pins themselves live in the existing suites and stay green unchanged.
 */
// @vitest-environment node
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
	const makeCdp = () => {
		const cdp = new EventEmitter() as EventEmitter & { send: ReturnType<typeof vi.fn> };
		cdp.send = vi.fn(async (method: string) => {
			if (method === 'Target.getTargetInfo') return { targetInfo: { targetId: 'tid-remote' } };
			if (method === 'Page.captureScreenshot') return { data: 'seedjpeg' };
			return {};
		});
		return cdp;
	};
	return {
		makeCdp,
		launchPersistentContext: vi.fn(),
		connectOverCDP: vi.fn()
	};
});

vi.mock('playwright-core', () => ({
	chromium: { launchPersistentContext: h.launchPersistentContext, connectOverCDP: h.connectOverCDP }
}));

// The UNSET pin exercises the real local branch, which mkdirs the disposable
// profile root (~/.dsi) — off-limits in sandboxed runners. Branch selection
// (launch vs companion) is the pin's subject, so the two fs writes are no-ops
// here; the real launch/lifecycle pins live in the existing suites.
vi.mock('node:fs', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:fs')>();
	return { ...actual, mkdirSync: vi.fn(), writeFileSync: vi.fn() };
});

import { browserRegistry } from '$lib/server/browser/registry.js';

const entries = (): Map<string, Record<string, any>> =>
	(process as unknown as { __DSI_BROWSER_STATE__: { entries: Map<string, Record<string, any>> } }).__DSI_BROWSER_STATE__.entries;

const CHASSIS = 'http://192.168.1.9:9560';

function mockChassisResponse(payload: unknown, ok = true, status = 200): ReturnType<typeof vi.fn> {
	return vi.fn(async (input: string | URL, init?: { body?: string }) => ({
		ok,
		status,
		json: async () => {
			if (typeof init?.body === 'string') return payload; // open request → payload
			return payload;
		}
	}) as unknown as Response);
}

function mockRemoteBrowser(): void {
	const cdp = h.makeCdp();
	const page = {};
	const context = {
		pages: () => [page],
		newCDPSession: vi.fn(async () => cdp),
		browser: () => undefined,
		close: vi.fn(async () => undefined)
	};
	h.connectOverCDP.mockResolvedValue({ contexts: () => [context], newContext: vi.fn(), close: vi.fn(async () => undefined) });
}

const companionPayload = {
	id: 'remote-glass-1',
	cdpTarget: 'http://192.168.1.9:9560/cdp/remote-glass-1',
	pid: 4242,
	profileDir: '/Users/mac/.dsi/browser-profiles/remotegl'
};

beforeEach(() => {
	h.launchPersistentContext.mockReset();
	h.connectOverCDP.mockReset();
	delete process.env.GLASS_CHASSIS_URL;
});

afterEach(() => {
	vi.unstubAllGlobals();
	delete process.env.GLASS_CHASSIS_URL;
	for (const id of [...entries().keys()]) void browserRegistry.close(String(id)).catch(() => undefined);
});

describe('registry chassis branch (ADR-0054 D2)', () => {
	it('STAMPED: open() births via the companion (fetch /open) and attaches over CDP — no local launch', async () => {
		process.env.GLASS_CHASSIS_URL = CHASSIS;
		const fetchMock = mockChassisResponse(companionPayload);
		vi.stubGlobal('fetch', fetchMock);
		mockRemoteBrowser();
		const info = await browserRegistry.open({ ownerSessionId: 'session-1', width: 800, height: 600, spawnMcp: false });
		// the remote birth request carried the opener's contract
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as [string, { body: string; method: string }];
		expect(url).toBe(CHASSIS + '/open');
		expect(init.method).toBe('POST');
		const body = JSON.parse(init.body) as { ownerSessionId?: string; width?: number };
		expect(body.ownerSessionId).toBe('session-1');
		expect(body.width).toBe(800);
		// the relay attaches to the companion's cdpTarget, never a local launch
		expect(h.connectOverCDP).toHaveBeenCalledWith(companionPayload.cdpTarget);
		expect(h.launchPersistentContext).not.toHaveBeenCalled();
		// the entry carries the chassis address — close() posts back to it
		const entry = entries().get(info.id) as { chassisUrl?: string; headless: boolean; headedOpen: boolean };
		expect(entry.chassisUrl).toBe(CHASSIS);
		// TRUTHFUL birth mode (operator sc#1 2026-11-08): this open is a PLAIN
		// click (no headedOpen) — a headless chassis glass. Flagging it headed
		// sent resizes down the window-bounds path (no OS window → no-op → the
		// mirror kept its birth viewport: the bottom band).
		expect(entry.headless).toBe(true);
		expect(entry.headedOpen).toBe(false);
	});

	it('STAMPED: return shape equals the local branch (BrowserSessionInfo keys)', async () => {
		process.env.GLASS_CHASSIS_URL = CHASSIS;
		vi.stubGlobal('fetch', mockChassisResponse(companionPayload));
		mockRemoteBrowser();
		const remote = await browserRegistry.open({ ownerSessionId: 'session-2', spawnMcp: false });
		const remoteKeys = Object.keys(remote).sort();
		// the local contract's exact key set (the panel consumes all of these)
		expect(remoteKeys).toEqual(['createdAt', 'headedOpen', 'id', 'mcp', 'mcpError', 'mcpHealth', 'ownerSessionId', 'pid', 'port', 'profileDir'].sort());
		expect(remote.headedOpen).toBe(true);
		expect(remote.ownerSessionId).toBe('session-2');
		expect(remote.pid).toBe(companionPayload.pid);
		expect(remote.profileDir).toBe(companionPayload.profileDir);
	});

	it('UNSET: byte-for-byte today — local launch, the companion is never asked (D5)', async () => {
		delete process.env.GLASS_CHASSIS_URL;
		const fetchMock = mockChassisResponse(companionPayload);
		vi.stubGlobal('fetch', fetchMock);
		h.launchPersistentContext.mockResolvedValue({
			browser: () => undefined,
			pages: () => [{}],
			newCDPSession: vi.fn(async () => h.makeCdp()),
			close: vi.fn(async () => undefined)
		});
		const info = await browserRegistry.open({ spawnMcp: false, port: 19487, headless: false });
		expect(h.launchPersistentContext).toHaveBeenCalledTimes(1);
		expect(h.connectOverCDP).not.toHaveBeenCalled();
		expect(fetchMock).not.toHaveBeenCalled();
		expect(info.headedOpen).toBe(false);
	});

	it('chassis DOWN: honest throw naming the chassis — never a silent local fallback', async () => {
		process.env.GLASS_CHASSIS_URL = CHASSIS;
		vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
		await expect(browserRegistry.open({ ownerSessionId: 'session-3', spawnMcp: false }))
			.rejects.toThrow(/glass chassis unreachable at http:\/\/192\.168\.1\.9:9560/);
		expect(h.launchPersistentContext).not.toHaveBeenCalled(); // no fallback birth
	});

	it('chassis REFUSAL (writer-held 409): the refusal rides the throw verbatim', async () => {
		process.env.GLASS_CHASSIS_URL = CHASSIS;
		vi.stubGlobal('fetch', vi.fn(async () => ({
			ok: false,
			status: 409,
			json: async () => ({ error: 'BUSY', message: 'writer-held: owner session session-4 already holds a glass on this chassis' })
		}) as unknown as Response));
		await expect(browserRegistry.open({ ownerSessionId: 'session-4', spawnMcp: false }))
			.rejects.toThrow(/glass chassis \(http:\/\/192\.168\.1\.9:9560\) refused open: 409 — writer-held/);
	});

	it('close() on a chassis-born glass posts /close to the companion', async () => {
		process.env.GLASS_CHASSIS_URL = CHASSIS;
		const fetchMock = vi.fn(async (input: string | URL, init?: { body?: string; method?: string }) => {
			const path = String(input);
			if (path.endsWith('/open')) return { ok: true, status: 200, json: async () => companionPayload } as unknown as Response;
			if (path.endsWith('/close')) {
				expect(JSON.parse(init?.body ?? '{}')).toMatchObject({ id: companionPayload.id });
				return { ok: true, status: 200, json: async () => ({ ok: true }) } as unknown as Response;
			}
			throw new Error('unexpected fetch ' + path);
		});
		vi.stubGlobal('fetch', fetchMock);
		mockRemoteBrowser();
		const info = await browserRegistry.open({ ownerSessionId: 'session-5', spawnMcp: false });
		const result = await browserRegistry.close(info.id);
		expect(result.ok).toBe(true);
	});
});
