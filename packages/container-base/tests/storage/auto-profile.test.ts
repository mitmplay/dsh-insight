import { beforeEach, describe, expect, it } from 'vitest';
import { currentProfile, createPrefsStore } from '../../src/index';

/**
 * ADR-0065 R4 amendment — the base owns the profile READ: an omitted
 * profile auto-resolves from the URL's ?profile param via the namespace
 * resolver; an EXPLICIT value (including null = default desk) always
 * wins. This is the test that would have caught the deaf-playground
 * defect (RCA 2026-11-15, The Second Consumer That Never Read the
 * Address).
 */

const store = createPrefsStore<{ n: number }>({
	key: 'auto-profile-probe',
	defaults: () => ({ n: 0 }),
	revive: (raw) => {
		const rec = raw as { n?: unknown };
		return typeof rec.n === 'number' && Number.isFinite(rec.n) ? { n: rec.n } : null;
	}
});

function useUrl(search: string): void {
	window.history.replaceState(null, '', search);
}

beforeEach(() => {
	localStorage.clear();
	useUrl('/');
});

describe('auto-profile resolution (ADR-0065 R4 amendment)', () => {
	it('no ?profile param → the bare default-desk key', () => {
		expect(currentProfile()).toBeNull();
		store.save({ n: 1 });
		expect(localStorage.getItem('auto-profile-probe')).not.toBeNull();
		expect(localStorage.getItem('auto-profile-probe_wh')).toBeNull();
		expect(store.load().n).toBe(1);
	});

	it('?profile=wh → omitted profile writes and reads the SUFFIXED key', () => {
		useUrl('/?profile=wh');
		expect(currentProfile()).toBe('wh');
		store.save({ n: 7 }); // the app passes NOTHING — the base resolves
		expect(localStorage.getItem('auto-profile-probe_wh')).not.toBeNull();
		expect(localStorage.getItem('auto-profile-probe')).toBeNull();
		expect(store.load().n).toBe(7);
	});

	it('explicit profile wins over the URL', () => {
		useUrl('/?profile=wh');
		store.save({ n: 2 }, null); // explicit default desk
		expect(localStorage.getItem('auto-profile-probe')).not.toBeNull();
		expect(localStorage.getItem('auto-profile-probe_wh')).toBeNull();
	});

	it('junk profile param sanitizes to null → the bare key', () => {
		useUrl('/?profile=!!');
		expect(currentProfile()).toBeNull();
		store.save({ n: 3 });
		expect(localStorage.getItem('auto-profile-probe')).not.toBeNull();
	});

	it('key(profile) reflects the URL too', () => {
		useUrl('/?profile=wh');
		expect(store.key()).toBe('auto-profile-probe_wh');
		useUrl('/');
		expect(store.key()).toBe('auto-profile-probe');
	});
});
