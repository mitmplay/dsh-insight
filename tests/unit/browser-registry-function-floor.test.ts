/**
 * Browser registry FUNCTION FLOOR sweep — the arms the earlier suites leave
 * to live traffic, all driven over the branch-mop mock harness shape:
 *   - open(): the context 'page' listener closure (retry loop + claim +
 *     auto-activate), the browser-level Target.targetCreated guest admit
 *     after its grace window, and the scrollbar-veto gate BOTH arms
 *   - handleOf: lazy attach of an enumerated-but-unattached target + the
 *     bounded-retry NO_TARGET refusal
 *   - applyPanelViewport + repairSurfaceAfterResize: the HEADED arms
 *     (learned chrome offset, STEP-1 convergence, bounce + flash) via
 *     JPEG SOF dims the repair parses from captures
 *   - listTabs: adoption of unknown live pages, healHandles' dead cached
 *     handle, the live-page probe arm, the pointer-null arm
 *   - closeTab: ordinal refusal, last-tab refusal, non-active victim,
 *     active victim re-activate
 *   - openTab / dispatch / elementAt / historyTravel refusal + fallback arms
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
      profileRoot: '/tmp/dsi-floor-browser-profiles',
      idleMs: 60_000,
      screencastQuality: 90,
      screencastMaxFps: 15,
      contentZoom: 1
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

import {
  admitGuestBirth,
  BrowserRegistryRefusal,
  browserRegistry,
  claimOwnerBirth,
  clampZoom,
  healPreserveOrdinal,
  layoutViewport,
  mintTabId,
  orphanChromePids,
  resolveTab,
  retireTabId
} from '$lib/server/browser/registry.js';

type Entry = Record<string, any> & { id: string };
const state = (): { entries: Map<string, Entry>; closed: Set<string> } => {
  if (!(process as any).__DSI_BROWSER_STATE__) browserRegistry.list(); // force the lazy init sweep
  return (process as any).__DSI_BROWSER_STATE__;
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** A minimal JPEG whose SOF0 marker carries (w, h) — the repair's dimsOf
 *  parses dims out of the bytes when the screencast metadata is empty. */
function sofJpeg(w: number, hh: number): string {
  return Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, (hh >> 8) & 255, hh & 255, (w >> 8) & 255, w & 255, 3, 0, 0, 0, 0, 0]).toString('base64');
}

/** A fake CDP session: EventEmitter + a send() dispatch table. */
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
    id: 'floor-' + Math.random().toString(36).slice(2, 8),
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
    profileDir: '/tmp/fake-profile-floor',
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
});

afterEach(() => {
  delete process.env.DSI_MCP_IN_PROCESS;
  delete process.env.GLASS_PORT;
  for (const id of [...(state()?.entries.keys() ?? [])]) state().entries.delete(id);
});

afterAll(async () => {
  for (const id of [...(state()?.entries.keys() ?? [])]) await browserRegistry.close(id).catch(() => undefined);
});

