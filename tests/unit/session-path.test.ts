/**
 * session-path resolver tests (Task 1.1-T, spec "2026-09-14 - The Session
 * Full Path") — the pure disk scan (ADR D2) over the REAL layout
 * `<root>/<projectDir>/<dir-for-id>`. Two naming generations are literal
 * candidates (RCA 2026-09-14: DSH format.ts:266 names the dir
 * `encodeSegment(id)` = bare UUID today; `session-<id>` is the legacy
 * generation still on disk): exact-name directory match, null on
 * miss/missing-root/error, FILE candidates ignored, unreadable project
 * dirs skipped. Temp roots per case — no encoding re-implementation.
 *
 * Node env (environmentMatchGlobs) — server-only module.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveSessionPath } from '$lib/server/session-path.js';

const dirs: string[] = [];

function tempRoot(): string {
	const dir = mkdtempSync(join(tmpdir(), 'dsi-session-path-'));
	dirs.push(dir);
	return dir;
}

afterEach(() => {
	// mkdtemp roots are self-contained; removing them keeps tmpdir lean.
	for (const dir of dirs.splice(0)) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {
			/* best effort */
		}
	}
});

describe('resolveSessionPath', () => {
	it('finds the CURRENT generation — bare-id directory (DSH format.ts:266)', async () => {
		const root = tempRoot();
		const project = join(root, '--Users-op-proj--');
		mkdirSync(join(project, 'abc-123'), { recursive: true });
		await expect(resolveSessionPath(root, 'abc-123')).resolves.toBe(join(project, 'abc-123'));
	});

	it('finds the LEGACY generation — session-<id> directory (still on disk)', async () => {
		const root = tempRoot();
		const project = join(root, '--Users-op-proj--');
		mkdirSync(join(project, 'session-abc-123'), { recursive: true });
		await expect(resolveSessionPath(root, 'abc-123')).resolves.toBe(
			join(project, 'session-abc-123')
		);
	});

	it('finds the session under ANY project dir without knowing the cwd', async () => {
		const root = tempRoot();
		mkdirSync(join(root, '--Users-op-other--'), { recursive: true });
		const project = join(root, '--Users-op-proj--');
		mkdirSync(join(project, 'abc-123'), { recursive: true });
		await expect(resolveSessionPath(root, 'abc-123')).resolves.toBe(join(project, 'abc-123'));
	});

	it('returns null when no project dir holds the id (either generation)', async () => {
		const root = tempRoot();
		mkdirSync(join(root, '--Users-op-proj--', 'session-other'), { recursive: true });
		mkdirSync(join(root, '--Users-op-proj--', 'other'), { recursive: true });
		await expect(resolveSessionPath(root, 'abc-123')).resolves.toBeNull();
	});

	it('returns null when the root is missing', async () => {
		await expect(resolveSessionPath(join(tempRoot(), 'nope'), 'abc-123')).resolves.toBeNull();
	});

	it('ignores a FILE named like a candidate (directory check, ADR pin)', async () => {
		const root = tempRoot();
		const project = join(root, '--Users-op-proj--');
		mkdirSync(project, { recursive: true });
		writeFileSync(join(project, 'abc-123'), 'not a directory', 'utf-8');
		writeFileSync(join(project, 'session-abc-123'), 'not a directory', 'utf-8');
		await expect(resolveSessionPath(root, 'abc-123')).resolves.toBeNull();
	});

	it('skips an unreadable project dir instead of failing the whole scan', async () => {
		const root = tempRoot();
		mkdirSync(join(root, '--Users-op-locked--'), { recursive: true });
		// A FILE where a project dir belongs: readdir on it throws — the
		// scan must continue to the next project, not return null outright.
		writeFileSync(join(root, 'not-a-dir'), 'x', 'utf-8');
		const project = join(root, '--Users-op-proj--');
		mkdirSync(join(project, 'abc-123'), { recursive: true });
		await expect(resolveSessionPath(root, 'abc-123')).resolves.toBe(join(project, 'abc-123'));
	});

	it('matches only exact names — no partial or prefix hits', async () => {
		const root = tempRoot();
		const project = join(root, '--Users-op-proj--');
		mkdirSync(join(project, 'abc-123-extra'), { recursive: true });
		mkdirSync(join(project, 'session-abc-123-extra'), { recursive: true });
		mkdirSync(join(project, 'prefix-abc-123'), { recursive: true });
		await expect(resolveSessionPath(root, 'abc-123')).resolves.toBeNull();
	});

	it('returns null when the ROOT is a file (top-level readdir throws)', async () => {
		// Distinct from the missing-root case: readdir resolves but rejects
		// with ENOTDIR — same top-level catch, same honest null.
		const root = tempRoot();
		writeFileSync(join(root, 'a-file-not-a-root'), 'x', 'utf-8');
		await expect(resolveSessionPath(join(root, 'a-file-not-a-root'), 'abc-123')).resolves.toBeNull();
	});

	it('skips a REAL directory unreadable by permission (EACCES inner catch)', async () => {
		const root = tempRoot();
		const locked = join(root, '--Users-op-locked--');
		mkdirSync(locked, { recursive: true });
		chmodSync(locked, 0o000); // readdir on it rejects — skip, keep scanning
		try {
			const project = join(root, '--Users-op-proj--');
			mkdirSync(join(project, 'abc-123'), { recursive: true });
			await expect(resolveSessionPath(root, 'abc-123')).resolves.toBe(join(project, 'abc-123'));
		} finally {
			chmodSync(locked, 0o755); // so afterEach's rmSync can reap it
		}
	});

	it('UUID-shaped id needs no encoding — literal name match (risk register)', async () => {
		const root = tempRoot();
		const id = '9f0c2e1a-4b3d-4e5f-8a7b-6c5d4e3f2a1b';
		mkdirSync(join(root, '--Users-op-proj--', id), { recursive: true });
		await expect(resolveSessionPath(root, id)).resolves.toBe(join(root, '--Users-op-proj--', id));
	});
});
