/**
 * Glass browser bootstrap (ADR "The Glass Bootstrap" 2026-11-05, D1-D4):
 * decide whether the floor's glass browser has a binary it can launch, and
 * fetch the pinned chromium once when it does not. Pure decision logic —
 * every effect (spawnSync, env, log, platform) is injected, so the unit
 * pins exercise the full decision tree without a network or a real cache.
 *
 * Probe order IS the launch order (D2): registry.ts tries system Google
 * Chrome (channel: 'chrome') FIRST and falls back to the bundled chromium,
 * so a machine with Chrome must never pay for a chromium download.
 *
 * Soft failure is the contract (D4): a failed or skipped fetch warns and
 * returns — the floor boots; only the glass is affected, and the launch
 * site's honest error (D5) names the cure.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/** Chrome candidates probed on PATH (Linux shape). macOS has no google-chrome
 *  on PATH — the .app bundle is the truth (checked separately). */
const CHROME_PATH_CANDIDATES = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];

/** The pinned playwright family, derived from this package's own
 *  playwright-core dependency (D3: no second hardcoded pin may exist).
 *  Returns null when the pin cannot be read — the caller then warns and
 *  skips the fetch; a null pin never spawns npx. */
/** @param {string} packageRoot @returns {string | null} */
export function pinnedPlaywrightVersion(packageRoot) {
	try {
		const doc = /** @type {any} */ (JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf-8')));
		const version = doc?.dependencies?.['playwright-core'];
		return typeof version === 'string' && /^\d+\.\d+\.\d+/.test(version) ? version : null;
	} catch {
		return null;
	}
}

/** True when a system Google/Chromium browser is resolvable: PATH probes on
 *  Linux, the .app bundle on macOS (where PATH probing is always blind). */
/** @param {(cmd: string, args?: string[], opts?: { stdio?: 'pipe' | 'inherit'; timeout?: number }) => { status: number | null }} spawnSync
 *  @param {string} [platform]
 *  @param {(p: string) => boolean} [exists]
 *  @returns {boolean} */
export function findSystemChrome(spawnSync, platform = process.platform, exists = existsSync) {
	if (platform === 'darwin') {
		return exists('/Applications/Google Chrome.app');
	}
	for (const name of CHROME_PATH_CANDIDATES) {
		try {
			if (spawnSync('which', [name], { stdio: 'pipe' }).status === 0) return true;
		} catch {
			// no which (or no sh) — the next candidate still probes
		}
	}
	return false;
}

/** True when ANY chromium-family build sits in the playwright cache (either
 *  platform root). The npx fetch is the revision authority — this probe is
 *  the cheap hint that avoids re-downloading what is already present. */
/** @param {Record<string, string | undefined>} [env]
 *  @param {(p: string) => string[]} [readdir]
 *  @returns {boolean} */
export function playwrightCacheHasChromium(env = process.env, readdir = readdirSync) {
	const home = env.HOME ?? homedir();
	const roots = [
		path.join(home, 'Library', 'Caches', 'ms-playwright'),
		path.join(home, '.cache', 'ms-playwright')
	];
	for (const root of roots) {
		try {
			if (readdir(root).some((entry) => entry.startsWith('chromium'))) return true;
		} catch {
			// unreadable/absent root — the next root still probes
		}
	}
	return false;
}

/**
 * The D2 decision tree. Sync by construction: every step is a stat, a
 * readdir, or one spawnSync child. Returns a verdict the launcher logs:
 *   { action: 'skip',    reason } — a browser exists (or the hatch fired)
 *   { action: 'fetched', reason } — the pinned chromium landed in the cache
 *   { action: 'warned',  reason } — no browser and the fetch failed/skipped;
 *                                   the floor still boots (D4)
 */
/** @param {{
 *   packageRoot: string,
 *   spawnSync: (cmd: string, args?: string[], opts?: { stdio?: 'pipe' | 'inherit'; timeout?: number }) => { status: number | null },
 *   env?: Record<string, string | undefined>,
 *   log?: (msg: string) => void,
 *   platform?: string
 * }} options
 * @returns {{ action: 'skip' | 'fetched' | 'warned', reason: string }} */
export function ensureGlassBrowser({ packageRoot, spawnSync, env = process.env, log = () => {}, platform = process.platform }) {
	if (env.DSI_SKIP_BROWSER_INSTALL === '1') {
		log('dsi dsh: glass browser check skipped (DSI_SKIP_BROWSER_INSTALL=1)');
		return { action: 'skip', reason: 'env-escape-hatch' };
	}
	if (findSystemChrome(spawnSync, platform)) {
		return { action: 'skip', reason: 'system-chrome' };
	}
	if (playwrightCacheHasChromium(env)) {
		return { action: 'skip', reason: 'cached-chromium' };
	}
	const pin = pinnedPlaywrightVersion(packageRoot);
	if (pin === null) {
		log('dsi dsh: glass browser — no playwright-core pin readable in package.json, skipping the chromium fetch');
		return { action: 'warned', reason: 'no-pin' };
	}
	// The loud line comes BEFORE the fetch child (D1): the silent-minutes
	// bug (2026-11-06) must never repeat on this stage.
	log(`dsi dsh: glass browser missing — downloading chromium (~150 MB, one-time, playwright@${pin})…`);
	let result;
	try {
		result = spawnSync('npx', ['--yes', `playwright@${pin}`, 'install', 'chromium'], {
			stdio: 'inherit',
			timeout: 300000
		});
	} catch (error) {
		const message = /** @type {any} */ (error)?.message ?? error;
		log(`dsi dsh: chromium fetch failed (${message}) — the floor still boots; the glass needs: npx playwright@${pin} install chromium`);
		return { action: 'warned', reason: 'fetch-error' };
	}
	if ((result?.status ?? 1) === 0) {
		return { action: 'fetched', reason: `playwright@${pin}` };
	}
	log(`dsi dsh: chromium fetch failed (exit ${result?.status}) — the floor still boots; the glass needs: npx playwright@${pin} install chromium`);
	return { action: 'warned', reason: 'fetch-failed' };
}
