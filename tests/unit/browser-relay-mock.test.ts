import { describe, expect, it, vi } from 'vitest';

import {
	BrowserRelay,
	RelayClosedError,
	type InputDispatch,
	type RelayFrame
} from '$lib/server/browser/relay.js';

type CdpArgs = Record<string, unknown>;

function fakeCdp(opts: { failAck?: boolean } = {}) {
	const sent: { method: string; args?: CdpArgs }[] = [];
	const listeners = new Map<string, (ev: unknown) => void>();
	const raw = {
		on: vi.fn((event: string, fn: (ev: unknown) => void) => {
			listeners.set(event, fn);
		}),
		send: vi.fn(async (method: string, args?: CdpArgs) => {
			sent.push({ method, args });
			if (method === 'Page.screencastFrameAck' && opts.failAck) {
				throw new Error('session gone');
			}
			return {};
		})
	};
	const emitFrame = (data: string, sessionId: string, metadata: Record<string, unknown> = { w: 1 }) => {
		listeners.get('Page.screencastFrame')?.({ data, sessionId, metadata });
	};
	return { cdp: raw as unknown as import('playwright-core').CDPSession, raw, sent, emitFrame };
}

const closeOf = (relay: BrowserRelay) => relay as unknown as { cdp: unknown };

describe('BrowserRelay (mock CDP — branch coverage)', () => {
	it('start() registers the screencast listener and sends startScreencast; re-start throws', async () => {
		const { cdp, raw, sent } = fakeCdp();
		const relay = new BrowserRelay(cdp);
		await relay.start();
		expect(raw.on).toHaveBeenCalled();
		// VERDICT: source is authoritative. ADR-0031 amendment 4 (commit e9807a7)
		// added config screencast quality (BrowserConfig.screencastQuality, default
		// 90, clamp 10..100); relay.ts now sends `quality` in Page.startScreencast.
		// Test updated to pin the evolved contract, not reverted source.
		expect(sent).toEqual([
			{ method: 'Page.startScreencast', args: { format: 'jpeg', quality: 90, everyNthFrame: 2 } }
		]);
		await expect(relay.start()).rejects.toBeInstanceOf(RelayClosedError);
	});

	it('start() throws RelayClosedError when the cdp handle is gone', async () => {
		const { cdp } = fakeCdp();
		const relay = new BrowserRelay(cdp);
		closeOf(relay).cdp = null;
		await expect(relay.start()).rejects.toBeInstanceOf(RelayClosedError);
	});

	it('screencastFrame bumps seq monotonically, fans out, and acks', async () => {
		const { cdp, sent, emitFrame } = fakeCdp();
		const relay = new BrowserRelay(cdp);
		await relay.start();
		const seen: number[] = [];
		const off = relay.subscribe((f: RelayFrame) => seen.push(f.seq));

		emitFrame('jpeg-a', 's1', { width: 10 });
		emitFrame('jpeg-b', 's2', { width: 20 });

		expect(seen).toEqual([1, 2]);
		expect(relay.latestFrame()).toEqual({ seq: 2, jpeg: 'jpeg-b', metadata: { width: 20 } });
		expect(sent.slice(1)).toEqual([
			{ method: 'Page.screencastFrameAck', args: { sessionId: 's1' } },
			{ method: 'Page.screencastFrameAck', args: { sessionId: 's2' } }
		]);

		off();
		emitFrame('jpeg-c', 's3');
		expect(seen).toEqual([1, 2]);
		expect(relay.latestFrame()?.seq).toBe(3);
	});

	it('swallows a failing screencastFrameAck instead of crashing the frame loop', async () => {
		const { cdp, sent, emitFrame } = fakeCdp({ failAck: true });
		const relay = new BrowserRelay(cdp);
		await relay.start();
		const seen: RelayFrame[] = [];
		relay.subscribe((f) => seen.push(f));
		expect(() => emitFrame('jpeg-x', 'sx')).not.toThrow();
		await new Promise((r) => setTimeout(r, 0));
		expect(seen.map((f) => f.seq)).toEqual([1]);
		expect(sent[1]?.method).toBe('Page.screencastFrameAck');
	});

	it('seed() fills an empty ring and fans out; never overrides a real frame; closed throws', async () => {
		const { cdp, emitFrame } = fakeCdp();
		const relay = new BrowserRelay(cdp);
		await relay.start();
		const seen: number[] = [];
		relay.subscribe((f: RelayFrame) => seen.push(f.seq));

		// starved birth: ring empty → the opener's captureScreenshot seed lands
		relay.seed({ seq: 0, jpeg: 'seed-jpeg', metadata: { seeded: true } });
		expect(seen).toEqual([1]);
		expect(relay.latestFrame()).toEqual({ seq: 1, jpeg: 'seed-jpeg', metadata: { seeded: true } });

		// a real screencast frame still advances the ring (seed is not sticky)
		emitFrame('jpeg-real', 's1', { width: 10 });
		expect(relay.latestFrame()).toEqual({ seq: 2, jpeg: 'jpeg-real', metadata: { width: 10 } });
	});

	it('seed() keeps the existing frame and throws RelayClosedError when closed', async () => {
		const { cdp, emitFrame } = fakeCdp();
		const relay = new BrowserRelay(cdp);
		await relay.start();
		emitFrame('jpeg-a', 's1');
		relay.seed({ seq: 0, jpeg: 'late-seed', metadata: {} });
		expect(relay.latestFrame()?.jpeg).toBe('jpeg-a');

		closeOf(relay).cdp = null;
		expect(() => relay.seed({ seq: 0, jpeg: 'x', metadata: {} })).toThrow(RelayClosedError);
	});

	it('latestFrame/subscribe usable while open, throw RelayClosedError when closed', async () => {
		const { cdp } = fakeCdp();
		const relay = new BrowserRelay(cdp);
		expect(relay.latestFrame()).toBeNull();
		expect(relay.subscribe(() => undefined)).toBeTypeOf('function');

		closeOf(relay).cdp = null;
		expect(() => relay.latestFrame()).toThrow(RelayClosedError);
		expect(() => relay.subscribe(() => undefined)).toThrow(RelayClosedError);
	});

	it('dispatch routes mouse/key/text to the right CDP methods with correct payloads', async () => {
		const { cdp, sent } = fakeCdp();
		const relay = new BrowserRelay(cdp);
		await relay.dispatch({ kind: 'mouse', type: 'mouseWheel', x: 5, y: 6, deltaX: 1, deltaY: 2 });
		expect(sent[0]).toEqual({
			method: 'Input.dispatchMouseEvent',
			args: {
				type: 'mouseWheel',
				x: 5,
				y: 6,
				button: 'none',
				clickCount: undefined,
				deltaX: 1,
				deltaY: 2,
				pointerType: 'mouse'
			}
		});

		await relay.dispatch({ kind: 'mouse', type: 'mousePressed', x: 0, y: 0, button: 'left', clickCount: 2 });
		expect(sent[1]?.args).toMatchObject({ button: 'left', clickCount: 2 });

		await relay.dispatch({ kind: 'key', type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: 'RET' });
		expect(sent[2]).toEqual({
			method: 'Input.dispatchKeyEvent',
			args: { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: 'RET' }
		});

		await relay.dispatch({ kind: 'text', text: 'hi' });
		expect(sent[3]).toEqual({ method: 'Input.insertText', args: { text: 'hi' } });
	});

	it('serializes dispatches: a failed dispatch does not poison the chain', async () => {
		const { cdp, raw } = fakeCdp();
		const relay = new BrowserRelay(cdp);
		raw.send.mockImplementationOnce(async () => {
			throw new Error('cdp blew up');
		});
		const p1 = relay.dispatch({ kind: 'text', text: 'bad' }).catch(() => 'failed');
		const p2 = relay.dispatch({ kind: 'text', text: 'good' }).then(() => 'ok');
		const [r1, r2] = await Promise.all([p1, p2]);
		expect(r1).toBe('failed');
		expect(r2).toBe('ok');
		expect(raw.send).toHaveBeenCalledTimes(2);
	});

	it('dispatch rejects with RelayClosedError when closed', async () => {
		const { cdp } = fakeCdp();
		const relay = new BrowserRelay(cdp);
		closeOf(relay).cdp = null;
		await expect(relay.dispatch({ kind: 'text', text: 'x' })).rejects.toBeInstanceOf(RelayClosedError);
	});

	it('stop() clears state, sends stopScreencast only once, and is repeat-safe', async () => {
		const { cdp, sent } = fakeCdp();
		const relay = new BrowserRelay(cdp);
		await relay.start();
		relay.stop();
		expect(closeOf(relay).cdp).toBeNull();
		expect(sent.filter((s) => s.method === 'Page.stopScreencast')).toHaveLength(1);
		relay.stop();
		expect(sent.filter((s) => s.method === 'Page.stopScreencast')).toHaveLength(1);
		await expect(relay.dispatch({ kind: 'text', text: 'x' })).rejects.toBeInstanceOf(RelayClosedError);
	});

	it('stop() on a never-started relay sends nothing', async () => {
		const fresh = fakeCdp();
		const relay2 = new BrowserRelay(fresh.cdp);
		relay2.stop();
		expect(fresh.sent).toHaveLength(0);
	});
});

