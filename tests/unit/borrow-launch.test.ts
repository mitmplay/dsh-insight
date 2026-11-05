import { describe, expect, it } from 'vitest';
import { mountArgs } from '../../src/lib/server/browser/borrow.js';

// Task 1.2-T — the launch seam's PURE contract. The impure launch itself is
// pinned live (Wave 3, the real Chrome quit + mount).
describe('borrow mount args (task 1.2-T, ADR-0047 D1/D3)', () => {
	it('carries exactly the profile-directory arg — the user-data-dir is the HOST root passed by open()', () => {
		expect(mountArgs('Profile 1')).toEqual(['--profile-directory=Profile 1']);
		expect(mountArgs('Default')).toEqual(['--profile-directory=Default']);
	});
});