// ---- pure map surgery: the guard matrix in one place -------------------------
describe('pure registry helpers (guard matrix)', () => {
  it('layoutViewport clamps the zoom and the box on both axes', () => {
    expect(layoutViewport(1000, 800, 2)).toEqual({ width: 500, height: 400 });
    expect(layoutViewport(1000, 800, 0)).toEqual({ width: 1000, height: 800 }); // z<=0 -> 1
    expect(layoutViewport(99999, 99999, 1)).toEqual({ width: 8192, height: 8192 });
  });

  it('clampZoom: non-number, non-finite, and out-of-range are null', () => {
    for (const bad of ['1', null, undefined, NaN, Infinity, 0.49, 1.26]) {
      expect(clampZoom(bad)).toBeNull();
    }
    expect(clampZoom(0.5)).toBe(0.5);
    expect(clampZoom(1.25)).toBe(1.25);
  });

  it('mintTabId is idempotent per targetId and never reuses ordinals', () => {
    const e: any = {};
    expect(mintTabId(e, 't1')).toBe(1);
    expect(mintTabId(e, 't1')).toBe(1); // re-enter
    expect(mintTabId(e, 't2')).toBe(2);
  });

  it('retireTabId drops the ordinal side; unknown targets are a no-op', () => {
    const e: any = { tabIds: new Map([[1, 'a']]), nextTabId: 2 };
    retireTabId(e, 'zzz');
    expect(e.tabIds.size).toBe(1);
    retireTabId(e, 'a');
    expect(e.tabIds.size).toBe(0);
    retireTabId({ tabIds: undefined } as any, 'a'); // no map at all: silent
  });

  it('healPreserveOrdinal rewrites in place and falls back to a mint', () => {
    const e: any = { tabIds: new Map([[3, 'old']]), nextTabId: 9 };
    expect(healPreserveOrdinal(e, 'old', 'new')).toBe(3);
    expect(e.tabIds.get(3)).toBe('new');
    expect(healPreserveOrdinal(e, 'ghost', 'fresh')).toBe(9); // fresh mint
  });

  it('resolveTab: active pointer arms, ordinal arms, raw targetId arm', () => {
    const e: any = { tabIds: new Map([[1, 'a'], [2, 'b']]), activeTargetId: 'b' };
    expect(resolveTab(e, 'active')).toEqual({ ok: true, targetId: 'b', tabId: 2 });
    expect(resolveTab({ ...e, activeTargetId: null }, 'active').ok).toBe(false);
    expect(resolveTab({ tabIds: new Map(), activeTargetId: 'zzz', nextTabId: 0 }, 'active').ok).toBe(false);
    expect(resolveTab(e, 2)).toEqual({ ok: true, targetId: 'b', tabId: 2 });
    expect(resolveTab(e, '2')).toEqual({ ok: true, targetId: 'b', tabId: 2 });
    expect(resolveTab(e, 99).ok).toBe(false); // unknown ordinal
    expect(resolveTab(e, 'b')).toEqual({ ok: true, targetId: 'b', tabId: 2 });
    expect(resolveTab(e, 'ghost').ok).toBe(false);
  });

  it('claimOwnerBirth + admitGuestBirth: the guard matrix', () => {
    const e: any = { closed: false, tabOrder: [], tabs: new Map() };
    claimOwnerBirth(e, 'own');
    expect(admitGuestBirth(e, 'own')).toBe(false); // owner claimed
    expect(admitGuestBirth(e, 'known')).toBe(true);
    expect(admitGuestBirth(e, 'known')).toBe(false); // already known
    expect(admitGuestBirth({ ...e, closed: true }, 'x')).toBe(false);
  });

  it('orphanChromePids matches only dirs ENDING at the profile name', () => {
    const ps = [
      '  101 /Applications/Chrome --user-data-dir=/tmp/dsi/abc1 --flag',
      '  202 chrome --user-data-dir=/tmp/dsi/abc12', // prefix sibling: no match for abc1
      '  303 not-a-chrome at all',
      '  garbage'
    ].join('\n');
    expect(orphanChromePids(ps, 'abc1')).toEqual([101]);
    expect(orphanChromePids('no needle here', 'abc1')).toEqual([]);
  });
});

