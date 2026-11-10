/**
 * chassis-shared readOwnerMarkerPid tests — the sweep's "sweepable" answer
 * (ADR-0054 D3): the marker's pid is returned only when the marker exists,
 * parses, and holds a numeric pid; every other shape (absent file, absent
 * dir, garbage text, string/missing pid, empty file) answers null so the
 * boot sweep treats the dir as orphaned.
 */
import { mkdtempSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OWNER_MARKER, readOwnerMarkerPid, writeOwnerMarker } from '../../src/lib/server/browser/chassis-shared';

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'dsi-owner-marker-'));
});

afterEach(() => {
	if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

describe('readOwnerMarkerPid', () => {
	it('returns the pid when the marker holds valid JSON with a numeric pid', () => {
		writeOwnerMarker(dir, 4242);
		expect(readOwnerMarkerPid(dir)).toBe(4242);
	});

	it('returns null when the marker is missing (dir exists, no marker)', () => {
		expect(readOwnerMarkerPid(dir)).toBeNull();
	});

	it('returns null when the directory itself does not exist', () => {
		expect(readOwnerMarkerPid(join(dir, 'nope'))).toBeNull();
	});

	it('returns null when the marker holds malformed JSON', () => {
		writeFileSync(join(dir, OWNER_MARKER), 'not json at all {{{');
		expect(readOwnerMarkerPid(dir)).toBeNull();
	});

	it('returns null when the marker is valid JSON but pid is a string or missing', () => {
		writeFileSync(join(dir, OWNER_MARKER), JSON.stringify({ pid: '1234', at: 1 }));
		expect(readOwnerMarkerPid(dir)).toBeNull();
		writeFileSync(join(dir, OWNER_MARKER), JSON.stringify({ at: 1 }));
		expect(readOwnerMarkerPid(dir)).toBeNull();
	});

	it('returns null when the marker is empty', () => {
		writeFileSync(join(dir, OWNER_MARKER), '');
		expect(readOwnerMarkerPid(dir)).toBeNull();
	});
});
