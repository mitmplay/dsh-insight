import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseProcs, selectOrphans, sweepOrphans } from '../../bin/lib/floor-sweep.mjs';

const PS_FIXTURE = [
	'    1     0 /sbin/launchd',
	'   30     1 node bin/dsi.mjs dsh --sync',           // THE CALLING LAUNCHER (selfPid)
	'  100    30 dsh-web-synced.sh --dev',              // parent 30 alive → spared
	'  101   999 node /tmp/_npx/h1sh/node_modules/.bin/dsh web', // parent 999 dead → orphan (matches the npx shim pattern)
	'  102    30 vite.js --port 5201',                  // live floor's own child → spared
	'  103   777 node deepseek-insight/build/index.js', // parent 777 dead → orphan (a reparent-to-launchd orphan is NOT swept by pid — the port takeover owns it)
	'  200   100 node deepseek-insight/build/index.js'  // child of live floor → spared
].join('\n');

const PATTERNS = ['dsh-web-synced.sh', '@deepseek-ai/dsh/lib/bin.js', '_npx/[^/]*/node_modules/.bin/dsh', 'deepseek-insight/build/index.js'];

describe('scoped orphan sweep (ADR-0082 D3)', () => {
	it('parses ps rows', () => {
		const rows = parseProcs(PS_FIXTURE);
		expect(rows).toHaveLength(7);
		expect(rows[2]).toEqual({ pid: 100, ppid: 30, command: 'dsh-web-synced.sh --dev' });
	});

	it('spares every process whose parent is alive (D3: never kill by name under a live parent)', () => {
		const orphans = selectOrphans(parseProcs(PS_FIXTURE), { patterns: PATTERNS, selfPid: 30 });
		expect(orphans.map((o) => o.pid)).toEqual([101, 103]);
	});

	it('never selects the calling launcher itself', () => {
		const rows = [
			{ pid: 30, ppid: 1, command: 'node bin/dsi.mjs dsh --sync' },
			{ pid: 1, ppid: 0, command: '/sbin/launchd' }
		];
		// pid 1 (launchd) is never in a pattern; but if selfPid were the only
		// matcher candidate, it must still be excluded
		expect(selectOrphans(rows, { patterns: ['dsi.mjs'], selfPid: 30 })).toEqual([]);
	});

	it('sweeps by pid with a per-pid receipt naming pid and command', () => {
		const terminate = vi.fn();
		const lines: string[] = [];
		const receipt = sweepOrphans({
			patterns: PATTERNS,
			selfPid: 30,
			listProcs: () => PS_FIXTURE,
			terminate,
			log: (l) => lines.push(l)
		});
		expect(receipt.swept.map((s) => s.pid)).toEqual([101, 103]);
		expect(terminate).toHaveBeenCalledTimes(2);
		expect(terminate).toHaveBeenCalledWith(101, 'SIGTERM');
		expect(terminate).toHaveBeenCalledWith(103, 'SIGTERM');
		expect(lines.filter((l) => l.includes('orphan swept (pid 101'))).toHaveLength(1);
		expect(lines.filter((l) => l.includes('orphan swept (pid 103'))).toHaveLength(1);
	});

	it('delegates port-held survivors to the injected takeover hook (the exit-64 receipt path)', () => {
		const freePorts = vi.fn(() => [3080, 5175]);
		const receipt = sweepOrphans({
			patterns: PATTERNS,
			selfPid: 30,
			listProcs: () => PS_FIXTURE,
			terminate: vi.fn(),
			log: () => {},
			freePorts
		});
		expect(freePorts).toHaveBeenCalledTimes(1);
		expect(receipt.ports).toEqual([3080, 5175]);
	});

	it('launcher contract: killOrphans uses the scoped sweep, never pkill, and frees ports only on consent', () => {
		// the dsi.mjs wrapper is the integration point — pin it so the old
		// name-based pkill can never quietly come back, and so the port
		// takeover is an explicit opt-in (ADR-0082 amendment 2026-11-25), never a default
		const src = readFileSync('bin/dsi.mjs', 'utf8');
		const fn = src.slice(src.indexOf('async function killOrphans'), src.indexOf('/** The DSI ports the bounce owns'));
		expect(fn).toContain('async function killOrphans({ takeover = false } = {})');
		expect(fn).toContain('sweepOrphans({');
		expect(fn).not.toContain("spawnSync('pkill'");
		expect(fn).toContain("DSI_SKIP_ORPHAN_SWEEP === '1'");
		expect(fn).toContain('if (!takeover) return;');
		expect(fn.indexOf('if (!takeover) return;')).toBeLessThan(fn.indexOf('await freeFloorPorts(floorPortSet())'));
	});

	it('launcher contract: STARTUP refuses a busy port and never takes one over', () => {
		const src = readFileSync('bin/dsi.mjs', 'utf8');
		const fn = src.slice(src.indexOf('async function preflightPort'), src.indexOf('function openBrowser('));
		expect(fn).toContain('await killOrphans();'); // the default: true orphans only, no takeover
		expect(fn).not.toContain('takeover: true');
		expect(fn).not.toContain('freeFloorPorts(');
		expect(fn).toContain('still in use by a process the sweep does not own (pid ');
		expect(fn).toContain('process.exit(64)');
	});

	it('launcher contract: only the --sync-kills verb asks for the takeover; the bounce frees ports itself', () => {
		const src = readFileSync('bin/dsi.mjs', 'utf8');
		expect(src.match(/killOrphans\(\{ takeover: true \}\)/g)).toHaveLength(1);
		const kills = src.slice(src.indexOf("flag === '--sync-kills'"), src.indexOf('function dsiConfigPath()'));
		expect(kills).toContain('killOrphans({ takeover: true })');
		const bounce = src.slice(src.indexOf('const sweepAndReserve = async () => {'), src.indexOf('const bounceVerdict ='));
		expect(bounce).toContain('await killOrphans();');
		expect(bounce).toContain('await freeFloorPorts(floorPortSet())');
	});
});
