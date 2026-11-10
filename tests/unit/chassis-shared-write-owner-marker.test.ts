/**
 * writeOwnerMarker — the Glass Chassis shared birth rule (chassis-shared.ts,
 * ADR-0054 D3). Plain vitest unit tests over node:fs tmp fixtures:
 * pins the marker filename (.dsi-owner.json), the JSON body contract
 * ({ pid, at }), the default pid = process.pid, the best-effort silent
 * failure on a nonexistent dir, and the idempotent overwrite.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { OWNER_MARKER, writeOwnerMarker } from '$lib/server/browser/chassis-shared';

const tmpDirs: string[] = [];

function makeTmpDir(): string {
	const dir = mkdtempSync(join(tmpdir(), 'dsi-owner-marker-'));
	tmpDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('writeOwnerMarker', () => {
	it('writes the marker file named .dsi-owner.json into the given dir with valid JSON', () => {
		const dir = makeTmpDir();
		writeOwnerMarker(dir, 4242);
		const raw = readFileSync(join(dir, OWNER_MARKER), 'utf8');
		expect(() => JSON.parse(raw)).not.toThrow();
	});

	it('JSON body has numeric pid equal to the passed pid and a numeric at timestamp', () => {
		const dir = makeTmpDir();
		writeOwnerMarker(dir, 12345);
		const body = JSON.parse(readFileSync(join(dir, OWNER_MARKER), 'utf8')) as { pid: unknown; at: unknown };
		expect(typeof body.pid).toBe('number');
		expect(body.pid).toBe(12345);
		expect(typeof body.at).toBe('number');
	});

	it('default pid equals process.pid when called without pid', () => {
		const dir = makeTmpDir();
		writeOwnerMarker(dir);
		const body = JSON.parse(readFileSync(join(dir, OWNER_MARKER), 'utf8')) as { pid: number };
		expect(body.pid).toBe(process.pid);
	});

	it('writing into a NONEXISTENT directory throws nothing and does not crash (best-effort)', () => {
		const dir = join(makeTmpDir(), 'does-not-exist');
		expect(() => writeOwnerMarker(dir, 7)).not.toThrow();
		expect(() => readFileSync(join(dir, OWNER_MARKER), 'utf8')).toThrow();
	});

	it('a second write overwrites cleanly (idempotent)', () => {
		const dir = makeTmpDir();
		writeOwnerMarker(dir, 111);
		writeOwnerMarker(dir, 222);
		const body = JSON.parse(readFileSync(join(dir, OWNER_MARKER), 'utf8')) as { pid: number };
		expect(body.pid).toBe(222);
	});
});
