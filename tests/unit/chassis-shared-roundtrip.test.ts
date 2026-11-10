/**
 * Unit: chassis-shared roundtrip — the Glass Chassis SHARED birth rules
 * (ADR-0054 D3): the owner marker written by writeOwnerMarker is read
 * back by readOwnerMarkerPid (write→read roundtrip), a sibling sweep can
 * tell a LIVE session (marker present, pid read) from an orphan (no
 * marker → null), and disposableProfilePath + the marker together show
 * the documented first-8-chars collision: two ids sharing the same
 * prefix land in ONE dir whose marker is the LAST writer's pid.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	OWNER_MARKER,
	disposableProfilePath,
	writeOwnerMarker,
	readOwnerMarkerPid
} from '$lib/server/browser/chassis-shared';

const roots: string[] = [];

function tmpRoot(): string {
	const dir = mkdtempSync(join(tmpdir(), 'dsi-chassis-shared-'));
	roots.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of roots) rmSync(dir, { recursive: true, force: true });
	roots.length = 0;
});

describe('OWNER_MARKER roundtrip', () => {
	it('writeOwnerMarker(dir, 4242) then readOwnerMarkerPid(dir) === 4242', () => {
		const dir = tmpRoot();
		writeOwnerMarker(dir, 4242);
		expect(readOwnerMarkerPid(dir)).toBe(4242);
	});

	it('the marker lands at join(dir, OWNER_MARKER) — the exported constant is the shared contract', () => {
		const dir = tmpRoot();
		const markerPath = join(dir, OWNER_MARKER);
		expect(existsSync(markerPath)).toBe(false);
		writeOwnerMarker(dir, 7);
		expect(existsSync(markerPath)).toBe(true);
		expect(readOwnerMarkerPid(dir)).toBe(7);
	});

	it('a sibling sweep tells LIVE vs orphan: marker present → pid number, no marker → null', () => {
		const live = tmpRoot();
		const orphan = tmpRoot();
		writeOwnerMarker(live, process.pid);
		const livePid = readOwnerMarkerPid(live);
		expect(typeof livePid).toBe('number');
		expect(livePid).toBe(process.pid);
		expect(readOwnerMarkerPid(orphan)).toBeNull();
	});
});

describe('disposableProfilePath + writeOwnerMarker — the first-8-chars collision', () => {
	it('two 30-char ids sharing the same first 8 chars share ONE dir; the marker holds the LAST writer pid', () => {
		const root = tmpRoot();
		const prefix = 'sess2026';
		const idA = prefix + '-aaaaaaaaaaaaaaaaaaaaa'; // 30 chars total
		const idB = prefix + '-bbbbbbbbbbbbbbbbbbbbb';
		expect(idA).toHaveLength(30);
		expect(idB).toHaveLength(30);
		const dirA = disposableProfilePath(root, idA);
		const dirB = disposableProfilePath(root, idB);
		// the intentional collision: same dir by name
		expect(dirA).toBe(dirB);
		expect(dirA).toBe(join(root, prefix));

		mkdirSync(dirA, { recursive: true }); // the registry's open() creates the profile dir before the marker
		writeOwnerMarker(dirA, 111);
		writeOwnerMarker(dirB, 222); // last writer wins

		// ONE marker remains in the shared dir
		const markerPath = join(dirA, OWNER_MARKER);
		expect(existsSync(markerPath)).toBe(true);
		expect(readOwnerMarkerPid(dirA)).toBe(222);
		expect(readOwnerMarkerPid(dirB)).toBe(222);
		expect(existsSync(markerPath)).toBe(true);
	});
});
