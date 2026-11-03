/**
 * panel-rows.test.ts — W2 task 2.2-T: the extracted sidebar-row
 * derivations (services/panels/panel-rows.ts, KB "The Floor
 * Decomposition" E1; ADR "The Manager in the Panel" D6/D10).
 *
 * Two contracts pinned:
 * 1. CONVERSATION PARITY — the extraction is verbatim: every row fact a
 *    pre-extraction route derived (title/workspace spine→cold fallback,
 *    dead, running, depth, move verbs) derives identically from the
 *    pure function.
 * 2. MANAGER ROW FACTS (ADR §8 required case) — a prompt-manager slot
 *    derives the kind-honest row: title 'Prompt Manager', running false, dead
 *    false, depth 0, no lineage keys — and never joins a spine or cold
 *    lookup even when ids collide.
 */
import { describe, expect, it } from 'vitest';
import {
	DOC_CHILD_PAINT,
	WORKSPACE_CHILD_PAINT,
	ghostPanelRowsFor,
	injectedDocTitle,
	MANAGER_ROW_TITLE,
	openSessionIdsOf,
	panelRowsFor,
	rowFactsByPanelId
} from '$lib/services/panels/panel-rows';
import { SYSTEM_PROMPT_DISPLAY_PATH } from '$lib/services/conversation/injected-shelf';
import { deriveLineage } from '$lib/services/lineage/lineage';
import { moveFactsFrom } from '$lib/services/lineage/lineage-move';
import type { DsiConversationPanel, DsiPanelEntry, DsiSessionSummary } from '$lib/types';

