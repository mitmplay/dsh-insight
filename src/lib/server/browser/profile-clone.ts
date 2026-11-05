/**
 * profile-clone — the Borrowed Signature's copy engine (ADR-0046, Proposed).
 *
 * Shift+Click asks the glass to launch AS the operator: this module reads the
 * host Chrome's Local State to find the LAST-USED profile, then copies the
 * SC#1 signature stores (cookies, local/session storage, the extension pack,
 * the signed preference set) into the fresh session dir. The ORIGINAL is
 * read-only for us — copy FROM, never mount, never write (ADR-0029 D5).
 *
 * Copy layout (ADR-0046 D2 + the launch note): the host's Local State lands
 * at the session dir root, the profile's stores land under
 * <sessionDir>/<profileKey>/ — the SAME key the host used — so Chromium's
 * Secure-Preferences MACs (keyed per profile key) verify and the extension
 * pack survives. open() must add --profile-directory=<key> to open the
 * cloned profile, not Default.
 *
 * Per-store BEST-EFFORT (karpathy Layer 2): a failed or mid-write store is
 * skipped and reported, never fails the open. Never copied: History, Login
 * Data, Web Data, caches (D2 — passwords and browsing history stay out of
 * an automation-owned dir).
 */
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** The host Chrome root — macOS today (the operator's host); other hosts
 *  are out of scope per the spec (karpathy Layer 1.6). */
export function defaultChromeRoot(): string {
	return join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome');
}

/** The SC#1 copy list (ADR-0046 D2, measured 2026-11-05). Files first,
 *  then dirs — 'Local State' resolves against the CHROME ROOT, everything
 *  else against the profile dir. */
export const SIGNATURE_FILES = ['Local State'] as const;
export const SIGNATURE_STORES = [
	'Cookies',
	'Network/Cookies',
	'Local Storage',
	'Session Storage',
	'Extensions',
	'Extension State',
	'Extension Rules',
	'Preferences',
	'Secure Preferences'
] as const;

/** Singleton lock files Chrome writes in a running profile — carried into a
 *  copy they make Chrome refuse to start. Always stripped (D2). */
const SINGLETON_GLOB = /^Singleton/;

export interface CloneSource {
	profileKey: string;
	sourceDir: string;
}

/** Task 1.1 — resolve the host's LAST-USED Chrome profile. Pure-ish: one
 *  Local State read, then a directory existence check. Returns null when
 *  anything is missing or malformed — the caller falls back to a clean
 *  launch (D1: the fallback is honest, never an error). */
export function resolveCloneSource(chromeRoot: string = defaultChromeRoot()): CloneSource | null {
	try {
		const localStatePath = join(chromeRoot, 'Local State');
		if (!existsSync(localStatePath)) return null;
		const parsed = JSON.parse(readFileSync(localStatePath, 'utf8')) as {
			profile?: { last_used?: unknown };
		};
		const key = parsed.profile?.last_used;
		if (typeof key !== 'string' || key.length === 0) return null;
		const sourceDir = join(chromeRoot, key);
		if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) return null;
		return { profileKey: key, sourceDir };
	} catch {
		// corrupt Local State, unreadable root — clean-launch fallback
		return null;
	}
}

export interface StoreVerdict {
	store: string;
	ok: boolean;
	/** 'absent' — the host profile simply lacks the store (e.g. no legacy
	 *  Cookies next to Network/Cookies); 'error' — the copy threw. */
	reason?: 'absent' | 'error';
}

/** Task 1.2 — copy the SC#1 signature stores into the session dir.
 *  Layout: SIGNATURE_FILES → destRoot; SIGNATURE_STORES → destRoot/<key>/.
 *  Singleton files are stripped from the destination afterwards. Per-store
 *  best-effort: one failing store never fails the copy. */
export function copySignatureStores(source: CloneSource, destRoot: string): StoreVerdict[] {
	const verdicts: StoreVerdict[] = [];
	const copyOne = (store: string, src: string, dest: string): void => {
		try {
			if (!existsSync(src)) {
				verdicts.push({ store, ok: false, reason: 'absent' });
				return;
			}
			cpSync(src, dest, { recursive: true });
			verdicts.push({ store, ok: true });
		} catch {
			// mid-write LevelDB, permission, disk-full — skip, never throw (D2)
			verdicts.push({ store, ok: false, reason: 'error' });
		}
	};

	for (const file of SIGNATURE_FILES) {
		copyOne(file, join(defaultChromeRootOf(source), file), join(destRoot, file));
	}
	for (const store of SIGNATURE_STORES) {
		copyOne(store, join(source.sourceDir, store), join(destRoot, source.profileKey, store));
	}

	// Singleton strip — destination only, glob-named, best-effort
	for (const dir of [destRoot, join(destRoot, source.profileKey)]) {
		try {
			if (!existsSync(dir)) continue;
			for (const name of readdirSync(dir)) {
				if (SINGLETON_GLOB.test(name)) {
					try {
						rmSync(join(dir, name), { recursive: true, force: true });
					} catch {
						// a stuck lock file must not fail the copy
					}
				}
			}
		} catch {
			// unreadable dest dir — nothing to strip
		}
	}
	return verdicts;
}

function defaultChromeRootOf(source: CloneSource): string {
	// SIGNATURE_FILES live at the chrome root; the root is the sourceDir's parent
	return join(source.sourceDir, '..');
}

/** Task 1.3 helper — the honest-launch identity map (ADR-0046 D3). A cloned
 *  profile IS a coherent identity on the same machine and IP: drop the
 *  spoofed userAgent/timezoneId/locale. A plain launch keeps today's spoofs. */
export function launchIdentityFor(clone: boolean): {
	userAgent?: string;
	timezoneId?: string;
	locale?: string;
} {
	if (clone) return {};
	return {
		userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
		timezoneId: 'America/New_York',
		locale: 'en-US'
	};
}