describe('relay frame pacing (ADR-0039 D1/D2, 2026-10-24)', () => {
	it('derives everyNthFrame from maxFps on a nominal 30 Hz clock', async () => {
		const { cdp, raw } = fakeCdp();
		const relay = new BrowserRelay(cdp, 90, 15);
		await relay.start();
		expect(raw.send).toHaveBeenCalledWith('Page.startScreencast', { format: 'jpeg', quality: 90, everyNthFrame: 2 });
	});
	it('clamps: maxFps 30 → every 1; maxFps 7 → round(30/7)=4; maxFps 1 → 30', async () => {
		for (const [fps, n] of [[30, 1], [7, 4], [1, 30]] as const) {
			const { cdp, raw } = fakeCdp();
			const relay = new BrowserRelay(cdp, 90, fps);
			await relay.start();
			expect(raw.send).toHaveBeenCalledWith('Page.startScreencast', { format: 'jpeg', quality: 90, everyNthFrame: n });
		}
	});
	it('source carries the pacing expression (refactor guard)', async () => {
		const src = (await import('node:fs')).readFileSync('src/lib/server/browser/relay.ts', 'utf8');
		expect(src).toContain('everyNthFrame: Math.max(1, Math.round(30 / this.maxFps))');
		const reg = (await import('node:fs')).readFileSync('src/lib/server/browser/registry.ts', 'utf8');
		expect(reg).toContain('new BrowserRelay(cdp, cfg.screencastQuality, cfg.screencastMaxFps)');
	});
});