function row(
	sessionId: string,
	over: Partial<DsiSessionSummary> = {}
): DsiSessionSummary {
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

function conversation(id: string, sessionId: string, width = 730): DsiConversationPanel {
	return { id, kind: 'conversation', sessionId, agentPreset: null, width };
}

function conv(panels: readonly DsiPanelEntry[]): DsiConversationPanel[] {
	return panels.filter((p): p is DsiConversationPanel => p.kind === 'conversation');
}

function manager(id: string, width = 730): DsiPanelEntry {
	return { id, kind: 'prompt-manager', width };
}

function injectedDoc(
	id: string,
	sourceSessionId: string,
	displayPath: string,
	width = 730
): DsiPanelEntry {
	return { id, kind: 'injected-doc', sourceSessionId, displayPath, width };
}

describe('panelRowsFor — conversation parity (2.2-T)', () => {
	it('title/workspace fall back spine → cold; dead/running honest; depth from lineage', () => {
		const spineRows = [
			row('s1', { title: 'Live One', workspace: '/w/a', running: true }),
			// s2 has NO spine row — the cold cache carries it
			row('s3', { parentSessionId: 's1', origin: 'subagent' })
		];
		const panels = [conversation('p1', 's1'), conversation('p2', 's2'), conversation('p3', 's3')];
		const lineageFacts = deriveLineage(spineRows, conv(panels));
		const moveFacts = moveFactsFrom(lineageFacts, openSessionIdsOf(panels));
		const rows = panelRowsFor({
			panels,
			spineRows,
			coldCache: {
				s2: { title: 'Cold Two', workspace: '/w/cold', running: false }
			},
			deadSessions: { s2: '404' },
			edgeCache: {},
			lineageFacts,
			moveFacts
		});
		expect(rows.map((r) => r.title)).toEqual(['Live One', 'Cold Two', 'Session s3']);
		expect(rows.map((r) => r.workspace)).toEqual(['/w/a', '/w/cold', '/tmp/w']);
		expect(rows.map((r) => r.dead)).toEqual([false, true, false]);
		expect(rows.map((r) => r.running)).toEqual([true, false, false]);
		// s3 is pinned under the OPEN s1 → depth 1 (lineage fact).
		expect(rows.map((r) => r.depth)).toEqual([0, 0, 1]);
	});

	it('rowFactsByPanelId keys every row by panel id (header chevron source)', () => {
		const panels = [conversation('p1', 's1'), manager('m1')];
		const lineageFacts = deriveLineage([], conv(panels));
		const rows = panelRowsFor({
			panels,
			spineRows: [],
			coldCache: {},
			deadSessions: {},
			edgeCache: {},
			lineageFacts,
			moveFacts: moveFactsFrom(lineageFacts, openSessionIdsOf(panels))
		});
		const facts = rowFactsByPanelId(rows);
		expect([...facts.keys()].sort()).toEqual(['m1', 'p1']);
	});
});

describe('panelRowsFor — manager row facts (ADR §8 required case)', () => {
	it('a prompt-manager slot derives the kind-honest row', () => {
		const spineRows = [row('s1', { title: 'Conversation', running: true })];
		const panels = [conversation('p1', 's1'), manager('m1'), conversation('p2', 's2')];
		const lineageFacts = deriveLineage(spineRows, conv(panels));
		const rows = panelRowsFor({
			panels,
			spineRows,
			// A cold row under the MANAGER's panel id must not leak in.
			coldCache: { m1: { title: 'Spoof', workspace: '/nope', running: true } },
			deadSessions: { m1: '404' },
			edgeCache: {},
			lineageFacts,
			moveFacts: moveFactsFrom(lineageFacts, openSessionIdsOf(panels))
		});
		const mgr = rows[1];
		expect(mgr.title).toBe(MANAGER_ROW_TITLE);
		expect(mgr.running).toBe(false);
		expect(mgr.dead).toBe(false);
		expect(mgr.depth).toBe(0);
		expect(mgr.runningDescendants).toBe(0);
		expect(mgr.parentSessionId).toBeNull();
		expect(mgr.fork).toBe(false);
		expect(mgr.spawnerTitle).toBeNull();
		expect(mgr.kind).toBe('panel');
		// Move verbs are positional: the middle slot moves both ways.
		expect(mgr.canMoveUp).toBe(true);
		expect(mgr.canMoveDown).toBe(true);
	});

	it('the open-session view is conversation-only — a manager id never joins it', () => {
		const panels = [conversation('p1', 's1'), manager('m1')];
		expect(openSessionIdsOf(panels)).toEqual(new Set(['s1']));
	});

	it('ghosts derive from conversation panels only; a manager spawner ghosts nothing', () => {
		const spineRows = [
			row('s1'),
			row('agent1', { parentSessionId: 's1', origin: 'subagent' })
		];
		const panels = [conversation('p1', 's1'), manager('m1')];
		const lineageFacts = deriveLineage(spineRows, conv(panels));
		const ghosts = ghostPanelRowsFor({
			panels,
			spineRows,
			coldCache: {},
			deadSessions: {},
			edgeCache: {},
			lineageFacts,
			moveFacts: moveFactsFrom(lineageFacts, openSessionIdsOf(panels))
		});
		expect(ghosts.map((g) => g.panel.id)).toEqual(['ghost-agent1']);
		expect(ghosts[0].kind).toBe('ghost');
	});
});

// ── Loadinjected W1 1.2-T — the document-child row (2026-09-07 ADR D3/D7) ──

describe('panelRowsFor — document-child row facts (Loadinjected ADR D3)', () => {
	it('an injected-doc slot derives the row-level lineage child', () => {
		const spineRows = [row('s1', { title: 'Conversation', running: true })];
		const panels = [
			conversation('p1', 's1'),
			injectedDoc('d1', 's1', 'AGENTS.md'),
			conversation('p2', 's2')
		];
		const lineageFacts = deriveLineage(spineRows, conv(panels));
		const rows = panelRowsFor({
			panels,
			spineRows,
			coldCache: {},
			deadSessions: {},
			edgeCache: {},
			lineageFacts,
			moveFacts: moveFactsFrom(lineageFacts, openSessionIdsOf(panels))
		});
		const doc = rows[1];
		expect(doc.title).toBe('AGENTS.md');
		expect(doc.parentSessionId).toBe('s1');
		expect(doc.depth).toBe(1);
		expect(doc.fork).toBe(false);
		expect(doc.spawnerTitle).toBeNull();
		expect(doc.running).toBe(false);
		expect(doc.dead).toBe(false);
		expect(doc.workspace).toBeNull();
		expect(doc.runningDescendants).toBe(0);
		expect(doc.kind).toBe('panel');
		// The FAMILY grammar (consolidated 2026-09-07): a document child
		// travels with its source — moves are not offered (the manager's
		// positional verbs are not this row's grammar).
		expect(doc.canMoveUp).toBe(false);
		expect(doc.canMoveDown).toBe(false);
	});

	it('depth is FLAT 1 — no spine join, no orphan degrade, no id-collision leaks', () => {
		const spineRows = [row('s9', { title: 'Spoof', running: true })];
		const panels = [injectedDoc('d1', 's9', 'AGENTS.md')];
		const lineageFacts = deriveLineage(spineRows, conv(panels));
		const rows = panelRowsFor({
			panels,
			spineRows,
			// Cold/dead/edge facts under the SOURCE session id must not leak
			// in — the doc row renders a record, not the session.
			coldCache: { s9: { title: 'Cold Spoof', workspace: '/nope', running: true } },
			deadSessions: { s9: '404' },
			edgeCache: { s9: 'edge-parent' },
			lineageFacts,
			moveFacts: moveFactsFrom(lineageFacts, openSessionIdsOf(panels))
		});
		expect(rows[0].depth).toBe(1);
		expect(rows[0].dead).toBe(false);
		expect(rows[0].running).toBe(false);
		expect(rows[0].parentSessionId).toBe('s9');
		expect(rows[0].spawnerTitle).toBeNull();
		expect(rows[0].workspace).toBeNull();
	});

	it('title: the synthetic system-prompt member reads the D7 pinned label', () => {
		expect(injectedDocTitle('AGENTS.md')).toBe('AGENTS.md');
		expect(injectedDocTitle('docs/nested/RULES.md')).toBe('docs/nested/RULES.md');
		expect(injectedDocTitle(SYSTEM_PROMPT_DISPLAY_PATH)).toBe('system prompt — latest epoch');
	});

	it('the maroon document-child paint is the pinned var(--color-doc-child) constant', () => {
		expect(DOC_CHILD_PAINT).toBe('var(--color-doc-child)');
	});

	it('the open-session view stays conversation-only — a doc source never joins it', () => {
		const panels = [conversation('p1', 's1'), injectedDoc('d1', 's1', 'AGENTS.md')];
		expect(openSessionIdsOf(panels)).toEqual(new Set(['s1']));
	});

	it('ghosts derive from conversation panels only — a doc panel ghosts nothing', () => {
		const spineRows = [
			row('s1'),
			row('agent1', { parentSessionId: 's1', origin: 'subagent' })
		];
		const panels = [conversation('p1', 's1'), injectedDoc('d1', 's1', 'AGENTS.md')];
		const lineageFacts = deriveLineage(spineRows, conv(panels));
		const ghosts = ghostPanelRowsFor({
			panels,
			spineRows,
			coldCache: {},
			deadSessions: {},
			edgeCache: {},
			lineageFacts,
			moveFacts: moveFactsFrom(lineageFacts, openSessionIdsOf(panels))
		});
		expect(ghosts.map((g) => g.panel.id)).toEqual(['ghost-agent1']);
	});
});

// ── Workspace rows — Shared Tree ADR (2026-09-17, D3): the explorer is a
// NON-family panel; its row reads exactly like a root (non-fork)
// conversation row. The file still anchors to its explorer (the
// below-explorer slot rule stands, D4 defers its re-key).

function explorerPanel(id: string, sessionId: string): DsiPanelEntry {
	return { id, kind: 'workspace-explorer', sessionId, root: '/w/a', expanded: [], width: 600 };
}

function filePanel(id: string, sessionId: string, explorerPanelId: string | null): DsiPanelEntry {
	return { id, kind: 'workspace-file', sessionId, path: 'AGENTS.md', explorerPanelId, width: 600 };
}

describe('panelRowsFor — workspace rows are root-like (Shared Tree D3)', () => {
	it('a ROOT conversation: the explorer row is a root row — depth 0, movable, no branch', () => {
		const spineRows = [row('s1')];
		const panels = [
			conversation('p1', 's1'),
			explorerPanel('e1', 's1'),
			filePanel('f1', 's1', 'e1')
		];
		const lineageFacts = deriveLineage(spineRows, conv(panels));
		const rows = panelRowsFor({
			panels,
			spineRows,
			coldCache: {},
			deadSessions: {},
			edgeCache: {},
			lineageFacts,
			moveFacts: moveFactsFrom(lineageFacts, openSessionIdsOf(panels))
		});
		expect(rows.map((r) => r.depth)).toEqual([0, 0, 0]);
		expect(rows[1].title).toBe('a'); // root basename
		expect(rows[2].title).toBe('AGENTS.md');
		expect(rows[1].parentSessionId).toBeNull(); // no conversation edge (D3)
		expect(rows[1].wsChild).toBeUndefined(); // no lineage branch paint
		expect(rows[1].canMoveUp).toBe(true); // the same grammar every root row uses
		// explorer unit [e1, f1] is the LAST block — down is at its edge (null).
		expect(rows[1].canMoveDown).toBe(false);
	});

	it('a FORK conversation does not lift the explorer: depth 0 all the same', () => {
		const spineRows = [row('root'), row('s1', { parentSessionId: 'root' })];
		const panels = [
			conversation('p0', 'root'),
			conversation('p1', 's1'),
			explorerPanel('e1', 's1'),
			filePanel('f1', 's1', 'e1')
		];
		const lineageFacts = deriveLineage(spineRows, conv(panels));
		const rows = panelRowsFor({
			panels,
			spineRows,
			coldCache: {},
			deadSessions: {},
			edgeCache: {},
			lineageFacts,
			moveFacts: moveFactsFrom(lineageFacts, openSessionIdsOf(panels))
		});
		expect(rows.map((r) => r.depth)).toEqual([0, 1, 0, 0]);
	});

	it('workspace rows carry NO wsChild paint — the explorer is not a spawned child', () => {
		const spineRows = [row('s1')];
		const panels = [
			conversation('p1', 's1'),
			explorerPanel('e1', 's1'),
			filePanel('f1', 's1', 'e1')
		];
		const lineageFacts = deriveLineage(spineRows, conv(panels));
		const rows = panelRowsFor({
			panels,
			spineRows,
			coldCache: {},
			deadSessions: {},
			edgeCache: {},
			lineageFacts,
			moveFacts: moveFactsFrom(lineageFacts, openSessionIdsOf(panels))
		});
		expect(rows[1].wsChild).toBeUndefined();
		expect(rows[2].wsChild).toBeUndefined();
	});

	it('conversation off the floor: the rows are unchanged roots (no orphan degrade needed)', () => {
		const spineRows = [row('s1')];
		const panels = [explorerPanel('e1', 's1'), filePanel('f1', 's1', 'e1')];
		const lineageFacts = deriveLineage(spineRows, conv(panels));
		const rows = panelRowsFor({
			panels,
			spineRows,
			coldCache: {},
			deadSessions: {},
			edgeCache: {},
			lineageFacts,
			moveFacts: moveFactsFrom(lineageFacts, openSessionIdsOf(panels))
		});
		expect(rows.map((r) => r.depth)).toEqual([0, 0]);
	});

	it('file with no explorer panel: still a root-like row (depth 0)', () => {
		const spineRows = [row('s1')];
		const panels = [conversation('p1', 's1'), filePanel('f1', 's1', null)];
		const lineageFacts = deriveLineage(spineRows, conv(panels));
		const rows = panelRowsFor({
			panels,
			spineRows,
			coldCache: {},
			deadSessions: {},
			edgeCache: {},
			lineageFacts,
			moveFacts: moveFactsFrom(lineageFacts, openSessionIdsOf(panels))
		});
		expect(rows.map((r) => r.depth)).toEqual([0, 0]);
	});
});
// ── Coverage extension (2026-10-29): the header labels, the folded-glass
// ghost rows, the browser row, the non-session kind rows, and the
// conversation row's fork/edge/spawner/sibling branches.

import {
	SETTINGS_ROW_TITLE,
	foldedGlassRowsFor,
	panelHeaderLabel,
	workspaceExplorerTitle,
	workspaceFileTitle
} from '$lib/services/panels/panel-rows';

describe('injectedDocTitle / title helpers — remaining branches', () => {
	it('workspaceExplorerTitle: the root basename; separator-only root falls back to the root', () => {
		expect(workspaceExplorerTitle('/Users/me/agentic-ai')).toBe('agentic-ai');
		expect(workspaceExplorerTitle('C:\\work\\dsi')).toBe('dsi');
		// Every segment is empty → filter drops all → pop() is undefined → root.
		expect(workspaceExplorerTitle('///')).toBe('///');
		expect(workspaceExplorerTitle('\\\\')).toBe('\\\\');
	});

	it('workspaceFileTitle: the basename; a bare name passes through', () => {
		expect(workspaceFileTitle('docs/nested/RULES.md')).toBe('RULES.md');
		expect(workspaceFileTitle('AGENTS.md')).toBe('AGENTS.md');
		expect(workspaceFileTitle('')).toBe('');
	});
});

describe('panelHeaderLabel — the header label per panel kind', () => {
	it('every non-conversation kind gets its pinned variant title', () => {
		expect(panelHeaderLabel({ id: 't', kind: 'terminal', width: 600 })).toBe('Terminal');
		expect(panelHeaderLabel({ id: 'b', kind: 'browser', width: 600 })).toBe('Glass Browser');
		expect(panelHeaderLabel({ id: 'm', kind: 'prompt-manager', width: 600 })).toBe(
			MANAGER_ROW_TITLE
		);
		expect(panelHeaderLabel({ id: 's', kind: 'skill-shelf', width: 600 })).toBe('Skill Shelf');
		expect(panelHeaderLabel({ id: 'p', kind: 'plugin-rack', width: 600 })).toBe('Plugin Rack');
		expect(
			panelHeaderLabel({ id: 'set', kind: 'settings-editor', target: 'dsi', width: 600 })
		).toBe(SETTINGS_ROW_TITLE.dsi);
		expect(
			panelHeaderLabel({ id: 'set', kind: 'settings-editor', target: 'dsh', width: 600 })
		).toBe(SETTINGS_ROW_TITLE.dsh);
		expect(
			panelHeaderLabel({ id: 'd', kind: 'injected-doc', sourceSessionId: 's1', displayPath: 'AGENTS.md', width: 600 })
		).toBe('AGENTS.md');
		// Titled explorer prints its title; a bare one prints the root basename.
		expect(
			panelHeaderLabel({ id: 'e', kind: 'workspace-explorer', sessionId: 's1', root: '/w/a', expanded: [], width: 600 })
		).toBe('a');
		expect(
			panelHeaderLabel({ id: 'e', kind: 'workspace-explorer', sessionId: 's1', root: '/w/a', title: 'Home', expanded: [], width: 600 })
		).toBe('Home');
		expect(
			panelHeaderLabel({ id: 'f', kind: 'workspace-file', sessionId: 's1', path: 'x/y.md', explorerPanelId: null, width: 600 })
		).toBe('y.md');
	});

	it('a conversation panel → undefined (its header is the session id + copy button)', () => {
		expect(panelHeaderLabel(conversation('p1', 's1'))).toBeUndefined();
	});
});

describe('panelRowsFor — the glass browser row (ADR-0036 Amendment 2)', () => {
	function browserPanel(id: string, openedBy?: string): DsiPanelEntry {
		return { id, kind: 'browser', width: 600, ...(openedBy ? { openedBy } : {}) };
	}

	function rowsFor(panels: DsiPanelEntry[], spineRows: DsiSessionSummary[]) {
		const lineageFacts = deriveLineage(spineRows, conv(panels));
		return panelRowsFor({
			panels,
			spineRows,
			coldCache: {},
			deadSessions: {},
			edgeCache: {},
			lineageFacts,
			moveFacts: moveFactsFrom(lineageFacts, openSessionIdsOf(panels))
		});
	}

	it('a glass with its opener on the floor: depth one below the opener, no move verbs', () => {
		const panels = [conversation('p1', 's1'), browserPanel('b1', 's1')];
		const [convRow, glass] = rowsFor(panels, [row('s1')]);
		expect(glass.title).toBe('Glass Browser');
		expect(glass.kind).toBe('panel');
		expect(glass.dead).toBe(false);
		expect(glass.running).toBe(false);
		expect(glass.workspace).toBeNull();
		expect(glass.parentSessionId).toBe('s1');
		expect(glass.depth).toBe((convRow.depth ?? 0) + 1);
		expect(glass.fork).toBe(false);
		expect(glass.spawnerTitle).toBeNull();
		expect(glass.siblingIndex).toBe(-1);
		expect(glass.canMoveUp).toBe(false);
		expect(glass.canMoveDown).toBe(false);
	});

	it('a glass without an opener (ControlBar) or with the opener gone: depth 0', () => {
		const orphan = rowsFor([browserPanel('b1', 'gone')], [row('s1')])[0];
		expect(orphan.depth).toBe(0);
		expect(orphan.parentSessionId).toBe('gone'); // the edge is recorded, just not OPEN
		const bare = rowsFor([browserPanel('b1')], [row('s1')])[0];
		expect(bare.depth).toBe(0);
		expect(bare.parentSessionId).toBeNull();
	});
});

describe('panelRowsFor — the non-session kind rows', () => {
	function rowsFor(panels: DsiPanelEntry[], spineRows: DsiSessionSummary[] = []) {
		const lineageFacts = deriveLineage(spineRows, conv(panels));
		return panelRowsFor({
			panels,
			spineRows,
			coldCache: {},
			deadSessions: {},
			edgeCache: {},
			lineageFacts,
			moveFacts: moveFactsFrom(lineageFacts, openSessionIdsOf(panels))
		});
	}

	it('terminal / skill-shelf / plugin-rack rows carry their pinned titles and positional verbs', () => {
		const panels: DsiPanelEntry[] = [
			{ id: 't', kind: 'terminal', width: 600 },
			{ id: 's', kind: 'skill-shelf', width: 600 },
			{ id: 'p', kind: 'plugin-rack', width: 600 }
		];
		const rows = rowsFor(panels);
		expect(rows.map((r) => r.title)).toEqual(['Terminal', 'Skill Shelf', 'Plugin Rack']);
		for (const r of rows) {
			expect(r.running).toBe(false);
			expect(r.dead).toBe(false);
			expect(r.depth).toBe(0);
			expect(r.parentSessionId).toBeNull();
			expect(r.fork).toBe(false);
			expect(r.spawnerTitle).toBeNull();
		}
		// Positional verbs: first cannot move up, last cannot move down.
		expect(rows[0].canMoveUp).toBe(false);
		expect(rows[0].canMoveDown).toBe(true);
		expect(rows[2].canMoveUp).toBe(true);
		expect(rows[2].canMoveDown).toBe(false);
	});

	it('settings-editor rows read the per-target SETTINGS_ROW_TITLE', () => {
		const panels: DsiPanelEntry[] = [
			{ id: 'd1', kind: 'settings-editor', target: 'dsi', width: 600 },
			{ id: 'd2', kind: 'settings-editor', target: 'dsh', width: 600 }
		];
		const rows = rowsFor(panels);
		expect(rows.map((r) => r.title)).toEqual(['DSI Settings', 'DSH Settings']);
		expect(rows.every((r) => r.depth === 0 && !r.running && !r.dead)).toBe(true);
	});
});

describe('panelRowsFor — conversation fork / edge / spawner / sibling branches', () => {
	function build(
		panels: DsiPanelEntry[],
		spineRows: DsiSessionSummary[],
		over: Partial<Parameters<typeof panelRowsFor>[0]> = {}
	) {
		const lineageFacts = deriveLineage(spineRows, conv(panels));
		return panelRowsFor({
			panels,
			spineRows,
			coldCache: {},
			deadSessions: {},
			edgeCache: {},
			lineageFacts,
			moveFacts: moveFactsFrom(lineageFacts, openSessionIdsOf(panels)),
			...over
		});
	}

	it('a spawned subagent: fork false; a fork child: fork true; both pin depth under an open parent', () => {
		const spineRows = [
			row('root'),
			row('agent1', { parentSessionId: 'root', origin: 'subagent' }),
			row('fk1', { parentSessionId: 'root' })
		];
		const panels = [conversation('p0', 'root'), conversation('p1', 'agent1'), conversation('p2', 'fk1')];
		const rows = build(panels, spineRows);
		expect(rows.map((r) => r.fork)).toEqual([false, false, true]);
		expect(rows.map((r) => r.depth)).toEqual([0, 1, 1]);
		// Parent OPEN → no spawner title; the hint is the depth paint instead.
		expect(rows.map((r) => r.spawnerTitle)).toEqual([null, null, null]);
		// siblingIndex = the child's index inside childrenByParent[root].
		expect(rows[1].siblingIndex).toBe(0);
		expect(rows[2].siblingIndex).toBe(1);
		expect(rows[0].siblingIndex).toBeUndefined(); // a root has no parent slot
	});

	it('a child whose parent is OFF the floor: depth degrades to 0 and the spawner title names the closed parent', () => {
		const spineRows = [
			row('root', { title: 'The Root' }),
			row('agent1', { parentSessionId: 'root', origin: 'subagent' })
		];
		const panels = [conversation('p1', 'agent1')];
		const [child] = build(panels, spineRows);
		expect(child.depth).toBe(0); // orphan degrade
		expect(child.parentSessionId).toBe('root');
		expect(child.spawnerTitle).toBe('The Root');
		expect(child.fork).toBe(false);
	});

	it('a session with NO spine row joins the edgeCache; an unknown parent id becomes its own spawner title', () => {
		const spineRows = [row('agent1')];
		const panels = [conversation('p1', 'agent1')];
		const [edgeRow] = build(panels, spineRows, { edgeCache: { agent1: 'edge-parent' } });
		expect(edgeRow.parentSessionId).toBe('edge-parent');
		expect(edgeRow.spawnerTitle).toBe('edge-parent'); // no spine row for it → the id itself
		expect(edgeRow.depth).toBe(0); // the edge parent holds no panel
		const [noEdge] = build(panels, spineRows);
		expect(noEdge.parentSessionId).toBeNull();
		expect(noEdge.spawnerTitle).toBeNull();
	});

	it('running/dead facts: spine running wins, cold running falls back, deadSessions marks dead', () => {
		const spineRows = [row('live', { running: true })];
		const panels = [conversation('p1', 'live'), conversation('p2', 'cold1'), conversation('p3', 'gone')];
		const rows = build(panels, spineRows, {
			coldCache: {
				cold1: { title: 'Cold', workspace: '/w', running: true },
				gone: { title: 'G', workspace: null, running: false }
			},
			deadSessions: { gone: '404' }
		});
		expect(rows.map((r) => r.running)).toEqual([true, true, false]);
		expect(rows.map((r) => r.dead)).toEqual([false, false, true]);
		// runningDescendants falls back to 0 when the lineage map lacks the id.
		expect(rows.every((r) => typeof r.runningDescendants === 'number')).toBe(true);
	});
});

describe('ghostPanelRowsFor — cold/dead fallbacks and sibling slots', () => {
	it('a ghost keeps its spine title, spine workspace, and the dead flag; the panel entry is synthetic', () => {
		const spineRows = [
			row('s1', { workspace: '/w/root' }),
			row('agent1', { parentSessionId: 's1', origin: 'subagent', workspace: '/w/agent' })
		];
		const panels = [conversation('p1', 's1')];
		const lineageFacts = deriveLineage(spineRows, conv(panels));
		const ghosts = ghostPanelRowsFor({
			panels,
			spineRows,
			coldCache: { agent1: { title: 'Cold Agent', workspace: '/cold', running: false } },
			deadSessions: { agent1: '404' },
			edgeCache: {},
			lineageFacts,
			moveFacts: moveFactsFrom(lineageFacts, openSessionIdsOf(panels))
		});
		const g = ghosts[0];
		expect(g.title).toBe('Session agent1'); // the ghost's own title beats the cold cache
		expect(g.workspace).toBe('/w/agent'); // the GHOST's own spine row, not the opener's
		expect(g.dead).toBe(true);
		expect(g.runningDescendants).toBe(0);
		expect(typeof g.siblingIndex).toBe('number');
		expect(g.parentSessionId).toBe('s1');
		// The synthetic panel entry never resolves to a registry action.
		expect(g.panel.id).toBe('ghost-agent1');
		expect(g.panel.kind).toBe('conversation');
	});

	it('a ghost with no title anywhere → null title, no crash', () => {
		const spineRows = [
			row('s1'),
			row('agent1', { parentSessionId: 's1', origin: 'subagent', title: null })
		];
		const panels = [conversation('p1', 's1')];
		const lineageFacts = deriveLineage(spineRows, conv(panels));
		const ghosts = ghostPanelRowsFor({
			panels,
			spineRows,
			coldCache: {},
			deadSessions: {},
			edgeCache: {},
			lineageFacts,
			moveFacts: moveFactsFrom(lineageFacts, openSessionIdsOf(panels))
		});
		expect(ghosts[0].title).toBeNull();
	});
});

describe('foldedGlassRowsFor — the folded-glass ghost rows (ADR-0037 D4)', () => {
	const depthOf = (id: string) => (id === 'root' ? 3 : 0);
	const titleFor = (id: string) => (id === 'opener' ? 'The Opener' : null);

	it('only folded slots with BOTH a session and an opener become rows', () => {
		const slots = [
			{ index: 0, sessionId: 'g1', openedBy: 'opener', folded: true },
			{ index: 1, sessionId: 'g2', openedBy: 'opener', folded: false }, // not folded
			{ index: 2, sessionId: 'g3', folded: true }, // no opener
			{ index: 3, openedBy: 'opener', folded: true } // no session
		];
		const rows = foldedGlassRowsFor(slots, depthOf, titleFor);
		expect(rows).toHaveLength(1);
		expect(rows[0].panel.id).toBe('glass-g1');
		expect(rows[0].panel.kind).toBe('conversation');
		expect(rows[0].title).toBe('Browser — The Opener');
	});

	it('a null opener title falls back to the opener id; depth is opener+1; the glass flushes first', () => {
		const rows = foldedGlassRowsFor(
			[{ index: 0, sessionId: 'g9', openedBy: 'unknown-opener', folded: true }],
			() => 2,
			() => null
		);
		expect(rows[0].title).toBe('Browser — unknown-opener');
		expect(rows[0].depth).toBe(3);
		expect(rows[0].kind).toBe('ghost');
		expect(rows[0].running).toBe(true);
		expect(rows[0].dead).toBe(false);
		expect(rows[0].workspace).toBeNull();
		expect(rows[0].runningDescendants).toBe(0);
		expect(rows[0].siblingIndex).toBe(-1);
		expect(rows[0].parentSessionId).toBe('unknown-opener');
	});

	it('no folded slots → no rows', () => {
		expect(foldedGlassRowsFor([], depthOf, titleFor)).toEqual([]);
	});
});
