// floor-lock.mjs — ADR-0082 (The Loud Floor) D2: ONE floor per checkout.
// A pid+boottime lockfile at the checkout root (.dsi-floor.lock) keeps a
// second floor from booting vite in the same folder — the co-tenant boot-sync
// that rewrote the shared svelte-kit generated root.svelte (evidence:
// dev/kb/rca/2026-11-20 - RCA — The Floor That Died Quietly.md). Content is
// JSON { pid, boottime, startedAt }; a holder whose pid is dead OR whose
// boottime differs (machine rebooted, pid reused) is STALE and is broken
// with a receipt, never a block. DSI_ALLOW_SHARED_CHECKOUT=1 is the
// deliberate scratch-floor bypass (PRD §4): warn and proceed.
//
// Pure decision layer with injectable edges (fs ops, liveness, log) so the
// unit tests pin every branch without spawning real floors.

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * The host's boot time as epoch SECONDS, or null when unknowable. macOS:
 * `sysctl -n kern.boottime` prints `{ sec = 1795529396, usec = 558632 } …`
 * (parsed by parseBootTime); Linux: /proc/stat's btime line. A null boottime
 * compares unequal to everything — with a live pid that means the lock still
 * holds (conservative: we never break a live holder's lock just because
 * boottime went missing). Amendment 2026-11-25: the first parser demanded
 * `sec=` with no spaces, so every macOS lock was written with a null
 * boottime and the boot-time arm of the stale-break never fired.
 * @returns {number | null}
 */
