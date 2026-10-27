import { afterAll, describe, expect, it, vi } from 'vitest';

import { browserRegistry, BrowserRegistryRefusal } from '$lib/server/browser/registry.js';

/** ADR-0040 D3 — every verb keeps ONE seam: optional targetId, absent means
 *  active; an unknown target raises the NO_TARGET refusal. */
const opened: string[] = [];

afterAll(async () => {
	for (const id of opened) await browserRegistry.close(id);
});

describe('registry verbs accept targetId (ADR-0040 D3)', () => {
	it('default verbs still ride the ACTIVE tab (absent targetId unchanged)', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, port: 9446 + opened.length * 3, url: 'data:text/html,<title>base</title>base-page' });
		opened.push(info.id);
		const pi = await browserRegistry.pageInfo(info.id);
		expect(pi.url).toContain('base-page');
		const nav = await browserRegistry.navInfo(info.id);
		expect(nav.entryCount).toBeGreaterThanOrEqual(1);
	}, 120_000);

	it('explicit targetId routes the verb to THAT tab, not the active one', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, port: 9446 + opened.length * 3, url: 'data:text/html,<title>t1</title>tab-one' });
		opened.push(info.id);
		const e = browserRegistry.peek(info.id);
		const page2 = await e.context.newPage();
		await page2.goto('data:text/html,<title>t2</title>tab-two').catch(() => undefined);
		const tabs = await browserRegistry.listTabs(info.id);
		const t2 = tabs.find((t) => !t.active)!.targetId;
		// only ATTACHED handles are verb targets (D3) — activate first
		await browserRegistry.activate(info.id, t2);
		// and back to tab 1 so the pointer is NOT on t2
		const t1 = tabs.find((t) => t.active)!.targetId;
		await browserRegistry.activate(info.id, t1);
		// navigate TAB 2 without moving the pointer
		await browserRegistry.navigate(info.id, 'data:text/html,<title>t2b</title>tab-two-renavigated', { targetId: t2 });
		const pi2 = await browserRegistry.pageInfo(info.id, t2);
		expect(pi2.url).toContain('tab-two-renavigated');
		// the ACTIVE tab (default view) is untouched
		const piActive = await browserRegistry.pageInfo(info.id);
		expect(piActive.url).toContain('tab-one');
		// dispatch to the explicit target resolves without crossing tabs
		await expect(browserRegistry.dispatch(info.id, { kind: 'key', type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 }, t2)).resolves.toBeUndefined();
	}, 120_000);

	it('NO_TARGET on an unknown target for every touched verb', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, port: 9446 + opened.length * 3, url: 'data:text/html,<title>t1</title>one' });
		opened.push(info.id);
		const BOGUS = 'no-such-target';
		// Deterministic stub: handleOf's unmapped-target retry loop (5 attempts
		// x 400ms sleep + a real CDP probe session per page per attempt) costs
		// ~1.9s PER VERB against a target that can never appear — ~13s for this
		// test alone. A bogus targetId can never win that race (it is not a
		// Playwright-lagged real tab), so refuse immediately and skip the wait;
		// every verb still runs its real body and the NO_TARGET assertion is
		// unchanged. Non-bogus targets delegate to the real seam.
		const realHandleOf = (browserRegistry as unknown as { handleOf: (e: unknown, t?: string) => Promise<unknown> }).handleOf.bind(browserRegistry);
		const stub = vi.fn((e: unknown, t?: string) => (t === BOGUS ? Promise.reject(new BrowserRegistryRefusal('NO_TARGET', 'no such tab: ' + t)) : realHandleOf(e, t)));
		(browserRegistry as unknown as { handleOf: unknown }).handleOf = stub;
		const restore = () => {
			(browserRegistry as unknown as { handleOf: unknown }).handleOf = realHandleOf;
		};
		try {
			await expect(browserRegistry.pageInfo(info.id, BOGUS)).rejects.toMatchObject({ code: 'NO_TARGET' });
			await expect(browserRegistry.navigate(info.id, 'data:text/html,<title>x</title>x', { targetId: BOGUS })).rejects.toMatchObject({ code: 'NO_TARGET' });
			await expect(browserRegistry.reload(info.id, BOGUS)).rejects.toMatchObject({ code: 'NO_TARGET' });
			await expect(browserRegistry.navInfo(info.id, BOGUS)).rejects.toMatchObject({ code: 'NO_TARGET' });
			await expect(browserRegistry.setViewport(info.id, 800, 600, BOGUS)).rejects.toMatchObject({ code: 'NO_TARGET' });
			await expect(browserRegistry.pageHistory(info.id, 'back', BOGUS)).rejects.toMatchObject({ code: 'NO_TARGET' });
			await expect(browserRegistry.dispatch(info.id, { kind: 'text', text: 'x' }, BOGUS)).rejects.toMatchObject({ code: 'NO_TARGET' });
		} finally {
			restore();
		}
		expect(stub).toHaveBeenCalledTimes(7); // every verb routed through the stubbed seam
	}, 30_000);
});
