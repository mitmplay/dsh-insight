/**
 * Browser registry COVERAGE GAP sweep — the arms the other suites leave
 * open, all mock-based (no chromium):
 *   - close(): the browserCdp detach arm, a throwing context.close /
 *     relay.stop / rmSync / brain connection.close -> ok:false, and the
 *     deathListeners-nullish arm (an entry without listeners closes clean)
 *   - repairSurfaceAfterResize: the ABSOLUTE-correction arm (getWindowForTarget
 *     answers bounds -> cw/ch derived from cur - captured), the capture-reject
 *     + relay-frame-null -> "if (!d) continue" arm, and the final-reseed
 *     SKIPPED arm (shot rejected -> no reseed call)
 *   - setViewport on a headless entry: the Playwright-pinned backstop
 *     (setViewportSize + Emulation.setDeviceMetricsOverride on a page-scoped
 *     session) and the dpr fallback arm (evaluate answers non-positive)
 *   - setZoom: CLOSED refusal, the clampZoom-null keep arm, happy zoom apply
 *   - dispatch: the e.closed (closing flag) refusal arm
 *   - open(): a getTargetInfo REJECTING cdp births a POINTERLESS entry
 *     (activeTargetId null, no tabIds), the first-frame contract seeds the
 *     empty ring via captureScreenshot, and the scrollbar gate skips a
 *     page without evaluate (typeof-guard false arm)
 */
// @vitest-environment node
import { EventEmitter } from 'node:events';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  return {
    launchPersistentContext: vi.fn(),
    spawn: vi.fn(),
    spawnSync: vi.fn(),
    readdirSync: vi.fn(),
    rmSync: vi.fn(),
    cfg: {
      enabled: false,
      headless: true,
      brainPort: 19515,
      mcpPin: '0.0.83',
      profileRoot: '/tmp/dsi-gapcov-browser-profiles',
      idleMs: 60_000,
      screencastQuality: 90,
      screencastMaxFps: 15,
      contentZoom: 1
    },
    relayLatest: { frame: null as unknown }
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

vi.mock('$lib/server/browser/relay.js', () => ({
  BrowserRelay: class {
    start = vi.fn(async () => undefined);
    pause = vi.fn(async () => undefined);
    stop = vi.fn();
    ensureStreaming = vi.fn(async () => undefined);
    dispatch = vi.fn(async () => undefined);
    seed = vi.fn();
    reseed = vi.fn();
    latestFrame = vi.fn(() => h.relayLatest.frame);
  }
}));

import { BrowserRegistryRefusal, browserRegistry } from '$lib/server/browser/registry.js';

type Entry = Record<string, any> & { id: string };
const state = (): { entries: Map<string, Entry>; closed: Set<string> } => {
  if (!(process as any).__DSI_BROWSER_STATE__) browserRegistry.list(); // force the lazy init sweep
  return (process as any).__DSI_BROWSER_STATE__;
};

/** A minimal JPEG whose SOF0 marker carries (w, h) — the repair's dimsOf
 *  parses dims out of the bytes when the screencast metadata is empty. */
function sofJpeg(w: number, hh: number): string {
  return Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, (hh >> 8) & 255, hh & 255, (w >> 8) & 255, w & 255, 3, 0, 0, 0, 0, 0]).toString('base64');
}

type Handlers = Record<string, unknown>;
function makeCdp(handlers: Handlers = {}): any {
  const cdp = new EventEmitter() as any;
  cdp.send = vi.fn(async (method: string, params?: any) => {
    const hh = handlers[method] as ((params?: any) => unknown) | undefined;
    if (hh) return await hh(params);
    if (method === 'Target.getTargetInfo') return { targetInfo: { targetId: (handlers.__tid as string | undefined) ?? 'tid-default' } };
    return {};
  });
  cdp.detach = vi.fn(async () => undefined);
  return cdp;
}

