import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Shape of the injected spawnSync the bootstrap module calls (matches
 *  node child_process spawnSync's result: status is null on signal/skip). */
type FakeSpawnResult = { status: number | null };
type SpawnSyncFn = (
	cmd: string,
	args?: string[],
	opts?: { stdio?: 'pipe' | 'inherit'; timeout?: number }
) => FakeSpawnResult;
/** Env vars the bootstrap reads (plus anything else a fake needs). */
type GlassEnv = { HOME?: string; DSI_SKIP_BROWSER_INSTALL?: string };
/** Injected options object for ensureGlassBrowser. */
type GlassOpts = {
	packageRoot: string;
	spawnSync: SpawnSyncFn;
	env: GlassEnv;
	log: (line: string) => void;
	platform: string;
};

import {
	pinnedPlaywrightVersion,
	findSystemChrome,
	playwrightCacheHasChromium,
	ensureGlassBrowser
} from '../../bin/lib/glass-browser-bootstrap.mjs';

/** A throwaway packageRoot whose package.json carries the given pin. */
function fakePackageRoot(pin: string | null): string {
	const root = mkdtempSync(path.join(tmpdir(), 'dsi-glass-bootstrap-'));
	if (pin !== null) {
		mkdirSync(root, { recursive: true });
		writeFileSync(
			path.join(root, 'package.json'),
			JSON.stringify({ dependencies: pin === 'junk' ? { playwright: 'x' } : { 'playwright-core': pin } })
		);
	}
	return root;
}

// Task 1.1-T — the D2 decision tree, every branch pinned (ADR D1-D4).
describe('pinnedPlaywrightVersion', () => {
	it('derives the pin from the playwright-core dependency', () => {
		const root = fakePackageRoot('1.61.0');
		try { expect(pinnedPlaywrightVersion(root)).toBe('1.61.0'); } finally { rmSync(root, { recursive: true, force: true }); }
	});
	it('returns null when the pin is missing or unreadable — never a guessed version', () => {
		const junk = fakePackageRoot('junk');
		try { expect(pinnedPlaywrightVersion(junk)).toBe(null); } finally { rmSync(junk, { recursive: true, force: true }); }
		expect(pinnedPlaywrightVersion(path.join(tmpdir(), 'dsi-does-not-exist-xyz'))).toBe(null);
	});
});

describe('findSystemChrome', () => {
	it('short-circuits on the macOS app bundle (PATH probing is blind there)', () => {
		expect(findSystemChrome(() => { throw new Error('must not spawn'); }, 'darwin', () => true)).toBe(true);
	});
	it('probes the PATH candidates on linux and takes the first hit', () => {
		const calls: string[] = [];
		const verdict = findSystemChrome((cmd: string, args?: string[]): FakeSpawnResult => {
			calls.push(args?.[0] ?? '');
			return { status: args?.[0] === 'chromium-browser' ? 0 : 1 };
		}, 'linux');
		expect(verdict).toBe(true);
		expect(calls[0]).toBe('google-chrome');
		expect(calls[calls.length - 1]).toBe('chromium-browser');
	});
	it('reports false when nothing resolves', () => {
		expect(findSystemChrome(() => ({ status: 1 }), 'linux')).toBe(false);
	});
});

describe('playwrightCacheHasChromium', () => {
	it('detects a chromium dir under either platform cache root', () => {
		const home = mkdtempSync(path.join(tmpdir(), 'dsi-glass-home-'));
		mkdirSync(path.join(home, '.cache', 'ms-playwright', 'chromium-1228'), { recursive: true });
		try {
			expect(playwrightCacheHasChromium({ HOME: home })).toBe(true);
		} finally { rmSync(home, { recursive: true, force: true }); }
	});
	it('reports false on an empty/absent cache', () => {
		const home = mkdtempSync(path.join(tmpdir(), 'dsi-glass-home2-'));
		try { expect(playwrightCacheHasChromium({ HOME: home })).toBe(false); } finally { rmSync(home, { recursive: true, force: true }); }
	});
});

describe('ensureGlassBrowser — the D2 decision tree', () => {
	const base = (): GlassOpts => ({
		packageRoot: fakePackageRoot('1.61.0'),
		spawnSync: (): never => { throw new Error('must not spawn at probe stage'); },
		// A scratch HOME: an empty env would fall back to the REAL homedir,
		// whose cache answers the probe with machine truth (caught live).
		env: { HOME: mkdtempSync(path.join(tmpdir(), 'dsi-glass-empty-home-')) },
		log: (_line: string): void => {},
		platform: 'linux'
	});

	it('skips on the escape hatch before ANY probe (D4)', () => {
		const opts = base();
		opts.env = { DSI_SKIP_BROWSER_INSTALL: '1' };
		const lines: string[] = [];
		opts.log = (l: string): void => { lines.push(l); };
		expect(ensureGlassBrowser(opts)).toEqual({ action: 'skip', reason: 'env-escape-hatch' });
		expect(lines.join('\n')).toContain('DSI_SKIP_BROWSER_INSTALL');
	});

	it('skips on system Chrome WITHOUT touching the cache or fetching (D2 order)', () => {
		const opts = base();
		opts.spawnSync = (_cmd: string, args?: string[]): FakeSpawnResult => ({ status: args?.[0] === 'google-chrome' ? 0 : 1 });
		expect(ensureGlassBrowser(opts)).toEqual({ action: 'skip', reason: 'system-chrome' });
	});

	it('skips on a cached chromium when no system Chrome exists', () => {
		const home = mkdtempSync(path.join(tmpdir(), 'dsi-glass-home3-'));
		mkdirSync(path.join(home, '.cache', 'ms-playwright', 'chromium-1228'), { recursive: true });
		const opts = base();
		opts.env = { HOME: home };
		try {
			expect(ensureGlassBrowser(opts)).toEqual({ action: 'skip', reason: 'cached-chromium' });
		} finally { rmSync(home, { recursive: true, force: true }); }
	});

	it('fetches the PINNED playwright when nothing skips — loud line BEFORE spawn (D1/D3)', () => {
		const order: string[] = [];
		const opts = base();
		opts.spawnSync = (cmd: string, args?: string[]): FakeSpawnResult => {
			// probe stage (which) answers MISS; only the fetch child succeeds
			if (cmd === 'which') return { status: 1 };
			order.push(`spawn:${cmd} ${(args ?? []).join(' ')}`);
			return { status: 0 };
		};
		opts.log = (l: string): void => { order.push(`log:${l}`); };
		const verdict = ensureGlassBrowser(opts);
		expect(verdict).toEqual({ action: 'fetched', reason: 'playwright@1.61.0' });
		expect(order[0]).toMatch(/^log:.*downloading chromium/);
		expect(order[1]).toMatch(/^spawn:npx --yes playwright@1\.61\.0 install chromium$/);
	});

	it('warns and continues when the fetch FAILS — never throws (D4)', () => {
		const opts = base();
		opts.spawnSync = (): FakeSpawnResult => ({ status: 1 });
		const lines: string[] = [];
		opts.log = (l: string): void => { lines.push(l); };
		const verdict = ensureGlassBrowser(opts);
		expect(verdict).toEqual({ action: 'warned', reason: 'fetch-failed' });
		expect(lines.join('\n')).toContain('install chromium');
	});

	it('warns without spawning npx when the pin is unreadable', () => {
		const opts = base();
		opts.packageRoot = path.join(tmpdir(), 'dsi-does-not-exist-xyz');
		expect(ensureGlassBrowser(opts)).toEqual({ action: 'warned', reason: 'no-pin' });
	});
});
