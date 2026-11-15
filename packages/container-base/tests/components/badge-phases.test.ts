import { describe, expect, it } from 'vitest';
import { liveBadgePhases, settleBadgePhases, BADGE_AFTERGLOW_MS } from '../../playground/src/lib/badge-phases';

/**
 * 2.1-T (WidthBadge Base Promotion, 2026-11-15) — the demo phase map
 * mirrors floor-reads badgeByPanelId: live while width differs from the
 * snapshot, fading through the 10s afterglow (BADGE_AFTERGLOW_MS must
 * equal the chip's own transition), then absent.
 */
describe('playground badge phase map (2.1-T)', () => {
	const ids = ['notes', 'scheduler', 'sessions'];

	it('live only for panes whose width differs from the snapshot', () => {
		const phases = liveBadgePhases(ids, [730, 810, 730], [730, 730, 730]);
		expect(phases).toEqual({ scheduler: 'live' });
	});

	it('empty when nothing moved', () => {
		expect(liveBadgePhases(ids, [730, 730, 730], [730, 730, 730])).toEqual({});
	});

	it('settle promotes exactly the live panes to fading', () => {
		const phases = liveBadgePhases(ids, [700, 810, 730], [730, 730, 730]);
		const fading = settleBadgePhases(phases);
		expect(fading).toEqual(['notes', 'scheduler']);
	});

	it('afterglow window matches the chip grammar (10s)', () => {
		expect(BADGE_AFTERGLOW_MS).toBe(10_000);
	});
});

/**
 * 2.3-T (WidthBadge Base Promotion sidebar scope, 2026-11-15) — the
 * sidebar badge rides the SAME helpers with a dedicated key ('pg-sidebar')
 * and its own snapshot pair; it never mixes into the pane map.
 */
describe('playground sidebar badge phase (2.3-T)', () => {
	const SIDEBAR_ID = 'pg-sidebar';

	it('live when the sidebar width deltas off its drag snapshot', () => {
		expect(liveBadgePhases([SIDEBAR_ID], [312], [260])).toEqual({ 'pg-sidebar': 'live' });
	});

	it('absent when the drag moved but returned to the snapshot width', () => {
		expect(liveBadgePhases([SIDEBAR_ID], [260], [260])).toEqual({});
	});

	it('settle promotes the live sidebar key to fading', () => {
		const phases = liveBadgePhases([SIDEBAR_ID], [402], [260]);
		expect(settleBadgePhases(phases)).toEqual([SIDEBAR_ID]);
	});

	it('fading persists through the same 10s afterglow window', () => {
		expect(BADGE_AFTERGLOW_MS).toBe(10_000);
	});
});
