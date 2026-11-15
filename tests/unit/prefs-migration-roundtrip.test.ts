import { beforeEach, describe, expect, it } from 'vitest';
import { loadSchedulerPrefs, saveSchedulerPrefs, SCHEDULER_PREFS_KEY } from '../../src/lib/utils/scheduler-prefs';
import { loadSessionFilter, saveSessionFilter } from '../../src/lib/utils/session-filter-prefs';
import { loadSpineGroupPrefs, saveSpineGroupPrefs } from '../../src/lib/utils/spine-group-prefs';
import { loadTagFilter, saveTagFilter } from '../../src/lib/utils/prompt-tag-prefs';
import { loadDraft, saveDraft } from '../../src/lib/utils/draft-prefs';

/**
 * W6 6.1-T (ADR-0063 D6) — migration round-trips: the stored blob format
 * and key grammar are UNCHANGED by the createPrefsStore cutover. Legacy
 * (hand-written by the old modules) blobs must read verbatim; junk must
 * still fall to defaults; writes must stay byte-identical in shape.
 * The draft module stays hand-rolled by operator decision (per-session
 * keys + prune are outside the store contract) — its round-trip is here
 * as the regression witness.
 */
const storageKeyFor = (base: string, profile?: string | null): string => (profile ? base + '_' + profile : base);

beforeEach(() => {
	localStorage.clear();
	document.cookie = 'dsi.locale=; path=/; max-age=0';
});

describe('scheduler-prefs round-trip (D6)', () => {
	it('legacy blob written by the hand-rolled module reads verbatim', () => {
		localStorage.setItem(SCHEDULER_PREFS_KEY, JSON.stringify({ collapsed: false, nameFilter: 'abc', dateFilter: '', viewMode: 'delivered' }));
		const prefs = loadSchedulerPrefs();
		expect(prefs).toEqual({ collapsed: false, nameFilter: 'abc', dateFilter: '', viewMode: 'delivered' });
	});

	it('junk fields fall back per field (old fold-only blob included)', () => {
		localStorage.setItem(SCHEDULER_PREFS_KEY, JSON.stringify({ collapsed: true }));
		expect(loadSchedulerPrefs()).toEqual({ collapsed: true, nameFilter: '', dateFilter: '', viewMode: 'all' });
		localStorage.setItem(SCHEDULER_PREFS_KEY, '{junk');
		expect(loadSchedulerPrefs().collapsed).toBe(true);
	});

	it('a save via the store is byte-identical in shape to the legacy write', () => {
		saveSchedulerPrefs({ collapsed: false, nameFilter: 'x', dateFilter: '2026-01-01', viewMode: 'scheduled' });
		expect(JSON.parse(localStorage.getItem(SCHEDULER_PREFS_KEY) ?? '')).toEqual({
			collapsed: false,
			nameFilter: 'x',
			dateFilter: '2026-01-01',
			viewMode: 'scheduled'
		});
	});
});

describe('session-filter-prefs round-trip (D6)', () => {
	it('legacy blob reads verbatim; legacy dsi-blank-mode fallback survives', () => {
		localStorage.setItem('dsi-session-filter', JSON.stringify({ workspace: '/w', preset: null, blankMode: 'any' }));
		localStorage.setItem('dsi-blank-mode', 'true');
		const f = loadSessionFilter();
		expect(f.workspace).toBe('/w');
		expect(f.preset).toBeNull();
		expect(f.blankMode).toBe('any');
	});

	it('absent blob: blankMode consults the legacy key before the default', () => {
		localStorage.setItem('dsi-blank-mode', 'true');
		// isBlankMode(true) resolves to the nonempty-conversations mode
		expect(loadSessionFilter().blankMode).toBe('nonempty');
	});

	it('save keeps the one-blob shape; the legacy key is never written', () => {
		saveSessionFilter({ workspace: null, preset: 'p1', blankMode: 'any' });
		expect(JSON.parse(localStorage.getItem('dsi-session-filter') ?? '')).toEqual({ workspace: null, preset: 'p1', blankMode: 'any' });
		expect(localStorage.getItem('dsi-blank-mode')).toBeNull();
	});
});

describe('spine-group-prefs round-trip (D6)', () => {
	it('legacy blob reads verbatim; explicit-false fields stay false', () => {
		localStorage.setItem('dsi-spine-group', JSON.stringify({ collapsed: true, nameFilter: 'q', subagentsHidden: false, dateFilter: '2026-02-02' }));
		expect(loadSpineGroupPrefs()).toEqual({ collapsed: true, nameFilter: 'q', subagentsHidden: false, dateFilter: '2026-02-02' });
	});

	it('junk shape falls to defaults (expanded, unfiltered)', () => {
		localStorage.setItem('dsi-spine-group', '[]');
		expect(loadSpineGroupPrefs()).toEqual({ collapsed: false, nameFilter: '', subagentsHidden: false, dateFilter: '' });
	});

	it('profile-suffixed keys are written and read unchanged', () => {
		saveSpineGroupPrefs({ collapsed: true, nameFilter: '', subagentsHidden: true, dateFilter: '' }, 'widi');
		expect(localStorage.getItem('dsi-spine-group_widi')).not.toBeNull();
		expect(localStorage.getItem('dsi-spine-group')).toBeNull();
		expect(loadSpineGroupPrefs('widi').subagentsHidden).toBe(true);
	});
});

describe('prompt-tag-prefs round-trip (D6)', () => {
	it('legacy array blob reads verbatim (lowercased, valid, deduped)', () => {
		localStorage.setItem('dsi-prompt-tags-filter', JSON.stringify(['Run', 'run', 'BAD WORD!', 'fix']));
		expect(loadTagFilter('dsi-prompt-tags-filter')).toEqual(['run', 'fix']);
	});

	it('junk shapes fall to []', () => {
		localStorage.setItem('dsi-strip-tags-filter', '{"not":"an array"}');
		expect(loadTagFilter('dsi-strip-tags-filter')).toEqual([]);
	});

	it('save keeps the bare-array blob shape per desk base', () => {
		saveTagFilter('dsi-strip-tags-filter', ['a', 'b']);
		expect(JSON.parse(localStorage.getItem('dsi-strip-tags-filter') ?? '')).toEqual(['a', 'b']);
		expect(localStorage.getItem('dsi-prompt-tags-filter')).toBeNull();
	});
});

describe('draft-prefs — hand-rolled by operator decision, regression witness (D6)', () => {
	it('per-session key grammar and prune semantics unchanged', () => {
		saveDraft('local:abc', 'hello', true);
		expect(localStorage.getItem('dsi-draft_local:abc')).not.toBeNull();
		expect(loadDraft('local:abc')).toEqual({ text: 'hello', focused: true });
		localStorage.setItem('dsi-draft_local:old', JSON.stringify({ text: 'x', focused: false, ts: 1 }));
		for (let i = 0; i < 25; i++) saveDraft('local:s' + i, 't', false);
		expect(localStorage.getItem('dsi-draft_local:old')).toBeNull(); // pruned
	});
});