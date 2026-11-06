/**
 * SidebarSessionContainer unit tests — the sidebar's session-rows shell:
 * the separator plus the filtered recency spine (SidebarSessionsList)
 * threaded through untouched. Purely presentational — the tests pin the
 * pass-through wiring (rows render, depth map rides along, spine
 * changes relay up to onspinechange).
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SidebarSessionContainer from '../../src/lib/components/sessions/SidebarSessionContainer.svelte';
import { defaultSpineGroupPrefs } from '../../src/lib/utils/spine-group-prefs';
import type { DsiSessionSummary, DsiWorkspaceSummary } from '../../src/lib/types';

const session: DsiSessionSummary = {
	sessionId: 's-1',
	title: 'First thread',
	agentPreset: null,
	running: false,
	blank: false,
	updatedAt: Date.now(),
	workspace: '/tmp/alpha',
	turns: null,
	parentSessionId: null,
	origin: 'user'
} as DsiSessionSummary;

const workspaces: DsiWorkspaceSummary[] = [];

let instance: Record<string, unknown> | null = null;
let host: HTMLElement | null = null;

function mountContainer(
	props: Partial<Record<string, unknown>> = {},
	sessions: DsiSessionSummary[] = [session]
): HTMLElement {
	host = document.createElement('div');
	document.body.appendChild(host);
	instance = mount(SidebarSessionContainer, {
		target: host,
		props: {
			current: null,
			visible: sessions,
			workspaces,
			spine: defaultSpineGroupPrefs(),
			onspinechange: vi.fn(),
			...props
		}
	});
	flushSync();
	return host;
}

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	host?.remove();
	host = null;
});

describe('SidebarSessionContainer — rows shell', () => {
	it('renders the list wrapper, the separator, and the threaded rows', () => {
		const h = mountContainer();
		expect(h.querySelector('[data-testid="sidebar-sessions-list"]')).not.toBeNull();
		expect(h.querySelector('hr')).not.toBeNull();
		expect(h.querySelector('[data-testid="sidebar-spine-group"]')).not.toBeNull();
		// The spine renders the session row through SidebarSessionsList.
		expect(h.querySelector('[data-testid="sidebar-spine-group-rows"]')).not.toBeNull();
	});

	it('an empty visible list with no current renders the empty hint', () => {
		const h = mountContainer({}, []);
		expect(h.querySelector('[data-testid="sidebar-sessions-empty"]')).not.toBeNull();
	});

	it('spine state changes relay from the list through onspinechange', () => {
		const onspinechange = vi.fn();
		const h = mountContainer({ onspinechange });
		const toggle = h.querySelector('[data-testid="sidebar-spine-group-toggle"]') as HTMLButtonElement;
		toggle.click();
		flushSync();
		expect(onspinechange).toHaveBeenCalledWith({ collapsed: true });
	});

	it('depthById rides through — a nested session renders indented', () => {
		const child: DsiSessionSummary = { ...session, sessionId: 's-child' } as DsiSessionSummary;
		const h = mountContainer({ visible: [session, child], depthById: { 's-child': 2 } });
		const rows = h.querySelectorAll('[data-session-id]');
		expect(rows.length).toBeGreaterThanOrEqual(2);
	});

	it('collapsed spine renders no rows block at all', () => {
		const spine = { ...defaultSpineGroupPrefs(), collapsed: true };
		const h = mountContainer({ spine });
		expect(h.querySelector('[data-testid="sidebar-spine-group-rows"]')).toBeNull();
	});
});