// ---- open(): the closures only a fake context can reach ----------------------
describe('open() closures — page listener, guest watcher, scrollbar gate', () => {
  it('the context page listener claims + activates its own birth', async () => {
    const NEW = 'tid-newborn';
    const contextCdp = makeCdp({ __tid: NEW });
    const fakePage: any = { setViewportSize: vi.fn(async () => undefined) };
    const on = vi.fn();
    mockLaunch({
      pages: () => [fakePage],
      newCDPSession: vi.fn(async (p: unknown) => (p === fakePage ? contextCdp : makeCdp({ __tid: NEW }))),
      on
    });
    const info = await browserRegistry.open({ spawnMcp: false, headless: true });
    const e = state().entries.get(info.id)!;
    expect(on).toHaveBeenCalled();
    const listener = on.mock.calls[0][1] as (p: unknown) => void;
    listener(fakePage);
    await vi.waitFor(() => {
      expect(e.tabOrder).toContain(NEW); // minted + tabOrder appended
      expect(e.ownBirths.has(NEW)).toBe(true); // owner hand claimed
      expect(e.tabs.has(NEW)).toBe(true); // activate's attach landed
      expect(e.activeTargetId).toBe(NEW); // the follow moved the pointer
    }, { timeout: 8000, interval: 100 });
  });

  it('an unclaimed browser-level birth is a GUEST after the grace window', async () => {
    const NEW = 'tid-guest';
    const bcdp = makeCdp();
    mockLaunch({
      browser: () => ({ newBrowserCDPSession: async () => bcdp })
    });
    const info = await browserRegistry.open({ spawnMcp: false, headless: true });
    const e = state().entries.get(info.id)!;
    bcdp.emit('Target.targetCreated', { targetInfo: { targetId: NEW, type: 'page' } });
    // within the grace window nothing has landed yet
    await sleep(400);
    expect(e.tabOrder).not.toContain(NEW);
    // after the FULL grace (10 x 300ms) the guest is admitted without focus
    await vi.waitFor(() => {
      expect(e.tabOrder).toContain(NEW);
      expect([...e.tabIds.values()]).toContain(NEW); // admitGuestBirth minted the ordinal
      expect(e.tabs.has(NEW)).toBe(false); // NO CDP handle — appear, not attach
      expect(e.activeTargetId).not.toBe(NEW); // pointer NEVER moved
    }, { timeout: 8000, interval: 200 });
  }, 20_000);

  it('the scrollbar gate throws when a headless launch hides its bars', async () => {
    const birth: any = { evaluate: vi.fn(async () => 0) }; // zero bar footprint
    mockLaunch({ pages: () => [birth] });
    await expect(browserRegistry.open({ spawnMcp: false, headless: true })).rejects.toThrow(/scrollbar gate/);
  });

  it('a healthy bar footprint passes the gate and open() resolves', async () => {
    const birth: any = { evaluate: vi.fn(async () => 15) };
    mockLaunch({ pages: () => [birth] });
    const info = await browserRegistry.open({ spawnMcp: false, headless: true });
    expect(birth.evaluate).toHaveBeenCalled();
    expect(state().entries.has(info.id)).toBe(true);
  });
});

