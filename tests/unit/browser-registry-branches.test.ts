/**
 * Browser registry BRANCH suite — the real-chromium happy paths live in
 * browser-registry.test.ts; here every refusal / fallback / teardown arm is
 * driven deterministically: fake CDP sessions + a mocked playwright launch +
 * a mocked MCP spawn, seeded straight into the process-global state the
 * registry owns. No headed browser, no lsof races.
 */
// @vitest-environment node
import { EventEmitter } from 'node:events';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---- shared mock handles (vi.hoisted: factories run before imports) --------
const h = vi.hoisted(() => {
	const pageJson = () => JSON.stringify({ url: 'data:x', title: 'T', dpr: 2, innerWidth: 800, innerHeight: 600, playerError: null, mediaErrorCode: null });
	let evaluateReply: () => unknown = () => ({
		result: { value: pageJson() }
	});
	const makeCdp = () => {
		const cdp = new EventEmitter() as EventEmitter & { send: ReturnType<typeof vi.fn> };
		cdp.send = vi.fn(async (method: string) => {
			if (method === 'Runtime.evaluate') return evaluateReply();
			return {};
		});
		return cdp;
	};
	return {
		makeCdp,
		setEvaluateReply: (fn: () => unknown) => { evaluateReply = fn; },
		launchPersistentContext: vi.fn(),
		spawn: vi.fn()
	};
});

vi.mock('playwright-core', () => ({
	chromium: { launchPersistentContext: h.launchPersistentContext }
}));

vi.mock('node:child_process', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:child_process')>();
	return { ...actual, spawn: h.spawn }; // spawnSync (lsof) stays REAL
});

let inProcessFail = false;

vi.mock('@playwright/mcp', () => ({
	createConnection: vi.fn(async () => {
			if (inProcessFail) throw new Error('brain refuses');
			return {
				connect: vi.fn(async () => undefined),
				close: vi.fn(async () => undefined)
			};
		})
}));
vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
	StreamableHTTPServerTransport: class {
		async connect(): Promise<void> {}
		async handleRequest(): Promise<void> {}
		async close(): Promise<void> {}
	}
}));

import { BrowserRegistryRefusal, browserRegistry } from '$lib/server/browser/registry.js';
import { BrowserRelay, type InputDispatch } from '$lib/server/browser/relay.js';

// ---- process-global state access -------------------------------------------
type Entry = Record<string, any> & { id: string; closed?: boolean };
const entries = (): Map<string, Entry> =>
	(process as any).__DSI_BROWSER_STATE__.entries;
const closedSet = (): Set<string> =>
	(process as any).__DSI_BROWSER_STATE__.closed;

const seededIds: string[] = [];

function fakeEntry(overrides: Partial<Entry> = {}): Entry {
	const cdp = h.makeCdp();
	const relay = new BrowserRelay(cdp as never);
	// ADR-0040 entry shape: tabs own the cdp/relay pair; the entry keeps the
	// active pointer. `cdp`/`relay` stay mirrored at entry level so the
	// assertions below keep reading one object.
	const TID = 'tid-' + Math.random().toString(36).slice(2, 8);
	return {
		id: 'seed-' + Math.random().toString(36).slice(2, 8),
		createdAt: new Date().toISOString(),
		context: { close: vi.fn(async () => undefined) },
		cdp,
		relay,
		tabs: new Map([[TID, { targetId: TID, cdp, relay, page: {} }]]),
		activeTargetId: TID,
		viewport: { width: 1280, height: 800 },
		headless: true,
		port: 9412,
		brainPort: 9515,
		streamSubscribers: 0,
		lastMcpActivity: Date.now(),
		pid: null,
		profileDir: '/tmp/fake-profile',
		mcpChild: null,
		mcpInProcess: null,
		mcpHealth: 'up',
		closed: false,
		...overrides
	};
}

function seed(overrides: Partial<Entry> = {}): Entry {
	const e = fakeEntry(overrides);
	entries().set(e.id, e);
	seededIds.push(e.id);
	return e;
}

afterEach(() => {
	for (const id of seededIds.splice(0)) entries().delete(id);
	delete process.env.DSI_MCP_IN_PROCESS;
	h.setEvaluateReply(() => ({ result: { value: JSON.stringify({ url: 'data:x', title: 'T', dpr: 2, innerWidth: 800, innerHeight: 600, playerError: null, mediaErrorCode: null }) } }));
});

afterAll(async () => {
	const ids = [...entries().keys()];
	for (const id of ids) await browserRegistry.close(id).catch(() => undefined);
});

