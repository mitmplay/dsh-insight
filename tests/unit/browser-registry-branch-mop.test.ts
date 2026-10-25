/**
 * Browser registry BRANCH MOP — the suites above (browser-registry.test.ts,
 * browser-registry-branches.test.ts) own the happy paths and the main
 * refusal matrix; this file sweeps the remaining uncovered arms:
 *   - sweepOrphanProfiles: rm arm + the best-effort catch arm
 *   - freePort exhaustion throw + pidOfPort lsof-hit arm
 *   - startInProcessMcp: upward port-scan fallback, total-failure throw,
 *     and the SSE http handler arms (404 / traffic / handler throw)
 *   - mcpBrainUrl both port arms; findLive nullish/live/closed arms
 *   - noteStreamOpen/Close (clamp at 0) / noteMcpTraffic unknown-id arms
 *   - waitLoad cap arm via reload; pageHistory happy + HISTORY_END refusals
 *   - setViewport CDP-side clamps; navInfo; evaluate empty-value arm
 *   - close(): brain without closeAllConnections, close() that never calls
 *     back (the 2s wedge guard), httpServer-less brain
 */
// @vitest-environment node
import { EventEmitter } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---- shared mock handles (hoisted: factories run before imports) -----------
const h = vi.hoisted(() => {
  const makeCdp = () => {
    const cdp = new EventEmitter() as EventEmitter & { send: ReturnType<typeof vi.fn> };
    cdp.send = vi.fn(async (method: string) => {
      // ADR-0040: open() names the birth tab via Target.getTargetInfo — a
      // CDP double that stays silent there leaves the entry pointerless.
      if (method === 'Target.getTargetInfo') return { targetInfo: { targetId: 'tid-mop-' + (makeCdp as any).n++ } };
      return {};
    });
    (makeCdp as any).n = (makeCdp as any).n ?? 0;
    return cdp;
  };
  return {
    makeCdp,
    launchPersistentContext: vi.fn(),
    spawn: vi.fn(),
    spawnSync: vi.fn(),
    readdirSync: vi.fn(),
    rmSync: vi.fn(),
    cfg: {
      enabled: false, // keep the idle reaper out of this suite
      headless: true,
      brainPort: 19515,
      mcpPin: '0.0.83',
      profileRoot: '/tmp/dsi-mop-browser-profiles',
      idleMs: 60_000,
      screencastQuality: 90,
      screencastMaxFps: 15
    }
  };
});

vi.mock('$lib/server/insight-config.js', () => ({
  readBrowserConfig: () => h.cfg
}));

vi.mock('playwright-core', () => ({
  chromium: { launchPersistentContext: h.launchPersistentContext }
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: h.spawn, spawnSync: h.spawnSync };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readdirSync: h.readdirSync, rmSync: h.rmSync };
});

let brainFail = false;
let handlerThrow = false;

vi.mock('@playwright/mcp', () => ({
  createConnection: vi.fn(async () => {
    if (brainFail) throw new Error('brain refuses');
    return {
      connect: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined)
    };
  })
}));

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: class {
    handleRequest = vi.fn(async (_req: unknown, res: { end: () => void; socket?: { destroy?: () => void } | null }) => {
      if (handlerThrow) {
        res.socket?.destroy?.(); // SSE client gone BEFORE writableEnded
        throw new Error('handler blew up');
      }
      res.end();
    });
    async close(): Promise<void> {}
  }
}));

import { BrowserRegistryRefusal, browserRegistry, reaperEligible } from '$lib/server/browser/registry.js';

type Entry = Record<string, any> & { id: string };
const state = (): { entries: Map<string, Entry>; closed: Set<string> } =>
  (process as any).__DSI_BROWSER_STATE__;

