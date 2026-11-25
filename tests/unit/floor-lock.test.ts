import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { acquireFloorLock, hostBootTime, parseBootTime, probeHolder, releaseFloorLock } from '../../bin/lib/floor-lock.mjs';

let dirs: string[] = [];
const newLockPath = () => {
	const dir = mkdtempSync(join(tmpdir(), 'floor-lock-'));
	dirs.push(dir);
	return join(dir, '.dsi-floor.lock');
};
afterEach(() => { dirs.forEach((d) => rmSync(d, { recursive: true, force: true })); dirs = []; });

describe('floor-lock (ADR-0082 D2)', () => {
	it('acquires on a free checkout and writes pid + boottime + startedAt', () => {
		const p = newLockPath();
		const receipt = acquireFloorLock(p, { pid: 4242, boottime: 1700000000, isAlive: () => true });
		expect(receipt).toMatchObject({ ok: true });
		const record = JSON.parse(readFileSync(p, 'utf8'));
		expect(record.pid).toBe(4242);
		expect(record.boottime).toBe(1700000000);
		expect(typeof record.startedAt).toBe('string');
	});

	it('refuses a second acquire on a live holder and names the holder pid', () => {
		const p = newLockPath();
		writeFileSync(p, JSON.stringify({ pid: 9001, boottime: 1700000000, startedAt: '2026-11-20T00:00:00Z' }));
		const lines: string[] = [];
		const receipt = acquireFloorLock(p, {
			pid: 4242, boottime: 1700000000, isAlive: () => true, allowShared: false,
			log: (l) => lines.push(l)
		});
		expect(receipt.ok).toBe(false);
		if (!receipt.ok) expect(receipt.holder).toBe(9001);
		// the spoken refusal carries the pid the operator must find
		expect(lines.join('\n')).toContain('9001');
		// the lock is untouched — the holder keeps it
		expect(JSON.parse(readFileSync(p, 'utf8')).pid).toBe(9001);
	});

	it('DSI_ALLOW_SHARED_CHECKOUT=1 warns and proceeds on a live holder', () => {
		const p = newLockPath();
		writeFileSync(p, JSON.stringify({ pid: 9001, boottime: 1700000000, startedAt: '2026-11-20T00:00:00Z' }));
		const lines: string[] = [];
		const receipt = acquireFloorLock(p, {
			pid: 4242, boottime: 1700000000, isAlive: () => true, allowShared: true,
			log: (l) => lines.push(l)
		});
		expect(receipt).toMatchObject({ ok: true, shared: true, holder: 9001 });
		expect(lines.join('\n')).toContain('WARNING');
	});

	it('breaks a stale lock (dead pid) with a receipt naming the prior holder', () => {
		const p = newLockPath();
		writeFileSync(p, JSON.stringify({ pid: 6655, boottime: 1700000000, startedAt: '2026-11-19T00:00:00Z' }));
		const lines: string[] = [];
		const receipt = acquireFloorLock(p, {
			pid: 4242, boottime: 1700000000, isAlive: () => false,
			log: (l) => lines.push(l)
		});
		expect(receipt).toMatchObject({ ok: true });
		expect((receipt as { stale?: { pid?: number } }).stale?.pid).toBe(6655);
		expect(JSON.parse(readFileSync(p, 'utf8')).pid).toBe(4242);
		expect(lines.join('\n')).toContain('6655');
	});

	it('breaks a lock whose boottime differs (reboot / pid reuse)', () => {
		const p = newLockPath();
		writeFileSync(p, JSON.stringify({ pid: 4242, boottime: 1111111111, startedAt: '2026-01-01T00:00:00Z' }));
		const receipt = acquireFloorLock(p, { pid: 4242, boottime: 1700000000, isAlive: () => true });
		// same pid as us → 'ours' takes precedence; use a foreign pid to test boottime staleness
		writeFileSync(p, JSON.stringify({ pid: 5151, boottime: 1111111111, startedAt: '2026-01-01T00:00:00Z' }));
		const stale = acquireFloorLock(p, { pid: 4242, boottime: 1700000000, isAlive: () => true });
		expect(stale.ok).toBe(true);
		expect(JSON.parse(readFileSync(p, 'utf8')).pid).toBe(4242);
	});

	it('release removes only OUR lock — a newer holder keeps theirs', () => {
		const p = newLockPath();
		writeFileSync(p, JSON.stringify({ pid: 4242, boottime: 1700000000, startedAt: 'x' }));
		expect(releaseFloorLock(p, { pid: 4242 })).toBe(true);
		expect(existsSync(p)).toBe(false);

		writeFileSync(p, JSON.stringify({ pid: 9001, boottime: 1700000000, startedAt: 'x' }));
		expect(releaseFloorLock(p, { pid: 4242 })).toBe(false);
		expect(existsSync(p)).toBe(true);
	});

	it('probeHolder verdicts: ours / alive / stale / malformed', () => {
		const alive = () => true;
		expect(probeHolder({ pid: 4242 }, { pid: 4242, boottime: 1, isAlive: alive })).toBe('ours');
		expect(probeHolder({ pid: 9, boottime: 1 }, { pid: 4242, boottime: 1, isAlive: alive })).toBe('alive');
		expect(probeHolder({ pid: 9, boottime: 1 }, { pid: 4242, boottime: 1, isAlive: () => false })).toBe('stale');
		expect(probeHolder({ pid: 9, boottime: 2 }, { pid: 4242, boottime: 1, isAlive: alive })).toBe('stale');
		expect(probeHolder({ nope: true }, { pid: 4242, boottime: 1, isAlive: alive })).toBe('malformed');
		expect(probeHolder(null, { pid: 4242, boottime: 1, isAlive: alive })).toBe('malformed');
	});
});

describe('boot time stamp (ADR-0082 D2, amendment 2026-11-25)', () => {
	it('reads the boot time as macOS prints it — `{ sec = N, usec = M } …` — and the compact form', () => {
		// verbatim `sysctl -n kern.boottime` output, read 2026-11-25 on this Mac
		expect(parseBootTime('{ sec = 1795529396, usec = 558632 } Tue Nov 24 22:09:56 2026\n')).toBe(1795529396);
		expect(parseBootTime('sec=1700000000')).toBe(1700000000);
		// `usec` alone is never mistaken for `sec`
		expect(parseBootTime('{ usec = 558632 }')).toBeNull();
		expect(parseBootTime('garbage')).toBeNull();
		expect(parseBootTime(undefined)).toBeNull();
	});

	it('the real probe returns the boot time on this Mac (the old pattern returned null here)', () => {
		if (process.platform !== 'darwin') return;
		const boot = hostBootTime();
		expect(Number.isInteger(boot) && (boot as number) > 1_600_000_000).toBe(true);
	});

	it('a lock written on this Mac therefore carries a boot time, so a pre-reboot lock breaks as stale', () => {
		if (process.platform !== 'darwin') return;
		const p = newLockPath();
		acquireFloorLock(p, { pid: 9001, isAlive: () => true }); // the real probe supplies boottime
		const record = JSON.parse(readFileSync(p, 'utf8'));
		expect(record.boottime).toBeGreaterThan(1_600_000_000);
		// after a reboot the boot time differs: the holder reads stale even with a live pid
		expect(probeHolder(record, { pid: 4242, boottime: record.boottime + 1, isAlive: () => true })).toBe('stale');
	});
});
