import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { armSelfHeal, shouldSelfHeal } from '../../src/lib/utils/error-self-heal';

/**
 * ADR-0075 (2026-11-19) — the error-page self-heal gate: in dev ONLY a
 * 500 reloads itself once after 1500ms (the HMR rebuild window's 500 is
 * not a real failure). 404/503/409 and prod never reload, and the timer
 * is disarmable so a navigating user leaves no pending reload.
 */
describe('error-page self-heal gate (ADR-0075)', () => {
	it('gates on dev AND status 500 — nothing else reloads', () => {
		expect(shouldSelfHeal(500, true)).toBe(true);
		for (const status of [404, 503, 409, 200, 400, 502]) {
			expect(shouldSelfHeal(status, true)).toBe(false);
		}
		// prod: dead even for a 500
		expect(shouldSelfHeal(500, false)).toBe(false);
	});

	it('arms a 1500ms one-shot reload in dev on a 500', () => {
		vi.useFakeTimers();
		const reload = vi.fn();
		const disarm = armSelfHeal(500, true, reload);
		expect(reload).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1499);
		expect(reload).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(reload).toHaveBeenCalledTimes(1);
		disarm();
		vi.useRealTimers();
	});

	it('disarms clean — a navigating user leaves no pending reload', () => {
		vi.useFakeTimers();
		const reload = vi.fn();
		const disarm = armSelfHeal(500, true, reload);
		disarm();
		vi.advanceTimersByTime(5000);
		expect(reload).not.toHaveBeenCalled();
		vi.useRealTimers();
	});

	it('never arms outside the gate — no timer, no throw', () => {
		const reload = vi.fn();
		expect(armSelfHeal(404, true, reload)).toBeTypeOf('function');
		expect(armSelfHeal(500, false, reload)).toBeTypeOf('function');
	});
});