function seed(overrides: Partial<Entry> = {}): Entry {
  const cdp = h.makeCdp();
  // ADR-0040 entry shape: the tab handles own cdp/relay; entry-level mirrors
  // stay so the (e.cdp as any) assertions keep reading one object.
  const TID = 'tid-' + Math.random().toString(36).slice(2, 8);
  const relay = {
    dispatch: vi.fn(async () => undefined),
    stop: vi.fn(),
    pause: vi.fn(async () => undefined),
    ensureStreaming: vi.fn(async () => undefined),
    latestFrame: vi.fn(() => null),
    seed: vi.fn()
  };
  const e: Entry = {
    id: 'seed-' + Math.random().toString(36).slice(2, 8),
    createdAt: new Date().toISOString(),
    context: { close: vi.fn(async () => undefined) },
    cdp,
    relay,
    tabs: new Map([[TID, { targetId: TID, cdp, relay, page: { setViewportSize: vi.fn(async () => undefined) } }]]),
    activeTargetId: TID,
    viewport: { width: 1280, height: 800 },
    headless: true,
    port: 9412,
    brainPort: 19515,
    pid: null,
    profileDir: '/tmp/fake-profile',
    streamSubscribers: 0,
    lastMcpActivity: 1,
    mcpChild: null,
    mcpInProcess: null,
    mcpHealth: 'up',
    mcpError: null,
    closed: false,
    ...overrides
  };
  state().entries.set(e.id, e);
  return e;
}

function mockLaunch(extra: Record<string, unknown> = {}): void {
  h.launchPersistentContext.mockResolvedValue({
    browser: () => ({}),
    pages: () => [{}],
    newCDPSession: vi.fn(async () => h.makeCdp()),
    close: vi.fn(async () => undefined),
    ...extra
  });
}

beforeEach(() => {
  h.launchPersistentContext.mockReset();
  h.spawn.mockReset();
  h.spawnSync.mockReset();
  h.readdirSync.mockReset();
  h.rmSync.mockReset();
  h.spawnSync.mockReturnValue({ status: 1, stdout: { toString: () => '' } }); // default: port free
  brainFail = false;
  handlerThrow = false;
});

afterEach(() => {
  delete process.env.DSI_MCP_IN_PROCESS;
  delete process.env.DSI_MCP_PORT;
  for (const id of [...(state()?.entries.keys() ?? [])]) state().entries.delete(id);
});

afterAll(async () => {
  for (const id of [...state().entries.keys()]) {
    await browserRegistry.close(id).catch(() => undefined);
  }
});

// ---- boot sweep --------------------------------------------------------------
describe('sweepOrphanProfiles (state() init)', () => {
  it('rmSync arm: a leftover profile dir not in the keep set is swept', async () => {
    delete (process as any).__DSI_BROWSER_STATE__; // force a fresh init sweep
    h.readdirSync.mockReturnValue(['deadbeef', 'cafebabe']);
    browserRegistry.list(); // a registry method touches the REAL state() -> init sweep
    expect(h.rmSync).toHaveBeenCalledTimes(2);
    for (const call of h.rmSync.mock.calls as [string, { recursive: boolean }][]) {
      expect(call[1].recursive).toBe(true);
    }
  });

  it('catch arm: an unreadable profile root is a best-effort no-op', async () => {
    delete (process as any).__DSI_BROWSER_STATE__;
    h.readdirSync.mockImplementation(() => {
      throw new Error('no such dir');
    });
    expect(() => browserRegistry.list()).not.toThrow();
  });
});

