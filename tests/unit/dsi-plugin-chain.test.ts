/**
 * Task 4.1-T — the launch chain's testable half (bin/lib/plugin-chain.mjs):
 * argument validation exits 64 shapes, launcher-rule command construction
 * (DSH_WEB_CMD override, else the pinned npx), and the dsi.mjs flag surface
 * smoke (spawn, never a live floor).
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bounceDevMode, dshLauncherCmd, parsePluginArgs, hostBounceDecision, floorUiPort, parseDevFloorPids, launchUrl, tokenFromSettings } from '../../bin/lib/plugin-chain.mjs';

const BIN = resolve(import.meta.dirname, '../../bin/dsi.mjs');

type Parsed = ReturnType<typeof parsePluginArgs>;

function mustParse(argv: string[], options?: { envProfile?: string }): NonNullable<Extract<Parsed, { action: string }>> {
	const r = parsePluginArgs(argv, options);
	if (r === null || !('action' in r)) throw new Error('expected a parsed invocation: ' + JSON.stringify(r));
	return r;
}

function mustFail(argv: string[]): string {
	const r = parsePluginArgs(argv);
	if (r === null || !('error' in r)) throw new Error('expected a usage error: ' + JSON.stringify(r));
	return r.error;
}

describe('parsePluginArgs', () => {
	it('null for non-plugin invocations (caller falls through)', () => {
		expect(parsePluginArgs(['--sync'])).toBeNull();
		expect(parsePluginArgs(['--token', 'abc'])).toBeNull();
	});
	it('parses add with an explicit profile', () => {
		expect(mustParse(['--plugin', 'add', 'git+https://x/y.git', '--profile', 'dev'])).toEqual({
			action: 'add', pkg: 'git+https://x/y.git', profile: 'dev'
		});
	});
	it('defaults the profile to web (env-seamable)', () => {
		expect(mustParse(['--plugin', 'remove', 'some-pkg'])).toEqual({
			action: 'remove', pkg: 'some-pkg', profile: 'web'
		});
		expect(mustParse(['--plugin', 'remove', 'some-pkg'], { envProfile: 'dev' }).profile).toBe('dev');
	});
	it('restart flag takes no arguments', () => {
		expect(mustParse(['--plugin-restart'])).toMatchObject({ action: 'restart' });
		expect(mustFail(['--plugin-restart', 'extra'])).toContain('usage');
	});
	it('restart accepts --dev and records it (RCA 2026-09-27: the bounce must restore the dev floor)', () => {
		expect(mustParse(['--plugin-restart']).dev).toBe(false);
		expect(mustParse(['--plugin-restart', '--dev']).dev).toBe(true);
		expect(mustFail(['--plugin-restart', '--dev', 'stray'])).toContain('usage');
	});
	it('bad shapes error with the usage line', () => {
		expect(mustFail(['--plugin'])).toContain('usage');
		expect(mustFail(['--plugin', 'bogus', 'x'])).toContain('usage');
		expect(mustFail(['--plugin', 'add', '--profile'])).toContain('usage');
		expect(mustFail(['--plugin', 'add', 'x', 'stray'])).toContain('unexpected argument');
	});
});

describe('bounceDevMode (RCA 2026-09-27, second order)', () => {
	it('an explicit --dev wins without asking the process table', () => {
		let asked = 0;
		expect(bounceDevMode(true, () => { asked++; return false; })).toBe(true);
		expect(asked).toBe(0);
	});
	it('no flag: a live dev floor (pgrep probe hits) bounces back as dev', () => {
		expect(bounceDevMode(false, () => true)).toBe(true);
	});
	it('no flag, no dev floor: production bounce (the 5174-only regression)', () => {
		expect(bounceDevMode(false, () => false)).toBe(false);
	});
	it('a throwing probe reads as production — the bounce still happens', () => {
		expect(bounceDevMode(false, () => { throw new Error('pgrep missing'); })).toBe(false);
	});
});

describe('dshLauncherCmd', () => {
	it('delegates to the pinned npx dsh by default', () => {
		expect(dshLauncherCmd('web', 'add', 'git+https://x/y.git', '1.2.3')).toBe(
			'npx --yes @deepseek-ai/dsh@1.2.3 plugin --profile web add git+https://x/y.git'
		);
	});
	it('DSH_WEB_CMD overrides the launcher', () => {
		process.env.DSH_WEB_CMD = 'dsh-from-source';
		expect(dshLauncherCmd('web', 'remove', 'pkg', '1.2.3')).toBe('dsh-from-source plugin --profile web remove pkg');
		delete process.env.DSH_WEB_CMD;
	});
});

describe('dsi.mjs flag surface (smoke — spawns the real CLI, no floor)', () => {
	const run = (args: string[]) => spawnSync(process.execPath, [BIN, 'dsh', ...args], { encoding: 'utf8' });
	it('a malformed --plugin usage exits 64 with the usage line', () => {
		const r = run(['--plugin']);
		expect(r.status).toBe(64);
		expect(r.stderr).toContain('usage: dsi dsh --plugin');
	});
	it('--plugin-restart with a stray argument exits 64', () => {
		expect(run(['--plugin-restart', 'extra']).status).toBe(64);
	});
	it('--help still lists the plugin verbs', () => {
		const r = spawnSync(process.execPath, [BIN, '--help'], { encoding: 'utf8' });
		expect(r.stdout).toContain('--plugin add');
		expect(r.stdout).toContain('--plugin-restart');
	});
});

// ADR-0025 D1/D3 — the bounce fork (hostBounceDecision): BOTH branches are
// pinned so the fallback cannot rot silently (Wave 2 risk register).
const noSleep = async () => {};

describe('hostBounceDecision (ADR-0025)', () => {
	it('pair/build mode sweeps without ever posting', async () => {
		let posted = 0;
		let swept = 0;
		const verdict = await hostBounceDecision({
			mode: 'pair',
			post: async () => { posted += 1; return true; },
			sweep: () => { swept += 1; },
			sleep: noSleep
		});
		expect(verdict).toBe('sweep');
		expect(posted).toBe(0);
		expect(swept).toBe(1);
	});

	it('in-process + route ok: host bounce, sweep SKIPPED (vite survives)', async () => {
		let posted = 0;
		let swept = 0;
		const verdict = await hostBounceDecision({
			mode: 'in-process',
			post: async () => { posted += 1; return true; },
			sweep: () => { swept += 1; },
			sleep: noSleep
		});
		expect(verdict).toBe('host');
		expect(posted).toBe(1);
		expect(swept).toBe(0);
	});

	it('in-process + route refused twice: fallback sweep runs (D3)', async () => {
		let posted = 0;
		let swept = 0;
		const sleeps: number[] = [];
		const verdict = await hostBounceDecision({
			mode: 'in-process',
			post: async () => { posted += 1; return false; },
			sweep: () => { swept += 1; },
			sleep: async (ms) => { sleeps.push(ms); },
			tries: 2
		});
		expect(verdict).toBe('sweep');
		expect(posted).toBe(2);
		expect(swept).toBe(1);
		expect(sleeps).toEqual([1000]); // retry window between the tries
	});

	it('in-process + route unreachable then ok: retry recovers the host path', async () => {
		let posted = 0;
		let swept = 0;
		const verdict = await hostBounceDecision({
			mode: 'in-process',
			post: async () => {
				posted += 1;
				if (posted === 1) throw new Error('ECONNREFUSED');
				return true;
			},
			sweep: () => { swept += 1; },
			sleep: noSleep
		});
		expect(verdict).toBe('host');
		expect(swept).toBe(0);
	});

	it('the fallback sweep is AWAITED — the chain cannot exit under a re-serve', async () => {
		let done = false;
		const verdict = await hostBounceDecision({
			mode: 'build',
			post: async () => true,
			sweep: async () => {
				await new Promise((r) => setTimeout(r, 5));
				done = true;
			},
			sleep: noSleep
		});
		expect(verdict).toBe('sweep');
		expect(done).toBe(true);
	});
});

// ADR-0025 Wave 3 gate finding (2026-10-14): the bounce POST must reach the
// DSI (vite) route - the DSH host port fences it (401) or 404s. The port
// rides the floor's own env/command, never DSH_HOST_PORT.
describe('floorUiPort (ADR-0025 W3 - POST the vite port)', () => {
  it('PORT= in the floor env dump wins', () => {
    expect(floorUiPort({
      floorEnv: 'TERM=x PORT=6190 DSI_DEV_MODE=in-process',
      command: 'vite dev --port 5175'
    })).toBe(6190);
  });

  it('DSI_PORT= (2026-11-08 rename) beats legacy PORT= in the floor env dump', () => {
    expect(floorUiPort({
      floorEnv: 'TERM=x DSI_PORT=6191 PORT=6190 DSI_DEV_MODE=in-process',
      command: 'vite dev --port 5175'
    })).toBe(6191);
  });

  it('else --port from the vite command line', () => {
    expect(floorUiPort({
      floorEnv: 'TERM=x DSI_DEV_MODE=in-process',
      command: 'node vite.js dev --host 127.0.0.1 --port 5175'
    })).toBe(5175);
  });

  it('else the 5175 launcher default', () => {
    expect(floorUiPort({ floorEnv: '', command: '' })).toBe(5175);
    expect(floorUiPort()).toBe(5175);
  });

  it('partial reads fall through arm by arm', () => {
    expect(floorUiPort({ floorEnv: 'PORT=abc', command: '' })).toBe(5175);
    expect(floorUiPort({ floorEnv: 'no port here', command: 'vite --port 6190 extra' })).toBe(6190);
  });
});

// ADR-0025 Wave 3 gate finding (2026-10-14): pgrep -f went blind to the
// vite process on the live floor, so floor discovery moved to a ps -eo
// dump parsed by this pure twin.
describe('parseDevFloorPids (ADR-0025 W3 - ps-based floor discovery)', () => {
  const dump = [
    '  41939 /Users/wharsojo/.hermes/node/bin/node /Users/me/deepseek-insight/node_modules/vite/bin/vite.js dev --port 5175',
    '    399 /usr/libexec/logd',
    '    555 node /somewhere/else/server.js',
    '  42000 node /Users/me/deepseek-insight/node_modules/.bin/vite --version'
  ].join('\n');

  it('finds ONLY the real vite.js floor lines, pids as strings', () => {
    expect(parseDevFloorPids(dump)).toEqual(['41939']);
  });

  it('ignores .bin shims and lookalike paths', () => {
    expect(parseDevFloorPids('  9 node /x/node_modules/.bin/vite')).toEqual([]);
  });

  it('empty / failed dump yields no pids', () => {
    expect(parseDevFloorPids('')).toEqual([]);
    expect(parseDevFloorPids(undefined as unknown as string)).toEqual([]);
  });
});

// D4 amended (2026-10-14): the launch token has no preset seam (minted
// inside the host process), so the chain hands the operator the FRESH URL
// after an in-place bounce instead of pretending the old one survives.
describe('launchUrl + tokenFromSettings (D4 amended)', () => {
  it('builds the launch URL from port and token', () => {
    expect(launchUrl({ port: 3080, token: 'abc_-123' })).toBe('http://127.0.0.1:3080/?token=abc_-123');
    expect(launchUrl({ port: 4400, token: 'x', host: 'localhost' })).toBe('http://localhost:4400/?token=x');
  });

  it('empty token means no URL to hand over', () => {
    expect(launchUrl({ token: '' })).toBe('');
    expect(launchUrl()).toBe('');
  });

  it('reads authToken from the settings.yaml text', () => {
    expect(tokenFromSettings('dsh:\n  authToken: T0k-3n')).toBe('T0k-3n');

    expect(tokenFromSettings('dsh:\n  authToken: \"quoted\"')).toBe('quoted');
  });

  it('absent or empty settings yield no token', () => {
    expect(tokenFromSettings('')).toBe('');
    expect(tokenFromSettings('other: value')).toBe('');
  });
});