// ---- the HEADED viewport + surface-repair ladder ------------------------------
describe('headed applyPanelViewport + repairSurfaceAfterResize', () => {
  function headedEntry(frame: any, handlers: Handlers = {}) {
    const TID = 'tid-head';
    const cdp = makeCdp({
      __tid: TID,
      'Runtime.evaluate': () => ({ result: { value: JSON.stringify({ oh: 87, ow: 6 }) } }),
      'Target.getWindowForTarget': () => ({ windowId: 7 }),
      'Browser.getWindowForTarget': () => ({ windowId: 7, bounds: { width: 793, height: 593 } }),
      'Browser.setWindowBounds': () => ({}),
      'Page.captureScreenshot': () => ({ data: sofJpeg(700, 500) }),
      ...handlers
    });
    const relay = makeRelay([frame]);
    const base = seed({});
    const e: Entry = {
      ...base.e,
      id: 'head-' + Math.random().toString(36).slice(2, 8),
      headless: false,
      activeTargetId: TID,
      tabs: new Map([[TID, { targetId: TID, tabId: 1, cdp, relay, page: { setViewportSize: vi.fn(async () => undefined) } }]]),
      tabOrder: [TID],
      tabIds: new Map([[1, TID]]),
      nextTabId: 2,
      chrome: undefined
    };
    state().entries.set(e.id, e);
    return { e, cdp, relay };
  }

  it('applyPanelViewport (via activate) learns the chrome offset and resizes the window', async () => {
    const frame = { seq: 1, jpeg: sofJpeg(700, 500), metadata: { deviceWidth: 700, deviceHeight: 500 } };
    const { e, cdp } = headedEntry(frame);
    await browserRegistry.activate(e.id, e.activeTargetId!);
    const calls = cdp.send.mock.calls.map((c: any[]) => c[0]);
    expect(calls).toContain('Browser.setWindowBounds'); // the window resize
    expect(e.chrome).toEqual({ w: 6, h: 87 }); // the live evaluate answered
  });

  it('STEP 1 converges when the capture matches the request', async () => {
    const stale = { seq: 1, jpeg: sofJpeg(400, 300), metadata: {} };
    const { e, cdp } = headedEntry(stale);
    await browserRegistry.setViewport(e.id, 700, 500);
    expect(e.chrome).toBeDefined(); // the feedback loop learned the offset
    expect(cdp.send.mock.calls.some((c: any[]) => c[0] === 'Browser.setWindowBounds')).toBe(true);
  }, 20_000);

  it('a never-matching surface runs the bounce, the flash, and the final reseed', async () => {
    const stale = { seq: 1, jpeg: sofJpeg(400, 300), metadata: {} };
    const { e, cdp } = headedEntry(stale, {
      'Page.captureScreenshot': () => ({ data: sofJpeg(400, 300) }) // always stale
    });
    await browserRegistry.setViewport(e.id, 700, 500);
    const methods = cdp.send.mock.calls.map((c: any[]) => c[0]);
    expect(methods.filter((m: string) => m === 'Browser.setWindowBounds').length).toBeGreaterThanOrEqual(5); // set + bounce pair + flash pair
    expect(e.chrome).toBeDefined();
  }, 30_000);
});

