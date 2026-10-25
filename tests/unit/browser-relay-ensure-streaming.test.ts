import { describe, expect, it, vi } from 'vitest';
import { BrowserRelay } from '../../src/lib/server/browser/relay.js';

/** BUGFIX 2026-10-24 (operator's hung second YouTube tab): activate() used
 *  resume() only — a lazily-attached relay (started=false) never streamed.
 *  ensureStreaming() must START it. */
function fakeCdp() {
  const sent: string[] = [];
  return {
    sent,
    on: vi.fn(),
    off: vi.fn(),
    send: vi.fn(async (method: string) => { sent.push(method); })
  };
}

describe('BrowserRelay.ensureStreaming (the hung-tab fix)', () => {
  it('STARTS a never-started (lazily attached) relay', async () => {
    const cdp = fakeCdp();
    const relay = new BrowserRelay(cdp as never, 60, 15);
    await relay.ensureStreaming();
    expect(cdp.sent).toContain('Page.startScreencast');
    // idempotent: already streaming → no second start
    await relay.ensureStreaming();
    expect(cdp.sent.filter((m) => m === 'Page.startScreencast')).toHaveLength(1);
  });

  it('RESUMES a paused relay and PAUSES the outgoing one (D1 pair)', async () => {
    const cdp = fakeCdp();
    const relay = new BrowserRelay(cdp as never, 60, 15);
    await relay.start();
    await relay.pause();
    expect(cdp.sent).toContain('Page.stopScreencast');
    await relay.ensureStreaming();
    expect(cdp.sent.filter((m) => m === 'Page.startScreencast')).toHaveLength(2);
  });
});
