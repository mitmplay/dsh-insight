/**
 * RowSessionItem floor verbs (ADR-0006 R5, reversed 2026-08-28) — the
 * onRowClick contract for a NON-glass session: plain click adds a panel,
 * Shift+click replaces the selected panel, a handled verb cancels the
 * anchor's navigation, and an unhandled verb (no floor mounted) lets the
 * seed href navigate. Cluster T4 of the branch gate (lines 75-92).
 * Harness: row-session-item-badge.test.ts pattern (direct mount + the
 * registry's register* slots — no vi.mock needed).
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RowSessionItem from '$lib/components/sessions/RowSessionItem.svelte';
import {
	registerAddPanel,
	registerReplaceSelected,
	resetPanelRegistryForTests
} from '$lib/services/panels/panel-registry';
import type { DsiSessionSummary, DsiWorkspaceSummary } from '$lib/types';

function makeSession(over: Partial<DsiSessionSummary> = {}): DsiSessionSummary {
	return {
		sessionId: 'conv-1',
		title: 'Owner session',
		workspace: '/tmp/ws',
		running: false,
		updatedAt: Date.now(),
		parentSessionId: null,
		origin: 'user',
		agentPreset: 'research',
		...over
	} as never;
}

const workspaces: DsiWorkspaceSummary[] = [];

function mountRow(session: DsiSessionSummary) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const component = mount(RowSessionItem, { target, props: { session, workspaces } });
	flushSync();
	const row = target.querySelector('a.row') as HTMLAnchorElement;
	expect(row).not.toBeNull();
	return { component, target, row };
}

/** Click the row anchor; returns the event for defaultPrevented asserts. */
function clickRow(row: HTMLAnchorElement, shiftKey = false): MouseEvent {
	const click = new MouseEvent('click', { bubbles: true, cancelable: true, shiftKey });
	row.dispatchEvent(click);
	return click;
}

afterEach(() => {
	resetPanelRegistryForTests(); // the registry singleton owns cross-test state
});

describe('RowSessionItem floor verbs', () => {
	it('plain click -> addPanelFromSidebar with { sessionId, agentPreset }, no replace', () => {
		const addPanel = vi.fn(() => true);
		const replaceSelected = vi.fn(() => true);
		registerAddPanel(addPanel);
		registerReplaceSelected(replaceSelected);

		const { component, row } = mountRow(makeSession());
		const click = clickRow(row);

		expect(addPanel).toHaveBeenCalledTimes(1);
		expect(addPanel).toHaveBeenCalledWith({ sessionId: 'conv-1', agentPreset: 'research' });
		expect(replaceSelected).not.toHaveBeenCalled();
		expect(click.defaultPrevented).toBe(true); // handled -> anchor navigation suppressed
		unmount(component);
		row.remove();
	});

	it('shift+click -> replaceSelectedFromRegistry, addPanel not called', () => {
		const addPanel = vi.fn(() => true);
		const replaceSelected = vi.fn(() => true);
		registerAddPanel(addPanel);
		registerReplaceSelected(replaceSelected);

		const { component, row } = mountRow(makeSession());
		const click = clickRow(row, true);

		expect(replaceSelected).toHaveBeenCalledTimes(1);
		expect(replaceSelected).toHaveBeenCalledWith({ sessionId: 'conv-1', agentPreset: 'research' });
		expect(addPanel).not.toHaveBeenCalled();
		expect(click.defaultPrevented).toBe(true);
		unmount(component);
		row.remove();
	});

	it('registry returns handled=true -> the anchor default is prevented', () => {
		registerAddPanel(vi.fn(() => true));
		registerReplaceSelected(vi.fn(() => true));

		const { component, row } = mountRow(makeSession());
		const click = clickRow(row);
		expect(click.defaultPrevented).toBe(true);
		unmount(component);
		row.remove();
	});

	it('registry returns handled=false (no floor mounted) -> default NOT prevented', () => {
		// No handlers registered: the registry's graceful no-op answers false.
		const { component, row } = mountRow(makeSession());
		const click = clickRow(row);
		expect(click.defaultPrevented).toBe(false); // the <a> navigates (seed href fallback)
		expect(row.getAttribute('href')).toContain('conv-1');
		unmount(component);
		row.remove();
	});

	it('session.agentPreset undefined -> the payload carries undefined agentPreset', () => {
		const addPanel = vi.fn(() => true);
		registerAddPanel(addPanel);
		registerReplaceSelected(null);

		const { component, row } = mountRow(makeSession({ agentPreset: undefined }));
		clickRow(row);

		expect(addPanel).toHaveBeenCalledTimes(1);
		expect(addPanel).toHaveBeenCalledWith({ sessionId: 'conv-1', agentPreset: undefined });
		unmount(component);
		row.remove();
	});
});
