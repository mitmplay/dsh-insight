/**
 * Registry REJECT arms — the one-line swallow callbacks
 * (`.catch(() => undefined)`) only EXECUTE when the underlying promise
 * actually rejects. Each test injects a rejection at a controlled point and
 * asserts the registry stays consistent (the swallow did not surface).
 * Sibling of browser-registry-gap-sweep.test.ts — same mock harness.
 */
import { EventEmitter } from 'node:events';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const makeCdp = (): EventEmitter & { send: ReturnType<typeof vi.fn>; detach: ReturnType<typeof vi.fn> } => {
    const cdp = new EventEmitter() as EventEmitter & { send: ReturnType<typeof vi.fn>; detach: ReturnType<typeof vi.fn> };
    cdp.send = vi.fn(async (method: string) => {
      if (method === 'Target.getTargetInfo') return { targetInfo: { targetId: 'tid-' + Math.random().toString(36).slice(2, 8) } };
      return {};
    });
    cdp.detach = vi.fn(async () => undefined);
    return cdp;
  };
  /** A cdp whose .send PROPERTY getter throws from the Nth access on —
   *  the only way to make applyPanelViewport (all of whose awaits carry
   *  internal catches) REJECT and so fire its callers' swallow callbacks. */
  const makeSendGetterThrowsFrom = (n: number): any => {
    const cdp = makeCdp();
    const real = cdp.send;
    let accesses = 0;
    Object.defineProperty(cdp, 'send', {
      get() {
        accesses += 1;
        if (accesses >= n) throw new Error('send access exploded');
        return real;
      }
    });
    return cdp;
  };
  const mkRelay = () => ({
    pause: vi.fn(async () => undefined),
    stop: vi.fn(),
    ensureStreaming: vi.fn(async () => undefined),
    dispatch: vi.fn(async () => undefined),
    seed: vi.fn(),
    reseed: vi.fn(),
    latestFrame: vi.fn(() => h.relayLatest.frame)
  });
  return {
    makeCdp,
    makeSendGetterThrowsFrom,
    mkRelay,
    launchPersistentContext: vi.fn(),
    spawn: vi.fn(),
    spawnSync: vi.fn(),
    readdirSync: vi.fn(),
    rmSync: vi.fn(),
    cfg: {
      enabled: false,
      headless: true,
      brainPort: 19598,
      mcpPin: '0.0.83',
      profileRoot: '/tmp/dsi-reject-browser-profiles',
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

import { browserRegistry } from '$lib/server/browser/registry.js';

type Entry = Record<string, any> & { id: string };
const state = (): { entries: Map<string, Entry>; closed: Set<string> } =>
  (process as any).__DSI_BROWSER_STATE__;

function seed(overrides: Partial<Entry> = {}): Entry {
  if (!(process as any).__DSI_BROWSER_STATE__) browserRegistry.list();
  const cdp = h.makeCdp();
  const TID = 'tid-' + Math.random().toString(36).slice(2, 8);
  const e: Entry = {
    id: 'rej-' + Math.random().toString(36).slice(2, 8),
    createdAt: new Date().toISOString(),
    context: { close: vi.fn(async () => undefined), pages: () => [], newCDPSession: vi.fn(async () => h.makeCdp()) },
    cdp,
    tabs: new Map([[TID, { targetId: TID, cdp, relay: h.mkRelay(), page: { setViewportSize: vi.fn(async () => undefined) } }]]),
    activeTargetId: TID,
    viewport: { width: 1280, height: 800 },
    headless: true,
    port: 9413,
    brainPort: 19598,
    pid: null,
    profileDir: '/tmp/fake-reject-profile',
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

const pageJson = JSON.stringify({ url: 'http://x/', title: 'T', dpr: 1, innerWidth: 10, innerHeight: 10, playerError: null, mediaErrorCode: null });

beforeEach(() => {
  h.relayLatest.frame = { seq: 1, jpeg: 'frame', metadata: {} };
  h.spawnSync.mockReturnValue({ status: 1, stdout: { toString: () => '' } });
});

afterEach(() => {
  for (const id of [...(state()?.entries.keys() ?? [])]) state().entries.delete(id);
  for (const id of [...(state()?.closed ?? [])]) state().closed.delete(id);
});

afterAll(async () => {
  for (const id of [...(state()?.entries.keys() ?? [])]) {
    await browserRegistry.close(id).catch(() => undefined);
  }
});

describe('activate() swallow arms (452/453/460/461/471)', () => {
  it('every best-effort await rejects on switch and the switch still completes', async () => {
    const e = seed();
    const relay = handleOf(e).relay;
    relay.pause.mockRejectedValue(new Error('pause blew up'));
    relay.ensureStreaming.mockRejectedValue(new Error('stream blew up'));
    h.relayLatest.frame = null; // first-frame grace -> captureScreenshot seed arm
    handleOf(e).cdp.send.mockImplementation(async (method: string) => {
      if (method === 'Page.enable' || method === 'Page.bringToFront') throw new Error('cdp gone: ' + method);
      if (method === 'Page.captureScreenshot') throw new Error('screenshot gone');
      if (method === 'Runtime.evaluate') return { result: { value: pageJson } };
      return {};
    });
    const res = await browserRegistry.activate(e.id, e.activeTargetId as string);
    expect(res.targetId).toBe(e.activeTargetId); // the switch survived every rejection
    expect(res.seq).toBe(0); // no frame, no seed — honest boundary payload
  }, 10_000);
});

describe('handleOf lazy-attach swallow arms (407/412/416/417)', () => {
  it('detach rejecting + applyPanelViewport/send-access rejections during attach', async () => {
    const e = seed();
    const NEW = 'tid-reject-attach';
    // probe 1: getTargetInfo rejects -> scdp.detach().catch arm (407)
    const probe1 = h.makeCdp();
    probe1.send.mockRejectedValue(new Error('target unreachable'));
    probe1.detach.mockRejectedValue(new Error('detach blew up'));
    // probe 2: names the target, then its send ACCESS explodes from the 2nd
    // access on -> applyPanelViewport (412), Page.enable (416), and the
    // second applyPanelViewport (417) all reject into their swallow arms
    // probe 2 names the target, then REJECTS every send: Page.enable's own
    // .catch arm (416) fires directly, and applyPanelViewport (whose headless
    // arm needs page.setViewportSize) rejects -> the void/awaited catches at
    // 412/417 fire
    const probe2 = h.makeCdp();
    probe2.send.mockImplementation(async (method: string) => {
      if (method === 'Target.getTargetInfo') return { targetInfo: { targetId: NEW } };
      throw new Error('cdp gone: ' + method);
    });
    let call = 0;
    (e.context as any).pages = () => [{ setViewportSize: vi.fn(async () => undefined) }, { setViewportSize: vi.fn(async () => undefined) }];
    (e.context as any).newCDPSession = vi.fn(async () => {
      call += 1;
      return call === 1 ? probe1 : probe2;
    });
    await expect(browserRegistry.activate(e.id, NEW)).resolves.toMatchObject({ targetId: NEW });
    expect(probe1.detach).toHaveBeenCalled(); // the reject fired into its catch
    expect(e.tabs.has(NEW)).toBe(true); // the handle still landed
  }, 15_000);
});

describe('listTabs filter/map arrows (434)', () => {
  it('page targets flow through filter+map; non-page noise is dropped', async () => {
    const e = seed();
    handleOf(e).cdp.send.mockImplementation(async (method: string) => {
      if (method === 'Target.getTargets')
        return {
          targetInfos: [
            { targetId: 't-page', type: 'page', url: 'http://p/', title: 'P' },
            { targetId: 't-ifr', type: 'iframe', url: 'about:blank', title: 'noise' },
            { targetId: 't-sw', type: 'service_worker', url: 'sw.js', title: 'noise2' }
          ]
        };
      return {};
    });
    const tabs = await browserRegistry.listTabs(e.id);
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toEqual({ targetId: 't-page', url: 'http://p/', title: 'P', active: false }); // active is the seed tid, not t-page
  });
});

describe('seedAfterNavigate swallow arms (766/817)', () => {
  it('a reseed that THROWS is swallowed (void catch arm)', async () => {
    const e = seed();
    h.relayLatest.frame = null; // grace loop runs, then the reseed fires
    handleOf(e).relay.reseed.mockImplementation(() => { throw new Error('reseed blew up'); });
    handleOf(e).cdp.send.mockImplementation(async (method: string) => {
      if (method === 'Page.captureScreenshot') return { data: 'jpeg-b64' };
      return {};
    });
    await browserRegistry.navigate(e.id, 'http://silent/');
    await new Promise((r) => setTimeout(r, 1200)); // let the voided seed run past the grace
    expect(state().entries.has(e.id)).toBe(true); // the registry is unharmed
  }, 10_000);

  it('a rejecting captureScreenshot is caught inside the seed arm', async () => {
    const e = seed();
    h.relayLatest.frame = null;
    handleOf(e).cdp.send.mockImplementation(async (method: string) => {
      if (method === 'Page.captureScreenshot') throw new Error('screenshot gone');
      return {};
    });
    await browserRegistry.navigate(e.id, 'http://silent2/');
    await new Promise((r) => setTimeout(r, 1200));
    expect(handleOf(e).relay.reseed).not.toHaveBeenCalled();
  }, 10_000);
});

describe('seedAfterResize swallow arms (787/803/961)', () => {
  it('a seed that THROWS is swallowed (void catch arm)', async () => {
    const e = seed();
    h.relayLatest.frame = null;
    handleOf(e).relay.seed.mockImplementation(() => { throw new Error('seed blew up'); });
    handleOf(e).cdp.send.mockImplementation(async (method: string) => {
      if (method === 'Page.captureScreenshot') return { data: 'jpeg-b64' };
      return {};
    });
    await browserRegistry.setViewport(e.id, 700, 500);
    await new Promise((r) => setTimeout(r, 1200));
    expect(state().entries.has(e.id)).toBe(true);
  }, 10_000);

  it('a rejecting captureScreenshot is caught inside the resize seed arm', async () => {
    const e = seed();
    h.relayLatest.frame = null;
    handleOf(e).cdp.send.mockImplementation(async (method: string) => {
      if (method === 'Page.captureScreenshot') throw new Error('screenshot gone');
      return {};
    });
    await browserRegistry.setViewport(e.id, 640, 480);
    await new Promise((r) => setTimeout(r, 1200));
    expect(handleOf(e).relay.seed).not.toHaveBeenCalled();
  }, 10_000);

  it('a rejecting page.setViewportSize is swallowed in the headless viewport arm', async () => {
    const e = seed();
    handleOf(e).page.setViewportSize.mockRejectedValue(new Error('resize blew up'));
    await expect(browserRegistry.setViewport(e.id, 500, 400)).resolves.toBeUndefined();
    expect(e.viewport).toEqual({ width: 500, height: 400 }); // remembered anyway (D4)
  });
});

describe('closeTab swallow arms (995/996/1000)', () => {
  it('closeTarget/detach rejections on the victim are swallowed', async () => {
    const e = seed();
    const victimCdp = h.makeCdp();
    victimCdp.send.mockRejectedValue(new Error('closeTarget gone'));
    victimCdp.detach.mockRejectedValue(new Error('detach gone'));
    (e.tabs as Map<string, any>).set('tid-victim', { targetId: 'tid-victim', cdp: victimCdp, relay: { stop: vi.fn() }, page: {} });
    const res = await browserRegistry.closeTab(e.id, 'tid-victim');
    expect(res.ok).toBe(true); // the rejections never surfaced
    expect(e.tabs.has('tid-victim')).toBe(false); // the handle is gone
  });

  it('a survivor re-activate that REJECTS is swallowed (1000)', async () => {
    const e = seed();
    // the survivor's send ACCESS explodes -> applyPanelViewport (un-caught
    // await in activate) rejects -> closeTab's .catch arm fires
    const survivorCdp = h.makeSendGetterThrowsFrom(3); // 1: getTargetInfo at open, 2: Page.enable in activate, 3: applyPanelViewport
    (e.tabs as Map<string, any>).set('tid-surv', { targetId: 'tid-surv', cdp: survivorCdp, relay: h.mkRelay(), page: { setViewportSize: vi.fn(async () => undefined) } });
    const res = await browserRegistry.closeTab(e.id, e.activeTargetId as string);
    expect(res).toEqual({ ok: true, activeTargetId: 'tid-surv' }); // pointer moved; the rejection was swallowed
  });
});

describe('open() first-frame seed rejection (585)', () => {
  it('a rejecting birth captureScreenshot still yields a live session', async () => {
    h.relayLatest.frame = null; // the mocked relay never paints -> grace + seed arm
    h.launchPersistentContext.mockResolvedValue({
      browser: () => ({}),
      pages: () => [{}],
      newCDPSession: vi.fn(async () => {
        const c = h.makeCdp();
        c.send.mockImplementation(async (method: string) => {
          if (method === 'Page.captureScreenshot') throw new Error('screenshot gone');
          return {};
        });
        return c;
      }),
      close: vi.fn(async () => undefined)
    });
    const info = await browserRegistry.open({ spawnMcp: false });
    expect(state().entries.has(info.id)).toBe(true); // the seed rejection was glue-caught
    await browserRegistry.close(info.id);
  }, 15_000);
});