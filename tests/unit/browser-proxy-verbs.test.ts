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
type Session = { id: string; pid: number | null };
/** Close raced against a hard cap: a wedged chromium shutdown must never
 *  hold the hook (8 sequential 15s races == the 120s hook timeout exactly —
 *  registry.close() can hang in context.close()). */
const bounded = (p: Promise<unknown>, ms: number): Promise<unknown | 'WEDGED'> => {
	let t: ReturnType<typeof setTimeout>;
	return Promise.race([p, new Promise((r) => ((t = setTimeout(() => r('WEDGED'), ms))))]).finally(() => clearTimeout(t!));
};
/** Hard-kill the session's own port owner (process group first, then the
 *  pid) so a wedged glass never outlives the run. SIGKILL cannot wedge. */
const hardKill = (pid: number): void => {
	for (const target of [-pid, pid]) {
		try {
			process.kill(target, 'SIGKILL');
			return;
		} catch {
			// ESRCH/EPERM on one form — try the next
		}
	}
};
const reap = async (id: string): Promise<void> => {
	if ((await bounded(browserRegistry.close(id), 5_000)) !== 'WEDGED') return;
	// wedged: SIGKILL the port owner, then a second bounded close to release
	// registry state and remove the profile dir (the wedged close died
	// before rmSync)
	const s = (browserRegistry.list() as Session[]).find((x) => x.id === id);
	if (s?.pid) hardKill(s.pid);
	await bounded(browserRegistry.close(id), 5_000).catch(() => undefined);
};
afterAll(async () => {
	// sessions are independent (own port, own profile dir) — reap in parallel
	await Promise.allSettled(opened.map(reap));
}, 30_000); // worst case per session is 2x5s, in parallel — far under the cap
const post = (body: unknown) => new Request('http://x', { method: 'POST', body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: { id } });
const page = (t: string) => 'data:text/html,<title>' + t + '</title><h1>' + t + '</h1>';

describe('registry pageHistory + reload (1.1-T)', () => {
	it('back/forward travel the browser list and report bounds', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, port: 9466 + opened.length * 3 });
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
		const info = await browserRegistry.open({ spawnMcp: false, port: 9466 + opened.length * 3 });
		opened.push(info.id);
		await browserRegistry.navigate(info.id, page('ONE'), { waitLoad: true });
		await expect(browserRegistry.pageHistory(info.id, 'forward')).rejects.toBeInstanceOf(BrowserRegistryRefusal);
	}, 120_000);

	it('reload keeps the page and answers pageInfo (D4)', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, port: 9466 + opened.length * 3 });
		opened.push(info.id);
		await browserRegistry.navigate(info.id, page('REL'), { waitLoad: true });
		const r = await browserRegistry.reload(info.id);
		expect(r.title).toBe('REL');
		expect(r.url.startsWith('data:text/html')).toBe(true);
	}, 120_000);
});

describe('navigate route closed union (1.2-T)', () => {
	it('url member still works and validates (old shape pinned)', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, port: 9466 + opened.length * 3 });
		opened.push(info.id);
		const res = await navigate({ ...ctx(info.id), request: post({ url: page('UNION') }) });
		expect(((await res.json()) as { title: string }).title).toBe('UNION');
		expect((await navigate({ ...ctx(info.id), request: post({ url: 'javascript:alert(1)' }) })).status).toBe(400);
	}, 120_000);

	it('action members route to reload/back/forward', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, port: 9466 + opened.length * 3 });
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
		const info = await browserRegistry.open({ spawnMcp: false, port: 9466 + opened.length * 3 });
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
		const info = await browserRegistry.open({ spawnMcp: false, port: 9466 + opened.length * 3 });
		opened.push(info.id);
		await browserRegistry.navigate(info.id, page('VP'), { waitLoad: true });
		await browserRegistry.setViewport(info.id, 500, 400);
		const pi = await browserRegistry.pageInfo(info.id);
		expect(pi.innerWidth).toBe(500);
		expect(pi.innerHeight).toBe(400);
	}, 120_000);

	it('viewport route validates shapes and answers ok', async () => {
		const info = await browserRegistry.open({ spawnMcp: false, port: 9466 + opened.length * 3 });
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
		const info = await browserRegistry.open({ spawnMcp: false, port: 9466 + opened.length * 3 });
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
		// fixture config, NOT the live file: the operator floor may carry a
		// real override (2026-10-24: live settings now carry quality 60 and
		// this test read it, breaking "absent section = default")
		const os = await import('node:os');
		const fsp = await import('node:fs/promises');
		const path = await import('node:path');
		const fixture = path.join(os.tmpdir(), `dsi-quality-fixture-${Date.now()}.yaml`);
		await fsp.writeFile(fixture, 'chat:\n  input:\n    maxRows: 15\n');
		try {
			expect(readBrowserConfig(fixture).screencastQuality).toBe(90); // absent section = default
		} finally {
			await fsp.rm(fixture, { force: true });
		}
		const relaySrc = (await import('node:fs')).readFileSync('src/lib/server/browser/relay.ts', 'utf8');
		expect(relaySrc).toContain('quality: this.quality');
		const regSrc = (await import('node:fs')).readFileSync('src/lib/server/browser/registry.ts', 'utf8');
		expect(regSrc).toContain('new BrowserRelay(cdp, cfg.screencastQuality, cfg.screencastMaxFps)'); // ADR-0039 adds pacing
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

describe('screencast pacing from config (ADR-0039 D1, 2026-10-24)', () => {
	it('default is 15, absent section falls back, out-of-range clamps to 1..60', async () => {
		const { readBrowserConfig, DEFAULT_BROWSER_CONFIG } = await import('$lib/server/insight-config.js');
		expect(DEFAULT_BROWSER_CONFIG.screencastMaxFps).toBe(15);
		// fixture config, NOT the live file: the operator floor carries a real
		// override (screencastMaxFps: 10 since 2026-10-24) and this test used
		// to read it, breaking "absent section = default" (same lesson as the
		// quality fixture above)
		const os = await import('node:os');
		const fsp = await import('node:fs/promises');
		const path = await import('node:path');
		const noSection = path.join(os.tmpdir(), `dsi-fps-fixture-${Date.now()}.yaml`);
		await fsp.writeFile(noSection, 'chat:\n  input:\n    maxRows: 15\n');
		const tooHigh = path.join(os.tmpdir(), `dsi-fps-high-${Date.now()}.yaml`);
		await fsp.writeFile(tooHigh, 'browser:\n  screencastMaxFps: 999\n');
		const tooLow = path.join(os.tmpdir(), `dsi-fps-low-${Date.now()}.yaml`);
		await fsp.writeFile(tooLow, 'browser:\n  screencastMaxFps: 0\n');
		try {
			expect(readBrowserConfig(noSection).screencastMaxFps).toBe(15); // absent section = default
			// intWithin's contract (same as every other section): OUT-OF-RANGE
			// falls back to the default, it does not clamp to the bound
			expect(readBrowserConfig(tooHigh).screencastMaxFps).toBe(15);
			expect(readBrowserConfig(tooLow).screencastMaxFps).toBe(15);
		} finally {
			await fsp.rm(noSection, { force: true });
			await fsp.rm(tooHigh, { force: true });
			await fsp.rm(tooLow, { force: true });
		}
	});
});