import { afterAll, describe, expect, it } from 'vitest';

import { browserRegistry } from '$lib/server/browser/registry.js';

/** ADR "The Mirror Must Face a Living Tab" (2026-10-28) — D1 adoption and
 *  D2 pointer liveness. Real (headless-default) chromium, spawnMcp off:
 *  the brain is not under test. Each test owns its own glass session so a
 *  dead-tab scenario cannot poison the next assertion. */
const opened: string[] = [];

afterAll(async () => {
	for (const id of opened) await browserRegistry.close(id).catch(() => undefined);
});

describe('browser registry mirror lifecycle (D1 adopt / D2 re-point)', () => {
	it('D1 adopt: a page the registry never minted joins listTabs with the NEXT ordinal', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, port: 9560, url: 'data:text/html,<title>t1</title>one' });
		opened.push(info.id);
		const first = await browserRegistry.listTabs(info.id);
		expect(first).toHaveLength(1);
		const birthOrdinal = first[0].tabId;
		// an UNKNOWN live page appears (fixture tab, post-churn birth)
		const page2 = await browserRegistry.peek(info.id).context.newPage();
		await page2.goto('data:text/html,<title>t2</title>two').catch(() => undefined);
		const after = await browserRegistry.listTabs(info.id);
		expect(after).toHaveLength(2);
		const t2 = after.find((r) => r.title === 't2');
		expect(t2).toBeTruthy();
		expect(t2!.tabId).toBe(birthOrdinal + 1); // adopted LAST — survivors keep theirs
		expect(after.find((r) => r.title === 't1')!.tabId).toBe(birthOrdinal);
	}, 120_000);

	it('D2 re-point: closing the FACED tab moves the pointer to a survivor within one poll, mirror re-seeded', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, port: 9563, url: 'data:text/html,<title>t1</title>one' });
		opened.push(info.id);
		const e = browserRegistry.peek(info.id);
		const page2 = await e.context.newPage();
		await page2.goto('data:text/html,<title>t2</title>two').catch(() => undefined);
		// face the birth tab, then kill it — the exact teardown shape
		const tabs = await browserRegistry.listTabs(info.id);
		const t1 = tabs.find((r) => r.title === 't1')!;
		await browserRegistry.activate(info.id, t1.targetId);
		await e.context.pages().find((p) => p.url().includes('title>t1'))?.close().catch(() => undefined);
		// ONE poll: adoption + re-point + re-seed
		const after = await browserRegistry.listTabs(info.id);
		expect(after.some((r) => r.targetId === t1.targetId)).toBe(false); // ghost evicted from the answer
		const active = after.filter((r) => r.active);
		expect(active).toHaveLength(1);
		expect(active[0].title).toBe('t2'); // the survivor faces the mirror
		// D2's re-seed: the mirror holds a real frame, not a frozen corpse
		expect(browserRegistry.relay(info.id).latestFrame()).not.toBeNull();
	}, 120_000);

	it('D2 edge: every page gone answers an honest empty strip (pointer null)', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, port: 9566, url: 'data:text/html,<title>t1</title>one' });
		opened.push(info.id);
		const e = browserRegistry.peek(info.id);
		for (const p of [...e.context.pages()]) await p.close().catch(() => undefined);
		const after = await browserRegistry.listTabs(info.id);
		expect(after).toHaveLength(0);
	}, 120_000);
});
