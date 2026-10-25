import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BrowserPanel from '$lib/components/browser/BrowserPanel.svelte';

class StubEventSource {
  static instances: StubEventSource[] = [];
  closed = false; readyState = 1;
  handlers = new Map<string, Set<(e: { data?: string }) => void>>();
  onerror: (() => void) | null = null;
  constructor(public url: string) { StubEventSource.instances.push(this); }
  addEventListener(type: string, cb: (e: { data?: string }) => void): void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(cb);
  }
  close(): void { this.closed = true; }
  emit(type: string, data?: string): void { for (const cb of this.handlers.get(type) ?? []) cb({ data }); }
}

const SESSION_ID = 'sess-ctxmenu123456';
const inputBodies: Record<string, unknown>[] = [];

const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>): Promise<Response> => {
  const url = String(args[0]);
  const init = (args[1] ?? {}) as RequestInit;
  if (url.endsWith('/api/browser') && init.method === 'POST') return new Response(JSON.stringify({ id: SESSION_ID }), { status: 200 });
  if (url.includes('/page')) return new Response(JSON.stringify({ dpr: 1 }), { status: 200 });
  if (url.endsWith('/tabs')) return new Response(JSON.stringify({ tabs: [] }), { status: 200 });
  if (url.includes('/input')) { inputBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>); return new Response('{}', { status: 200 }); }
  if (url.includes('/element')) return new Response(JSON.stringify({ href: 'https://x.example/a', src: 'https://x.example/i.png', text: 'x' }), { status: 200 });
  if (url.includes('/opentab')) return new Response(JSON.stringify({ targetId: 't', url: 'x', title: 'x' }), { status: 200 });
  return new Response('unrouted', { status: 404 });
});

beforeEach(() => {
  StubEventSource.instances = [];
  inputBodies.length = 0;
  vi.stubGlobal('Image', class { onload: (() => void) | null = null; width = 800; height = 400; set src(v: string) { setTimeout(() => this.onload?.(), 0); } });
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
  vi.stubGlobal('EventSource', StubEventSource as unknown as typeof EventSource);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect: vi.fn(), drawImage: vi.fn() } as never);
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('right-click through the glass (bugfix 2026-10-25)', () => {
  it('contextmenu opens the DSI menu; actions dispatch (bugfix round 2)', async () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const instance = mount(BrowserPanel, { target, props: { browserSessionId: SESSION_ID } });
    flushSync();
    await new Promise((r) => setTimeout(r, 5));
    const glass = document.querySelector('[data-testid=browser-glass] canvas') as HTMLElement;
    expect(glass).toBeTruthy();
    // a frame must arrive first — viewport (scale DIVISOR) comes from it
    StubEventSource.instances[0].emit('frame', JSON.stringify({ jpeg: 'aGk=', metadata: {} }));
    await new Promise((r) => setTimeout(r, 5));
    flushSync();
    (document.querySelector('[data-testid=browser-glass]') as HTMLElement).getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 800, height: 400, right: 800, bottom: 400, toJSON: () => ({}) }) as DOMRect;
    // isolate: does a LEFT press post in this harness at all?
    glass.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 100, clientY: 80, bubbles: true, cancelable: true }));
    flushSync();
    console.log('INPUT AFTER LEFT', JSON.stringify(inputBodies));
    const ev = new MouseEvent('contextmenu', { button: 2, clientX: 200, clientY: 100, bubbles: true, cancelable: true });
    glass.dispatchEvent(ev);
    flushSync();
    expect(ev.defaultPrevented).toBe(true);
    await new Promise((r) => setTimeout(r, 5));
    flushSync();
    // the DSI menu is up with the element data pass applied
    const menu = document.querySelector('[data-testid=browser-ctxmenu]');
    expect(menu).toBeTruthy();
    const items = [...document.querySelectorAll('[data-testid=browser-ctxmenu-item]')].map((b) => b.textContent);
    expect(items.some((t) => t?.includes('Open image in new tab'))).toBe(true);
    expect(items.some((t) => t?.includes('Copy link address'))).toBe(true);
    // 'Send right-click to the page' dispatches the right press+release pair
    const before = inputBodies.length;
    [...document.querySelectorAll('[data-testid=browser-ctxmenu-item]')]
      .find((b) => b.textContent?.includes('Send right-click to the page'))!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    flushSync();
    const rights = inputBodies.slice(before).filter((b) => b.button === 'right');
    expect(rights).toHaveLength(2);
    expect(rights[0]).toMatchObject({ kind: 'mouse', type: 'mousePressed', button: 'right', clickCount: 1 });
    expect(rights[1]).toMatchObject({ kind: 'mouse', type: 'mouseReleased', button: 'right' });
    unmount(instance);
  });
});