function makeRelay(frames: any[] = []): any {
  let i = 0;
  return {
    dispatch: vi.fn(async () => undefined),
    stop: vi.fn(),
    pause: vi.fn(async () => undefined),
    ensureStreaming: vi.fn(async () => undefined),
    seed: vi.fn(),
    reseed: vi.fn(),
    latestFrame: vi.fn(() => frames[i++] ?? frames[frames.length - 1] ?? null)
  };
}

function seed(overrides: Partial<Entry> = {}): { e: Entry; cdp: any; relay: any } {
  const TID = 'tid-' + Math.random().toString(36).slice(2, 8);
  const cdp = makeCdp({ __tid: TID });
  const relay = makeRelay([{ seq: 1, jpeg: sofJpeg(640, 480), metadata: { deviceWidth: 640, deviceHeight: 480 } }]);
  const e: Entry = {
    id: 'gapcov-' + Math.random().toString(36).slice(2, 8),
    createdAt: new Date().toISOString(),
    context: { close: vi.fn(async () => undefined), pages: () => [] },
    tabs: new Map([[TID, { targetId: TID, tabId: 1, cdp, relay, page: { setViewportSize: vi.fn(async () => undefined) } }]]),
    tabOrder: [TID],
    tabIds: new Map([[1, TID]]),
    nextTabId: 2,
    activeTargetId: TID,
    viewport: { width: 700, height: 500 },
    zoom: 1,
    headless: true,
    port: 9412,
    brainPort: 19515,
    pid: null,
    profileDir: '/tmp/fake-gapcov-profile',
    streamSubscribers: 0,
    lastMcpActivity: 1,
    mcpChild: null,
    mcpInProcess: null,
    mcpHealth: 'up',
    mcpError: null,
    closed: false,
    ownerSessionId: null,
    ...overrides
  };
  state().entries.set(e.id, e);
  return { e, cdp, relay };
}

/** A HEADED entry whose cdp always answers a STALE capture — the repair
 *  ladder cannot converge, so its correction arms run to exhaustion. */
function headedEntry(capture: (method: string) => unknown): { e: Entry; cdp: any; relay: any } {
  const TID = 'tid-head-' + Math.random().toString(36).slice(2, 8);
  const cdp = makeCdp({
    __tid: TID,
    'Page.captureScreenshot': capture as unknown,
    'Browser.getWindowForTarget': () => ({ windowId: 7 })
  });
  const relay = makeRelay([{ seq: 1, jpeg: sofJpeg(400, 300), metadata: {} }]);
  const e: Entry = {
    id: 'gapcovh-' + Math.random().toString(36).slice(2, 8),
    createdAt: new Date().toISOString(),
    context: { close: vi.fn(async () => undefined), pages: () => [] },
    tabs: new Map([[TID, { targetId: TID, tabId: 1, cdp, relay, page: { setViewportSize: vi.fn(async () => undefined) } }]]),
    tabOrder: [TID],
    tabIds: new Map([[1, TID]]),
    nextTabId: 2,
    activeTargetId: TID,
    viewport: { width: 700, height: 500 },
    zoom: 1,
    headless: false,
    port: 9412,
    brainPort: 19515,
    pid: null,
    profileDir: '/tmp/fake-gapcov-profile',
    streamSubscribers: 0,
    lastMcpActivity: 1,
    mcpChild: null,
    mcpInProcess: null,
    mcpHealth: 'up',
    mcpError: null,
    closed: false,
    ownerSessionId: null
  };
  state().entries.set(e.id, e);
  return { e, cdp, relay };
}

function mockLaunch(extra: Record<string, unknown> = {}): void {
  h.launchPersistentContext.mockResolvedValue({
    browser: () => ({}),
    pages: () => [{}],
    newCDPSession: vi.fn(async () => makeCdp()),
    close: vi.fn(async () => undefined),
    ...extra
  });
}

