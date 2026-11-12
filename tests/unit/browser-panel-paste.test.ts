/**
 * browser-panel-paste — the wire-clipboard paste listener (ADR-0061 D2/D3).
 * Host pattern: browser-panel-contextmenu.test.ts. A paste event with a
 * clipboardData stub on the glass canvas must preventDefault, post ONE
 * kind:'text' dispatch per chunk IN ORDER, no-op on empty text, and
 * survive a POST rejection without an unhandled rejection.
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

const SESSION_ID = 'sess-paste1234567';
const inputBodies: Record<string, unknown>[] = [];
const elementBodies: Record<string, unknown>[] = [];
let failInputPosts = false;
let elementSelection: string | null = null;
const writeText = vi.fn(async () => undefined);

const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>): Promise<Response> => {
  const url = String(args[0]);
  const init = (args[1] ?? {}) as RequestInit;
  if (url.endsWith('/api/browser') && init.method === 'POST') return new Response(JSON.stringify({ id: SESSION_ID }), { status: 200 });
  if (url.includes('/page')) return new Response(JSON.stringify({ dpr: 1 }), { status: 200 });
  if (url.endsWith('/tabs')) return new Response(JSON.stringify({ tabs: [] }), { status: 200 });
  if (url.includes('/input')) {
    if (failInputPosts) return Promise.reject(new Error('wire down'));
    inputBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    return new Response('{}', { status: 200 });
  }
  if (url.includes('/element')) { elementBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>); return new Response(JSON.stringify({ href: null, src: null, text: null, selection: elementSelection }), { status: 200 }); }
  return new Response('unrouted', { status: 404 });
});

beforeEach(() => {
  StubEventSource.instances = [];
  inputBodies.length = 0;
  elementBodies.length = 0;
  failInputPosts = false;
  elementSelection = null;
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: vi.fn(), writeText } });
  vi.stubGlobal('Image', class { onload: (() => void) | null = null; width = 800; height = 400; set src(v: string) { setTimeout(() => this.onload?.(), 0); } });
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);
  vi.stubGlobal('EventSource', StubEventSource as unknown as typeof EventSource);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect: vi.fn(), drawImage: vi.fn() } as never);
});

afterEach(() => {
  delete (navigator as unknown as Record<string, unknown>).clipboard;
  vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.innerHTML = '';
});

/** happy-dom ships no ClipboardEvent constructor with clipboardData — a
 *  plain cancelable Event carrying the stub is the honest stand-in. */
function pasteEvent(text: string): Event {
  const ev = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'clipboardData', { value: { getData: () => text } });
  return ev;
}

async function mountPanel(): Promise<Record<string, unknown>> {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const instance = mount(BrowserPanel, { target, props: { browserSessionId: SESSION_ID } });
  flushSync();
  await new Promise((r) => setTimeout(r, 5));
  flushSync();
  return { instance };
}

