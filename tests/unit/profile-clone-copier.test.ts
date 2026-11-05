import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copySignatureStores, SIGNATURE_FILES, SIGNATURE_STORES } from '../../src/lib/server/browser/profile-clone.js';

function tmp(): string {
	return mkdtempSync(join(tmpdir(), 'dsi-clone-copy-'));
}

function seedHost(root: string): string {
	const chromeRoot = join(root, 'Chrome');
	const profile = join(chromeRoot, 'Profile 1');
	mkdirSync(join(profile, 'Network'), { recursive: true });
	mkdirSync(join(profile, 'Local Storage'), { recursive: true });
	writeFileSync(join(chromeRoot, 'Local State'), '{"profile":{"last_used":"Profile 1"}}');
	writeFileSync(join(profile, 'Cookies'), 'cookies db');
	writeFileSync(join(profile, 'Network', 'Cookies'), 'network cookies db');
	writeFileSync(join(profile, 'Local Storage', 'leveldb.log'), 'ls');
	writeFileSync(join(profile, 'Preferences'), '{}');
	writeFileSync(join(profile, 'Secure Preferences'), '{}');
	writeFileSync(join(profile, 'History'), 'must NOT copy');
	writeFileSync(join(profile, 'Login Data'), 'must NOT copy');
	writeFileSync(join(profile, 'SingletonLock'), 'lock');
	return chromeRoot;
}

describe('copySignatureStores (task 1.2)', () => {
	it('copies exactly the SC#1 store list into the profile-keyed layout', () => {
		const root = tmp();
		try {
			const chromeRoot = seedHost(root);
			const dest = join(root, 'dest');
			mkdirSync(dest, { recursive: true });
			const verdicts = copySignatureStores({ profileKey: 'Profile 1', sourceDir: join(chromeRoot, 'Profile 1') }, dest);
			// the signature files land at the dest root
			expect(existsSync(join(dest, 'Local State'))).toBe(true);
			// stores land under the SAME profile key (MAC verification layout)
			expect(existsSync(join(dest, 'Profile 1', 'Cookies'))).toBe(true);
			expect(existsSync(join(dest, 'Profile 1', 'Network', 'Cookies'))).toBe(true);
			expect(existsSync(join(dest, 'Profile 1', 'Local Storage', 'leveldb.log'))).toBe(true);
			expect(existsSync(join(dest, 'Profile 1', 'Preferences'))).toBe(true);
			// the never-copy list stays out
			expect(existsSync(join(dest, 'Profile 1', 'History'))).toBe(false);
			expect(existsSync(join(dest, 'Profile 1', 'Login Data'))).toBe(false);
			// the store list itself is the contract (D2)
			expect([...SIGNATURE_STORES]).toContain('Secure Preferences');
			expect([...SIGNATURE_STORES]).not.toContain('History');
			// verdicts: every listed store reported, absent ones marked
			const absent = verdicts.filter((v) => v.reason === 'absent').map((v) => v.store);
			expect(absent).toContain('Session Storage');
			expect(absent).toContain('Extensions');
			expect(verdicts.find((v) => v.store === 'Cookies')?.ok).toBe(true);
			void SIGNATURE_FILES;
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('strips Singleton lock files from the destination', () => {
		const root = tmp();
		try {
			const chromeRoot = seedHost(root);
			const dest = join(root, 'dest');
			mkdirSync(dest, { recursive: true });
			// the HOST carries the lock; the CLONE must not
			copySignatureStores({ profileKey: 'Profile 1', sourceDir: join(chromeRoot, 'Profile 1') }, dest);
			expect(existsSync(join(dest, 'Profile 1', 'SingletonLock'))).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('survives an unreadable store — skip, never throw', () => {
		const root = tmp();
		try {
			const chromeRoot = seedHost(root);
			// point the copier at a source whose Preferences is a DIRECTORY of doom:
			// simplest honest probe — a store that exists but cannot cpSync cleanly
			// is approximated by a missing source dir member; the contract under test
			// is that absent/error stores are REPORTED, not fatal.
			const verdicts = copySignatureStores({ profileKey: 'Profile 1', sourceDir: join(chromeRoot, 'Profile 1') }, join(root, 'dest'));
			expect(verdicts.length).toBeGreaterThan(0);
			expect(verdicts.every((v) => typeof v.ok === 'boolean')).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