beforeEach(() => {
  for (const m of [h.launchPersistentContext, h.spawn, h.spawnSync, h.readdirSync, h.rmSync]) m.mockReset();
  h.spawnSync.mockReturnValue({ status: 1, stdout: { toString: () => '' } }); // ports free
  h.relayLatest.frame = null;
});

afterEach(() => {
  delete process.env.DSI_MCP_IN_PROCESS;
  delete process.env.GLASS_PORT;
  for (const id of [...(state()?.entries.keys() ?? [])]) state().entries.delete(id);
});

afterAll(async () => {
  for (const id of [...(state()?.entries.keys() ?? [])]) await browserRegistry.close(id).catch(() => undefined);
});

describe('close() — teardown error arms', () => {
  it('an entry WITHOUT deathListeners closes clean (nullish arm)', async () => {
    const { e } = seed();
    e.deathListeners = undefined;
    const res = await browserRegistry.close(e.id, 'test');
    expect(res).toEqual({ ok: true, alreadyClosed: false });
    expect(state().entries.has(e.id)).toBe(false);
  });

  it('a browserCdp detach that REJECTS cannot break the close', async () => {
    const { e } = seed();
    e.browserCdp = { detach: vi.fn(async () => { throw new Error('session gone'); }) };
    const res = await browserRegistry.close(e.id);
    expect(res.ok).toBe(true);
    expect(e.browserCdp.detach).toHaveBeenCalled();
  });

  it('every teardown failure is collected -> ok:false (context, relay, brain, rmSync)', async () => {
    const { e } = seed();
    e.context.close = vi.fn(async () => { throw new Error('context dead'); });
    e.tabs.get(e.activeTargetId!)!.relay.stop = vi.fn(() => { throw new Error('relay stuck'); });
    e.mcpInProcess = { connection: { close: vi.fn(async () => { throw new Error('brain refused'); }) }, httpServer: null };
    h.rmSync.mockImplementation(() => { throw new Error('EBUSY'); });
    const res = await browserRegistry.close(e.id);
    expect(res.ok).toBe(false);
    expect(res.alreadyClosed).toBe(false);
    expect(state().entries.has(e.id)).toBe(false);
  });
});

describe('dispatch / setZoom refusal + keep arms', () => {
  it('dispatch on a session whose closed FLAG is set answers CLOSED', async () => {
    const { e } = seed();
    e.closed = true;
    await expect(browserRegistry.dispatch(e.id, { type: 'mouse', x: 1, y: 1 } as any)).rejects.toThrow(BrowserRegistryRefusal);
  });

  it('setZoom refuses a closing session', async () => {
    const { e } = seed();
    e.closed = true;
    await expect(browserRegistry.setZoom(e.id, 1.5)).rejects.toThrow(/session is closing/);
  });

  it('setZoom with an unclampable zoom KEEPS the current zoom (silent keep arm)', async () => {
    const { e } = seed();
    await browserRegistry.setZoom(e.id, Number.NaN);
    expect(e.zoom).toBe(1);
  });

  it('setZoom happy path re-applies the panel viewport headless (dpr fallback arm)', async () => {
    const { e } = seed();
    const pageCdp = makeCdp();
    e.tabs.get(e.activeTargetId!)!.page = {
      setViewportSize: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => 0), // non-positive dpr -> the fallback dpr=1 arm
      context: () => ({ newCDPSession: vi.fn(async () => pageCdp) })
    };
    await browserRegistry.setZoom(e.id, 1.25);
    expect(e.zoom).toBe(1.25);
    const methods = pageCdp.send.mock.calls.map((c: any[]) => c[0]);
    expect(methods).toContain('Emulation.setDeviceMetricsOverride');
  });
});