describe('wire-clipboard paste (ADR-0061 D2/D3)', () => {
  it('a paste event preventDefaults and posts one kind:text dispatch', async () => {
    await mountPanel();
    const canvas = document.querySelector('[data-testid=browser-glass] canvas') as HTMLElement;
    const ev = pasteEvent('wire-paste');
    canvas.dispatchEvent(ev);
    flushSync();
    await new Promise((r) => setTimeout(r, 5));
    expect(ev.defaultPrevented).toBe(true); // the DSI page never receives the text
    expect(inputBodies).toEqual([{ kind: 'text', text: 'wire-paste' }]);
  });

  it('an oversized paste crosses as ordered chunks that rejoin', async () => {
    await mountPanel();
    const text = 'a'.repeat(5000); // >4096 → two chunks (4096 + 904)
    const canvas = document.querySelector('[data-testid=browser-glass] canvas') as HTMLElement;
    canvas.dispatchEvent(pasteEvent(text));
    flushSync();
    await new Promise((r) => setTimeout(r, 5));
    expect(inputBodies).toHaveLength(2);
    expect(inputBodies.every((b) => b.kind === 'text')).toBe(true);
    expect(inputBodies.map((b) => b.text).join('')).toBe(text); // order + completeness
    expect((inputBodies[0].text as string).length).toBeLessThanOrEqual(4096);
    expect((inputBodies[1].text as string).length).toBeLessThanOrEqual(4096);
  });

  it('empty clipboard text is a no-op — zero POSTs', async () => {
    await mountPanel();
    const canvas = document.querySelector('[data-testid=browser-glass] canvas') as HTMLElement;
    canvas.dispatchEvent(pasteEvent(''));
    flushSync();
    await new Promise((r) => setTimeout(r, 5));
    expect(inputBodies).toEqual([]);
  });

  it('a modifier chord keydown NEVER dispatches (the v-prefix bugfix)', async () => {
    await mountPanel();
    const canvas = document.querySelector('[data-testid=browser-glass] canvas') as HTMLElement;
    // Cmd+V's keydown must not become a literal "v" on the wire — the paste
    // event that follows owns the text
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', code: 'KeyV', metaKey: true, bubbles: true, cancelable: true }));
    flushSync();
    await new Promise((r) => setTimeout(r, 5));
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', code: 'KeyV', ctrlKey: true, bubbles: true, cancelable: true }));
    flushSync();
    await new Promise((r) => setTimeout(r, 5));
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', altKey: true, bubbles: true, cancelable: true }));
    flushSync();
    await new Promise((r) => setTimeout(r, 5));
    expect(inputBodies).toEqual([]);
    // a PLAIN key still rides the wire with its text (regression pin)
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true, cancelable: true }));
    flushSync();
    await new Promise((r) => setTimeout(r, 5));
    expect(inputBodies).toEqual([{ kind: 'key', type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 0, text: 'a' }]);
  });

  it('a modifier chord keydown NEVER dispatches (the v-prefix bugfix)', async () => {
    await mountPanel();
    const canvas = document.querySelector('[data-testid=browser-glass] canvas') as HTMLElement;
    // Cmd+V's keydown must not become a literal "v" on the wire — the paste
    // event that follows owns the text
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', code: 'KeyV', metaKey: true, bubbles: true, cancelable: true }));
    flushSync();
    await new Promise((r) => setTimeout(r, 5));
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', code: 'KeyV', ctrlKey: true, bubbles: true, cancelable: true }));
    flushSync();
    await new Promise((r) => setTimeout(r, 5));
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', altKey: true, bubbles: true, cancelable: true }));
    flushSync();
    await new Promise((r) => setTimeout(r, 5));
    expect(inputBodies).toEqual([]);
    // a PLAIN key still rides the wire with its text (regression pin)
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true, cancelable: true }));
    flushSync();
    await new Promise((r) => setTimeout(r, 5));
    expect(inputBodies).toEqual([{ kind: 'key', type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 0, text: 'a' }]);
  });

  it('⌘A crosses as the select-all VERB — never a key event (D7)', async () => {
    await mountPanel();
    const canvas = document.querySelector('[data-testid=browser-glass] canvas') as HTMLElement;
    const ev = new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', metaKey: true, bubbles: true, cancelable: true });
    canvas.dispatchEvent(ev);
    flushSync();
    await new Promise((r) => setTimeout(r, 5));
    expect(ev.defaultPrevented).toBe(true); // the DSI page must NOT select-all itself
    expect(elementBodies).toEqual([{ selectAll: true }]);
    expect(inputBodies).toEqual([]); // no key dispatch rides the wire
  });

  it('⌘C reads the glass selection and writes the OPERATOR clipboard (D8)', async () => {
    elementSelection = 'glass picked text';
    await mountPanel();
    const canvas = document.querySelector('[data-testid=browser-glass] canvas') as HTMLElement;
    const ev = new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', metaKey: true, bubbles: true, cancelable: true });
    canvas.dispatchEvent(ev);
    flushSync();
    await new Promise((r) => setTimeout(r, 5));
    expect(ev.defaultPrevented).toBe(true);
    expect(elementBodies).toEqual([{ selectionOnly: true }]); // the POINT-LESS pass
    expect(writeText).toHaveBeenCalledWith('glass picked text');
    expect(inputBodies).toEqual([]);
  });

  it('⌘C over an empty glass selection is an honest no-op', async () => {
    elementSelection = null;
    await mountPanel();
    const canvas = document.querySelector('[data-testid=browser-glass] canvas') as HTMLElement;
    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', metaKey: true, bubbles: true, cancelable: true }));
    flushSync();
    await new Promise((r) => setTimeout(r, 5));
    expect(elementBodies).toEqual([{ selectionOnly: true }]);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('drag-select fidelity: held moves carry button+buttons, doubles carry clickCount:2 (D6)', async () => {
    await mountPanel();
    // a frame must arrive first — the viewport is the scale DIVISOR
    StubEventSource.instances[0].emit('frame', JSON.stringify({ jpeg: 'aGk=', metadata: {} }));
    await new Promise((r) => setTimeout(r, 10));
    flushSync();
    (document.querySelector('[data-testid=browser-glass]') as HTMLElement).getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 800, height: 400, right: 800, bottom: 400, toJSON: () => ({}) }) as DOMRect;
    const canvas = document.querySelector('[data-testid=browser-glass] canvas') as HTMLElement;
    const before = inputBodies.length;
    // single press (clickCount 1)
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 100, clientY: 80, detail: 1, bubbles: true, cancelable: true }));
    flushSync();
    // a move while HELD must carry the drag state
    canvas.dispatchEvent(new MouseEvent('mousemove', { button: 0, clientX: 200, clientY: 90, bubbles: true }));
    flushSync();
    await new Promise((r) => setTimeout(r, 30)); // the rAF coalescer fires
    flushSync();
    // release, then a HOVER move — must stay button-less
    canvas.dispatchEvent(new MouseEvent('mouseup', { button: 0, clientX: 260, clientY: 95, detail: 1, bubbles: true, cancelable: true }));
    flushSync();
    canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, clientY: 100, bubbles: true }));
    flushSync();
    await new Promise((r) => setTimeout(r, 30));
    flushSync();
    const [press, dragMove, release, hoverMove] = inputBodies.slice(before);
    expect(press).toMatchObject({ kind: 'mouse', type: 'mousePressed', button: 'left', clickCount: 1 });
    expect(dragMove).toMatchObject({ kind: 'mouse', type: 'mouseMoved', button: 'left', buttons: 1 });
    expect(release).toMatchObject({ kind: 'mouse', type: 'mouseReleased', button: 'left', clickCount: 1 });
    expect(hoverMove).toMatchObject({ kind: 'mouse', type: 'mouseMoved' });
    expect(hoverMove.button).toBeUndefined();
    expect(hoverMove.buttons).toBeUndefined();
    // a double-click's second pair stamps clickCount: 2 (Chromium word-selects on it)
    const dbl = inputBodies.length;
    canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 100, clientY: 80, detail: 2, bubbles: true, cancelable: true }));
    flushSync();
    canvas.dispatchEvent(new MouseEvent('mouseup', { button: 0, clientX: 100, clientY: 80, detail: 2, bubbles: true, cancelable: true }));
    flushSync();
    expect(inputBodies.slice(dbl).map((b) => b.clickCount)).toEqual([2, 2]);
  });

  it('a POST rejection is caught — no unhandled rejection escapes', async () => {
    failInputPosts = true;
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await mountPanel();
    const canvas = document.querySelector('[data-testid=browser-glass] canvas') as HTMLElement;
    canvas.dispatchEvent(pasteEvent('boom'));
    flushSync();
    await new Promise((r) => setTimeout(r, 10));
    flushSync();
    const unhandled = errSpy.mock.calls.filter((c) => String(c[0]).includes('Unhandled'));
    expect(unhandled).toEqual([]);
    errSpy.mockRestore();
  });
});
