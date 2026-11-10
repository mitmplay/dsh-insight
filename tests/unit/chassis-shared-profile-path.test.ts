/**
 * Unit: chassis-shared disposableProfilePath / OWNER_MARKER — the rules
 * of birth (ADR-0054 D3): a profile dir is the FIRST 8 chars of the
 * session id, raw (dashes/dots included, never sanitized), so a host-born
 * glass and a local one are indistinguishable by name. Two different ids
 * sharing the first 8 chars collapse to the same path — the birth-name
 * collision is an INTENTIONAL house rule, not a bug.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { OWNER_MARKER, disposableProfilePath } from '$lib/server/browser/chassis-shared';

describe('disposableProfilePath', () => {
	it('joins profileRoot with the FIRST 8 chars of a uuid-like id', () => {
		const id = '9f2c81a7-3b4e-4d5f-8a90-1c2d3e4f5a6b'; // 36 chars
		expect(disposableProfilePath('/tmp/profiles', id)).toBe(join('/tmp/profiles', '9f2c81a7'));
	});

	it('maps an id of exactly 8 chars to itself', () => {
		expect(disposableProfilePath('/tmp/profiles', 'abcd1234')).toBe(join('/tmp/profiles', 'abcd1234'));
	});

	it('uses an id shorter than 8 chars whole, with no padding', () => {
		expect(disposableProfilePath('/tmp/profiles', 'ab')).toBe(join('/tmp/profiles', 'ab'));
	});

	it('slices on raw chars — dashes and dots are kept, not sanitized', () => {
		expect(disposableProfilePath('/tmp/profiles', 'a.b-c_d-e-f')).toBe(join('/tmp/profiles', 'a.b-c_d-'));
	});

	it('collapses two different ids sharing the first 8 chars to the same path (intentional birth-name collision)', () => {
		const a = disposableProfilePath('/tmp/profiles', 'deadbeef-one');
		const b = disposableProfilePath('/tmp/profiles', 'deadbeef-two');
		expect(a).toBe(b);
	});
});

describe('OWNER_MARKER', () => {
	it('is the fixed owner marker file name', () => {
		expect(OWNER_MARKER).toBe('.dsi-owner.json');
	});
});
