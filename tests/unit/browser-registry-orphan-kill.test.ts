/**
 * Ghost Glass Fix 3 (RCA 2026-10-31, Bug 3): the boot-time profile sweep
 * deletes STALE profile DIRS — but a Chrome whose registry entry died
 * abnormally keeps RUNNING with a live CDP port forever (proven live:
 * PID 3462, port 9549, profile f0707132 deleted, process immortal).
 * The sweep grows a process-kill arm: before deleting a dir, find and
 * SIGKILL the Chrome holding it. Pure seams so no OS is needed in tests.
 */
import { describe, expect, it, vi } from 'vitest';

import { orphanChromePids, killOrphanChrome } from '../../src/lib/server/browser/registry.js';

const psOut = [
  '  3462 /Applications/Chrome --headless --user-data-dir=/x/.dsi/browser-profiles/f0707132 --remote-debugging-port=9549',
  '  40661 node bin/dev',
  '  5100 /Applications/Chrome --headless --user-data-dir=/x/.dsi/browser-profiles/aaaa1111 --remote-debugging-port=9400'
].join('\n');

describe('orphanChromePids (pure matcher)', () => {
	it('finds the Chrome holding the swept profile dir', () => {
		expect(orphanChromePids(psOut, 'f0707132')).toEqual([3462]);
	});

	it('does not match a PREFIX-sharing sibling profile', () => {
		// f070713 must not match f0707132's dir — the dir name is followed
		// by end-of-string or a path separator, never a mid-name substring
		expect(orphanChromePids(psOut, 'f070713')).toEqual([]);
		expect(orphanChromePids(psOut, 'aaaa')).toEqual([]);
	});

	it('returns every holder when several processes carry the dir', () => {
		const doubled = psOut + '\n  7001 helper --user-data-dir=/x/.dsi/browser-profiles/f0707132';
		expect(orphanChromePids(doubled, 'f0707132').sort()).toEqual([3462, 7001]);
	});

	it('answers empty for a profile nothing holds', () => {
		expect(orphanChromePids(psOut, 'deadbeef')).toEqual([]);
	});
});

describe('killOrphanChrome (injected-OS sweeper arm)', () => {
	it('SIGKILLs every holder before the dir is deleted', () => {
		const kill = vi.fn();
		killOrphanChrome('f0707132', {
			listPids: () => psOut,
			killPid: kill
		});
		expect(kill).toHaveBeenCalledTimes(1);
		expect(kill).toHaveBeenCalledWith(3462, 'SIGKILL');
	});

	it('a quiet profile means no kill attempt', () => {
		const kill = vi.fn();
		killOrphanChrome('deadbeef', { listPids: () => psOut, killPid: kill });
		expect(kill).not.toHaveBeenCalled();
	});

	it('a dead process (kill throws ESRCH) is swallowed — sweep stays best-effort', () => {
		const kill = vi.fn(() => {
			const e = new Error('ESRCH') as NodeJS.ErrnoException;
			e.code = 'ESRCH';
			throw e;
		});
		expect(() =>
			killOrphanChrome('f0707132', { listPids: () => psOut, killPid: kill })
		).not.toThrow();
		expect(kill).toHaveBeenCalledWith(3462, 'SIGKILL');
	});

	it('a failed ps listing is swallowed — the dir sweep still runs', () => {
		const kill = vi.fn();
		expect(() =>
			killOrphanChrome('f0707132', { listPids: () => { throw new Error('ps exploded'); }, killPid: kill })
		).not.toThrow();
		expect(kill).not.toHaveBeenCalled();
	});
});