// ---- port helpers --------------------------------------------------------------
describe('freePort / pidOfPort arms via open()', () => {
  it('every port held -> open refuses with the scan-exhausted error', async () => {
    h.spawnSync.mockReturnValue({ status: 0, stdout: { toString: () => '9' } }); // nothing free
    mockLaunch();
    await expect(browserRegistry.open({ spawnMcp: false })).rejects.toThrow(/no free debug port/);
    expect(h.launchPersistentContext).not.toHaveBeenCalled();
  });

  it('pidOfPort: an lsof hit becomes the session pid', async () => {
    let call = 0;
    h.spawnSync.mockImplementation(() => {
      call += 1;
      if (call === 1) return { status: 1, stdout: { toString: () => '' } }; // portFree -> free
      return { status: 0, stdout: { toString: () => '4321' } }; // pidOfPort hit
    });
    mockLaunch();
    const info = await browserRegistry.open({ spawnMcp: false, port: 9480 });
    expect(info.pid).toBe(4321);
    await browserRegistry.close(info.id);
  });

  it('the exit handler ignores a REPLACED mcpChild (identity check arm)', async () => {
    mockLaunch();
    const child = new EventEmitter() as any;
    child.pid = 7;
    h.spawn.mockReturnValue(child);
    const info = await browserRegistry.open();
    // swap the handle: the stale child exit must NOT mark the brain down
    (state().entries.get(info.id) as Entry).mcpChild = { pid: 8, kill: vi.fn() };
    child.emit('exit', 3);
    expect(browserRegistry.list().find((s) => s.id === info.id)?.mcpHealth).toBe('up');
    await browserRegistry.close(info.id);
  });

  it('open honours options.url and falls back to newPage when no page exists', async () => {
    const newPage = vi.fn(async () => ({}));
    mockLaunch({ pages: () => [], newPage });
    const info = await browserRegistry.open({ spawnMcp: false, url: 'data:text/html,<h1>hi</h1>' });
    const born = state().entries.get(info.id) as Entry;
    const cdp = [...born.tabs.values()][0].cdp as any;
    expect(cdp.send).toHaveBeenCalledWith('Page.navigate', { url: 'data:text/html,<h1>hi</h1>' });
    expect(newPage).toHaveBeenCalled();
    await browserRegistry.close(info.id);
  });
});

// ---- in-process brain: port scan + http handler ---------------------------------
describe('startInProcessMcp - scan fallback + http handler arms', () => {
  it('occupied brain port -> binds the next free port upward; mcpBrainUrl follows it', async () => {
    const blocker = net.createServer();
    await new Promise<void>((res) => blocker.listen(19541, '127.0.0.1', res));
    process.env.DSI_MCP_IN_PROCESS = '1';
    process.env.DSI_MCP_PORT = '19541';
    try {
      mockLaunch();
      const info = await browserRegistry.open(); // MCP brain ON, in-process
      expect(info.mcp).toBe('in-process');
      expect(info.mcpHealth).toBe('up');
      const e = state().entries.get(info.id) as Entry;
      expect(e.mcpInProcess.port).toBeGreaterThan(19541);
      expect(browserRegistry.mcpBrainUrl(info.id)).toBe(
        'http://127.0.0.1:' + e.mcpInProcess.port + '/sse'
      );
      await browserRegistry.close(info.id);
    } finally {
      blocker.close();
    }
  });

  it('no bindable brain port at all -> the brain degrades with the scan error', async () => {
    process.env.DSI_MCP_IN_PROCESS = '1';
    process.env.DSI_MCP_PORT = '65536'; // 65537..65596 are ALL past the port ceiling
    mockLaunch();
    const info = await browserRegistry.open(); // brain ON, in-process, no bindable port
    expect(info.mcp).toBe('none');
    expect(info.mcpHealth).toBe('down');
    expect(info.mcpError).toMatch(/65536|no free brain port/); // scan exhaustion throw
    await browserRegistry.close(info.id);
  });

  it('http handler: non-/sse 404s; /sse notes traffic; a throwing handler still ends', async () => {
    process.env.DSI_MCP_IN_PROCESS = '1';
    process.env.DSI_MCP_PORT = '19545';
    mockLaunch();
    const info = await browserRegistry.open(); // brain ON, in-process
    const e = state().entries.get(info.id) as Entry;
    const port: number = e.mcpInProcess.port;
    const get = (path: string, method = 'GET') =>
      new Promise<{ status: number; ended: boolean }>((res, rej) => {
        const req = http.request({ host: '127.0.0.1', port, path, method }, (r) => {
          r.resume();
          r.on('end', () => res({ status: r.statusCode ?? 0, ended: true }));
        });
        req.on('error', rej);
        req.end();
      });

    const before = e.lastMcpActivity;
    await new Promise((r) => setTimeout(r, 5));
    expect(await get('/not-sse')).toMatchObject({ status: 404 }); // non-sse arm
    expect(e.lastMcpActivity).toBe(before); // 404s are NOT MCP traffic

    handlerThrow = true;
    // the handler destroys the socket THEN throws — the client sees a hang
    // up while the server still runs the !writableEnded -> res.end() guard
    await expect(get('/sse')).rejects.toThrow(/hang up|ECONNRESET/i);
    handlerThrow = false;
    expect(e.lastMcpActivity).toBeGreaterThan(before); // onTraffic fired

    await browserRegistry.close(info.id);
  }, 15_000);
});

