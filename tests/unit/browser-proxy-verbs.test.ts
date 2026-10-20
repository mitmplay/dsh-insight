/**
 * The Glass Proxies — registry pageHistory/reload (Tasks 1.1-T) and the
 * navigate route's closed union (Tasks 1.2-T), against a real (headless
 * default) chromium, the house pattern of browser-navigate.test.ts.
 * ADR-0031 D3/D4.
 */
import { existsSync } from 'node:fs';

import { afterAll, describe, expect, it } from 'vitest';

import { browserRegistry, BrowserRegistryRefusal } from '$lib/server/browser/registry.js';
import { POST as navigate } from '../../src/routes/api/browser/[id]/navigate/+server';
import { POST as viewport } from '../../src/routes/api/browser/[id]/viewport/+server';

const opened: string[] = [];
afterAll(async () => {
	for (const id of opened) await browserRegistry.close(id);
});
const post = (body: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: { id } });
const page = (t: string) => 'data:text/html,<title>' + t + '</title><h1>' + t + '</h1>';

describe('registry pageHistory + reload (1.1-T)', () => {
	it('back/forward travel the browser list and report bounds', async () => {
		const info = await browserRegistry.open({ spawnMcp: false });
		opened.push(info.id);
		// fresh session: the list already holds the launch page(s), so back
		// lands on the initial about:blank (bounds refusal is pinned by the
		// forward-at-end test below)
		const initial = await browserRegistry.pageHistory(info.id, 'back');
		expect(initial.url).toBe('about:blank');
		expect(initial.currentIndex).toBe(0);
		await browserRegistry.navigate(info.id, page('AAA'), { waitLoad: true });
		await browserRegistry.navigate(info.id, page('BBB'), { waitLoad: true });
		const back = await browserRegistry.pageHistory(info.id, 'back');
		expect(back.title).toBe('AAA');
		expect(back.currentIndex).toBe(back.entryCount - 2); // launch pages precede the fixtures
		expect(back.entryCount).toBeGreaterThanOrEqual(2);
		const fwd = await browserRegistry.pageHistory(info.id, 'forward');
		expect(fwd.title).toBe('BBB');
	}, 120_000);

	it('forward at the list end refuses', async () => {
		const info = await browserRegistry.open({ spawnMcp: false });
		opened.push(info.id);
		await browserRegistry.navigate(info.id, page('ONE'), { waitLoad: true });
		await expect(browserRegistry.pageHistory(info.id, 'forward')).rejects.toBeInstanceOf(BrowserRegistryRefusal);
	}, 120_000);

	it('reload keeps the page and answers pageInfo (D4)', async () => {
		const info = await browserRegistry.open({ spawnMcp: false });
		opened.push(info.id);
		await browserRegistry.navigate(info.id, page('REL'), { waitLoad: true });
		const r = await browserRegistry.reload(info.id);
		expect(r.title).toBe('REL');
		expect(r.url.startsWith('data:text/html')).toBe(true);
	}, 120_000);
});

describe('navigate route closed union (1.2-T)', () => {
	it('url member still works and validates (old shape pinned)', async () => {
		const info = await browserRegistry.open({ spawnMcp: false });
		opened.push(info.id);
		const res = await navigate({ ...ctx(info.id), request: post({ url: page('UNION') }) });
		expect(((await res.json()) as { title: string }).title).toBe('UNION');
		expect((await navigate({ ...ctx(info.id), request: post({ url: 'javascript:alert(1)' }) })).status).toBe(400);
	}, 120_000);

	it('action members route to reload/back/forward', async () => {
		const info = await browserRegistry.open({ spawnMcp: false });
		opened.push(info.id);
		await navigate({ ...ctx(info.id), request: post({ url: page('X1') }) });
		await navigate({ ...ctx(info.id), request: post({ url: page('X2') }) });
		const back = await navigate({ ...ctx(info.id), request: post({ action: 'back' }) });
		expect(((await back.json()) as { title: string }).title).toBe('X1');
		const fwd = await navigate({ ...ctx(info.id), request: post({ action: 'forward' }) });
		expect(((await fwd.json()) as { title: string }).title).toBe('X2');
		const rel = await navigate({ ...ctx(info.id), request: post({ action: 'reload' }) });
		expect(((await rel.json()) as { title: string }).title).toBe('X2');
	}, 120_000);

	it('rejects open-union bodies and unknown sessions', async () => {
		const info = await browserRegistry.open({ spawnMcp: false });
		opened.push(info.id);
		expect((await navigate({ ...ctx(info.id), request: post({}) })).status).toBe(400); // neither member
		expect((await navigate({ ...ctx(info.id), request: post({ url: page('Y'), action: 'back' }) })).status).toBe(400); // both members
		expect((await navigate({ ...ctx(info.id), request: post({ action: 'sideways' }) })).status).toBe(400);
		expect((await navigate({ ...ctx('nope'), request: post({ action: 'reload' }) })).status).toBe(404);
		// bounds refusal surfaces as 409 with the reason
		const res = await navigate({ ...ctx(info.id), request: post({ action: 'forward' }) });
		expect(res.status).toBe(409);
	}, 120_000);
});

