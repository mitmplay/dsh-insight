/**
 * RowSessionItem — depth class + seed href (cluster T5, coverage mop-up):
 * 1. depth 0 (default) — no 'child' class, data-depth="0".
 * 2. depth 2 — 'child' class, data-depth="2".
 * 3. seed href carries the ACTIVE workspace profile (conversationSeedUrl
 *    gets profile !== null).
 * 4. no workspace state mounted — getWorkspaceState() is null, so
 *    conversationSeedUrl receives profile null (the ?? null arm).
 * 5. session.title undefined — the interior's label falls back to
 *    'untitled'.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RowSessionItem from '$lib/components/sessions/RowSessionItem.svelte';
import { conversationSeedUrl } from '$lib/utils/seed-url';
import { setWorkspaceState } from '$lib/services/conversation/workspace-context.svelte';
import type { DsiSessionSummary, DsiWorkspaceSummary } from '$lib/types';

// The row's floor verbs — stubbed: this suite only pins depth + href.
vi.mock('$lib/services/panels/panel-registry', () => ({
	panelRegistryActive: () => false,
	addPanelFromSidebar: () => false,
	replaceSelectedFromRegistry: () => false,
	summonGlassFromRegistry: () => undefined
}));

// Seed URL builder — a shape-faithful spy so call ARGS are assertable.
vi.mock('$lib/utils/seed-url', () => ({
	conversationSeedUrl: vi.fn(
		(sessionId: string, profile: string | null = null) =>
			`/?sessionKey=${sessionId}${profile !== null ? `&profile=${profile}` : ''}`
	)
}));

const seedUrlMock = vi.mocked(conversationSeedUrl);

const workspaces: DsiWorkspaceSummary[] = [];

function sessionFixture(over: Partial<DsiSessionSummary> = {}): DsiSessionSummary {
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

function mountRow(props: { session: DsiSessionSummary; depth?: number }) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const component = mount(RowSessionItem, {
		target,
		props: { workspaces, ...props }
	});
	flushSync();
	return { component, target };
}

afterEach(() => {
	setWorkspaceState(null); // withdraw any published profile
	seedUrlMock.mockClear();
});

describe('RowSessionItem depth + seed href', () => {
	it('depth 0 (default prop) — the anchor has no child class, data-depth="0"', () => {
		const { component, target } = mountRow({ session: sessionFixture() });
		const anchor = target.querySelector('a.row') as HTMLAnchorElement;
		expect(anchor.getAttribute('data-depth')).toBe('0');
		expect(anchor.classList.contains('child')).toBe(false);
		unmount(component);
	});

	it('depth 2 — the anchor carries the child class, data-depth="2"', () => {
		const { component, target } = mountRow({ session: sessionFixture(), depth: 2 });
		const anchor = target.querySelector('a.row') as HTMLAnchorElement;
		expect(anchor.getAttribute('data-depth')).toBe('2');
		expect(anchor.classList.contains('child')).toBe(true);
		unmount(component);
	});

	it('seed href carries the ACTIVE profile — conversationSeedUrl gets profile widi', () => {
		setWorkspaceState({
			rows: [],
			selectedPanelId: null,
			profile: 'widi',
			select: () => undefined,
			remove: () => undefined
		});
		const { component, target } = mountRow({ session: sessionFixture() });
		const anchor = target.querySelector('a.row') as HTMLAnchorElement;
		expect(seedUrlMock).toHaveBeenCalledWith('conv-1', 'widi');
		expect(anchor.getAttribute('href')).toBe('/?sessionKey=conv-1&profile=widi');
		unmount(component);
	});

	it('no workspace state mounted — conversationSeedUrl is called with profile null', () => {
		const { component, target } = mountRow({ session: sessionFixture() });
		const anchor = target.querySelector('a.row') as HTMLAnchorElement;
		expect(seedUrlMock).toHaveBeenCalledWith('conv-1', null);
		expect(anchor.getAttribute('href')).toBe('/?sessionKey=conv-1');
		unmount(component);
	});

	it('session.title undefined — the interior label falls back to untitled', () => {
		const { component, target } = mountRow({
			session: sessionFixture({ title: undefined as unknown as string })
		});
		const label = target.querySelector('.label');
		expect(label?.textContent).toBe('untitled');
		unmount(component);
	});
});
