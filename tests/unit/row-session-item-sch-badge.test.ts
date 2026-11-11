/**
 * RowSessionItem × SCH badge (Scheduled Mark, task 2.2-T, ADR-0057 D2) —
 * the spine row's pins: a scheduled session shows the muted pill with the
 * EXACT text SCH; a subagent row and an ordinary (null-origin) row show
 * none. Title strings are never modified (D2) and no behavior keys to the
 * badge (D3) — this is markup presence only. Spec: dev/specs/2026-11/
 * 2026-11-10 - The Scheduled Mark.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RowSessionItemHost from '../fixtures/RowSessionItemHost.svelte';
import type { DsiSessionSummary, DsiWorkspaceSummary } from '../../src/lib/types';
import { refreshScheduleLedger } from '../../src/lib/services/schedule-ledger.svelte';

const workspaces: DsiWorkspaceSummary[] = [];

const baseSession: DsiSessionSummary = {
	sessionId: 'sch-1',
	title: 'Nightly report',
	workspace: '/tmp/ws',
	running: false,
	updatedAt: Date.now(),
	parentSessionId: null,
	origin: 'scheduled',
	agentPreset: null
} as never;

function mountRow(origin: unknown, sessionId = 'sch-1'): { target: HTMLElement; c: Record<string, unknown> } {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const c = mount(RowSessionItemHost, {
		target,
		props: { session: { ...baseSession, origin, sessionId } as DsiSessionSummary, workspaces }
	});
	flushSync();
	return { target, c };
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('row-session-item — SCH badge (Scheduled Mark 2.2-T)', () => {
	it('a scheduled row shows the badge with EXACT text SCH and keeps the title', () => {
		const { target, c } = mountRow('scheduled');
		const badge = target.querySelector('[data-testid="sidebar-sch-badge"]');
		expect(badge).not.toBeNull();
		expect(badge?.textContent).toBe('SCH');
		// D2: the title string is untouched — badge is separate DOM.
		expect(target.querySelector('.label')?.textContent).toBe('Nightly report');
		unmount(c);
		target.remove();
	});

	it('a subagent row shows NO badge', () => {
		const { target, c } = mountRow('subagent');
		expect(target.querySelector('[data-testid="sidebar-sch-badge"]')).toBeNull();
		unmount(c);
		target.remove();
	});

	it('an ordinary (null-origin) row shows NO badge', () => {
		const { target, c } = mountRow(null);
		expect(target.querySelector('[data-testid="sidebar-sch-badge"]')).toBeNull();
		unmount(c);
		target.remove();
	});
});

describe('row-session-item — SCH badge via schedule-ledger join (ADR-0057 Amendment 2026-11-11 D1-prime)', () => {
	it('a failed ledger fetch fails OPEN: an ordinary row shows NO badge', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('host down')));
		const { target, c } = mountRow(null, 'plain-1');
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		expect(target.querySelector('[data-testid="sidebar-sch-badge"]')).toBeNull();
		unmount(c);
		target.remove();
	});

	it('a null-origin session present in the ledger shows the badge (the pinned-host path)', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ items: [{ targetSessionId: 'ledger-sch-1', status: 'active' }] })
		}));
		// deterministic: land the ledger BEFORE mounting so the first render joins
		await refreshScheduleLedger();
		const { target, c } = mountRow(null, 'ledger-sch-1');
		const badge = target.querySelector('[data-testid="sidebar-sch-badge"]');
		expect(badge).not.toBeNull();
		expect(badge?.textContent).toBe('SCH');
		// D2: the title string is untouched — badge is separate DOM.
		expect(target.querySelector('.label')?.textContent).toBe('Nightly report');
		unmount(c);
		target.remove();
	});

	it('a session absent from the ledger shows NO badge (no false marks)', async () => {
		// ledger now contains ledger-sch-1 from the previous pin (module set persists);
		// this row's id is not a ledger target and its origin is null
		const { target, c } = mountRow(null, 'plain-2');
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		expect(target.querySelector('[data-testid="sidebar-sch-badge"]')).toBeNull();
		unmount(c);
		target.remove();
	});
});