// ---- pure lookups + note arms ---------------------------------------------------
describe('mcpBrainUrl / findLive / note* arms', () => {
  it('mcpBrainUrl falls back to brainPort when no in-process brain exists', () => {
    const e = seed({ brainPort: 19600 });
    expect(browserRegistry.mcpBrainUrl(e.id)).toBe('http://127.0.0.1:19600/sse');
  });

  it('findLive: nullish false, live true, tombstoned false, unknown false', () => {
    const e = seed();
    expect(browserRegistry.findLive(null)).toBe(false);
    expect(browserRegistry.findLive(undefined)).toBe(false);
    expect(browserRegistry.findLive('')).toBe(false);
    expect(browserRegistry.findLive(e.id)).toBe(true);
    state().closed.add(e.id);
    expect(browserRegistry.findLive(e.id)).toBe(false);
    expect(browserRegistry.findLive('ghost')).toBe(false);
    state().closed.delete(e.id);
  });

  it('noteStreamOpen/Close count subscribers and clamp at zero; unknown ids are no-ops', () => {
    const e = seed();
    browserRegistry.noteStreamOpen('ghost'); // unknown id arm
    browserRegistry.noteStreamClose('ghost');
    expect(e.streamSubscribers).toBe(0);
    browserRegistry.noteStreamOpen(e.id);
    browserRegistry.noteStreamOpen(e.id);
    expect(e.streamSubscribers).toBe(2);
    browserRegistry.noteStreamClose(e.id);
    browserRegistry.noteStreamClose(e.id);
    browserRegistry.noteStreamClose(e.id); // clamp arm
    expect(e.streamSubscribers).toBe(0);
    const t = Date.now() + 5;
    browserRegistry.noteMcpTraffic(e.id);
    expect(e.lastMcpActivity).toBeGreaterThanOrEqual(t - 5);
  });
});