beforeEach(() => {
	h.launchPersistentContext.mockReset();
	h.spawn.mockReset();
	inProcessFail = false;
});

// ---- refusals + listing -----------------------------------------------------
describe('browser registry branches — refusals, listing, tombstones', () => {
	it('peek/relay refuse NO_SESSION on an unknown id', () => {
		expect(() => browserRegistry.peek('ghost')).toThrowError(BrowserRegistryRefusal);
		try {
			browserRegistry.peek('ghost');
		} catch (e) {
			expect((e as BrowserRegistryRefusal).code).toBe('NO_SESSION');
		}
		expect(() => browserRegistry.relay('ghost')).toThrowError(/no such browser session/);
	});

	it('isClosed reflects the tombstone set', () => {
		closedSet().add('tomb-1');
		expect(browserRegistry.isClosed('tomb-1')).toBe(true);
		expect(browserRegistry.isClosed('tomb-2')).toBe(false);
		closedSet().delete('tomb-1');
	});

	it('list maps all three mcp descriptor arms (child / in-process / none)', () => {
		const child = seed({ mcpChild: { pid: 4242 } });
		const inProc = seed({ mcpInProcess: { connection: {}, httpServer: {}, port: 9512 } });
		const none = seed();
		const byId = new Map(browserRegistry.list().map((s) => [s.id, s]));
		expect(byId.get(child.id)?.mcp).toBe('child');
		expect(byId.get(inProc.id)?.mcp).toBe('in-process');
		expect(byId.get(none.id)?.mcp).toBe('none');
		expect(byId.get(child.id)?.mcpHealth).toBe('up');
	});
});

// ---- dispatch fence ---------------------------------------------------------
describe('browser registry branches — dispatch fence', () => {
	it('dispatch: unknown + never-closed id refuses via the peek arm', async () => {
		await expect(browserRegistry.dispatch('ghost', { kind: 'text', text: 'x' })).rejects.toThrowError(BrowserRegistryRefusal);
	});

	it('dispatch: tombstoned (closed) id refuses CLOSED "session was closed" (D8)', async () => {
		closedSet().add('tomb-dispatch');
		try {
			await browserRegistry.dispatch('tomb-dispatch', { kind: 'text', text: 'x' });
			expect.unreachable('must refuse');
		} catch (e) {
			expect((e as BrowserRegistryRefusal).code).toBe('CLOSED');
			expect((e as Error).message).toBe('session was closed');
		} finally {
			closedSet().delete('tomb-dispatch');
		}
	});

	it('dispatch: entry mid-close (closed flag) refuses CLOSED "session is closing"', async () => {
		const e = seed({ closed: true });
		try {
			await browserRegistry.dispatch(e.id, { kind: 'text', text: 'x' });
			expect.unreachable('must refuse');
		} catch (err) {
			expect((err as BrowserRegistryRefusal).code).toBe('CLOSED');
			expect((err as Error).message).toBe('session is closing');
		}
	});

	it('dispatch happy path serializes through the real relay to CDP', async () => {
		const e = seed();
		await browserRegistry.dispatch(e.id, { kind: 'text', text: 'hi' } as InputDispatch);
		const cdp = e.cdp as any;
		expect(cdp.send.mock.calls.map((c: any[]) => c[0])).toContain('Input.insertText');
	});
});

