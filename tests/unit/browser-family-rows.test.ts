import { describe, expect, it } from 'vitest';
import { deriveLineage, familyRenderOrder } from '$lib/services/lineage/lineage';
import { moveFactsFrom, movePanelLineage, blockBounds } from '$lib/services/lineage/lineage-move';
import { ghostPanelRowsFor, panelRowsFor } from '$lib/services/panels/panel-rows';
import type { DsiConversationPanel, DsiPanelEntry, DsiSessionSummary } from '$lib/types';

/**
 * ADR-0036 Amendment 2: the glass is family, not furniture — the roster
 * row paints the sub-agent lineage costume (parent edge = openedBy, depth
 * one below the opener, no positional verbs) and the glass TRAVELS with
 * the opener's family block (the doc-tail pattern in lineage-move).
 */

function row(sessionId: string, over: Partial<DsiSessionSummary> = {}): DsiSessionSummary {
	return {
		sessionId,
		title: `Session ${sessionId}`,
		agentPreset: null,
		running: false,
		blank: false,
		updatedAt: 0,
		workspace: '/tmp/w',
		turns: null,
		...over
	};
}

function conv(id: string, sessionId: string): DsiConversationPanel {
	return { id, kind: 'conversation', sessionId, agentPreset: null, width: 480 };
}

function glass(id: string, openedBy?: string): DsiPanelEntry {
	return { id, kind: 'browser', width: 480, ...(openedBy !== undefined ? { openedBy } : {}) };
}

function factsFor(panels: DsiPanelEntry[], childrenOf: Record<string, string[]>) {
	const rows: DsiSessionSummary[] = [];
	for (const p of panels) {
		if (p.kind !== 'conversation') continue;
		rows.push(row(p.sessionId));
	}
	for (const [parent, kids] of Object.entries(childrenOf)) {
		for (const kid of kids) rows.push(row(kid, { parentSessionId: parent, origin: 'subagent' }));
	}
	const lineage = deriveLineage(rows, panels.filter((p): p is DsiConversationPanel => p.kind === 'conversation'));
	return { lineage, moveFacts: moveFactsFrom(lineage, new Set(rows.map((r) => r.sessionId))) };
}

describe('browser roster row paints the lineage costume (Amendment 2)', () => {
	const panels: DsiPanelEntry[] = [conv('p1', 'sess-a'), glass('pb', 'sess-a')];
	const rowsInput = {
		panels,
		spineRows: [row('sess-a')],
		coldCache: {},
		deadSessions: {},
		edgeCache: {},
		...(() => { const f = factsFor(panels, {}); return { lineageFacts: f.lineage, moveFacts: f.moveFacts }; })()
	};
	const rows = panelRowsFor(rowsInput as never);
	const browserRow = rows.find((r) => r.panel.id === 'pb')!;

	it('parent edge is the opener', () => {
		expect(browserRow.parentSessionId).toBe('sess-a');
	});

	it('depth is one below the opener (the sub-agent costume)', () => {
		expect(browserRow.depth).toBe(1);
	});

	it('no positional verbs — the glass travels with the family', () => {
		expect(browserRow.canMoveUp).toBe(false);
		expect(browserRow.canMoveDown).toBe(false);
	});

	it('a provenance-less glass (ControlBar open) degrades to a plain row', () => {
		const plain = panelRowsFor({
			...rowsInput,
			panels: [conv('p1', 'sess-a'), glass('pb2')]
		} as never).find((r) => r.panel.id === 'pb2')!;
		expect(plain.depth).toBe(0);
		expect(plain.parentSessionId).toBeNull();
	});
});