// ---- navigation verbs -----------------------------------------------------------
describe('reload / pageHistory / setViewport / navInfo', () => {
  it('reload resolves through the load cap even when no load event fires', async () => {
    const e = seed();
    (e.cdp as any).send.mockImplementation(async (method: string) => {
      if (method === 'Runtime.evaluate')
        return { result: { value: JSON.stringify({ url: 'u', title: 't', dpr: 1, innerWidth: 10, innerHeight: 20, playerError: null, mediaErrorCode: null }) } };
      return {}; // never emits Page.loadEventFired -> cap arm
    });
    const r = await browserRegistry.reload(e.id);
    expect(r).toMatchObject({ url: 'u', title: 't' });
  }, 10_000);

  it('pageHistory travels back; the forward end refuses HISTORY_END', async () => {
    const e = seed();
    const hist = { currentIndex: 1, entries: [{ id: 11 }, { id: 12 }] };
    (e.cdp as any).send.mockImplementation(async (method: string) => {
      if (method === 'Page.getNavigationHistory') return hist;
      if (method === 'Runtime.evaluate')
        return { result: { value: JSON.stringify({ url: 'u', title: 't', dpr: 1, innerWidth: 1, innerHeight: 1, playerError: null, mediaErrorCode: null }) } };
      return {};
    });
    const back = await browserRegistry.pageHistory(e.id, 'back');
    expect(back).toMatchObject({ currentIndex: 0, entryCount: 2 });
    expect((e.cdp as any).send).toHaveBeenCalledWith('Page.navigateToHistoryEntry', { entryId: 11 });

    hist.currentIndex = 0;
    await expect(browserRegistry.pageHistory(e.id, 'back')).rejects.toThrow(/HISTORY_END/);
    try {
      await browserRegistry.pageHistory(e.id, 'back');
    } catch (err) {
      expect((err as BrowserRegistryRefusal).code).toBe('CLOSED');
    }

    hist.currentIndex = 1;
    await expect(browserRegistry.pageHistory(e.id, 'forward')).rejects.toThrow(
      /cannot go forward from index 1 of 2/
    );
  });

  it('setViewport clamps hostile sizes into the CDP-safe range', async () => {
    // VERDICT: source is authoritative — ADR-0041 (round 10, the black
    // bands) replaced Emulation.setDeviceMetricsOverride with the WINDOW
    // resize (headed: Browser.setWindowBounds; headless: the Playwright page
    // API, whose context viewport is the re-asserting owner). The clamps
    // (200..8192) and the rounding arm are unchanged.
    const e = seed(); // headless seed -> the page.setViewportSize arm
    const page = (e.tabs as Map<string, any>).get((e as any).activeTargetId).page;
    await browserRegistry.setViewport(e.id, 1, 99_999);
    expect(page.setViewportSize).toHaveBeenCalledWith({ width: 200, height: 8192 });
    await browserRegistry.setViewport(e.id, 100.6, 8191.4); // rounding arm
    expect(page.setViewportSize).toHaveBeenLastCalledWith({
      width: 200, // width floor is 200 — Math.round(100.6)=101 clamps UP
      height: 8191
    });
  });

  it('navInfo returns the history position', async () => {
    const e = seed();
    (e.cdp as any).send.mockImplementation(async (method: string) => {
      if (method === 'Page.getNavigationHistory')
        return { currentIndex: 0, entries: [{ id: 1 }] };
      return {};
    });
    await expect(browserRegistry.navInfo(e.id)).resolves.toEqual({ currentIndex: 0, entryCount: 1 });
  });

  it('pageInfo empty-value arm: a result without .value yields empty strings', async () => {
    const e = seed();
    (e.cdp as any).send.mockImplementation(async (method: string) => {
      if (method === 'Runtime.evaluate') return { result: {} }; // value ?? '' arm
      return {};
    });
    await expect(browserRegistry.pageInfo(e.id)).rejects.toThrow(); // JSON.parse('') edge
  });
});

// ---- close() wedge guards ---------------------------------------------------------
describe('close() teardown residue arms', () => {
  it('a brain httpServer without closeAllConnections and a close() that never calls back still finishes (2s wedge guard)', async () => {
    const e = seed({
      mcpInProcess: {
        connection: { close: vi.fn(async () => undefined) },
        httpServer: { close: vi.fn(() => undefined) }, // no cb call, no closeAllConnections
        port: 19550
      }
    });
    await expect(browserRegistry.close(e.id)).resolves.toEqual({ ok: true, alreadyClosed: false });
    expect(e.mcpInProcess).toBeNull();
  }, 10_000);

  it('a brain with NO httpServer skips both optional calls and still closes the connection', async () => {
    const connClose = vi.fn(async () => undefined);
    const e = seed({ mcpInProcess: { connection: { close: connClose }, port: 19551 } });
    await expect(browserRegistry.close(e.id)).resolves.toEqual({ ok: true, alreadyClosed: false });
    expect(connClose).toHaveBeenCalled();
  });
});


// ---- round 2: reaper + launch fallback + hostile-cdp glue ----------------------
describe('reaperEligible (pure seam)', () => {
  it('a watched stream is NEVER eligible, even when idle; fresh traffic keeps too', () => {
    const now = 1_000_000;
    expect(reaperEligible({ streamSubscribers: 1, lastMcpActivity: 0 }, 100, now)).toBe(false); // watched arm
    expect(reaperEligible({ streamSubscribers: 0, lastMcpActivity: now - 100 }, 100, now)).toBe(true); // idle arm
    expect(reaperEligible({ streamSubscribers: 0, lastMcpActivity: now }, 100, now)).toBe(false); // fresh arm
    expect(reaperEligible({ streamSubscribers: 0, lastMcpActivity: now - 99 }, 100, now)).toBe(false); // boundary
  });
});