describe('viewport follows the panel (ADR-0031 amendment 2)', () => {
	it('setViewport resizes the page; pageInfo witnesses it', async () => {
		const info = await browserRegistry.open({ spawnMcp: false });
		opened.push(info.id);
		await browserRegistry.navigate(info.id, page('VP'), { waitLoad: true });
		await browserRegistry.setViewport(info.id, 500, 400);
		const pi = await browserRegistry.pageInfo(info.id);
		expect(pi.innerWidth).toBe(500);
		expect(pi.innerHeight).toBe(400);
	}, 120_000);

	it('viewport route validates shapes and answers ok', async () => {
		const info = await browserRegistry.open({ spawnMcp: false });
		opened.push(info.id);
		const good = await viewport({ ...ctx(info.id), request: post({ width: 600, height: 450 }) });
		expect(good.status).toBe(200);
		expect((await good.json())).toEqual({ ok: true });
		expect((await viewport({ ...ctx(info.id), request: post({ width: 'wide' }) })).status).toBe(400);
		expect((await viewport({ ...ctx(info.id), request: post({ height: 400 }) })).status).toBe(400);
		expect((await viewport({ ...ctx('nope'), request: post({ width: 600, height: 450 }) })).status).toBe(404);
	}, 120_000);
});

describe('profile cleanup + screencast fidelity (operator reports 2026-10-20)', () => {
	it('screencast sends a config-driven quality (the captcha-legibility fix)', async () => {
		const src = (await import('node:fs')).readFileSync('src/lib/server/browser/relay.ts', 'utf8');
		expect(src).toContain('quality: this.quality');
	});

	it('close removes the session profile dir from ~/.dsi/browser-profiles', async () => {
		const info = await browserRegistry.open({ spawnMcp: false });
		const list = browserRegistry.list() as Array<{ id: string; profileDir: string }>;
		const mine = list.find((s) => s.id === info.id)!;
		expect(mine.profileDir).toContain('browser-profiles');
		const exists = (d: string): boolean => existsSync(d);
		expect(exists(mine.profileDir)).toBe(true);
		await browserRegistry.close(info.id);
		expect(exists(mine.profileDir)).toBe(false);
	}, 120_000);
});

describe('screencast quality from config (amendment 4, 2026-10-20)', () => {
	it('default is 90 and the relay start carries it; yaml override flows through', async () => {
		const { readBrowserConfig, DEFAULT_BROWSER_CONFIG } = await import('$lib/server/insight-config.js');
		expect(DEFAULT_BROWSER_CONFIG.screencastQuality).toBe(90);
		expect(readBrowserConfig().screencastQuality).toBe(90); // absent section = default
		const relaySrc = (await import('node:fs')).readFileSync('src/lib/server/browser/relay.ts', 'utf8');
		expect(relaySrc).toContain('quality: this.quality');
		const regSrc = (await import('node:fs')).readFileSync('src/lib/server/browser/registry.ts', 'utf8');
		expect(regSrc).toContain('new BrowserRelay(cdp, cfg.screencastQuality)');
		expect(regSrc).toContain('--autoplay-policy=no-user-gesture-required');
	});
});

describe('player-error witness (amendment 5, 2026-10-20)', () => {
	it('pageInfo surfaces the page own failure text + MediaError code', async () => {
		const src = (await import('node:fs')).readFileSync('src/lib/server/browser/registry.ts', 'utf8');
		expect(src).toContain('playerError');
		expect(src).toContain('mediaErrorCode');
		expect(src).toContain('.ytp-error-content');
	});
});

describe('sound in the headless glass — the operator fix (2026-10-20)', () => {
	it('launch ignores Playwright default --mute-audio (the REAL sound fix)', async () => {
		const src = (await import('node:fs')).readFileSync('src/lib/server/browser/registry.ts', 'utf8');
		// Playwright injects --mute-audio by default; only the ignore-list
		// removes it — the autoplay policy flag alone was never audible
		expect(src).toContain("ignoreDefaultArgs = ['--enable-automation', '--mute-audio']");
	});
});
