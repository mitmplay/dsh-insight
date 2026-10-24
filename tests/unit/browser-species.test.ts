import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';

import ConversationHeader from '$lib/components/conversation/header/ConversationHeader.svelte';
import {
	configureFloorRegistry,
	resetFloorState,
	st,
	openBrowserPanel,
	removePanel
} from '$lib/services/panels/floor-registry.svelte';

// the seam the state home demands (the page normally configures it)
configureFloorRegistry({
	getLineageFacts: () => ({ subagentIds: new Set(), depthById: new Map(), rootIds: new Set(), childrenByParent: new Map() }) as never,
	getMoveFacts: () => ({ parentOf: new Map() }) as never,
	getWorkspaceFor: () => null,
	ensureCold: async () => undefined,
	rememberEdge: () => undefined,
	getPanelWidth: () => 480,
	setPanelWidthPreset: () => undefined,
	setTreePct: () => undefined,
	getSettingsHomes: () => ({}),
	applyTerminalDeskAction: () => undefined
});

afterEach(() => {
	resetFloorState();
	document.body.innerHTML = '';
});

describe('browser floor species (W2 2.2)', () => {
	it('openBrowserPanel inserts a singleton and dedupes to focus', () => {
		resetFloorState();
		openBrowserPanel();
		expect(st.panels.filter((p) => p.kind === 'browser')).toHaveLength(1);
		const id = (st.panels.find((p) => p.kind === 'browser') as { id: string }).id;
		openBrowserPanel(); // second click FOCUSES, never duplicates
		expect(st.panels.filter((p) => p.kind === 'browser')).toHaveLength(1);
		expect(st.selectedPanelId).toBe(id);
	});

	// The ghost is ALWAYS the first child under its opener (operator ruling
	// 2026-10-24 — the spine tree ships wire order -1, the floor must match).
	// A sub-agent adopted BEFORE the glass never pushes it to the region end.
	it('a chip-spawned glass pins FIRST under its opener, before adopted children', () => {
		// the opener HAS an adopted child: childrenByParent carries A -> [sub]
		configureFloorRegistry({
			getLineageFacts: () => ({
				subagentIds: new Set(['sub']),
				depthById: new Map([['sub', 1]]),
				rootIds: new Set(['A', 'B']),
				childrenByParent: new Map([['A', [{ sessionId: 'sub', title: 'sub', agentPreset: null, running: false, blank: false, updatedAt: 0, workspace: '/w', turns: null, parentSessionId: 'A', origin: 'subagent' }]]])
			}) as never,
			getMoveFacts: () => ({ parentOf: new Map([['sub', 'A']]) }) as never,
			getWorkspaceFor: () => null,
			ensureCold: async () => undefined,
			rememberEdge: () => undefined,
			getPanelWidth: () => 480,
			setPanelWidthPreset: () => undefined,
			setTreePct: () => undefined,
			getSettingsHomes: () => ({}),
			applyTerminalDeskAction: () => undefined
		});
		resetFloorState();
		// floor: |A|sub|B| — A already has an adopted child sub-agent
		st.panels = [
			{ id: 'p-a', kind: 'conversation', sessionId: 'A', agentPreset: null, width: 480 },
			{ id: 'p-sub', kind: 'conversation', sessionId: 'sub', agentPreset: null, width: 480 },
			{ id: 'p-b', kind: 'conversation', sessionId: 'B', agentPreset: null, width: 480 }
		] as never;
		openBrowserPanel(undefined, false, undefined, 'A', 'bs-1');
		const kinds = st.panels.map((p) => (p.kind === 'conversation' ? (p as { sessionId: string }).sessionId : p.kind));
		expect(kinds).toEqual(['A', 'browser', 'sub', 'B']);
	});

	it('ConversationHeader renders the browser chip only when the opener is provided', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(ConversationHeader, {
			target,
			props: { sessionId: 's1', title: 't', initialTitle: 't', ontitlechange: () => undefined, agent: null, isStreaming: false, onOpenBrowser: () => undefined }
		});
		expect(target.querySelector('[data-testid="open-browser"]')).not.toBeNull();
		unmount(instance);
		target.innerHTML = '';

		const target2 = document.createElement('div');
		document.body.appendChild(target2);
		const instance2 = mount(ConversationHeader, {
			target: target2,
			props: { sessionId: 's1', title: 't', initialTitle: 't', ontitlechange: () => undefined, agent: null, isStreaming: false }
		});
		// subagent read-only mounts never receive the opener — no chip
		expect(target2.querySelector('[data-testid="open-browser"]')).toBeNull();
		unmount(instance2);
	});

	it('clicking the chip fires the opener', () => {
		let fired = 0;
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(ConversationHeader, {
			target,
			props: { sessionId: 's1', title: 't', initialTitle: 't', ontitlechange: () => undefined, agent: null, isStreaming: false, onOpenBrowser: () => (fired += 1) }
		});
		(target.querySelector('[data-testid="open-browser"]') as HTMLElement).click();
		expect(fired).toBe(1);
		unmount(instance);
	});

});

