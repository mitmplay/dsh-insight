/**
 * SidebarSessionsList — the ticker-cap $effect (ADR-0034 D1).
 *
 * The component feeds the heartbeat scope two ways: the mode flip
 * (setMode from appConfig().conversation.heartbeatType) and, ONLY in
 * ticker-cap, the whole rendered spine (setSpine over visible's ids).
 * These tests mount the component DIRECTLY with the REAL app-config
 * store (steered through its /api/config seam, the app-config.test.ts
 * pattern) and a mocked heartbeat-scope module, asserting:
 *  - ticker-cap: setSpine carries exactly the rendered session ids;
 *  - non-ticker-cap: setSpine is NEVER called (the viewport effect owns
 *    that mode — covered by the viewport tests elsewhere);
 *  - a visible-list change in ticker-cap re-reports the new spine.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SidebarSessionsList from '$lib/components/sessions/SidebarSessionsList.svelte';
import {
	appConfig,
	loadAppConfig,
	resetAppConfigForTests
} from '$lib/services/config/app-config.svelte';
import { heartbeatScope } from '$lib/services/jobs/heartbeat-scope.svelte';
import type { DsiSessionSummary, DsiWorkspaceSummary } from '$lib/types';
// Test-only reactive props: the same $state proxy factory Svelte's
// compiler emits, so the component's tracked read of `visible` sees the
// splice below (plain .ts tests can't invoke runes directly).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { proxy } from 'svelte/internal/client';

vi.mock('$lib/services/jobs/heartbeat-scope.svelte', () => ({
	heartbeatScope: {
		setMode: vi.fn(),
		setSpine: vi.fn(),
		setViewport: vi.fn(),
		setAlways: vi.fn(),
		reset: vi.fn()
	}
}));

const setSpine = vi.mocked(heartbeatScope.setSpine);

/** One summary row — the full DsiSessionSummary shape. */
function summary(sessionId: string): DsiSessionSummary {
	return {
		sessionId,
		title: `Session ${sessionId}`,
		agentPreset: 'research',
		running: false,
		blank: false,
		updatedAt: Date.now(),
		workspace: '/tmp/e2e-harness',
		turns: null
	};
}

const WORKSPACES: DsiWorkspaceSummary[] = [];

interface MountHandle {
	target: HTMLElement;
	instance: Record<string, unknown>;
}

function mountList(visible: DsiSessionSummary[]): MountHandle {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(SidebarSessionsList, {
		target,
		props: {
			current: null,
			visible,
			workspaces: WORKSPACES
		}
	}) as unknown as Record<string, unknown>;
	flushSync();
	return { target, instance };
}

/** Mount with a REACTIVE visible list (a live $state proxy) — the
 *  ticker-cap effect re-runs when the test splices it. */
function mountListProxy(visible: DsiSessionSummary[]): MountHandle {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(SidebarSessionsList, {
		target,
		props: {
			current: null,
			visible,
			workspaces: WORKSPACES
		}
	}) as unknown as Record<string, unknown>;
	flushSync();
	return { target, instance };
}

/** Land a config body with the given heartbeatType through the real
 *  store's singleton GET (reset first — the load dedupes). */
async function landHeartbeatType(
	heartbeatType: 'ticker-cap' | 'viewport-cap'
): Promise<void> {
	resetAppConfigForTests();
	vi.stubGlobal(
		'fetch',
		vi.fn(async () =>
			new Response(
				JSON.stringify({ conversation: { heartbeatType } }),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			)
		)
	);
	await loadAppConfig();
	expect(appConfig().conversation.heartbeatType).toBe(heartbeatType);
	flushSync();
}

beforeEach(() => {
	resetAppConfigForTests();
	vi.clearAllMocks();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('SidebarSessionsList — ticker-cap spine feed (ADR-0034 D1)', () => {
	it('ticker-cap: setSpine is called with the rendered session ids', async () => {
		await landHeartbeatType('ticker-cap');
		const { instance } = mountList([summary('s-one'), summary('s-two'), summary('s-three')]);
		expect(setSpine).toHaveBeenCalledWith(['s-one', 's-two', 's-three']);
		unmount(instance);
	});

	it('viewport-cap (not ticker-cap): setSpine is NEVER called', async () => {
		await landHeartbeatType('viewport-cap');
		const { instance } = mountList([summary('s-one'), summary('s-two')]);
		flushSync();
		expect(setSpine).not.toHaveBeenCalled();
		unmount(instance);
	});

	it('a visible-list change in ticker-cap updates the spine set on the SAME mount', async () => {
		await landHeartbeatType('ticker-cap');
		// A $state proxy for visible — mutated under the mounted component so
		// the effect re-runs exactly as the owner's filtered feed would.
		const visible = proxy<DsiSessionSummary[]>([summary('s-one'), summary('s-two')]);
		const { target, instance } = mountListProxy(visible);
		expect(setSpine).toHaveBeenCalledWith(['s-one', 's-two']);

		setSpine.mockClear();
		visible.splice(0, visible.length, summary('s-nine'), summary('s-ten'), summary('s-eleven'));
		flushSync();
		expect(setSpine).toHaveBeenCalledWith(['s-nine', 's-ten', 's-eleven']);
		expect(target.querySelectorAll('[data-testid="sidebar-session-card"]')).toHaveLength(3);
		unmount(instance);
	});
});
