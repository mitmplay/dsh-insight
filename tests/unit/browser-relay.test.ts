import { afterAll, describe, expect, it } from 'vitest';

import { browserRegistry } from '$lib/server/browser/registry.js';
import { RelayClosedError, type RelayFrame } from '$lib/server/browser/relay.js';

const opened: string[] = [];
afterAll(async () => {
	for (const id of opened) await browserRegistry.close(id);
});

describe('browser relay (real CDP)', () => {
	it('keeps only the LATEST frame in the ring', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, url: 'data:text/html,<h1>frames</h1>' });
		opened.push(info.id);
		const relay = browserRegistry.relay(info.id);
		const seen: number[] = [];
		const off = relay.subscribe((f: RelayFrame) => seen.push(f.seq));
		// fresh damage AFTER subscribing — screencast emits only on paint
		await browserRegistry.navigate(info.id, 'data:text/html,<h1>more</h1>');
		await new Promise((r) => setTimeout(r, 1500));
		off();
		expect(seen.length).toBeGreaterThan(0);
		expect(relay.latestFrame()?.seq).toBe(Math.max(...seen));
	}, 120_000); // headed chromium under parallel workers needs >60s ceiling

	it('serializes a burst of input dispatches and lands them in order', async () => {
		const info = await browserRegistry.open({ spawnMcp: false });
		opened.push(info.id);
		const relay = browserRegistry.relay(info.id);
		// open() guarantees a first paint (starter page), so the latest
		// frame already exists — assert it before dispatching
		expect(relay.latestFrame()).not.toBeNull();
		await Promise.all([
			relay.dispatch({ kind: 'key', type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 }),
			relay.dispatch({ kind: 'key', type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 }),
			relay.dispatch({ kind: 'text', text: 'ok' })
		]);
		expect(relay.latestFrame()).not.toBeNull();
	}, 120_000); // headed chromium under parallel workers needs >60s ceiling

	it('throws CLOSED (not a hang) after stop', async () => {
		const info = await browserRegistry.open({ spawnMcp: false });
		const relay = browserRegistry.relay(info.id);
		await browserRegistry.close(info.id);
		await expect(relay.dispatch({ kind: 'text', text: 'x' })).rejects.toBeInstanceOf(RelayClosedError);
		expect(() => relay.latestFrame()).toThrow(RelayClosedError);
	}, 120_000); // headed chromium under parallel workers needs >60s ceiling
});