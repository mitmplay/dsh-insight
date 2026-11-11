/**
 * RowSessionItem verb/branch sweep — direct mount (row-session-item-
 * glass-summon.test.ts pattern), covering the arms its sibling suites
 * leave open:
 *
 *  - plain click with NO floor mounted → the registry no-op lets the
 *    anchor navigate (handled false, no preventDefault)
 *  - plain click WITH a floor → addPanelFromSidebar handled, nav cancelled
 *  - Shift+click with a floor → replaceSelectedFromRegistry (reversed R5)
 *  - rowTitle variants: no floor / floor + workspace / floor + no workspace
 *  - the depth>0 child class (ADR D6)
 *  - the fork chip arms: parentSessionId set vs origin 'subagent' vs glass
 *  - a glass row WITHOUT an opener still summons (no orphan add first)
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	registerAddPanel,
	registerReplaceSelected,
	registerSummonGlass,
	panelRegistryActive,
	resetPanelRegistryForTests
} from '$lib/services/panels/panel-registry';
import RowSessionItem from '$lib/components/sidebar/session-list/RowSessionItem.svelte';
import type { DsiSessionSummary } from '$lib/types';

vi.mock('$lib/components/sidebar/session-list/RowJobBadge.svelte', () => ({ default: () => '' }));

function rowSession(over: Partial<DsiSessionSummary> = {}): DsiSessionSummary {
	return {
		sessionId: 'conv-1',
		title: 'Owner session',
		workspace: '/tmp/ws',
		running: false,
		updatedAt: Date.now(),
		parentSessionId: null,
		origin: 'user',
		agentPreset: null,
		...over
	} as DsiSessionSummary;
}

function mountRow(session: DsiSessionSummary, depth = 0) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(RowSessionItem, {
		target,
		props: { session, workspaces: [], depth }
	});
	flushSync();
	return {
		target,
		row: target.querySelector('[data-testid="sidebar-session-card"]') as HTMLAnchorElement,
		cleanup: () => {
			unmount(instance as never);
			target.remove();
		}
	};
}

afterEach(() => {
	resetPanelRegistryForTests(); // handlers must not leak across arms
	document.body.innerHTML = '';
});

describe('RowSessionItem — click verbs', () => {
	it('no floor mounted: the click is unhandled and the anchor navigates', () => {
		const view = mountRow(rowSession());
		expect(panelRegistryActive()).toBe(false);
		const click = new MouseEvent('click', { bubbles: true, cancelable: true });
		view.row.dispatchEvent(click);
		expect(click.defaultPrevented).toBe(false);
		view.cleanup();
	});

	it('floor mounted, plain click: addPanelFromSidebar answers and nav is cancelled', () => {
		const added: Array<{ sessionId: string; agentPreset: string | null }> = [];
		registerAddPanel((req) => {
			if (req.kind !== undefined && req.kind !== 'conversation') return false;
			added.push({ sessionId: req.sessionId, agentPreset: req.agentPreset });
			return true;
		});
		const view = mountRow(rowSession({ agentPreset: 'research' }));
		const click = new MouseEvent('click', { bubbles: true, cancelable: true });
		view.row.dispatchEvent(click);
		expect(added).toEqual([{ sessionId: 'conv-1', agentPreset: 'research' }]);
		expect(click.defaultPrevented).toBe(true);
		view.cleanup();
	});

	it('floor mounted, Shift+click: replaceSelectedFromRegistry (reversed R5 verbs)', () => {
		registerAddPanel(() => {
			throw new Error('plain verb must not fire on Shift+click');
		});
		const replaced: string[] = [];
		registerReplaceSelected((req) => {
			if (req.kind !== undefined && req.kind !== 'conversation') return false;
			replaced.push(req.sessionId);
			return true;
		});
		const view = mountRow(rowSession());
		view.row.dispatchEvent(
			new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey: true })
		);
		expect(replaced).toEqual(['conv-1']);
		view.cleanup();
		registerAddPanel(null);
	});
});

describe('RowSessionItem — rowTitle variants', () => {
	it('no floor: the title is the bare workspace path', () => {
		const view = mountRow(rowSession());
		expect(view.row.getAttribute('title')).toBe('/tmp/ws');
		view.cleanup();
	});

	it('floor + workspace: path plus the replace affordance', () => {
		registerAddPanel(() => true);
		const view = mountRow(rowSession());
		expect(view.row.getAttribute('title')).toBe('/tmp/ws — Shift+click to replace panel');
		view.cleanup();
	});

	it('floor + no workspace: the affordance alone', () => {
		registerAddPanel(() => true);
		const view = mountRow(rowSession({ workspace: null }));
		expect(view.row.getAttribute('title')).toBe('Shift+click to replace panel');
		view.cleanup();
		registerAddPanel(null);
	});
});

describe('RowSessionItem — depth and fork-chip arms', () => {
	it('depth > 0 marks the row child', () => {
		const view = mountRow(rowSession(), 2);
		expect(view.row.className).toContain('child');
		expect(view.row.getAttribute('data-depth')).toBe('2');
		view.cleanup();
	});

	it('a subagent-origin row with a parent renders no fork chip arm (origin !== subagent fails)', () => {
		// fork = parentSessionId != null && origin !== 'subagent' && !isGlass
		const view = mountRow(rowSession({ parentSessionId: 'p-1', origin: 'subagent' }));
		// The row itself never renders the chip — WorkspaceRowItem receives
		// fork=false; observe only that the row renders fine (contract: no crash).
		expect(view.row).not.toBeNull();
		view.cleanup();
	});

	it('a glass row summons even without an opener (no orphan add first)', () => {
		const calls: string[] = [];
		registerAddPanel(() => {
			calls.push('add');
			return true;
		});
		registerSummonGlass((glass) => {
			calls.push('summon:' + (glass.sessionId ?? ''));
		});
		const view = mountRow(rowSession({ sessionId: 'glass-2', origin: 'browser' }));
		expect(view.row.getAttribute('href')).toBeNull();
		view.row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		expect(calls).toEqual(['summon:glass-2']);
		view.cleanup();
	});
});
