/**
 * dsi-cli unit tests — the launcher's Skill Mirror wiring (Wave 2) and the
 * published-manifest contract (D3). bin/dsi.mjs executes at import, so the
 * wiring is pinned structurally (source order + syntax) plus a help smoke.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..', '..');
const cli = readFileSync(join(repoRoot, 'bin', 'dsi.mjs'), 'utf-8');
const manifest = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf-8')) as {
	files?: string[];
};

describe('dsi.mjs — Skill Mirror wiring (Wave 2)', () => {
	it('imports the mirror module', () => {
		expect(cli).toContain("from './lib/mirror-skills.mjs'");
	});

	it('calls the mirror step BEFORE both child spawns (web and sync paths)', () => {
		// The mirror call must precede each path's actual spawn CALL SITE:
		// the sync path spawns via runSyncedPair(...), the web path via the
		// 'const child =' line (both variants resolve there).
		const def = cli.indexOf('function runSkillsMirror');
		const calls = [...cli.matchAll(/\trunSkillsMirror\(\);/g)].map((m) => m.index ?? -1);
		const syncSpawn = cli.indexOf('runSyncedPair('); // first occurrence = the call
		const webSpawn = cli.indexOf('const child ='); // the web branch's spawn line
		expect(def).toBeGreaterThan(-1);
		expect(calls.length).toBe(2); // wired on BOTH paths (web + dsh --sync)
		const [syncCall, webCall] = calls;
		expect(syncCall).toBeLessThan(syncSpawn); // mirror runs before the pair
		expect(webCall).toBeLessThan(webSpawn); // mirror runs before the child
	});
});

describe('package.json — the skill source ships (D3)', () => {
	it('files includes both skill sources', () => {
		expect(manifest.files).toContain('.agents');
		expect(manifest.files).toContain('skills');
	});

	it('the repo carries the six skill directories, each with a SKILL.md', () => {
		const skills = ['dsi-adr', 'dsi-i18n-migrate', 'dsi-release', 'dsi-spcheck', 'dsi-spec', 'dsi-task'];
		for (const name of skills) {
			const entry = join(repoRoot, 'skills', name, 'SKILL.md');
			expect(existsSyncHard(entry), name).toBe(true);
		}
	});
});

// vitest happy-dom environment has no fs-based existsSync import here by
// design — keep the file dependency-light with one inline check
import { existsSync } from 'node:fs';
function existsSyncHard(path: string): boolean {
	return existsSync(path);
}

describe('dsi.mjs — --zai writes the profile patch, not legacy settings.yaml (D7)', () => {
	it('imports the zai-patch module', () => {
		expect(cli).toContain("from './lib/zai-patch.mjs'");
	});

	it('resolves the target via zaiPatchPath, not the legacy DSH settings join', () => {
		expect(cli).toContain('zaiPatchPath()');
		expect(cli).not.toContain("'.dsh', 'settings.yaml'");
		expect(cli).not.toContain('DSH_SETTINGS_PATH');
	});

	it('keeps the fail-loud contract — the wrapper maps errors to exit 65', () => {
		const fn = cli.indexOf('function addZaiProvider');
		const exit65 = cli.indexOf('process.exit(65)', fn);
		expect(fn).toBeGreaterThan(-1);
		expect(exit65).toBeGreaterThan(fn);
	});

	it('the USAGE help names cordis.patch.yml, not the legacy file, for --zai', () => {
		const zaiHelp = cli.indexOf('--zai    bootstrap the GLM');
		const helpSlice = cli.slice(zaiHelp, zaiHelp + 200);
		expect(helpSlice).toContain('cordis.patch.yml');
	});
});

describe('dsi.mjs — first-run config seed (ENOENT 2026-11-04)', () => {
	it('defines ensureDsiConfig and calls it BEFORE the pair spawns any child', () => {
		const def = cli.indexOf('function ensureDsiConfig');
		const seedCall = cli.indexOf('\tensureDsiConfig();');
		const hostSpawn = cli.indexOf("spawn('/bin/sh', [script, ...hostSpawnArgs]");
		expect(def).toBeGreaterThan(-1);
		expect(seedCall).toBeGreaterThan(def);
		expect(seedCall).toBeLessThan(hostSpawn); // seed precedes the host child
	});

	it('the seed clones the template settings.yaml and never touches an existing config', () => {
		const fn = cli.slice(cli.indexOf('function ensureDsiConfig'), cli.indexOf('function setDshAuthToken'));
		expect(fn).toContain('existsSync(configPath)'); // early-return guard
		expect(fn).toContain("'template', '.dsi'"); // shipped template source
		expect(fn).toContain("'{}\\n'"); // degrade-to-empty fallback
	});
});

describe('dsh-web-synced.sh — update_token survives a missing settings.yaml (ENOENT 2026-11-04)', () => {
	const { mkdtempSync, existsSync, readFileSync, writeFileSync } = require('node:fs');
	const { tmpdir } = require('node:os');
	const scriptPath = join(repoRoot, 'scripts', 'dsh-web-synced.sh');

	/** Run update_token from the script against a scratch DSI_CONFIG_PATH. */
	function runUpdateToken(configPath: string, token: string): { status: number; out: string } {
		const sh = [
			`DSI_CONFIG_PATH='${configPath}'`,
			`. '${scriptPath}' >/dev/null 2>&1`,
			`update_token '${token}'`,
		].join('\n');
		// The script path rides as $0 (sh -c's third arg) so its own
		// DSI_ROOT=$(dirname $0)/.. resolution works, exactly as when
		// dsi.mjs executes the script as a file.
		// Sourcing the script also runs its top-level launcher block, which
		// would npx-spawn a real 'dsh web' and pipe it into watch_host_stdin —
		// a process that blocks on stdin forever (the 5s-timeout hang). Point
		// DSH_WEB_CMD at a no-op and ignore stdin so the watcher's read -r
		// sees EOF immediately and sourcing exits cleanly; update_token itself
		// still runs verbatim afterwards.
		const r = spawnSync('/bin/sh', ['-c', sh, scriptPath], {
			encoding: 'utf-8',
			env: { ...process.env, DSH_WEB_CMD: 'true' },
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		return { status: r.status ?? -1, out: (r.stdout ?? '') + (r.stderr ?? '') };
	}

	it('creates dir + file with the token when settings.yaml does not exist (the first-run case)', () => {
		const root = mkdtempSync(join(tmpdir(), 'dsi-synced-'));
		const configPath = join(root, 'nested', 'settings.yaml'); // dir also missing
		const r = runUpdateToken(configPath, 'tok-first-run');
		expect(r.status).toBe(0);
		expect(r.out).toContain('authToken updated');
		expect(existsSync(configPath)).toBe(true);
		expect(readFileSync(configPath, 'utf-8')).toContain('authToken: tok-first-run');
	});

	it('merges into an existing file without clobbering sibling keys', () => {
		const root = mkdtempSync(join(tmpdir(), 'dsi-synced-'));
		const configPath = join(root, 'settings.yaml');
		writeFileSync(configPath, 'ui:\n  locale: en\ndsh:\n  old: 1\n', 'utf-8');
		const r = runUpdateToken(configPath, 'tok-second');
		expect(r.status).toBe(0);
		const text = readFileSync(configPath, 'utf-8');
		expect(text).toContain('locale: en'); // sibling section survives
		expect(text).toContain('tok-second'); // token updated
	});

	it('still fails loud on a present-but-unparseable file (not a silent skip)', () => {
		const root = mkdtempSync(join(tmpdir(), 'dsi-synced-'));
		const configPath = join(root, 'settings.yaml');
		writeFileSync(configPath, '- just\n- a list\n', 'utf-8');
		const r = runUpdateToken(configPath, 'tok-bad');
		expect(r.status).not.toBe(0);
		expect(existsSync(configPath)).toBe(true);
		expect(readFileSync(configPath, 'utf-8')).not.toContain('tok-bad'); // untouched
	});
});
