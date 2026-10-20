/**
 * SessionIdAndName BRANCH MOP — the main suites
 * (session-id-and-name.test.ts, session-copy-path.test.ts) own the render
 * matrix; this file sweeps the remaining arms:
 *   - the copied=true SVG arm (check mark replaces the copy rectangles)
 *   - the fetch .catch() arm while mounted (network refusal -> path stays
 *     hidden, button absent)
 *   - the stale-guard arms of the $effect: resolution AFTER unmount, and
 *     a rejection AFTER unmount (the !stale false arm)
 */
import { mount, unmount, flushSync, type ComponentProps } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SessionIdAndName from '$lib/components/conversation/header/SessionIdAndName.svelte';

const PATH = '/tmp/sessions/abc-123';

function mountCluster(props: Partial<ComponentProps<typeof SessionIdAndName>> = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const comp = mount(SessionIdAndName, {
    target,
    props: { sessionId: 'abc-123', title: 'My session', initialTitle: null, ...props }
  });
  return { target, comp, cleanup: () => { unmount(comp); target.remove(); } };
}

function copyButton(target: HTMLElement): HTMLElement | null {
  return target.querySelector('[data-testid="conversation-header-copy-path"]');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SessionIdAndName branch mop', () => {
  it('a successful copy swaps the copy rectangles for the check mark (copied arm)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ path: PATH }), { status: 200 }))
    );
    const { target, cleanup } = mountCluster();
    await vi.waitFor(() => expect(copyButton(target)).not.toBeNull());

    // idle: the two-rectangle copy glyph (plus its tail path)
    expect(copyButton(target)!.querySelector('rect')).not.toBeNull();
    expect(copyButton(target)!.querySelector('path[d^="M3 8.5"]')).toBeNull();

    copyButton(target)!.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(PATH));
    flushSync();

    // copied: the check-mark path replaces the rectangles
    expect(copyButton(target)!.querySelector('rect')).toBeNull();
    expect(copyButton(target)!.querySelector('path[d^="M3 8.5"]')).not.toBeNull();
    cleanup();
  });

  it('a fetch REJECTION while mounted keeps the path hidden (catch arm)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const { target, cleanup } = mountCluster();
    await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    flushSync();
    expect(copyButton(target)).toBeNull(); // sessionPath stayed null
    cleanup();
  });

  it('a resolution arriving AFTER unmount is dropped (stale arm)', async () => {
    let release!: (v: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        () => new Promise<Response>((res) => { release = res; })
      )
    );
    const { target, comp } = mountCluster();
    flushSync(); // force the mount $effect to run -> fetch is issued
    expect(vi.mocked(fetch)).toHaveBeenCalled();
    unmount(comp); // the effect cleanup runs BEFORE the fetch settles
    release(new Response(JSON.stringify({ path: PATH }), { status: 200 }));
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
    expect(target.querySelector('[data-testid="conversation-header-copy-path"]')).toBeNull();
    target.remove();
  });

  it('a rejection arriving AFTER unmount is also dropped (!stale false arm)', async () => {
    let reject!: (e: unknown) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        () => new Promise<Response>((_res, rej) => { reject = rej; })
      )
    );
    const { target, comp } = mountCluster();
    flushSync(); // force the mount $effect to run -> fetch is issued
    expect(vi.mocked(fetch)).toHaveBeenCalled();
    unmount(comp);
    reject(new Error('late failure'));
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
    expect(target.querySelector('[data-testid="conversation-header-copy-path"]')).toBeNull();
    target.remove();
  });
});