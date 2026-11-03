/**
 * Sidebar badge phase machine (Movable Rail ADR amendment 2026-10-30):
 * pagePrefs.sidebarBadge — live at drag start, fading at mouseup,
 * null after the 10s afterglow; a re-drag cancels the afterglow.
 * The phase is NEVER persisted (saveSidebarPrefs whitelist untouched).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function freshPagePrefs() {
	vi.resetModules();
	return (await import('$lib/services/workspace/page-prefs.svelte')).pagePrefs;
}

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

describe('pagePrefs.sidebarBadge — the afterglow machine', () => {
	it('starts null (no badge before any gesture)', async () => {
		const pp = await freshPagePrefs();
		expect(pp.sidebarBadge).toBeNull();
	});

	it('drag start → live; mouseup → fading; 10s → null', async () => {
		const pp = await freshPagePrefs();
		pp.cancelSidebarAfterglow();
		expect(pp.sidebarBadge).toBe('live');
		pp.armSidebarAfterglow();
		expect(pp.sidebarBadge).toBe('fading');
		vi.advanceTimersByTime(9_999);
		expect(pp.sidebarBadge).toBe('fading');
		vi.advanceTimersByTime(1);
		expect(pp.sidebarBadge).toBeNull();
	});

	it('a re-drag during the afterglow cancels the timer and goes live', async () => {
		const pp = await freshPagePrefs();
		pp.armSidebarAfterglow();
		vi.advanceTimersByTime(5_000);
		pp.cancelSidebarAfterglow();
		expect(pp.sidebarBadge).toBe('live');
		vi.advanceTimersByTime(10_000);
		// the cancelled timer must not have fired
		expect(pp.sidebarBadge).toBe('live');
	});

	it('an afterglow timer is not doubled by a second mouseup', async () => {
		const pp = await freshPagePrefs();
		pp.armSidebarAfterglow();
		pp.armSidebarAfterglow();
		vi.advanceTimersByTime(10_000);
		expect(pp.sidebarBadge).toBeNull();
	});
});