// ---- close() teardown matrix ------------------------------------------------
describe('browser registry branches — close() teardown matrix', () => {
	it('close of a never-open id resolves cleanly (no-entry arm)', async () => {
		await expect(browserRegistry.close('nope')).resolves.toEqual({ ok: true, alreadyClosed: true });
	});

	it('close of an entry already flagged closed deletes it and reports alreadyClosed', async () => {
		const e = seed({ closed: true });
		await expect(browserRegistry.close(e.id)).resolves.toEqual({ ok: true, alreadyClosed: true });
		expect(entries().has(e.id)).toBe(false);
	});

	it('full close: brain first, child SIGTERMed, tombstoned, ok:true', async () => {
		const connClose = vi.fn(async () => undefined);
		const httpClose = vi.fn((cb?: () => unknown) => cb?.());
		const kill = vi.fn();
		const e = seed({
			mcpInProcess: { connection: { close: connClose }, httpServer: { close: httpClose }, port: 9513 },
			mcpChild: { pid: 999, kill }
		});
		await expect(browserRegistry.close(e.id)).resolves.toEqual({ ok: true, alreadyClosed: false });
		expect(connClose).toHaveBeenCalled();
		expect(httpClose).toHaveBeenCalled();
		expect(kill).toHaveBeenCalledWith('SIGTERM');
		expect(entries().has(e.id)).toBe(false);
		expect(browserRegistry.isClosed(e.id)).toBe(true);
	});

	it('every teardown step may throw: errors are gathered, ok:false, entry still reaped', async () => {
		const e = seed({
			mcpInProcess: {
				connection: { close: vi.fn(async () => { throw new Error('conn broke'); }) },
				httpServer: { close: vi.fn() },
				port: 9514
			},
			mcpChild: { pid: 1, kill: vi.fn(() => { throw new Error('kill failed'); }) },
			relay: { stop: vi.fn(() => { throw new Error('relay broke'); }) },
			context: { close: vi.fn(async () => { throw new Error('context broke'); }) }
		});
		await expect(browserRegistry.close(e.id)).resolves.toEqual({ ok: false, alreadyClosed: false });
		expect(entries().has(e.id)).toBe(false);
	});

	it('a child without a pid is not signalled; the close still succeeds', async () => {
		const kill = vi.fn();
		const e = seed({ mcpChild: { pid: null, kill } });
		await expect(browserRegistry.close(e.id)).resolves.toEqual({ ok: true, alreadyClosed: false });
		expect(kill).not.toHaveBeenCalled();
	});

	it('the tombstone set is capped at 256 — the oldest id is evicted', async () => {
		// isolate: earlier close() tests tombstoned their ids — snapshot & clear
		const prior = [...closedSet()];
		closedSet().clear();
		for (let i = 0; i < 256; i++) closedSet().add('filler-' + i);
		const e = seed();
		await browserRegistry.close(e.id);
		expect(closedSet().size).toBe(256);
		expect(closedSet().has('filler-0')).toBe(false); // oldest evicted
		expect(closedSet().has(e.id)).toBe(true);
		closedSet().clear();
		for (const id of prior) closedSet().add(id);
	});
});

// ---- navigate + pageInfo ----------------------------------------------------
describe('browser registry branches — navigate + pageInfo', () => {
	it('navigate without waitLoad sends Page.navigate directly', async () => {
		const e = seed();
		await browserRegistry.navigate(e.id, 'data:text/html,<h1>x</h1>');
		expect((e.cdp as any).send).toHaveBeenCalledWith('Page.navigate', { url: 'data:text/html,<h1>x</h1>' });
	});

	it('navigate with waitLoad waits for Page.loadEventFired before resolving', async () => {
		const e = seed();
		const cdp = e.cdp as any;
		cdp.send.mockImplementation(async (method: string) => {
			if (method === 'Page.navigate') {
				queueMicrotask(() => (e.cdp as any).emit('Page.loadEventFired'));
			}
			return {};
		});
		await browserRegistry.navigate(e.id, 'data:text/html,<h1>loaded</h1>', { waitLoad: true });
		expect(cdp.send).toHaveBeenCalledWith('Page.navigate', { url: 'data:text/html,<h1>loaded</h1>' });
	});

	it('pageInfo returns the evaluated JSON when CDP answers in time', async () => {
		const e = seed();
		await expect(browserRegistry.pageInfo(e.id)).resolves.toEqual({ url: 'data:x', title: 'T', dpr: 2, innerWidth: 800, innerHeight: 600, playerError: null, mediaErrorCode: null });
	});

	it('pageInfo degrades to (busy) when the evaluate never answers (3s cap)', async () => {
		const e = seed();
		(e.cdp as any).send.mockImplementation(() => new Promise(() => undefined)); // hang
		// VERDICT: source is authoritative — ADR-0031 amendments 5/6 (07ecce4,
		// ec20ad4) extended the busy-shape with viewport (innerWidth/innerHeight)
		// and playback-witness (playerError/mediaErrorCode) fields, all null/0
		// while degraded. The 3s cap itself is unchanged.
		await expect(browserRegistry.pageInfo(e.id)).resolves.toEqual({
			url: '(busy)', title: '(busy)', dpr: 1,
			innerWidth: 0, innerHeight: 0, playerError: null, mediaErrorCode: null
		});
	}, 10_000);
});

