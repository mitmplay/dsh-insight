/**
 * borrow — The Borrowed Chrome's mount brain (ADR-0047, Proposed).
 *
 * Shift+Click mounts the operator's REAL Chrome profile: the glass Chrome
 * launches against the HOST Chrome root (--user-data-dir=<host root>) with
 * --profile-directory=<last-used key>. Nothing is copied; the cookies
 * decrypt because this is the place they live (the cancelled clone proved
 * the wall: Chrome 157 drops undecryptable cookies outside the original
 * instance — live probe 2026-11-05, ADR-0046 amendment).
 *
 * The borrow requires the daily Chrome to be QUIT: a held SingletonLock
 * means refuse with an honest verdict (DSI never force-quits Chrome —
 * ADR-0047 D2). A STALE lock (owning pid dead) is treated as free.
 */
import { existsSync, readFileSync, readlinkSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function defaultChromeRoot(): string {
	return join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
}

export interface LastUsedProfile {
	profileKey: string;
	hostRoot: string;
}

/** Migrated from the cancelled clone (ADR-0046 D1 kept): the host's own
 *  answer to "which profile is me right now". Null on anything missing. */
export function resolveLastUsedProfile(chromeRoot: string = defaultChromeRoot()): LastUsedProfile | null {
	try {
		const localStatePath = join(chromeRoot, 'Local State');
		if (!existsSync(localStatePath)) return null;
		const parsed = JSON.parse(readFileSync(localStatePath, 'utf8')) as {
			profile?: { last_used?: unknown };
		};
		const key = parsed.profile?.last_used;
		if (typeof key !== 'string' || key.length === 0) return null;
		const profileDir = join(chromeRoot, key);
		if (!existsSync(profileDir) || !statSync(profileDir).isDirectory()) return null;
		return { profileKey: key, hostRoot: chromeRoot };
	} catch {
		return null;
	}
}

export interface LockVerdict {
	free: boolean;
	/** The holding pid when the lock exists and its process is alive. */
	pid?: number;
}

/** ADR-0047 D2 — is the host Chrome root free to mount? The SingletonLock
 *  is a symlink whose content starts with the owning pid. Absent ⇒ free.
 *  Present but the pid is DEAD ⇒ a crashed Chrome left it behind ⇒ free.
 *  Present and alive ⇒ refuse honestly; DSI never force-quits. */
export function checkHostLock(chromeRoot: string = defaultChromeRoot()): LockVerdict {
	const lockPath = join(chromeRoot, 'SingletonLock');
	try {
		if (!existsSync(lockPath) && !readlinkExists(lockPath)) return { free: true };
		const content = readlinkSync(lockPath).toString();
		// Chromium lock formats observed live 2026-11-05: 'hostname-pid'
		// (modern, e.g. '192.168.1.9-474') and the legacy 'pid-hostname'.
		// Take the largest integer in the string — that is the pid in both.
		const numbers = content.match(/\d+/g) ?? [];
		const pid = Number(Math.max(...numbers.map(Number), 0));
		if (!Number.isFinite(pid) || pid <= 0) return { free: true };
		let alive = true;
		try {
			process.kill(pid, 0);
		} catch {
			alive = false;
		}
		return alive ? { free: false, pid } : { free: true };
	} catch {
		// unreadable lock state — treat as free; the launch itself is the truth
		return { free: true };
	}
}

function readlinkExists(path: string): boolean {
	try {
		readlinkSync(path);
		return true;
	} catch {
		return false;
	}
}

/** ADR-0047 D1/D3 — the mount launch args: the REAL root as user-data-dir
 *  (Chromium requires the profile inside its root) and the profile key.
 *  Deliberately NO off-screen park, NO fixed window size, NO automation
 *  extras beyond the registry's anti-fingerprint base — the OS window is
 *  the operator's own browsing window. */
export function mountArgs(profileKey: string): string[] {
	return ['--profile-directory=' + profileKey];
}