describe('the glass travels with the family block (Amendment 2)', () => {
	const panels: DsiPanelEntry[] = [
		conv('p1', 'sess-a'),
		conv('p2', 'sess-sub'),
		glass('pb', 'sess-a'),
		conv('p3', 'sess-b')
	];
	const { lineage, moveFacts } = factsFor(panels, { 'sess-a': ['sess-sub'] });
	void lineage;

	it('moving the main agent DOWN carries the glass (order: A sub glass | B)', () => {
		const next = movePanelLineage(panels, 'p1', 'down', moveFacts);
		expect(next).not.toBeNull();
		expect(idOf(next!)).toEqual(['sess-b', 'sess-a', 'sess-sub', 'pb']);
	});

	it('moving the main agent UP back restores it above the glass', () => {
		const moved = movePanelLineage(panels, 'p1', 'down', moveFacts)!;
		const back = movePanelLineage(moved, 'p1', 'up', moveFacts)!;
		expect(idOf(back)).toEqual(['sess-a', 'sess-sub', 'pb', 'sess-b']);
	});

	it('blockBounds on the browser row resolves to the opener family head', () => {
		const idx = panels.findIndex((p) => p.id === 'pb');
		expect(blockBounds(panels, idx, moveFacts)).toEqual([0, 2]);
	});
});

describe('the SUMMONED glass keeps the folded glass\'s wire slot (2026-10-22 bug)', () => {
	// The report: a folded glass renders right under its opener (the ghost
	// row ships siblingIndex -1, ADR-0037 D4), but the moment the operator
	// summons it — the ghost flips kind to a real browser PANEL row — the
	// roster dropped it BELOW the sub-agent ghost siblings. Root cause: the
	// browser branch of panelRowsFor set no siblingIndex, so the sibling
	// merge read its threshold as Infinity and flushed every ghost first.
	const panels: DsiPanelEntry[] = [
		conv('p1', 'sess-a'),
		glass('pb', 'sess-a') // the SUMMONED glass — a real browser panel
	];
	const { lineage, moveFacts } = factsFor(panels, { 'sess-a': ['c1', 'c2'] });
	const rowsInput = {
		panels,
		spineRows: [row('sess-a'), row('c1', { parentSessionId: 'sess-a', origin: 'subagent' }), row('c2', { parentSessionId: 'sess-a', origin: 'subagent' })],
		coldCache: {},
		deadSessions: {},
		edgeCache: {},
		lineageFacts: lineage,
		moveFacts
	};
	const rows = panelRowsFor(rowsInput as never);
	const ghosts = ghostPanelRowsFor(rowsInput as never);

	it('the browser panel row carries the glass wire slot (siblingIndex -1)', () => {
		const browserRow = rows.find((r) => r.panel.id === 'pb')!;
		expect(browserRow.siblingIndex).toBe(-1);
	});

	it('the roster renders the summoned glass under its opener, ABOVE the ghost siblings', () => {
		// The same merge SidebarOpenPanels runs: panels + ghosts by wire order.
		const members = rows.map((r) => ({
			id: r.panel.kind === 'conversation' ? (r.panel as DsiConversationPanel).sessionId : r.panel.id,
			parent: r.parentSessionId ?? null,
			order: r.siblingIndex,
			depth: r.depth ?? 0,
			row: r
		}));
		const ghostMembers = ghosts.map((g) => ({
			id: (g.panel as DsiConversationPanel).sessionId,
			parent: g.parentSessionId ?? '',
			order: g.siblingIndex,
			depth: g.depth ?? 0,
			row: g
		}));
		const order = familyRenderOrder(members, ghostMembers).map((e) => e.member.id);
		const browserIdx = order.indexOf('pb');
		const c1Idx = order.indexOf('c1');
		const c2Idx = order.indexOf('c2');
		expect(browserIdx).toBeGreaterThan(-1);
		expect(browserIdx).toBeLessThan(c1Idx);
		expect(browserIdx).toBeLessThan(c2Idx);
	});
});

function idOf(panels: DsiPanelEntry[]): string[] {
	return panels.map((p) => (p.kind === 'conversation' ? (p as DsiConversationPanel).sessionId : p.id));
}