describe('the idle reaper interval (both arms, fast clock)', () => {
  it('sweeps an idle unwatched entry and KEEPS one with stream subscribers', async () => {
    h.cfg.enabled = true; // reaper gate arm
    h.cfg.idleMs = 20; // mocked config: interval = min(10, 30000) = 10ms
    try {
      mockLaunch();
      const boot = await browserRegistry.open({ spawnMcp: false }); // installs the timer
      const keeper = seed({ streamSubscribers: 1 });
      const reaped = seed({ lastMcpActivity: Date.now() - 60_000 });
      await new Promise((r) => setTimeout(r, 80));
      expect(state().entries.has(reaped.id)).toBe(false); // eligible -> swept
      expect(browserRegistry.isClosed(reaped.id)).toBe(true);
      expect(state().entries.has(keeper.id)).toBe(true); // watched -> kept
      state().entries.delete(keeper.id);
      void boot;
    } finally {
      const s = state() as { reaperTimer?: ReturnType<typeof setInterval> };
      if (s.reaperTimer) clearInterval(s.reaperTimer);
      delete s.reaperTimer;
      h.cfg.enabled = false;
    }
  });
});

describe('launch fallback + hostile-enable glue arms', () => {
  it('no system Chrome: launch(true) rejects -> falls back to launch(false) WITHOUT the channel', async () => {
    h.launchPersistentContext
      .mockRejectedValueOnce(new Error('chrome not found'))
      .mockResolvedValueOnce({
        browser: () => ({}),
        pages: () => [{}],
        newCDPSession: vi.fn(async () => h.makeCdp()),
        close: vi.fn(async () => undefined)
      });
    const info = await browserRegistry.open({ spawnMcp: false, port: 9481 });
    expect(h.launchPersistentContext).toHaveBeenCalledTimes(2);
    const [, second] = h.launchPersistentContext.mock.calls as [string, Record<string, unknown>][];
    expect('channel' in second).toBe(false); // useChrome=false spread arm
    await browserRegistry.close(info.id);
  });

  it('open() survives a cdp that REJECTS Page.enable and Page.navigate (catch glue)', async () => {
    const hostile = h.makeCdp();
    hostile.send.mockImplementation(async (method: string) => {
      if (method === 'Page.enable' || method === 'Page.navigate') throw new Error('cdp gone');
      return {};
    });
    mockLaunch({ newCDPSession: vi.fn(async () => hostile) });
    const info = await browserRegistry.open({ spawnMcp: false, url: 'data:text/html,<h1>x</h1>' });
    expect(state().entries.has(info.id)).toBe(true); // launch glue caught both
    await browserRegistry.close(info.id);
  });

  it('navigate/setViewport/navInfo/reload/pageHistory each survive a rejecting Page.enable', async () => {
    const e = seed();
    const hist = { currentIndex: 1, entries: [{ id: 11 }, { id: 12 }] };
    (e.cdp as any).send.mockImplementation(async (method: string) => {
      if (method === 'Page.enable') throw new Error('cdp gone');
      if (method === 'Page.getNavigationHistory') return hist;
      if (method === 'Runtime.evaluate')
        return { result: { value: JSON.stringify({ url: 'u', title: 't', dpr: 1, innerWidth: 1, innerHeight: 1, playerError: null, mediaErrorCode: null }) } };
      if (method === 'Page.reload' || method === 'Page.navigateToHistoryEntry') {
        queueMicrotask(() => (e.cdp as any).emit('Page.loadEventFired'));
      }
      return {};
    });
    await expect(browserRegistry.navigate(e.id, 'data:text/html,x', { waitLoad: true })).resolves.toBeUndefined();
    await expect(browserRegistry.setViewport(e.id, 800, 600)).resolves.toBeUndefined();
    await expect(browserRegistry.navInfo(e.id)).resolves.toEqual({ currentIndex: 1, entryCount: 2 });
    await expect(browserRegistry.reload(e.id)).resolves.toMatchObject({ url: 'u' });
    await expect(browserRegistry.pageHistory(e.id, 'back')).resolves.toMatchObject({ currentIndex: 0 });
  });

  it('noteMcpTraffic for an UNKNOWN id is a no-op (if-e false arm)', () => {
    expect(() => browserRegistry.noteMcpTraffic('ghost-traffic')).not.toThrow();
  });
});