// ---- listTabs arms -------------------------------------------------------------
describe('listTabs — heal, probe, adopt, pointer', () => {
  it('adopts an unknown live page with the next ordinal, survivors keep theirs', async () => {
    const TID = 'tid-known';
    const NEW = 'tid-unknown';
    const cdp = makeCdp({
      __tid: TID,
      'Target.getTargets': () => ({ targetInfos: [
        { targetId: TID, type: 'page', url: 'https://a', title: 'A' },
        { targetId: NEW, type: 'page', url: 'https://b', title: 'B' }
      ] })
    });
    const newPage: any = { url: () => 'https://b', setViewportSize: vi.fn(async () => undefined) };
    const { e } = seed({
      activeTargetId: TID,
      context: { close: vi.fn(async () => undefined), pages: () => [newPage], newCDPSession: vi.fn(async () => makeCdp({ __tid: NEW })) },
      tabs: new Map([[TID, { targetId: TID, tabId: 1, cdp, relay: makeRelay([]), page: newPage }]]),
      tabOrder: [TID],
      tabIds: new Map([[1, TID]]),
      nextTabId: 2
    });
    const rows = await browserRegistry.listTabs(e.id);
    expect(rows.map((r) => r.targetId)).toEqual([TID, NEW]); // tabOrder sort: known first
    expect(rows[1].tabId).toBe(2); // adoption minted the next ordinal
    expect(rows[0].active).toBe(true);
  });

  it('heals a DEAD cached handle preserving its ordinal', async () => {
    const TID = 'tid-dead';
    const freshCdp = makeCdp({ __tid: TID });
    const oldCdp = makeCdp({ __tid: TID });
    oldCdp.send.mockImplementation(async (method: string) => {
      if (method === 'Target.getTargets') throw new Error('session closed'); // enumeration blind: heal fires
      if (method === 'Target.getTargetInfo') throw new Error('handle dead'); // the cached handle is dead
      return {};
    });
    const oldRelay = makeRelay([]);
    const page: any = { url: () => 'https://healed', setViewportSize: vi.fn(async () => undefined) };
    const { e } = seed({
      activeTargetId: TID,
      context: { close: vi.fn(async () => undefined), pages: () => [page], newCDPSession: vi.fn(async () => freshCdp) },
      tabs: new Map([[TID, { targetId: TID, tabId: 1, cdp: oldCdp, relay: oldRelay, page }]]),
      tabOrder: [TID],
      tabIds: new Map([[1, TID]]),
      nextTabId: 2
    });
    const rows = await browserRegistry.listTabs(e.id);
    expect(oldRelay.stop).toHaveBeenCalled(); // the dead relay stopped
    expect(e.tabs.get(TID)!.cdp).toBe(freshCdp); // replaced
    expect(rows[0].tabId).toBe(1); // ordinal PRESERVED
  });

  it('probes live pages directly when enumeration is blind; re-points a corpse pointer', async () => {
    const LIVE = 'tid-live';
    const CORPSE = 'tid-corpse';
    const page: any = { url: () => 'https://probed', setViewportSize: vi.fn(async () => undefined) };
    const probeCdp = makeCdp({ __tid: LIVE });
    // the pointer's OWN handle is CDP-healthy but enumerates EMPTY — heal
    // keeps it, the probe arm feeds, and the D2 re-point moves the pointer
    const corpseCdp = makeCdp({ __tid: CORPSE, 'Target.getTargets': () => ({ targetInfos: [] }) });
    const corpseRelay = makeRelay([]);
    const { e } = seed({
      activeTargetId: CORPSE,
      context: { close: vi.fn(async () => undefined), pages: () => [page], newCDPSession: vi.fn(async () => probeCdp) },
      tabs: new Map([[CORPSE, { targetId: CORPSE, tabId: 1, cdp: corpseCdp, relay: corpseRelay, page: {} }]]),
      tabOrder: [CORPSE],
      tabIds: new Map([[1, CORPSE]]),
      nextTabId: 2
    });
    const rows = await browserRegistry.listTabs(e.id);
    expect(rows.map((r) => r.targetId)).toEqual([LIVE]); // probed from the live page
    expect(e.activeTargetId).toBe(LIVE); // the corpse pointer re-pointed
  });

  it('zero survivors nulls the pointer instead of lying', async () => {
    const { e } = seed({
      context: { close: vi.fn(async () => undefined), pages: () => [] }
    });
    const TID = [...e.tabs.keys()][0];
    e.tabs.get(TID)!.cdp.send.mockImplementation(async (method: string) => {
      if (method === 'Target.getTargets') return { targetInfos: [] }; // enumeration empty
      return {};
    });
    const rows = await browserRegistry.listTabs(e.id);
    expect(rows).toEqual([]);
    expect(e.activeTargetId).toBeNull();
  });
});

// ---- closeTab matrix -----------------------------------------------------------
describe('closeTab — the refusal + re-activate matrix', () => {
  it('an unknown or retired ordinal is an explicit NO_TARGET', async () => {
    const { e } = seed();
    await expect(browserRegistry.closeTab(e.id, 99)).rejects.toThrow(/unknown or retired tab ordinal/);
  });

  it('closing the LAST tab is refused — the trash owns session death', async () => {
    const { e } = seed();
    await expect(browserRegistry.closeTab(e.id, 1)).rejects.toThrow(/cannot close the last tab/);
  });

  it('closing a NON-active victim stops its relay and splices the order', async () => {
    const { e } = seed();
    const victimTid = 'tid-victim';
    const victimRelay = makeRelay([]);
    const victimCdp = makeCdp({ __tid: victimTid });
    e.tabs.set(victimTid, { targetId: victimTid, tabId: 2, cdp: victimCdp, relay: victimRelay, page: {} });
    e.tabOrder.push(victimTid);
    mintTabId(e as any, victimTid);
    const out = await browserRegistry.closeTab(e.id, 2);
    expect(victimRelay.stop).toHaveBeenCalled();
    expect(e.tabs.has(victimTid)).toBe(false);
    expect(e.tabOrder).not.toContain(victimTid);
    expect(out).toEqual({ ok: true, activeTargetId: e.activeTargetId });
    expect(victimCdp.send).toHaveBeenCalledWith('Target.closeTarget', { targetId: victimTid });
  });

  it('closing the ACTIVE tab moves the pointer and re-activates the survivor', async () => {
    const cdp = makeCdp({ __tid: 'tid-survivor' });
    const relay = makeRelay([{ seq: 1, jpeg: sofJpeg(10, 10), metadata: {} }]);
    const { e } = seed();
    const survivor = 'tid-survivor';
    e.tabs.set(survivor, { targetId: survivor, tabId: 2, cdp, relay, page: { setViewportSize: vi.fn(async () => undefined) } });
    e.tabOrder.push(survivor);
    mintTabId(e as any, survivor);
    const out = await browserRegistry.closeTab(e.id, 1);
    expect(out.activeTargetId).toBe(survivor);
    expect(e.activeTargetId).toBe(survivor);
  });
});