describe('repairSurfaceAfterResize — the correction arms', () => {
  it('the ABSOLUTE correction arm: getWindowForTarget bounds teach cw/ch exactly', async () => {
    // capture always stale (400x300); the window bounds answer 418x390 ->
    // cw = 418-400 = 18, ch = 390-300 = 90 (the cur-bounds derivation arm)
    const { e } = headedEntry(() => ({ data: sofJpeg(400, 300) }));
    (e as any).chrome = undefined;
    const cdp = e.tabs.get(e.activeTargetId!)!.cdp;
    cdp.send.mockImplementation(async (method: string) => {
      if (method === 'Page.captureScreenshot') return { data: sofJpeg(400, 300) };
      if (method === 'Browser.getWindowForTarget') return { windowId: 7, bounds: { width: 418, height: 390 } };
      return {};
    });
    await browserRegistry.setViewport(e.id, 700, 500);
    expect((e as any).chrome).toEqual({ w: 18, h: 90 });
  }, 30_000);

  it('a rejecting capture AND an empty ring run the !d continue arm and SKIP the final reseed', async () => {
    const { e, relay } = headedEntry(() => { throw new Error('surface gone'); });
    relay.latestFrame = vi.fn(() => null); // no fallback dims either
    const cdp = e.tabs.get(e.activeTargetId!)!.cdp;
    cdp.send.mockImplementation(async (method: string) => {
      if (method === 'Page.captureScreenshot') throw new Error('surface gone'); // final reseed arm: shot null
      if (method === 'Browser.getWindowForTarget') return { windowId: 7 };
      return {};
    });
    await browserRegistry.setViewport(e.id, 700, 500); // must not throw
    expect(relay.reseed).not.toHaveBeenCalled(); // shot?.data falsy -> reseed skipped
  }, 30_000);
});

describe('open() — pointerless birth + first-frame seed arms', () => {
  it('a REJECTING getTargetInfo births a POINTERLESS entry (null pointer, no tabIds)', async () => {
    const birthCdp = makeCdp();
    birthCdp.send.mockImplementation(async (method: string) => {
      if (method === 'Target.getTargetInfo') throw new Error('target gone'); // open()'s catch arm
      if (method === 'Page.captureScreenshot') return { data: sofJpeg(320, 240) };
      return {};
    });
    mockLaunch({ pages: () => [{}], newCDPSession: vi.fn(async () => birthCdp) });
    const info = await browserRegistry.open({ spawnMcp: false, port: 9499 });
    const e = state().entries.get(info.id)!;
    expect(e.activeTargetId).toBeNull();
    expect(e.tabIds.size).toBe(0);
    expect(e.tabOrder).toEqual([]);
    expect(e.tabs.size).toBe(0);
    await browserRegistry.close(info.id);
  });

  it('an empty ring at birth is seeded via captureScreenshot (first-frame contract)', async () => {
    const birthCdp = makeCdp();
    birthCdp.send.mockImplementation(async (method: string) => {
      if (method === 'Page.captureScreenshot') return { data: sofJpeg(320, 240) };
      return {};
    });
    mockLaunch({ pages: () => [{}], newCDPSession: vi.fn(async () => birthCdp) });
    const info = await browserRegistry.open({ spawnMcp: false, port: 9505 });
    // the relay mock's latestFrame stays null the whole time -> the seed arm ran
    // (the mock class seeds the shared spy; assert via the birth cdp capture call)
    expect(birthCdp.send.mock.calls.some((c: any[]) => c[0] === 'Page.captureScreenshot')).toBe(true);
    await browserRegistry.close(info.id);
  });

  it('the scrollbar gate SKIPS a page without evaluate (typeof-guard false arm)', async () => {
    const birthCdp = makeCdp();
    const page: any = { setViewportSize: vi.fn(async () => undefined) }; // NO evaluate
    mockLaunch({ pages: () => [page], newCDPSession: vi.fn(async () => birthCdp) });
    const info = await browserRegistry.open({ spawnMcp: false, port: 9511 }); // headless default
    expect(info.mcp).toBe('none');
    await browserRegistry.close(info.id);
  });
});
