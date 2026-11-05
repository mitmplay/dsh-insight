import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkHostLock, mountArgs, resolveLastUsedProfile } from '../../src/lib/server/browser/borrow.js';

function tmp(): string {
	return mkdtempSync(join(tmpdir(), 'dsi-borrow-'));
}

describe('resolveLastUsedProfile (task 1.1, migrated from the cancelled clone)', () => {
	it('resolves the last-used profile', () => {
		const root = tmp();
		try {
			writeFileSync(join(root, 'Local State'), JSON.stringify({ profile: { last_used: 'Profile 1' } }));
			mkdirSync(join(root, 'Profile 1'));
			expect(resolveLastUsedProfile(root)).toEqual({ profileKey: 'Profile 1', hostRoot: root });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('null on missing Local State / corrupt JSON / missing key / missing dir', () => {
		const root = tmp();
		try {
			expect(resolveLastUsedProfile(root)).toBeNull();
			writeFileSync(join(root, 'Local State'), '{oops');
			expect(resolveLastUsedProfile(root)).toBeNull();
			writeFileSync(join(root, 'Local State'), JSON.stringify({ profile: {} }));
			expect(resolveLastUsedProfile(root)).toBeNull();
			writeFileSync(join(root, 'Local State'), JSON.stringify({ profile: { last_used: 'Ghost' } }));
			expect(resolveLastUsedProfile(root)).toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe('checkHostLock (task 1.1, ADR-0047 D2)', () => {
	it('absent lock = free', () => {
		const root = tmp();
		try {
			expect(checkHostLock(root)).toEqual({ free: true });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('live pid = refuse', () => {
		const root = tmp();
		try {
			symlinkSync(process.pid + '_livehost', join(root, 'SingletonLock'));
			const v = checkHostLock(root);
			expect(v.free).toBe(false);
			expect(v.pid).toBe(process.pid);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('stale lock (dead pid) = free — a crashed Chrome left it behind', () => {
		const root = tmp();
		try {
			// a pid that cannot exist in this test process's view: use a huge number
			symlinkSync('2147483646_ghost', join(root, 'SingletonLock'));
			expect(checkHostLock(root)).toEqual({ free: true });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe('mountArgs (task 1.1, ADR-0047 D1)', () => {
	it('carries only the profile-directory arg — no park, no size, no extras', () => {
		expect(mountArgs('Profile 1')).toEqual(['--profile-directory=Profile 1']);
	});
});
