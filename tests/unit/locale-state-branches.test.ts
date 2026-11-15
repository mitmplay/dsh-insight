/**
 * Locale-state branch edges — extends tests/unit/locale-state.test.ts (2.1-T)
 * to the arms the real paraglide runtime never takes in tests: a runtime
 * locale OUTSIDE the fleet, a runtime that THROWS (not ready), a tracked
 * state that fell out of the fleet, and an unavailable localStorage mirror
 * (private mode). getLocale/setLocale are mocked so each arm is forced
 * deterministically; the real cookie/localStorage runtime is pinned by the
 * sibling test instead.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getLocaleMock = vi.fn<() => string>();
const paraglideSetLocaleMock = vi.fn<(next: string) => Promise<void>>();

vi.mock('$lib/paraglide/runtime', () => ({
	getLocale: () => getLocaleMock(),
	setLocale: (next: string) => paraglideSetLocaleMock(next),
	localStorageKey: 'dsi.locale'
}));

import { currentLocale, setLocale, localeState, t } from '$lib/services/locale/locale-state.svelte';

beforeEach(() => {
	getLocaleMock.mockReset().mockReturnValue('en');
	paraglideSetLocaleMock.mockReset().mockResolvedValue(undefined);
	localStorage.clear();
});

describe('currentLocale — runtime arms', () => {
	it('runtime locale in fleet wins over tracked state', async () => {
		await setLocale('zh');
		getLocaleMock.mockReturnValue('id');
		expect(currentLocale()).toBe('id');
	});

	it('runtime locale OUTSIDE the fleet falls through to tracked state', async () => {
		await setLocale('id');
		getLocaleMock.mockReturnValue('fr' as never);
		expect(currentLocale()).toBe('id');
	});

	it('runtime locale outside fleet AND tracked state outside fleet → persisted choice surfaces (base-store arm, ADR-0063 D3)', async () => {
		await setLocale('id');
		// force tracked state out of the fleet — simulates a stale mirror
		const st = localeState() as { locale: unknown };
		st.locale = 'xx'; // deliberate corruption
		getLocaleMock.mockReturnValue('xx' as never);
		// the base store's read is the new fallback arm: the persisted choice is fleet-valid
		expect(currentLocale()).toBe('id');
	});

	it('runtime + tracked + persisted all unusable → DEFAULT (en)', async () => {
		await setLocale('id');
		const st = localeState() as { locale: unknown };
		st.locale = 'xx';
		getLocaleMock.mockReturnValue('xx' as never);
		localStorage.removeItem('dsi.locale'); // nothing valid anywhere
		document.cookie = 'dsi.locale=; path=/; max-age=0';
		expect(currentLocale()).toBe('en');
	});

	it('runtime THROWS (not ready) — caught, falls to tracked state', async () => {
		getLocaleMock.mockImplementation(() => {
			throw new Error('runtime not ready');
		});
		await setLocale('zh');
		expect(currentLocale()).toBe('zh');
	});
});

describe('setLocale — gate + persistence arms', () => {
	it('invalid locale never reaches the runtime (D3 gate arm)', async () => {
		// @ts-expect-error — out-of-fleet by design
		await setLocale('fr');
		expect(paraglideSetLocaleMock).not.toHaveBeenCalled();
		expect(localStorage.getItem('dsi.locale')).toBeNull();
	});

	it('localStorage.setItem throwing is swallowed — cookie still holds', async () => {
		const setItem = Storage.prototype.setItem;
		Storage.prototype.setItem = () => {
			throw new Error('quota / private mode');
		};
		try {
			await setLocale('id');
		} finally {
			Storage.prototype.setItem = setItem;
		}
		expect(paraglideSetLocaleMock).toHaveBeenCalled();
		expect(paraglideSetLocaleMock.mock.calls[0][0]).toBe('id');
		expect(localeState().locale).toBe('id');
	});
});

describe('t — translation seat arms', () => {
	it('runtime locale in fleet calls fn through the tracked path', () => {
		getLocaleMock.mockReturnValue('zh');
		expect(t(() => 'hello')).toBe('hello');
	});

	it('runtime locale outside fleet falls through to fn (default-resolves itself)', () => {
		getLocaleMock.mockReturnValue('xx' as never);
		expect(t(() => 'fallback')).toBe('fallback');
	});

	it('runtime THROWS — caught, fn still resolves', () => {
		getLocaleMock.mockImplementation(() => {
			throw new Error('runtime not ready');
		});
		expect(t(() => 'safe')).toBe('safe');
	});
});
