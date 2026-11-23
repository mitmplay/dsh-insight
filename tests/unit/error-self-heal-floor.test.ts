import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { armSelfHeal, shouldSelfHeal } from '$lib/utils/error-self-heal';

/**
 * ADR-0075 — self-heal floor pins (src/lib/utils/error-self-heal.ts): the
 * two arms the sibling suite (tests/unit/error-page-self-heal.test.ts)
 * leaves untouched, because it ALWAYS injects `reload`.
 *
 *  - L23 default parameter `reload: () => void = () => location.reload()`
 *    — the PRODUCTION path: src/routes/+error.svelte:21 runs
 *    `$effect(() => armSelfHeal(page.status, dev))` with no third argument,
 *    so the default arm is what the operator's tab really runs. Pinned:
 *    armed with nothing injected, the page's OWN `location.reload` fires
 *    exactly once, at 1500ms — never at 1499ms, never twice — and the
 *    returned disarm (L27) still clears the pending shot.
 *  - L25 `return () => {}` — the no-op disarm handed back OUTSIDE the gate
 *    (non-500 status, or prod). The sibling only checks it is a function;
 *    pinned here: calling it is harmless and no timer ever existed.
 *
 * `location.reload` is spied with an empty implementation (restored after
 * each test) so the default arm runs for real without triggering
 * happy-dom's navigation.
 */
describe('error-page self-heal — the default-reload arm and the no-op disarm (ADR-0075 floor)', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.spyOn(location, 'reload').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.useRealTimers();
	});

	it('the default reload IS location.reload — armed with no third argument it fires once, at 1500ms', () => {
		const reload = vi.mocked(location.reload);
		// L23: the default arm evaluates because `reload` arrives undefined.
		const disarm = armSelfHeal(500, true);
		expect(disarm).toBeTypeOf('function');
		expect(vi.getTimerCount()).toBe(1);
		expect(reload).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1499);
		expect(reload).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(reload).toHaveBeenCalledTimes(1);
		expect(reload).toHaveBeenCalledWith(); // the browser signature: no arguments

		// One-shot: the timer is spent once it fired — a 500 page never loops.
		expect(vi.getTimerCount()).toBe(0);
		vi.advanceTimersByTime(5000);
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it('the default arm still hands back the live disarm — it cancels the pending location.reload', () => {
		const reload = vi.mocked(location.reload);
		const disarm = armSelfHeal(500, true);
		disarm();
		expect(vi.getTimerCount()).toBe(0);
		vi.advanceTimersByTime(5000);
		expect(reload).not.toHaveBeenCalled();
	});

	it('outside the gate the returned no-op disarm is callable and harmless — no timer ever existed', () => {
		const reload = vi.mocked(location.reload);
		for (const [status, dev] of [
			[404, true], // reaped session
			[503, true], // host down
			[409, true], // ownership
			[500, false] // prod: dead even for a 500
		] as const) {
			expect(shouldSelfHeal(status, dev)).toBe(false);
			const disarm = armSelfHeal(status, dev);
			// L25: the no-op — calling it must neither throw nor arm anything.
			expect(() => disarm()).not.toThrow();
		}
		expect(vi.getTimerCount()).toBe(0);
		vi.advanceTimersByTime(5000);
		expect(reload).not.toHaveBeenCalled();
	});
});
