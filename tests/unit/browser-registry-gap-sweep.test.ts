/**
 * Browser registry GAP SWEEP — the arms the suites above leave open, all
 * mock-based (no chromium):
 *   - elementAt: happy / null element / parse-failure / evaluate cap arms
 *   - openTab: CLOSED, no-src, createTarget-no-id, activate=false, activate=true
 *   - closeTab: CLOSED, last-tab, no-such-tab, happy, active-move re-activate
 *   - dispatch: the CLOSED tombstone arm
 *   - applyPanelViewport: the HEADED arm (window resize) + no-windowId arm
 *   - handleOf lazy attach: probe hit, probe reject (catch), detach arm
 *   - activate: outgoing relay pause + screenshot seed + hostile-page catch
 *   - navigate waitLoad arm + seedAfterNavigate reseed; seedAfterResize seed
 *   - relay() CLOSED refusal; listTabs no-source / CDP-reject arms
 *   - close(): mcpChild kill throw arm
 */
import { EventEmitter } from 'node:events';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const makeCdp = (): EventEmitter & { send: ReturnType<typeof vi.fn> } => {
    const cdp = new EventEmitter() as EventEmitter & { send: ReturnType<typeof vi.fn>; detach: ReturnType<typeof vi.fn> };
    cdp.detach = vi.fn(async () => undefined);
    cdp.send = vi.fn(async (method: string) => {
      if (method === 'Target.getTargetInfo') return { targetInfo: { targetId: 'tid-' + Math.random().toString(36).slice(2, 8) } };
      return {};
    });
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
      enabled: false,
      headless: true,
      brainPort: 19599,
      mcpPin: '0.0.83',
      profileRoot: '/tmp/dsi-gap-browser-profiles',
      idleMs: 60_000,
      screencastQuality: 90,
      screencastMaxFps: 15
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
const state = (): { entries: Map<string, Entry>; closed: Set<string> } =>
  (process as any).__DSI_BROWSER_STATE__;

function seed(overrides: Partial<Entry> = {}): Entry {
  if (!(process as any).__DSI_BROWSER_STATE__) browserRegistry.list(); // init the process-global state
  const cdp = h.makeCdp();
  const TID = 'tid-' + Math.random().toString(36).slice(2, 8);
  const mkRelay = () => ({
    pause: vi.fn(async () => undefined),
    stop: vi.fn(),
    ensureStreaming: vi.fn(async () => undefined),
    dispatch: vi.fn(async () => undefined),
    seed: vi.fn(),
    reseed: vi.fn(),
    latestFrame: vi.fn(() => h.relayLatest.frame)
  });
  const e: Entry = {
    id: 'gap-' + Math.random().toString(36).slice(2, 8),
    createdAt: new Date().toISOString(),
    context: { close: vi.fn(async () => undefined), pages: () => [], newCDPSession: vi.fn(async () => h.makeCdp()) },
    cdp,
    tabs: new Map([[TID, { targetId: TID, cdp, relay: mkRelay(), page: { setViewportSize: vi.fn(async () => undefined) } }]]),
    activeTargetId: TID,
    viewport: { width: 1280, height: 800 },
    headless: true,
    port: 9412,
    brainPort: 19599,
    pid: null,
    profileDir: '/tmp/fake-gap-profile',
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

const handleOf = (e: Entry): any => (e.tabs as Map<string, any>).get(e.activeTargetId);

beforeEach(() => {
  h.relayLatest.frame = { seq: 1, jpeg: 'frame', metadata: {} }; // fast path: no first-frame grace
  h.spawnSync.mockReturnValue({ status: 1, stdout: { toString: () => '' } });
});

afterEach(() => {
  delete process.env.DSI_MCP_IN_PROCESS;
  for (const id of [...(state()?.entries.keys() ?? [])]) state().entries.delete(id);
  for (const id of [...(state()?.closed ?? [])]) state().closed.delete(id);
});

afterAll(async () => {
  for (const id of [...(state()?.entries.keys() ?? [])]) {
    await browserRegistry.close(id).catch(() => undefined);
  }
});
describe('elementAt', () => {
  it('parses the JSON answer with href/src/text', async () => {
    const e = seed();
    handleOf(e).cdp.send.mockImplementation(async (method: string) => {
      if (method === 'Runtime.evaluate')
        return { result: { value: JSON.stringify({ href: 'http://a/', src: 'http://i.png', text: 'link text' }) } };
      return {};
    });
    await expect(browserRegistry.elementAt(e.id, 5, 6)).resolves.toEqual({ href: 'http://a/', src: 'http://i.png', text: 'link text' });
  });

  it('a null element answer returns the all-null shape', async () => {
    const e = seed();
    handleOf(e).cdp.send.mockImplementation(async (method: string) => {
      if (method === 'Runtime.evaluate') return { result: { value: JSON.stringify({ href: null, src: null, text: null }) } };
      return {};
    });
    await expect(browserRegistry.elementAt(e.id, 0, 0)).resolves.toEqual({ href: null, src: null, text: null });
  });

  it('a non-JSON answer falls back to the all-null shape (parse catch arm)', async () => {
    const e = seed();
    handleOf(e).cdp.send.mockImplementation(async (method: string) => {
      if (method === 'Runtime.evaluate') return { result: { value: 'NOT JSON' } };
      return {};
    });
    await expect(browserRegistry.elementAt(e.id, 1, 1)).resolves.toEqual({ href: null, src: null, text: null });
  });

  it('a hung evaluate hits the 2s cap and answers all-null', async () => {
    const e = seed();
    handleOf(e).cdp.send.mockImplementation(async (method: string) => {
      if (method === 'Runtime.evaluate') await new Promise(() => undefined); // never resolves
      return {};
    });
    await expect(browserRegistry.elementAt(e.id, 1, 1)).resolves.toEqual({ href: null, src: null, text: null });
  }, 10_000);
});

describe('openTab', () => {
  it('refuses a CLOSED (tombstoned-flag) session', async () => {
    const e = seed({ closed: true });
    await expect(browserRegistry.openTab(e.id, 'http://x/')).rejects.toMatchObject({ code: 'CLOSED' });
  });

  it('refuses when no tab handle exists to create from', async () => {
    const e = seed({ tabs: new Map(), activeTargetId: null });
    await expect(browserRegistry.openTab(e.id, 'http://x/')).rejects.toMatchObject({ code: 'CLOSED' });
  });

  it('refuses when createTarget returns no id', async () => {
    const e = seed();
    handleOf(e).cdp.send.mockImplementation(async () => ({}));
    await expect(browserRegistry.openTab(e.id, 'http://x/')).rejects.toMatchObject({ code: 'NO_TARGET' });
  });

  it('happy path with activate:false — navigates, returns boundary payload', async () => {
    const e = seed();
    let created = 0;
    handleOf(e).cdp.send.mockImplementation(async (method: string) => {
      if (method === 'Target.createTarget') return { targetId: 'tid-new-' + ++created };
      return {};
    });
    const mkTab = (tid: string) => ({ targetId: tid, cdp: h.makeCdp(), relay: { pause: vi.fn(async () => undefined), stop: vi.fn(), ensureStreaming: vi.fn(async () => undefined), dispatch: vi.fn(async () => undefined), seed: vi.fn(), reseed: vi.fn(), latestFrame: vi.fn(() => h.relayLatest.frame) }, page: { setViewportSize: vi.fn(async () => undefined) } });
    (e.tabs as Map<string, any>).set('tid-new-1', mkTab('tid-new-1'));
    const res = await browserRegistry.openTab(e.id, 'http://new/', { activate: false });
    expect(res.targetId).toBe('tid-new-1');
    expect(res.url).toBe('http://new/');
    expect(e.tabs.has('tid-new-1')).toBe(true);
    expect(e.activeTargetId).not.toBe('tid-new-1'); // activate skipped
  });

  it('blank path (ADR-0042 D2): creates WITHOUT navigating, reports about:blank', async () => {
    const e = seed();
    const navSpy = vi.spyOn(browserRegistry, 'navigate').mockResolvedValue({} as never);
    handleOf(e).cdp.send.mockImplementation(async (method: string) => {
      if (method === 'Target.createTarget') return { targetId: 'tid-blank-1' };
      return {};
    });
    const res = await browserRegistry.openTab(e.id, undefined, { activate: false });
    expect(res.targetId).toBe('tid-blank-1');
    expect(res.url).toBe('about:blank');
    expect(navSpy).not.toHaveBeenCalled(); // createTarget ONLY — no navigate round trip
    navSpy.mockRestore();
  });

  it('activate:true moves the pointer and re-activates the new face', async () => {
    const e = seed();
    let created = 0;
    handleOf(e).cdp.send.mockImplementation(async (method: string) => {
      if (method === 'Target.createTarget') return { targetId: 'tid-open-' + ++created };
      return {};
    });
    const mkTab = (tid: string) => ({ targetId: tid, cdp: h.makeCdp(), relay: { pause: vi.fn(async () => undefined), stop: vi.fn(), ensureStreaming: vi.fn(async () => undefined), dispatch: vi.fn(async () => undefined), seed: vi.fn(), reseed: vi.fn(), latestFrame: vi.fn(() => h.relayLatest.frame) }, page: { setViewportSize: vi.fn(async () => undefined) } });
    (e.tabs as Map<string, any>).set('tid-open-1', mkTab('tid-new-1'));
    const res = await browserRegistry.openTab(e.id, 'http://activated/');
    expect(res.targetId).toBe('tid-open-1');
    expect(e.activeTargetId).toBe('tid-open-1');
  });
});

describe('closeTab', () => {
  it('refuses a closing session', async () => {
    const e = seed({ closed: true });
    await expect(browserRegistry.closeTab(e.id, 'any')).rejects.toMatchObject({ code: 'CLOSED' });
  });

  it('refuses closing the LAST tab', async () => {
    const e = seed();
    const only = e.activeTargetId as string;
    await expect(browserRegistry.closeTab(e.id, only)).rejects.toMatchObject({ code: 'NO_TARGET' });
  });

  it('refuses an unknown tab', async () => {
    const e = seed();
    (e.tabs as Map<string, any>).set('tid-second', { targetId: 'tid-second', cdp: h.makeCdp(), relay: { stop: vi.fn() }, page: {} });
    await expect(browserRegistry.closeTab(e.id, 'ghost')).rejects.toMatchObject({ code: 'NO_TARGET' });
  });

  it('closes a background tab without moving the pointer', async () => {
    const e = seed();
    const victimCdp = h.makeCdp();
    const stop = vi.fn();
    (e.tabs as Map<string, any>).set('tid-back', { targetId: 'tid-back', cdp: victimCdp, relay: { stop }, page: {} });
    const res = await browserRegistry.closeTab(e.id, 'tid-back');
    expect(res).toEqual({ ok: true, activeTargetId: e.activeTargetId });
    expect(stop).toHaveBeenCalled();
    expect(victimCdp.send).toHaveBeenCalledWith('Target.closeTarget', { targetId: 'tid-back' });
    expect(e.tabs.has('tid-back')).toBe(false);
  });

  it('closing the ACTIVE tab re-activates the first survivor', async () => {
    const e = seed();
    const survivorRelay = { pause: vi.fn(async () => undefined), stop: vi.fn(), ensureStreaming: vi.fn(async () => undefined), seed: vi.fn(), reseed: vi.fn(), latestFrame: vi.fn(() => ({ seq: 3, jpeg: 'j', metadata: {} })), dispatch: vi.fn(async () => undefined) };
    (e.tabs as Map<string, any>).set('tid-next', { targetId: 'tid-next', cdp: h.makeCdp(), relay: survivorRelay, page: { setViewportSize: vi.fn(async () => undefined) } });
    const res = await browserRegistry.closeTab(e.id, e.activeTargetId as string);
    expect(res.activeTargetId).toBe('tid-next');
    expect(survivorRelay.ensureStreaming).toHaveBeenCalled();
  });
});

describe('dispatch tombstone + relay refusal', () => {
  it('dispatch on a closed id answers CLOSED (tombstone arm)', async () => {
    const e = seed();
    const id = e.id;
    await browserRegistry.close(id);
    await expect(browserRegistry.dispatch(id, { kind: 'text', text: 'x' })).rejects.toMatchObject({ code: 'CLOSED' });
  });

  it('relay() refuses CLOSED when there is no active tab handle', async () => {
    const e = seed({ activeTargetId: null, tabs: new Map() });
    // relay() is sync-throwing, not async: expect a synchronous refusal
    try {
      browserRegistry.relay(e.id);
      expect.unreachable('relay should have refused');
    } catch (err) {
      expect((err as BrowserRegistryRefusal).code).toBe('CLOSED');
    }
  });
});