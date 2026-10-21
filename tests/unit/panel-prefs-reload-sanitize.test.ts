/**
 * Reload blob sanitize (the Reload Rememberer ADR D3, shape pinned
 * 2026-09-23): the skill-shelf whitelist admits only a well-formed
 * loading (numeric startedAt) or an unexpired done (numeric startedAt
 * AND doneAt). Everything else — junk, the legacy `state`-keyed blob,
 * an expired done, a missing startedAt — clears to idle (null).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPanelPrefs, savePanelPrefs } from '$lib/utils/panel-prefs';

const T0 = 1_700_000_000_000;

function storedReload(reload: unknown): unknown {
	savePanelPrefs({
		panels: [{ id: 's', kind: 'skill-shelf', width: 480, reload } as never],
		selectedPanelId: 's',
		panelWidth: 730,
		zoom: 1
	});
	return (loadPanelPrefs().panels[0] as { reload: unknown }).reload;
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(T0);
	localStorage.clear();
});

afterEach(() => {
	vi.useRealTimers();
	localStorage.clear();
});

describe('reload blob sanitize — what survives the whitelist', () => {
describe('plugin-rack reload survival (The Plugin Rack ADR, 2026-09-27)', () => {
	it('a plugin-rack slot survives the blob with its tab; junk tab sanitizes to install', () => {
		savePanelPrefs({
			panels: [
				{ id: 'rack-1', kind: 'plugin-rack', width: 480, tab: 'uninstall' } as never,
				{ id: 'rack-2', kind: 'plugin-rack', width: 480, tab: 'bogus' } as never
			],
			selectedPanelId: 'rack-1',
			panelWidth: 730,
			zoom: 1
		});
		const panels = loadPanelPrefs().panels as Array<{ kind: string; id: string; tab?: string }>;
		const kept = panels.filter((p) => p.kind === 'plugin-rack');
		expect(kept.map((p) => p.id)).toEqual(['rack-1', 'rack-2']);
		expect(kept[0].tab).toBe('uninstall');
		expect(kept[1].tab).toBe('install');
	});
});

	it('a terminal slot survives the blob as a terminal (Surviving Shell D3 — the desk re-attaches)', () => {
		savePanelPrefs({
			panels: [{ id: 't-slot', kind: 'terminal', width: 460 } as never],
			selectedPanelId: 't-slot',
			panelWidth: 730,
			zoom: 1
		});
		const panel = loadPanelPrefs().panels[0] as { kind: string; id: string };
		expect(panel.kind).toBe('terminal');
		expect(panel.id).toBe('t-slot');
	});
	it('a well-formed loading survives with its startedAt', () => {
		expect(storedReload({ phase: 'loading', startedAt: T0 - 100 })).toEqual({
			phase: 'loading',
			startedAt: T0 - 100
		});
	});

	it('an unexpired done survives with startedAt and doneAt', () => {
		expect(
			storedReload({ phase: 'done', startedAt: T0 - 2_000, doneAt: T0 + 3_000 })
		).toEqual({ phase: 'done', startedAt: T0 - 2_000, doneAt: T0 + 3_000 });
	});

	it('an expired done falls to null', () => {
		expect(
			storedReload({ phase: 'done', startedAt: T0 - 9_000, doneAt: T0 - 1 })
		).toBeNull();
	});

	it('a done at the exact expiry boundary is expired', () => {
		expect(
			storedReload({ phase: 'done', startedAt: T0 - 5_000, doneAt: T0 })
		).toBeNull();
	});

	it('the legacy state-keyed blob falls to null (forward cleanup)', () => {
		expect(storedReload({ state: 'loading' })).toBeNull();
		expect(storedReload({ state: 'done', doneAt: T0 + 9_999 })).toBeNull();
	});

	it('a missing startedAt makes ANY phase fall to null', () => {
		expect(storedReload({ phase: 'loading' })).toBeNull();
		expect(storedReload({ phase: 'done', doneAt: T0 + 9_999 })).toBeNull();
	});

	it('junk shapes fall to null', () => {
		expect(storedReload(null)).toBeNull();
		expect(storedReload(undefined)).toBeNull();
		expect(storedReload('loading')).toBeNull();
		expect(storedReload(42)).toBeNull();
		expect(storedReload({ phase: 'idle', startedAt: T0 })).toBeNull();
	});
});

describe('terminal desk mirror sanitize (Terminal Desk ADR D3, Wave 3 — task 3.1-T)', () => {
	function storedDesk(desk: unknown): unknown {
		savePanelPrefs({
			panels: [{ id: 't', kind: 'terminal', width: 460, desk } as never],
			selectedPanelId: 't',
			panelWidth: 730,
			zoom: 1
		});
		return (loadPanelPrefs().panels[0] as { desk: unknown }).desk;
	}

	it('a well-formed mirror survives: tabs, sessionIds, selectedTab', () => {
		expect(
			storedDesk({ tabs: [{ sessionIds: ['a', 'b'] }, { sessionIds: ['c'] }], selectedTab: 1 })
		).toEqual({ tabs: [{ sessionIds: ['a', 'b'] }, { sessionIds: ['c'] }], selectedTab: 1 });
	});

	it('selectedTab clamps into range; junk sessionIds members drop', () => {
		// D5 amendment: maxIndex = tabs.length + jobs.length — a stored index may
		// point at the rebuilt follow tab, so 9 clamps to 2 on a 2-tab mirror.
		expect(
			storedDesk({ tabs: [{ sessionIds: ['a'] }, { sessionIds: ['b'] }], selectedTab: 9 })
		).toEqual({ tabs: [{ sessionIds: ['a'] }, { sessionIds: ['b'] }], selectedTab: 2 });
		expect(
			storedDesk({ tabs: [{ sessionIds: ['a', 42, null, ''] }], selectedTab: 0 })
		).toEqual({ tabs: [{ sessionIds: ['a'] }], selectedTab: 0 });
	});

	it('empty/junk tabs drop; all tabs gone ⇒ the whole mirror drops (fresh-desk fallback)', () => {
		expect(storedDesk({ tabs: [{ sessionIds: [] }], selectedTab: 0 })).toBeUndefined();
		expect(storedDesk({ tabs: 'nope', selectedTab: 0 })).toBeUndefined();
		expect(storedDesk('nope')).toBeUndefined();
		expect(storedDesk(undefined)).toBeUndefined();
	});
});