// ── ADR-0036 D1/D2: provenance recorded once at spawn, never rewritten ──
describe('glass provenance (ADR-0036)', () => {
	it('openBrowserPanel records openedBy on the inserted entry', () => {
		resetFloorState();
		openBrowserPanel(undefined, false, undefined, 'sess-a');
		const entry = st.panels.find((p) => p.kind === 'browser') as { openedBy?: string };
		expect(entry.openedBy).toBe('sess-a');
	});

	it('a DIFFERENT opener spawns its OWN glass — one glass per opener (Amendment 3)', () => {
		resetFloorState();
		openBrowserPanel(undefined, false, undefined, 'sess-a');
		const idA = (st.panels.find((p) => p.kind === 'browser') as { id: string }).id;
		openBrowserPanel(undefined, false, undefined, 'sess-b');
		const glasses = st.panels.filter((p) => p.kind === 'browser') as Array<{ id: string; openedBy?: string }>;
		expect(glasses).toHaveLength(2);
		const glassB = glasses.find((g) => g.openedBy === 'sess-b')!;
		expect(glassB).toBeDefined();
		expect(glassB.id).not.toBe(idA);
		expect(st.selectedPanelId).toBe(glassB.id);
	});

	it('the SAME opener click only focuses — openedBy never rewrites (D2)', () => {
		resetFloorState();
		openBrowserPanel(undefined, false, undefined, 'sess-a');
		const idA = (st.panels.find((p) => p.kind === 'browser') as { id: string }).id;
		openBrowserPanel(undefined, false, undefined, 'sess-a');
		expect(st.panels.filter((p) => p.kind === 'browser')).toHaveLength(1);
		const entry = st.panels.find((p) => p.kind === 'browser') as { id: string; openedBy?: string };
		expect(entry.id).toBe(idA);
		expect(entry.openedBy).toBe('sess-a');
		expect(st.selectedPanelId).toBe(idA);
	});

	it('a ControlBar-style open (no opener) leaves openedBy undefined', () => {
		resetFloorState();
		openBrowserPanel();
		const entry = st.panels.find((p) => p.kind === 'browser') as { openedBy?: string };
		expect(entry.openedBy).toBeUndefined();
	});

	it('makeBrowserPanel omits the field entirely when no opener given', async () => {
		const mod = await import('$lib/services/panels/floor-registry/factories.js');
		const panel = mod.makeBrowserPanel() as { openedBy?: string };
		expect('openedBy' in panel).toBe(false);
		const owned = mod.makeBrowserPanel(700, 'sess-a') as { openedBy?: string; width: number };
		expect(owned.openedBy).toBe('sess-a');
		expect(owned.width).toBe(700);
	});

});

// ── ADR-0036 Amendment 2: the glass is family, not furniture ──────────
describe('glass placement + cascade (Amendment 2)', () => {
	function configure(): void {
		configureFloorRegistry({
			getLineageFacts: () =>
				({
					subagentIds: new Set(['sess-sub']),
					depthById: new Map([
						['sess-a', 0],
						['sess-sub', 1]
					]),
					rootIds: new Set(['sess-a']),
					// sess-sub is a child of sess-a (the cascade walk reads this)
					childrenByParent: new Map([['sess-a', [{ sessionId: 'sess-sub' } as never]]])
				}) as never,
			getMoveFacts: () => ({ parentOf: () => null }) as never,
			getWorkspaceFor: () => null,
			ensureCold: async () => undefined,
			rememberEdge: () => undefined,
			getPanelWidth: () => 480,
			setPanelWidthPreset: () => undefined,
			setTreePct: () => undefined,
			getSettingsHomes: () => ({}),
			applyTerminalDeskAction: () => undefined
		});
	}

	it('chip spawn pins the glass FIRST under its opener, before children (Ladder Amendment 2)', () => {
		resetFloorState();
		configure();
		// floor shape: A | sub(agent of A) | other
		st.panels = [
			{ id: 'p1', kind: 'conversation', sessionId: 'sess-a', agentPreset: null, width: 480 },
			{ id: 'p2', kind: 'conversation', sessionId: 'sess-sub', agentPreset: null, width: 480 },
			{ id: 'p3', kind: 'prompt-manager', width: 480 }
		] as never;
		st.selectedPanelId = 'p3'; // focus is ELSEWHERE — placement must ignore it
		openBrowserPanel(undefined, false, undefined, 'sess-a');
		const idx = st.panels.findIndex((p) => p.kind === 'browser');
		expect(idx).toBe(1); // the ghost is ALWAYS the first child: right after A, before sub
	});

	it('closing the opener dooms the glass (D5 revised)', () => {
		resetFloorState();
		configure();
		st.panels = [
			{ id: 'p1', kind: 'conversation', sessionId: 'sess-a', agentPreset: null, width: 480 },
			{ id: 'pb', kind: 'browser', width: 480, openedBy: 'sess-a' }
		] as never;
		st.selectedPanelId = 'pb';
		removePanel('p1'); // family walk: sess-a dooms sess-a's family incl. the glass
		expect(st.panels.some((p) => p.kind === 'browser')).toBe(false);
	});

	it('a ControlBar glass (no provenance) survives every cascade', () => {
		resetFloorState();
		configure();
		st.panels = [
			{ id: 'p1', kind: 'conversation', sessionId: 'sess-a', agentPreset: null, width: 480 },
			{ id: 'pb', kind: 'browser', width: 480 }
		] as never;
		removePanel('p1');
		expect(st.panels.some((p) => p.kind === 'browser')).toBe(true);
	});
});