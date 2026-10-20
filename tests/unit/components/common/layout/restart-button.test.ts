/**
 * RestartButton — the Restart Verb trigger (ADR 2026-10-12): click POSTs
 * /api/floor/restart, then the button polls through the blackout (the
 * server may die before answering) and reloads the page when the floor
 * answers again. Disabled + self-gated while restarting.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RestartButton from '$lib/components/common/layout/RestartButton.svelte';
const calls: Array<{ url: string; init?: RequestInit }> = [];
let devFloor = true; // the dev-mode gate answer (toggle per test)
function installFetch(snapshotSequence: Array<'down' | 'up'>): void {
  devFloor = true; // default: the old suite mounts on a dev floor
  let i = 0;
  vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === '/api/floor/mode') {
      return new Response(JSON.stringify({ dev: devFloor, mode: devFloor ? 'dev' : 'build' }), { status: 200 });
    }
    if (url === '/api/floor/restart') {
      return new Response(JSON.stringify({ ok: true, restarting: true }), { status: 200 });
    }
    if (url === '/api/plugins/snapshot') {
      const phase = snapshotSequence[Math.min(i, snapshotSequence.length - 1)];
      i += 1;
      return new Response(JSON.stringify({ ok: phase === 'up' }), { status: phase === 'up' ? 200 : 503 });
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch);
}

const reloadMock = vi.fn();
async function mountButton() {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const comp = mount(RestartButton, { target, props: {} });
  flushSync();
  // wait for the onMount mode-fetch to settle and the gate to apply
  // (real timers normally; fake timers advance themselves)
  for (let k = 0; k < 50; k += 1) {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(1);
    else await new Promise((r) => setTimeout(r, 1));
    flushSync();
    const shown = !!target.querySelector('[data-testid="sidebar-restart-trigger"]');
    if (shown === devFloor) break;
  }
  const btn = target.querySelector('[data-testid="sidebar-restart-trigger"]') as HTMLButtonElement;
  return { btn, cleanup: () => { unmount(comp); target.remove(); } };
}
beforeEach(() => {
  reloadMock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});
describe('RestartButton dev gate (2026-10-13)', () => {
  it('a dev floor (mode.dev=true) shows the trigger', async () => {
    devFloor = true;
    installFetch(['up']);
    const h = await mountButton();
    await vi.waitFor(() => expect(h.btn).toBeTruthy());
    h.cleanup();
  });
  it('a build floor (mode.dev=false) never renders the trigger', async () => {
    installFetch(['up']);
    devFloor = false; // installFetch resets to true — flip after stubbing
    const h = await mountButton();
    await new Promise((r) => setTimeout(r, 20));
    expect(h.btn).toBeNull();
    h.cleanup();
  });
  it('a failed mode fetch keeps the trigger hidden (hidden by default)', async () => {
    devFloor = false; // the stubbed 500 never answers — hidden either way
    vi.stubGlobal('fetch', (async () => new Response('{}', { status: 500 })) as typeof fetch);
    const h = await mountButton();
    await new Promise((r) => setTimeout(r, 20));
    expect(h.btn).toBeNull();
    h.cleanup();
  });
});
describe('RestartButton', () => {
  it('renders the sidebar trigger with the floorRestart label', async () => {
    installFetch(['up']);
    const h = await mountButton();
    expect(h.btn).toBeTruthy();
    expect(h.btn.getAttribute('aria-label')).toBeTruthy();
  });
  it('click fires the restart POST and disables while restarting', async () => {
    installFetch(['down', 'down', 'up']);
    vi.stubGlobal('location', { reload: reloadMock });
    const h = await mountButton();
    h.btn.click();
    flushSync();
    expect(calls.some((c) => c.url === '/api/floor/restart' && c.init?.method === 'POST')).toBe(true);
    expect(h.btn.disabled).toBe(true);
    await vi.waitFor(() => expect(reloadMock).toHaveBeenCalled(), { timeout: 8000 });
  });
  it('a floor that never comes back times out and re-enables the trigger', async () => {
    vi.useFakeTimers();
    installFetch(['down']);
    vi.stubGlobal('location', { reload: reloadMock });
    const h = await mountButton();
    h.btn.click();
    flushSync();
    await vi.advanceTimersByTimeAsync(125_000);
    expect(reloadMock).not.toHaveBeenCalled();
    expect(h.btn.disabled).toBe(false);
    vi.useRealTimers();
  });
});

// Coverage-gap matrix (2026-10-21): the network-REJECT catch arms (the mode
// fetch dying mid-flight, the restart POST dying with the server, the poll
// hitting a dead floor) plus the class-passthrough prop were the only
// uncovered branches — each gets a direct-mount test here.
describe('RestartButton coverage gaps (reject arms + passthrough class)', () => {
  it('a mode fetch that REJECTS (floor unreachable) keeps the trigger hidden', async () => {
    devFloor = false;
    vi.stubGlobal('fetch', (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch);
    const h = await mountButton();
    await new Promise((r) => setTimeout(r, 20));
    expect(h.btn).toBeNull();
    h.cleanup();
  });

  it('a rejecting restart POST falls through to the poll and still reloads', async () => {
    vi.useFakeTimers();
    devFloor = true;
    let polls = 0;
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push({ url });
      if (url === '/api/floor/mode') {
        return new Response(JSON.stringify({ dev: true }), { status: 200 });
      }
      if (url === '/api/floor/restart') {
        throw new TypeError('server died before answering');
      }
      // snapshot poll: down once, then up
      polls += 1;
      const up = polls >= 2;
      return new Response(JSON.stringify({ ok: up }), { status: up ? 200 : 503 });
    }) as typeof fetch);
    vi.stubGlobal('location', { reload: reloadMock });
    const h = await mountButton();
    h.btn.click();
    flushSync();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(reloadMock).toHaveBeenCalled();
    expect(polls).toBeGreaterThanOrEqual(2);
    vi.useRealTimers();
    h.cleanup();
  });

  it('a rejecting snapshot poll keeps polling until the floor answers', async () => {
    vi.useFakeTimers();
    devFloor = true;
    let polls = 0;
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push({ url });
      if (url === '/api/floor/mode') {
        return new Response(JSON.stringify({ dev: true }), { status: 200 });
      }
      if (url === '/api/floor/restart') {
        return new Response('{}', { status: 200 });
      }
      polls += 1;
      if (polls === 1) throw new TypeError('floor still down');
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch);
    vi.stubGlobal('location', { reload: reloadMock });
    const h = await mountButton();
    h.btn.click();
    flushSync();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(reloadMock).toHaveBeenCalled();
    expect(polls).toBe(2);
    vi.useRealTimers();
    h.cleanup();
  });

  it('a second click while restarting is a no-op (the guard true-arm)', async () => {
    // Never-resolving fetch keeps the restarting flag pinned at true across
    // both clicks, so the guard's TRUE arm fires and the second click is
    // swallowed before any second POST can be issued.
    devFloor = true;
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push({ url });
      if (url === '/api/floor/mode') {
        return new Response(JSON.stringify({ dev: true }), { status: 200 });
      }
      // restart POST + snapshot poll: hang forever
      return new Promise(() => {}) as unknown as Response;
    }) as typeof fetch);
    vi.stubGlobal('location', { reload: reloadMock });
    const h = await mountButton();
    // calls is module-level and shared across tests — count only THIS test's
    // clicks.
    // This stub records only the URL (no init), so count restart hits by URL.
    const restartPosts = () => calls.filter((c) => c.url === '/api/floor/restart').length;
    const postsBefore = restartPosts();
    h.btn.click();
    flushSync();
    // The disabled attribute blocks the DOM-level click, but it is only a
    // derived VIEW of the restarting flag — removing it does not reset the
    // state. Strip it so the second click actually dispatches and the
    // handler runs, reads restarting=true, and returns early (guard TRUE arm).
    expect(h.btn.disabled).toBe(true);
    h.btn.removeAttribute('disabled');
    h.btn.click(); // handler runs, guard sees restarting=true → early return
    flushSync();
    expect(restartPosts() - postsBefore).toBe(1);
    // NOTE: no disabled re-assertion here — Svelte only rewrites the derived
    // attribute when the restarting flag CHANGES, and we manually stripped it,
    // so the DOM stays stale by design. The one-POST delta IS the proof the
    // guard swallowed the second click.
    h.cleanup();
  });

  it('a host class passthrough lands on the trigger button', async () => {
    devFloor = true;
    installFetch(['up']);
    const target = document.createElement('div');
    document.body.appendChild(target);
    const comp = mount(RestartButton, { target, props: { class: 'rail-collapsed-label' } });
    flushSync();
    for (let k = 0; k < 50; k += 1) {
      await new Promise((r) => setTimeout(r, 1));
      flushSync();
      if (target.querySelector('[data-testid="sidebar-restart-trigger"]')) break;
    }
    const btn = target.querySelector('[data-testid="sidebar-restart-trigger"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.className).toContain('restart-trigger');
    expect(btn.className).toContain('rail-collapsed-label');
    unmount(comp);
    target.remove();
  });
});

// AppSidebarHeader placement pin (operator-added, 2026-10-12): the restart
// trigger leads the header row, BEFORE the About trigger — both surfaces
// (expanded header + collapsed stub) carry the button.
describe('AppSidebarHeader placement (source pins)', () => {
  const src = readFileSync(join(process.cwd(), 'src/lib/components/common/layout/AppSidebarHeader.svelte'), 'utf-8');
  it('renders RestartButton before AboutButton', async () => {
    const restartIdx = src.indexOf('<RestartButton');
    const aboutIdx = src.indexOf('<AboutButton');
    expect(restartIdx).toBeGreaterThan(-1);
    expect(aboutIdx).toBeGreaterThan(restartIdx);
  });
  it('AppSidebar collapsed stub also carries the button before About', async () => {
    const app = readFileSync(join(process.cwd(), 'src/lib/components/common/layout/AppSidebar.svelte'), 'utf-8');
    const restartIdx = app.indexOf('<RestartButton');
    const aboutIdx = app.indexOf('<AboutButton');
    expect(restartIdx).toBeGreaterThan(-1);
    expect(aboutIdx).toBeGreaterThan(restartIdx);
  });
});
