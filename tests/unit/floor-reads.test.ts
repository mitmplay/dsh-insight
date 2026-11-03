/**
 * floorReads unit tests — the floor's READ-side views, exercised through
 * the public getters and helper functions only. Every reactive dependency
 * (spine-feed, page-feeds, floor-registry) and every pure derivation
 * (lineage, panel-rows) is mocked; floorReads itself is plain
 * re-computation, so the tests pin the joins, not the runes.
 *
 * Imports a runes module chain (page-feeds/spine-feed are .svelte.ts) →
 * runs under the 'dom' project — deliberately NOT in serverOnlyTestFiles.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
	a2aRowsFor,
	agentFor,
	agentLabelFor,
	filePanelRoot,
	floorReads,
	panelParentFor,
	panelTitleFor,
	panelWorkspaceFor,
	seedColdOf
} from '../../src/lib/services/panels/floor-reads.svelte';

const { spineFeed } = vi.hoisted(() => ({
	spineFeed: {
		rows: [] as Array<Record<string, unknown>>,
		presets: [] as Array<Record<string, unknown>>,
		workspaces: {} as Record<string, string>,
		a2aRows: [] as Array<Record<string, unknown>>
	}
}));
const { pageFeeds } = vi.hoisted(() => ({
	pageFeeds: { coldCache: {} as Record<string, { title?: string | null; workspace?: string | null }>, deadSessions: {} as Record<string, string>, edgeCache: {} as Record<string, string> }
}));
const { floor } = vi.hoisted(() => ({
	floor: {
		panels: [] as Array<Record<string, unknown>>,
		drag: null as { widths: (number | undefined)[] } | null,
		widthBadgeFading: false,
		widthBadgeIds: [] as string[]
	}
}));
const sessionWorkspaceExplorer = vi.hoisted(() => vi.fn());
const deriveLineage = vi.hoisted(() => vi.fn(() => ({ lineage: 'facts' })));
const moveFactsFrom = vi.hoisted(() => vi.fn(() => ({ move: 'facts' })));
const panelRowsFor = vi.hoisted(() => vi.fn(() => [{ id: 'row-1' }]));
const rowFactsByPanelId = vi.hoisted(() => vi.fn(() => new Map([['row-1', { id: 'row-1' }]])));
const ghostPanelRowsFor = vi.hoisted(() => vi.fn(() => [{ id: 'ghost-1' }]));
const openSessionIdsOf = vi.hoisted(() => vi.fn(() => new Set<string>()));

vi.mock('$lib/services/conversation/spine-feed.svelte', () => ({ spineFeed }));
vi.mock('$lib/services/workspace/page-feeds.svelte', () => ({ pageFeeds }));
vi.mock('$lib/services/panels/floor-registry.svelte', () => ({ floor, sessionWorkspaceExplorer }));
vi.mock('$lib/services/lineage/lineage', () => ({ deriveLineage }));
vi.mock('$lib/services/lineage/lineage-move', () => ({ moveFactsFrom }));
vi.mock('$lib/services/panels/panel-rows', () => ({
	panelRowsFor,
	rowFactsByPanelId,
	ghostPanelRowsFor,
	openSessionIdsOf
}));

beforeEach(() => {
	vi.clearAllMocks();
	spineFeed.rows = [];
	spineFeed.presets = [];
	spineFeed.a2aRows = [];
	pageFeeds.coldCache = {};
	pageFeeds.edgeCache = {};
	floor.panels = [];
	floor.drag = null;
	floor.widthBadgeFading = false;
	floor.widthBadgeIds = [];
});

describe('floorReads spine getters', () => {
	it('spineRows/spinePresets/spineWorkspaces pass the spine singleton through', () => {
		spineFeed.rows = [{ sessionId: 's1', title: 'T' }];
		spineFeed.presets = [{ id: 'claude', name: 'Claude' }];

		expect(floorReads.spineRows).toEqual([{ sessionId: 's1', title: 'T' }]);
		expect(floorReads.spinePresets).toEqual([{ id: 'claude', name: 'Claude' }]);
		expect(floorReads.spineWorkspaces).toBe(spineFeed.workspaces);
	});

	it('spineTitles joins titles by sessionId', () => {
		spineFeed.rows = [
			{ sessionId: 's1', title: 'one' },
			{ sessionId: 's2', title: null }
		];
		expect(floorReads.spineTitles).toEqual({ s1: 'one', s2: null });
	});
});

describe('floorReads derivation getters', () => {
	it('conversationPanels keeps only conversation-kind panels', () => {
		floor.panels = [
			{ id: 'p1', kind: 'conversation' },
			{ id: 'p2', kind: 'manager' },
			{ id: 'p3', kind: 'conversation' }
		];
		expect(floorReads.conversationPanels.map((p) => p.id)).toEqual(['p1', 'p3']);
	});

	it('rowInputs assembles the full panel-rows input record', () => {
		floor.panels = [{ id: 'p1', kind: 'conversation' }];
		pageFeeds.coldCache['s1'] = { title: 't' };
		pageFeeds.deadSessions['gone'] = 'msg';
		pageFeeds.edgeCache['c1'] = 'p1';

		const input = floorReads.rowInputs;
		expect(input.panels).toEqual(floor.panels);
		expect(input.spineRows).toBe(floorReads.spineRows);
		expect(input.coldCache).toBe(pageFeeds.coldCache);
		expect(input.deadSessions).toBe(pageFeeds.deadSessions);
		expect(input.edgeCache).toBe(pageFeeds.edgeCache);
		expect(input.lineageFacts).toEqual({ lineage: 'facts' });
		expect(input.moveFacts).toEqual({ move: 'facts' });
	});

	it('panelRows / rowFactsByPanelId / ghostRows delegate to panel-rows', () => {
		floor.panels = [{ id: 'p1', kind: 'conversation' }];
		expect(floorReads.panelRows).toEqual([{ id: 'row-1' }]);
		expect(floorReads.rowFactsByPanelId.get('row-1')).toEqual({ id: 'row-1' });
		expect(floorReads.ghostRows).toEqual([{ id: 'ghost-1' }]);
	});

	it('badgeByPanelId marks live panels whose width left the drag snapshot', () => {
		floor.panels = [
			{ id: 'p1', width: 100 },
			{ id: 'p2', width: 200 }
		];
		floor.drag = { widths: [100, 999] };
		const map = floorReads.badgeByPanelId;
		expect(map.get('p1')).toBeUndefined();
		expect(map.get('p2')).toBe('live');
	});

	it('badgeByPanelId falls back to the fading afterglow ids when no drag runs', () => {
		floor.widthBadgeFading = true;
		floor.widthBadgeIds = ['p9'];
		const map = floorReads.badgeByPanelId;
		expect(map.get('p9')).toBe('fading');
		expect(map.size).toBe(1);
	});

	it('badgeByPanelId returns an empty map with no drag and no afterglow', () => {
		expect(floorReads.badgeByPanelId.size).toBe(0);
	});
});

describe('live panel helpers', () => {
	it('panelTitleFor prefers the spine row, falls back to the cold load', () => {
		spineFeed.rows = [{ sessionId: 's1', title: 'spine' }];
		pageFeeds.coldCache['s2'] = { title: 'cold' };
		expect(panelTitleFor('s1')).toBe('spine');
		expect(panelTitleFor('s2')).toBe('cold');
		expect(panelTitleFor('nope')).toBeNull();
	});

	it('panelWorkspaceFor uses the same spine-first merge', () => {
		spineFeed.rows = [{ sessionId: 's1', workspace: '/ws/spine' }];
		pageFeeds.coldCache['s2'] = { workspace: '/ws/cold' };
		expect(panelWorkspaceFor('s1')).toBe('/ws/spine');
		expect(panelWorkspaceFor('s2')).toBe('/ws/cold');
		expect(panelWorkspaceFor('nope')).toBeNull();
	});

	it('panelParentFor is spine-only plus the add-time edge cache', () => {
		spineFeed.rows = [{ sessionId: 's1', parentSessionId: 'p-spine' }];
		pageFeeds.edgeCache['c1'] = 'p-edge';
		expect(panelParentFor('s1')).toBe('p-spine');
		expect(panelParentFor('c1')).toBe('p-edge');
		expect(panelParentFor('nope')).toBeNull();
	});

	it('agentFor prefers the panel preset, falls back to the spine row', () => {
		spineFeed.rows = [{ sessionId: 's1', agentPreset: 'spine-agent' }];
		expect(agentFor({ sessionId: 's1', agentPreset: null } as never)).toBe('spine-agent');
		expect(agentFor({ sessionId: 's1', agentPreset: 'panel-agent' } as never)).toBe('panel-agent');
		expect(agentFor({ sessionId: 'none', agentPreset: null } as never)).toBeNull();
	});

	it('agentLabelFor maps the preset id to its display name, else the raw id', () => {
		spineFeed.rows = [{ sessionId: 's1', agentPreset: 'claude' }];
		spineFeed.presets = [{ id: 'claude', name: 'Claude Code' }];
		expect(agentLabelFor({ sessionId: 's1', agentPreset: null } as never)).toBe('Claude Code');
		expect(agentLabelFor({ sessionId: 's1', agentPreset: 'raw' } as never)).toBe('raw');
		expect(agentLabelFor({ sessionId: 'none', agentPreset: null } as never)).toBeNull();
	});

	it("a2aRowsFor keeps only the panel's own sender rows", () => {
		spineFeed.a2aRows = [
			{ fromSession: 's1', text: 'a' },
			{ fromSession: 's2', text: 'b' },
			{ fromSession: 's1', text: 'c' }
		];
		expect(a2aRowsFor('s1')).toEqual([
			{ fromSession: 's1', text: 'a' },
			{ fromSession: 's1', text: 'c' }
		]);
	});

	it('filePanelRoot prefers the open explorer root, else the workspace, else empty', () => {
		spineFeed.rows = [{ sessionId: 's1', workspace: '/ws/s1' }];
		sessionWorkspaceExplorer.mockReturnValueOnce({ root: '/explorer/root' });
		expect(filePanelRoot('s1')).toBe('/explorer/root');
		sessionWorkspaceExplorer.mockReturnValueOnce(undefined);
		expect(filePanelRoot('s1')).toBe('/ws/s1');
		sessionWorkspaceExplorer.mockReturnValueOnce(undefined);
		expect(filePanelRoot('nope')).toBe('');
	});
});

describe('seedColdOf', () => {
	it('validates and defaults a full server-load payload', () => {
		const cold = seedColdOf({ sessionId: 's1', entries: [{ seq: 1 }], lastSeq: 1 });
		expect(cold).toEqual({
			title: null,
			workspace: null,
			agentPreset: null,
			entries: [{ seq: 1 }],
			lastSeq: 1,
			running: false,
			hasMore: false,
			pendingAnswers: [],
			settledAnswers: [],
			permission: null,
			imageLimits: null,
			knobEvents: [],
			deliverables: []
		});
	});

	it('passes through the optional fields when present', () => {
		const cold = seedColdOf({
			sessionId: 's1',
			entries: [],
			title: 'T',
			workspace: '/ws',
			agentPreset: 'claude',
			running: true,
			hasMore: true
		});
		expect(cold).toMatchObject({
			title: 'T',
			workspace: '/ws',
			agentPreset: 'claude',
			running: true,
			hasMore: true
		});
	});

	it('rejects shapes without a sessionId or a real entries array', () => {
		expect(seedColdOf(undefined)).toBeUndefined();
		expect(seedColdOf({})).toBeUndefined();
		expect(seedColdOf({ sessionId: 's1' })).toBeUndefined();
		expect(seedColdOf({ sessionId: 's1', entries: 'not-an-array' })).toBeUndefined();
	});
});