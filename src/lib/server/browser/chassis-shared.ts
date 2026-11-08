/**
 * Glass Chassis SHARED birth rules (ADR-0054 D3 / spec 2026-11-08 Glass
 * Chassis Remote CDP task 1.2): the ONE copy of the rules of birth —
 * disposable-profile dir naming, the owner marker, and the pid-of-port
 * probe. Imported by BOTH registry.ts (local births) and bin/dsi-chassis.mjs
 * (the host companion births) so the machine boundary never forks the
 * house rules. Plain typed ESM over node: builtins only — the companion
 * is executed by plain `node`, which strips these types natively
 * (Node >= 23.6), so no build step sits between the two consumers.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The owner marker file name (fix 2026-11-05): written into every
 *  profile dir so a sibling process's boot sweep can tell a LIVE session
 *  from an orphan (registry.foreignLiveOwner). */
export const OWNER_MARKER = '.dsi-owner.json';

/** The disposable profile dir for session id `id` under the root: the
 *  first 8 id chars, exactly the naming registry.open() has always used —
 *  a host-born glass and a local one are indistinguishable by name. */
export function disposableProfilePath(profileRoot: string, id: string): string {
	return join(profileRoot, id.slice(0, 8));
}

/** Write the owner marker (best-effort): lets the creating process's pid
 *  be seen across processes. A failed write must never fail the open —
 *  a missing marker just sweeps like any legacy leftover. */
export function writeOwnerMarker(profileDir: string, pid: number = process.pid): void {
	try {
		writeFileSync(join(profileDir, OWNER_MARKER), JSON.stringify({ pid, at: Date.now() }));
	} catch {
		// marker write must never fail the open
	}
}

/** Read the marker's owner pid, or null when absent/unreadable/malformed
 *  (the sweep's "sweepable" answer). */
export function readOwnerMarkerPid(dir: string): number | null {
	try {
		const pid = (JSON.parse(readFileSync(join(dir, OWNER_MARKER), 'utf8')) as { pid?: number }).pid;
		return typeof pid === 'number' ? pid : null;
	} catch {
		return null;
	}
}

/** The pid holding a LISTENING tcp port (lsof), or null — the same probe
 *  registry.open() uses to recover the browser pid persistent contexts do
 *  not expose, and the companion uses to report its births. */
export function pidOfPort(port: number): number | null {
	const p = spawnSync('lsof', ['-ti', 'tcp:' + port, '-sTCP:LISTEN'], { stdio: 'pipe' });
	return p.status === 0 ? Number(p.stdout.toString().trim().split('\n')[0]) : null;
}