// ---- openTab / dispatch / elementAt arms ---------------------------------------
describe('openTab, dispatch, elementAt arms', () => {
  it('openTab without a tab handle is CLOSED; createTarget without an id is NO_TARGET', async () => {
    const { e } = seed();
    e.tabs.clear();
    await expect(browserRegistry.openTab(e.id)).rejects.toThrow(/no tab handle to create from/);
    const { e: e2 } = seed();
    const active = e2.tabs.get(e2.activeTargetId!)!;
    active.cdp.send.mockImplementation(async (m: string) => (m === 'Target.createTarget' ? {} : {}));
    await expect(browserRegistry.openTab(e2.id)).rejects.toThrow(/returned no id/);
  });

  it('openTab with activate:false mints the ordinal and skips the switch', async () => {
    const { e } = seed();
    const NEW = 'tid-opened';
    e.tabs.get(e.activeTargetId!)!.cdp.send.mockImplementation(async (m: string) =>
      m === 'Target.createTarget' ? { targetId: NEW } : {});
    const out = await browserRegistry.openTab(e.id, undefined, { activate: false });
    expect(out.tabId).toBe(2);
    expect(out.targetId).toBe(NEW);
    expect(out.url).toBe('about:blank');
    expect(e.activeTargetId).not.toBe(NEW);
  });

  it('a tombstoned id answers CLOSED, not a 404-disguised miss', async () => {
    const { e } = seed();
    state().closed.add(e.id);
    state().entries.delete(e.id);
    await expect(browserRegistry.dispatch(e.id, { type: 'mousePressed' } as any)).rejects.toThrow(/session was closed/);
  });

  it('elementAt survives a garbage evaluate answer with nulls', async () => {
    const { e } = seed();
    e.tabs.get(e.activeTargetId!)!.cdp.send.mockImplementation(async (m: string) =>
      m === 'Runtime.evaluate' ? { result: { value: 'not-json{{' } } : {});
    const out = await browserRegistry.elementAt(e.id, 5, 5);
    expect(out).toEqual({ href: null, src: null, text: null, selection: null });
  });

  it('historyTravel refuses an out-of-list position and travels a valid one', async () => {
    const { e, cdp } = seed();
    cdp.send.mockImplementation(async (m: string) => {
      if (m === 'Page.getNavigationHistory') return { currentIndex: 0, entries: [{ id: 11 }, { id: 12 }] };
      if (m === 'Page.navigateToHistoryEntry') { cdp.emit('Page.loadEventFired', {}); return {}; }
      return {};
    });
    await expect(browserRegistry.historyTravel(e.id, 9)).rejects.toThrow(/HISTORY_INDEX/);
    const out = await browserRegistry.historyTravel(e.id, 1);
    expect(out).toEqual({ currentIndex: 1, entryCount: 2 });
    expect(cdp.send).toHaveBeenCalledWith('Page.navigateToHistoryEntry', { entryId: 12 });
  });
});