// ---- open() launch + MCP wiring ----------------------------------------------
describe('browser registry branches — open() launch + MCP wiring', () => {
	function mockLaunch(): void {
		h.launchPersistentContext.mockResolvedValue({
			browser: () => ({}),
			pages: () => [{}],
			newCDPSession: vi.fn(async () => h.makeCdp()),
			close: vi.fn(async () => undefined)
		});
	}

	it('open (spawnMcp:false) launches headed, pins the debug-port args, reuses a free preferred port', async () => {
		mockLaunch();
		const free = 9487; // 94xx scan range — near-certainly free on this floor
		// VERDICT: source is authoritative — ADR-0030 D2 (operator decision
		// 2026-10-20) flipped the default: headless: true unless the config's
		// browser.headless is explicitly false, and open() honours the
		// options.headless override. The old pin "headed is the default" also
		// read the LIVE ~/.dsi/settings.yaml, making the arm machine-dependent.
		// Pin the override arm explicitly; the default-true arm stays a
		// config-resolution concern of insight-config.
		const info = await browserRegistry.open({ spawnMcp: false, port: free, headless: false });
		seededIds.push(info.id);
		expect(info.port).toBe(free); // preferred && portFree → returned as-is
		expect(info.pid).toBeNull(); // lsof finds no listener → null arm (launch mocked)
		expect(info.mcp).toBe('none');
		expect(h.launchPersistentContext).toHaveBeenCalledTimes(1);
		const [dir, opts] = h.launchPersistentContext.mock.calls[0] as [string, { headless: boolean; args: string[] }];
		expect(opts.headless).toBe(false); // explicit options.headless override wins over config
		expect(opts.args).toContain('--remote-debugging-port=' + free);
		expect(opts.args).toContain('--window-position=-32000,-32000');
		expect(dir).toContain('.dsi/browser-profiles');
		await browserRegistry.close(info.id);
	});

	it('open falls back to a scan when the preferred port is already held', async () => {
		mockLaunch();
		const net = await import('node:net');
		const blocker = net.createServer();
		await new Promise<void>((res) => blocker.listen(9488, '127.0.0.1', res));
		try {
			const info = await browserRegistry.open({ spawnMcp: false, port: 9488 });
			seededIds.push(info.id);
			expect(info.port).not.toBe(9488); // portFree(9488) === false → scan arm
			expect(info.port).toBeGreaterThanOrEqual(9400);
			expect(info.port).toBeLessThan(9500);
			await browserRegistry.close(info.id);
		} finally {
			blocker.close();
		}
	});

	it('open spawns the pinned MCP child by default; its exit marks the brain down', async () => {
		mockLaunch();
		const child = new EventEmitter() as any;
		child.pid = 4321;
		h.spawn.mockReturnValue(child);
		const info = await browserRegistry.open(); // spawnMcp defaults true
		seededIds.push(info.id);
		expect(info.mcp).toBe('child');
		expect(info.mcpHealth).toBe('up');
		const [cmd, args] = h.spawn.mock.calls[0] as [string, string[]];
		expect(cmd).toBe('npx');
		expect(args[0]).toBe('@playwright/mcp@0.0.83');
		expect(args).toContain('--cdp-endpoint');
		expect(args).toContain('http://127.0.0.1:' + info.port);
		child.emit('exit', 1); // the brain died
		expect(browserRegistry.list().find((s) => s.id === info.id)?.mcpHealth).toBe('down');
		await browserRegistry.close(info.id);
	});

	it('a spawn error event also marks the brain down (graceful D7 fallback)', async () => {
		mockLaunch();
		const child = new EventEmitter() as any;
		child.pid = null;
		h.spawn.mockReturnValue(child);
		const info = await browserRegistry.open();
		seededIds.push(info.id);
		child.emit('error', new Error('ENOENT'));
		expect(browserRegistry.list().find((s) => s.id === info.id)?.mcpHealth).toBe('down');
		await browserRegistry.close(info.id);
	});

	it('DSI_MCP_IN_PROCESS=1 with a failing brain marks it down instead of throwing', async () => {
		mockLaunch();
		process.env.DSI_MCP_IN_PROCESS = '1';
		inProcessFail = true; // createConnection throws → catch arm
		const info = await browserRegistry.open();
		seededIds.push(info.id);
		expect(info.mcp).toBe('none'); // mcpInProcess never set
		expect(info.mcpHealth).toBe('down');
		await browserRegistry.close(info.id);
	});

	it('DSI_MCP_IN_PROCESS=1 happy path: the brain comes up in-process', async () => {
		mockLaunch();
		process.env.DSI_MCP_IN_PROCESS = '1';
		const info = await browserRegistry.open();
		seededIds.push(info.id);
		expect(info.mcp).toBe('in-process');
		expect(info.mcpHealth).toBe('up');
		await browserRegistry.close(info.id);
		expect(browserRegistry.isClosed(info.id)).toBe(true);
	});
});
