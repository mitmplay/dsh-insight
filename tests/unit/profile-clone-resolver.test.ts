import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveCloneSource } from '../../src/lib/server/browser/profile-clone.js';

function tmpRoot(): string {
	return mkdtempSync(join(tmpdir(), 'dsi-clone-resolver-'));
}

function seedRoot(root: string, localState: string, profileKey?: string): string {
	writeFileSync(join(root, 'Local State'), localState);
	if (profileKey) mkdirSync(join(root, profileKey), { recursive: true });
	return root;
}

describe('resolveCloneSource (task 1.1)', () => {
	it('resolves the last-used profile dir', () => {
		const root = tmpRoot();
		try {
			seedRoot(root, JSON.stringify({ profile: { last_used: 'Profile 1' } }), 'Profile 1');
			const src = resolveCloneSource(root);
			expect(src).toEqual({ profileKey: 'Profile 1', sourceDir: join(root, 'Profile 1') });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('returns null on missing Local State', () => {
		const root = tmpRoot();
		try {
			expect(resolveCloneSource(root)).toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('returns null on corrupt JSON', () => {
		const root = tmpRoot();
		try {
			seedRoot(root, '{not json');
			expect(resolveCloneSource(root)).toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('returns null on missing last_used key', () => {
		const root = tmpRoot();
		try {
			seedRoot(root, JSON.stringify({ profile: {} }));
			expect(resolveCloneSource(root)).toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('returns null when the named profile dir is missing', () => {
		const root = tmpRoot();
		try {
			seedRoot(root, JSON.stringify({ profile: { last_used: 'Profile 9' } }));
			expect(resolveCloneSource(root)).toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
