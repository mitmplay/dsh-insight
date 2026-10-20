import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';

import ConversationHeader from '$lib/components/conversation/header/ConversationHeader.svelte';
import {
	configureFloorRegistry,
	resetFloorState,
	st,
	openBrowserPanel
} from '$lib/services/panels/floor-registry.svelte';

// the seam the state home demands (the page normally configures it)
configureFloorRegistry({
	getLineageFacts: () => ({ subagentIds: new Set(), depthById: new Map(), rootIds: new Set() }) as never,
	getMoveFacts: () => ({}) as never,
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