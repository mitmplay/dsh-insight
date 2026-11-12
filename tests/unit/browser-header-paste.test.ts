/**
 * browser-header-paste — the wire-clipboard Paste button (ADR-0061 D5).
 * Host pattern: browser-panel-contextmenu.test.ts (the panel mounts, the
 * header rides inside). readText is stubbed on the operator-browser
 * clipboard: text → chunked kind:'text' POSTs; a denied rejection → no
 * POST + the honest 'denied' state on the button; empty → no POST +
 * 'empty'. Never a fake success.
 */
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

const SESSION_ID = 'sess-hdrpaste1234';
const inputBodies: Record<string, unknown>[] = [];

const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>): Promise<Response> => {
  const url = String(args[0]);
  const init = (args[1] ?? {}) as RequestInit;
  if (url.endsWith('/api/browser') && init.method === 'POST') return new Response(JSON.stringify({ id: SESSION_ID }), { status: 200 });
  if (url.includes('/page')) return new Response(JSON.stringify({ dpr: 1 }), { status: 200 });
  if (url.endsWith('/tabs')) return new Response(JSON.stringify({ tabs: [] }), { status: 200 });
  if (url.includes('/input')) { inputBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>); return new Response('{}', { status: 200 }); }
  if (url.includes('/element')) return new Response(JSON.stringify({ href: null, src: null, selection: null }), { status: 200 });
  return new Response('unrouted', { status: 404 });
});

let readText: ReturnType<typeof vi.fn>;
const clipboardDesc = Object.getOwnPropertyDescriptor(Navigator.prototype, 'clipboard');

beforeEach(() => {
  StubEventSource.instances = [];
  inputBodies.length = 0;
  vi.stubGlobal('Image', class { onload: (() => void) | null = null; width = 800; height = 400; set src(v: string) { setTimeout(() => this.onload?.(), 0); } });
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
  vi.stubGlobal('EventSource', StubEventSource as unknown as typeof EventSource);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect: vi.fn(), drawImage: vi.fn() } as never);
  readText = vi.fn();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText } });
});

afterEach(() => {
  delete (navigator as unknown as Record<string, unknown>).clipboard;
  if (clipboardDesc) Object.defineProperty(Navigator.prototype, 'clipboard', clipboardDesc);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

async function mountLivePanel(): Promise<void> {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const instance = mount(BrowserPanel, { target, props: { browserSessionId: SESSION_ID } });
  flushSync();
  // a frame arrives — the panel reaches 'live' and the header button arms
  StubEventSource.instances[0].emit('frame', JSON.stringify({ jpeg: 'aGk=', metadata: {} }));
  await new Promise((r) => setTimeout(r, 10));
  flushSync();
  return instance as unknown as void extends never ? never : any;
}

const button = (): HTMLButtonElement => document.querySelector('[data-testid=browser-paste]') as HTMLButtonElement;

describe('header Paste button (ADR-0061 D5)', () => {
  it('readable clipboard text → chunked kind:text POSTs, honest pasted state', async () => {
    readText.mockResolvedValue('pasted-text');
    await mountLivePanel();
    expect(button()).toBeTruthy();
    button().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    flushSync();
    await new Promise((r) => setTimeout(r, 10));
    flushSync();
    expect(inputBodies).toEqual([{ kind: 'text', text: 'pasted-text' }]);
    expect(button().getAttribute('data-paste-state')).toBe('pasted');
  });

  it('an oversized clipboard pastes as ordered chunks that rejoin', async () => {
    const text = 'b'.repeat(8193); // three chunks
    readText.mockResolvedValue(text);
    await mountLivePanel();
    button().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    flushSync();
    await new Promise((r) => setTimeout(r, 10));
    flushSync();
    expect(inputBodies.map((b) => b.text).join('')).toBe(text);
    expect(inputBodies).toHaveLength(3);
    for (const b of inputBodies) expect((b.text as string).length).toBeLessThanOrEqual(4096);
  });

  it('denied readText → NO POST and the honest denied state', async () => {
    readText.mockRejectedValue(new Error('NotAllowedError'));
    await mountLivePanel();
    button().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    flushSync();
    await new Promise((r) => setTimeout(r, 10));
    flushSync();
    expect(inputBodies).toEqual([]);
    expect(button().getAttribute('data-paste-state')).toBe('denied');
  });

  it('an empty clipboard → NO POST and the honest empty state', async () => {
    readText.mockResolvedValue('');
    await mountLivePanel();
    button().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    flushSync();
    await new Promise((r) => setTimeout(r, 10));
    flushSync();
    expect(inputBodies).toEqual([]);
    expect(button().getAttribute('data-paste-state')).toBe('empty');
  });
});
