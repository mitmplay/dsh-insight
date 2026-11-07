/**
 * SidebarSessions unit tests — the app sidebar's body DATA OWNER: the
 * guarded load chain over /api/dsh/sessions, the phase branches, the
 * derived spine pipeline (paneled exclusion, glass synthetic rows,
 * lineage nesting), the persisted spine view state, and the
 * create/replace handoffs (registry-first, seed navigation fallback).
 *
 * AppSidebar's suite covers the page-side wiring; these mounts pin the
 * owner's OWN logic directly (error body, network throw, in-flight
 * coalescing, glass-row shaping, the off-floor seed fallback).
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SidebarSessions from '../../src/lib/components/sessions/SidebarSessions.svelte';
import type { DsiPreset, DsiSessionSummary, DsiWorkspaceSummary } from '../../src/lib/types';

const jsonResponse = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const SESSIONS: DsiSessionSummary[] = [
	{
		sessionId: 's-current',
		title: 'Current work',
		agentPreset: 'main',
		running: false,
		blank: false,
		updatedAt: Date.now() - 60_000,
		workspace: '/tmp/alpha',
		turns: null,
		parentSessionId: null,
		origin: 'user'
	},
	{
		sessionId: 's-two',
		title: 'Research thread',
		agentPreset: 'research',
		running: true,
		blank: false,
		updatedAt: Date.now() - 120_000,
		workspace: '/tmp/beta',
		turns: null,
		parentSessionId: null,
		origin: 'user'
	},
	{
		sessionId: 's-sub',
		title: 'Spawned helper',
		agentPreset: null,
		running: false,
		blank: false,
		updatedAt: Date.now() - 90_000,
		workspace: '/tmp/alpha',
		turns: null,
		parentSessionId: 's-two',
		origin: 'subagent'
	}
] as DsiSessionSummary[];

const REGISTRY: DsiWorkspaceSummary[] = [
	{ workspaceId: 'w-a', title: 'alpha', path: '/tmp/alpha', sessionIds: [] },
	{ workspaceId: 'w-b', title: 'beta', path: '/tmp/beta', sessionIds: [] }
];

const PRESETS: DsiPreset[] = [
	{ id: 'main', name: null, description: null, isDefault: true },
	{ id: 'research', name: 'Research', description: null, isDefault: false }
];

let instance: Record<string, unknown> | null = null;
let host: HTMLElement | null = null;

async function mountSessions(
	props: Partial<Record<string, unknown>> = {},
	fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
): Promise<HTMLElement> {
	vi.stubGlobal(
		'fetch',
		vi.fn(
			fetchImpl ??
				(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
					if (String(input) === '/api/dsh/sessions' && init?.method === 'POST')
						return jsonResponse({ ok: true, sessionId: 's-new', agentPreset: null });
					if (String(input) === '/api/dsh/sessions')
						return jsonResponse({ ok: true, sessions: SESSIONS, workspaces: REGISTRY, presets: PRESETS });
					return jsonResponse({ ok: true });
				})
		)
	);
	host = document.createElement('div');
	document.body.appendChild(host);
	instance = mount(SidebarSessions, {
		target: host,
		props: {
			currentSessionId: 's-current',
			filter: { workspace: null, preset: null, showBlank: true } as never,
			onfilterchange: vi.fn(),
			...props
		}
	});
	// Multi-await settle — the load chain ($effect → fetch → state).
	for (let i = 0; i < 10; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
	return host;
}

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	host?.remove();
	host = null;
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	localStorage.clear();
});

describe('SidebarSessions — the data owner', () => {
	it('ready phase renders the spine rows (current excluded, others listed)', async () => {
		const h = await mountSessions();
		expect(h.querySelector('[data-testid="sidebar-spine-group-rows"]')).not.toBeNull();
		const rows = h.querySelectorAll('[data-session-id]');
		const ids = [...rows].map((r) => (r as HTMLElement).dataset.sessionId);
		expect(ids).not.toContain('s-current');
		expect(ids).toContain('s-two');
	});

	it('an ok:false body flips to the error phase with the host message', async () => {
		const h = await mountSessions({}, async () =>
			jsonResponse({ ok: false, error: { code: 'boom', message: 'host down' } }, 500)
		);
		const text = h.textContent ?? '';
		expect(text).toContain('host down');
	});

	it('a non-ok response without an error body reports the status fallback', async () => {
		const h = await mountSessions({}, async () => jsonResponse({}, 503));
		expect(h.textContent ?? '').toMatch(/503/);
	});

	it('a network throw lands in the error phase with the thrown message', async () => {
		const h = await mountSessions({}, () => {
			throw new Error('socket exploded');
		});
		expect(h.textContent ?? '').toContain('socket exploded');
	});

	it('missing arrays in an ok body default to empty (?? arms)', async () => {
		const h = await mountSessions({}, async () => jsonResponse({ ok: true }));
		expect(h.querySelector('[data-testid="sidebar-sessions-empty"]')).not.toBeNull();
	});

	it('paneled sessions leave the spine', async () => {
		const h = await mountSessions({ paneledSessionIds: ['s-two'] });
		const ids = [...h.querySelectorAll('[data-session-id]')].map(
			(r) => (r as HTMLElement).dataset.sessionId
		);
		expect(ids).not.toContain('s-two');
	});

	it('glass rows join the spine as the openers browser children', async () => {
		const h = await mountSessions({
			glassRows: [{ sessionId: 'glass-1', openedBy: 's-two', title: '' }]
		});
		const ids = [...h.querySelectorAll('[data-session-id]')].map(
			(r) => (r as HTMLElement).dataset.sessionId
		);
		expect(ids).toContain('glass-1');
	});

	it('a glass row whose opener is off the floor still renders (?? fallback arms)', async () => {
		const h = await mountSessions({
			glassRows: [{ sessionId: 'glass-9', openedBy: 's-gone', title: 'Lone glass' }]
		});
		const ids = [...h.querySelectorAll('[data-session-id]')].map(
			(r) => (r as HTMLElement).dataset.sessionId
		);
		expect(ids).toContain('glass-9');
	});

	it('the spine collapse toggle persists through setSpine (localStorage write)', async () => {
		const h = await mountSessions();
		const toggle = h.querySelector('[data-testid="sidebar-spine-group-toggle"]') as HTMLButtonElement;
		toggle.click();
		flushSync();
		// The key carries no profile here (null desk): the base key itself.
		const raw = localStorage.getItem('dsi-spine-group');
		expect(raw).not.toBeNull();
		const blob = JSON.parse(raw ?? '{}');
		expect(blob.collapsed).toBe(true);
	});

	it('onfilterchange relays a preset-pill pick upward', async () => {
		const onfilterchange = vi.fn();
		const h = await mountSessions({ onfilterchange });
		// Both dimensions discriminate → both pill groups render; the pill
		// testid anchors the stable key (filter-preset-<key>).
		const pill = h.querySelector('[data-testid="filter-preset-research"]') as HTMLButtonElement;
		expect(pill).not.toBeNull();
		pill.click();
		flushSync();
		expect(onfilterchange).toHaveBeenCalledTimes(1);
		const arg = onfilterchange.mock.calls[0][0] as { preset: string | null };
		expect(arg.preset).toBe('research');
	});

	it('the Replace verb dispatches through replaceFocused (seed fallback off-floor)', async () => {
		const assigned: string[] = [];
		const origAssign = window.location.assign;
		window.location.assign = ((url: string | URL) => {
			assigned.push(String(url));
		}) as never;
		try {
			const h = await mountSessions({
				filter: { workspace: null, preset: 'research', blankMode: 'any' } as never
			});
			// Flip the footer's verb toggle to Replace, then create.
			const replaceToggle = h.querySelector('[data-testid="chat-mode-replace"]') as HTMLButtonElement;
			expect(replaceToggle).not.toBeNull();
			replaceToggle.click();
			flushSync();
			const create = h.querySelector('[data-testid="new-chat-button"]') as HTMLButtonElement;
			create.click();
			await new Promise((r) => setTimeout(r, 20));
			flushSync();
			expect(assigned.length).toBe(1);
			expect(assigned[0]).toContain('sessionKey=');
		} finally {
			window.location.assign = origAssign;
		}
	});

	it('a created session falls back to seed navigation when no floor is mounted', async () => {
		const assigned: string[] = [];
		const origAssign = window.location.assign;
		window.location.assign = ((url: string | URL) => {
			assigned.push(String(url));
		}) as never;
		try {
			// Arm the create through the filter PROP (the owner reads it, the
			// footer's preset rides filter.preset): the pill pick route needs
			// the real page to re-publish, so arm directly.
			const h = await mountSessions({
				filter: { workspace: null, preset: 'research', blankMode: 'any' } as never
			});
			const create = h.querySelector('[data-testid="new-chat-button"]') as HTMLButtonElement;
			create.click();
			await new Promise((r) => setTimeout(r, 20));
			flushSync();
			// No floor is mounted here → the registry add no-ops → the seed
			// deep-link fallback navigates.
			expect(assigned.length).toBe(1);
			expect(assigned[0]).toContain('sessionKey=');
		} finally {
			window.location.assign = origAssign;
		}
	});
});
