import { afterAll, describe, expect, it } from 'vitest';

import { BrowserRegistryRefusal, browserRegistry } from '$lib/server/browser/registry.js';

/** ADR-0040 Wave 1 — the registry's tab map, listTabs and activate. Real
 *  (headless-default) chromium, spawnMcp off: the brain is not under test. */
const opened: string[] = []; // close-all teardown; entries removed on in-test closes

afterAll(async () => {
	for (const id of opened) await browserRegistry.close(id);
});

describe('browser registry tabs (ADR-0040)', () => {
	it('listTabs: birth page is the first active tab (type:page only)', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, port: 9504 + opened.length * 3, url: 'data:text/html,<title>t1</title>one' });
		opened.push(info.id);
		const tabs = await browserRegistry.listTabs(info.id);
		expect(tabs.length).toBeGreaterThanOrEqual(1);
		const active = tabs.filter((t) => t.active);
		expect(active).toHaveLength(1);
		expect(active[0].targetId.length).toBeGreaterThan(0);
	}, 120_000);

	it('activate: lazy-attaches a second page, moves the pointer, seeds the boundary frame', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, port: 9504 + opened.length * 3, url: 'data:text/html,<title>t1</title>one' });
		opened.push(info.id);
		const e = browserRegistry.peek(info.id);
		const page2 = await e.context.newPage();
		await page2.goto('data:text/html,<title>t2</title>two').catch(() => undefined);
		const tabs = await browserRegistry.listTabs(info.id);
		expect(tabs.length).toBe(2);
		const t2 = tabs.find((t) => !t.active);
		expect(t2).toBeTruthy();
		const res = await browserRegistry.activate(info.id, t2!.targetId);
		expect(res.targetId).toBe(t2!.targetId);
		expect(res.seq).toBeGreaterThanOrEqual(0);
		expect(res.url).toContain('data:text/html');
		// the pointer moved (D2) — listing proves it without internals
		const after = await browserRegistry.listTabs(info.id);
		expect(after.find((t) => t.targetId === t2!.targetId)?.active).toBe(true);
		// D4: a switch never answers without a frame — jpeg present or seeded
		expect(browserRegistry.relay(info.id).latestFrame()).not.toBeNull();
	}, 120_000);

	it('activate re-activating the active tab is a clean no-op', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, port: 9504 + opened.length * 3, url: 'data:text/html,<title>t1</title>one' });
		opened.push(info.id);
		const tabs = await browserRegistry.listTabs(info.id);
		const active = tabs.find((t) => t.active)!;
		const res = await browserRegistry.activate(info.id, active.targetId);
		expect(res.targetId).toBe(active.targetId);
	}, 120_000);

	it('refusals: NO_TARGET unknown tab, NO_SESSION unknown id, CLOSED tombstone', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, port: 9504 + opened.length * 3, url: 'data:text/html,<title>t1</title>one' });
		opened.push(info.id);
		await expect(browserRegistry.activate(info.id, 'deadbeef')).rejects.toMatchObject({ code: 'NO_TARGET' });
		await expect(browserRegistry.listTabs('no-such-id')).rejects.toMatchObject({ code: 'NO_SESSION' });
		await browserRegistry.close(info.id);
		opened.splice(opened.indexOf(info.id), 1);
		await expect(browserRegistry.activate(info.id, 'x')).rejects.toBeInstanceOf(BrowserRegistryRefusal);
	}, 120_000);
});