export function hostBootTime() {
	try {
		if (process.platform === 'darwin') {
			const out = execSync('sysctl -n kern.boottime', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
			return parseBootTime(out);
		}
		const stat = readFileSync('/proc/stat', 'utf8');
		const m = /^btime (\d+)$/m.exec(stat);
		return m ? Number(m[1]) : null;
	} catch {
		return null;
	}
}

/**
 * Boot-time seconds out of `sysctl -n kern.boottime` output. macOS prints
 * `{ sec = 1795529396, usec = 558632 } Tue Nov 24 22:09:56 2026` — spaces
 * around the `=` (read 2026-11-25); the compact `sec=1795529396` form is
 * accepted too. `usec` never matches (`\bsec`). Null when no sec is found.
 * @param {string | undefined} [output]
 * @returns {number | null}
 */
export function parseBootTime(output) {
	const m = /\bsec\s*=\s*(\d+)/.exec(output ?? '');
	return m ? Number(m[1]) : null;
}

/**
 * pid alive probe — signal 0 costs nothing and kills nothing.
 * @param {number} pid
 * @returns {boolean}
 */
export function pidAlive(pid) {
	try { process.kill(pid, 0); return true; } catch { return false; }
}

/** The verdict for a lock file's recorded holder:
 *  'ours'        — the recorded pid IS the calling pid (re-acquire: fine)
 *  'stale'       — pid dead, or boottime differs (reboot / pid reuse)
 *  'alive'       — pid alive with the same boottime: a live foreign floor
 *  'malformed'   — unreadable / unparseable content: break it, do not trust it
 *  @param {any} [record]
 *  @param {{ pid?: number, boottime?: number | null, isAlive?: (pid: number) => boolean }} [edges]
 *  @returns {'ours' | 'stale' | 'alive' | 'malformed'}
 */
export function probeHolder(record, { pid = process.pid, boottime = hostBootTime(), isAlive = pidAlive } = {}) {
	if (!record || !Number.isInteger(record.pid) || record.pid <= 0) return 'malformed';
	if (record.pid === pid) return 'ours';
	if (record.boottime !== undefined && record.boottime !== null && boottime !== null && record.boottime !== boottime) return 'stale';
	return isAlive(record.pid) ? 'alive' : 'stale';
}

/** Acquire the checkout lock. Returns a receipt:
 *  { ok: true }                    lock written, we hold it
 *  { ok: true, shared: true }      live holder present but env bypass consented
 *  { ok: true, stale: prior }      stale lock broken, prior recorded as receipt
 *  { ok: false, holder, holderBoottime }  live foreign floor — caller exits 64
 * Edges are injectable so tests run on a temp path with a fake liveness.
 * @param {string} lockPath
 * @param {{ pid?: number, boottime?: number | null, allowShared?: boolean, isAlive?: (pid: number) => boolean, exists?: (path: string) => boolean, read?: typeof readFileSync, write?: (path: string, data: string) => void, log?: (line: string) => void }} [edges]
 * @returns {{ ok: boolean, shared?: boolean, stale?: { pid: number, boottime?: number | null, startedAt?: string } | null, holder?: number, holderBoottime?: number | null }}
 */
export function acquireFloorLock(lockPath, {
	pid = process.pid,
	boottime = hostBootTime(),
	allowShared = process.env.DSI_ALLOW_SHARED_CHECKOUT === '1',
	isAlive = pidAlive,
	exists = existsSync,
	read = readFileSync,
	write = writeFileSync,
	log = (line) => console.log(line)
} = {}) {
	if (exists(lockPath)) {
		let record = null;
		try { record = JSON.parse(read(lockPath, 'utf8')); } catch { record = null; }
		const verdict = probeHolder(record, { pid, boottime, isAlive });
		if (verdict === 'ours') return { ok: true };
		if (verdict === 'alive') {
			if (allowShared) {
				log('dsi dsh: WARNING — another floor holds this checkout (pid ' + record.pid + ', started ' + (record.startedAt ?? 'unknown') + '); DSI_ALLOW_SHARED_CHECKOUT=1 — proceeding at your own risk of boot-sync clobber');
				return { ok: true, shared: true, holder: record.pid };
			}
			log('dsi dsh: this checkout already runs a floor (pid ' + record.pid + ', started ' + (record.startedAt ?? 'unknown') + ') — one floor per checkout; set DSI_ALLOW_SHARED_CHECKOUT=1 to override');
			return { ok: false, holder: record.pid, holderBoottime: record.boottime ?? null };
		}
		// 'stale' or 'malformed': break with a receipt — a dead pid or a
		// rebooted machine never blocks the floor.
		const reason = verdict === 'malformed' ? 'malformed content' : record && record.boottime !== boottime && boottime !== null && record.boottime != null ? 'holder boottime differs (reboot or pid reuse)' : 'pid is dead';
		log('dsi dsh: stale floor lock broken (holder pid ' + (record?.pid ?? '?') + ', ' + reason + ') — taking over');
		writeLock(lockPath, { pid, boottime, startedAt: new Date().toISOString() }, write);
		return { ok: true, stale: record ?? null };
	}
	writeLock(lockPath, { pid, boottime, startedAt: new Date().toISOString() }, write);
	return { ok: true };
}

/**
 * @param {string} lockPath
 * @param {{ pid: number, boottime: number | null, startedAt: string }} record
 * @param {(path: string, data: string) => void} write
 */
function writeLock(lockPath, record, write) {
	write(lockPath, JSON.stringify(record, null, '\t') + '\n');
}

/** Release the lock — ONLY if it is still ours. A shared-checkout bypass or
 *  a takeover by a newer floor means our unlink must not erase someone
 *  else's lock.
 *  @param {string} lockPath
 *  @param {{ pid?: number, exists?: (path: string) => boolean, read?: typeof readFileSync, remove?: (path: string) => void }} [edges]
 *  @returns {boolean}
 */
export function releaseFloorLock(lockPath, {
	pid = process.pid,
	exists = existsSync,
	read = readFileSync,
	remove = unlinkSync
} = {}) {
	if (!exists(lockPath)) return false;
	let record = null;
	try { record = JSON.parse(read(lockPath, 'utf8')); } catch { record = null; }
	if (!record || record.pid !== pid) return false;
	try { remove(lockPath); return true; } catch { return false; }
}
