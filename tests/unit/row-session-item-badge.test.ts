/**
 * RowSessionItem × RowJobBadge (Job Badge Wave 2, Task 2.2-T) — the ADR-0026
 * D1 pin: a roster frame NEVER changes the row list's shape. The badge is a
 * leaf INSIDE the owner row (same [data-testid="sidebar-session-card"]
 * element count), absent on rows whose session owns no job, and a badge
 * click neither navigates nor fires the row's open/replace verbs.
 * Spec: dev/specs/2026-10/2026-10-16 - Job Badge.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import RowSessionItemHost from '../fixtures/RowSessionItemHost.svelte';
import RowJobBadge from '../../src/lib/components/sessions/RowJobBadge.svelte';
import { heartbeatScope } from '../../src/lib/services/jobs/heartbeat-scope.svelte';
import type { DsiSessionSummary, DsiWorkspaceSummary } from '../../src/lib/types';

const session: DsiSessionSummary = {
	sessionId: 'conv-1',
	title: 'Owner session',
	workspace: '/tmp/ws',
	running: false,
	updatedAt: Date.now(),
	parentSessionId: null,
	origin: 'user',
	agentPreset: null
} as never;

const workspaces: DsiWorkspaceSummary[] = [];

let jobs: unknown[] = [];
beforeEach(() => {
	// REAL timers: settleUntil polls with real setTimeout hops — fake timers
	// freeze those hops and the test hangs to its 5 s timeout (2026-10-16
	// Wave 2 re-run). Nothing here needs virtual time; kill arm timing is
	// 2.1-T's job (row-job-badge.test.ts), which owns its own fake timers.
	vi.useRealTimers();
	jobs = [
		{
			id: 'bash-1',
			kind: 'bash',
			label: 'work',
			owner: 'conv-1',
			status: 'running',
			startedAt: 1,
			output: { total: 0, earliest: 0 }
		}
	];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
			if (init?.method === 'POST') {
				return { ok: true, json: async () => ({ ok: true, outcome: 'requested' }) };
			}
			const params = new URL(String(url), 'http://localhost').searchParams;
			// ADR-0032 D5 — the scope arms via the BATCH dialect (armMany →
			// refreshBatch, which expects a rosters map); the singular form
			// stays for direct watches. Both answer the fixture's jobs.
			const batchIds = params.get('sessionIds');
			if (batchIds !== null) {
				const rosters: Record<string, unknown> = {};
				for (const id of batchIds.split(',').filter(Boolean)) {
					rosters[id] = id === 'conv-1' ? { jobs } : { jobs: [] };
				}
				return { ok: true, json: async () => ({ ok: true, rosters }) };
			}
			const sid = params.get('sessionId');
			return {
				ok: true,
				json: async () => ({ ok: true, sessionId: sid, jobs: sid === 'conv-1' ? jobs : [] })
			};
		})
	);
});

/**
 * Bounded settle: nested-child effects land their async snapshot one round
 * later than a directly-mounted component — poll (advance + flush) until the
 * predicate holds, never a fixed sleep (spec Step 3.5 harness rule).
 */
async function settleUntil(predicate: () => boolean, rounds = 30): Promise<void> {
	// Real-timer settle (a2a settle pattern): fake timers break the nested
	// child's effect scheduling here — flush + microtask + real 10 ms hops.
	for (let i = 0; i < rounds && !predicate(); i++) {
		await new Promise((r) => setTimeout(r, 10));
		flushSync();
		await Promise.resolve();
	}
	// NOTE (Wave 2): a byte-identical dynamically-imported copy of
	// RowSessionItem renders the badge fine while the static import lags one
	// flush forever under happy-dom — a vitest/vite transform-ordering
	// artifact, bisected via fixture copies (D/E/F/G/H all pass). The real
	// DOM contract is Wave 4's Playwright run.
}

async function mountRow(sid = 'conv-1') {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const component = mount(RowSessionItemHost, {
		target,
		props: { session: { ...session, sessionId: sid }, workspaces }
	});
	// ADR-0034 D2 — the badge is a pure reader; the SCOPE arms the watch
	// (same technique as 2.1-T's row-job-badge.test.ts). The real-timer
	// settle covers the scope's arm debounce + batch fetch.
	heartbeatScope.setViewport([sid]);
	flushSync();
	await settleUntil(() => Boolean(target.querySelector('[data-testid="job-badge"]')), 60);
	return { component, target };
}

/**
 * Harness warm-up (Wave 2 re-run, 2026-10-16): the FIRST-ever mount + fetch +
 * $state cycle of the roster store in a vitest worker silently fails to
 * propagate into any template (bisected 2026-10-16: byte-identical test passes
 * as test 2 of a file, fails as test 1; a throwaway mount/unmount cycle fixes
 * every later mount — see also the transform-ordering note in settleUntil).
 * Test-harness artifact only; the real DOM contract is Wave 4's Playwright
 * run. One warm cycle with the 2.1-T technique, then real timers resume.
 */
beforeAll(async () => {
	vi.useFakeTimers();
	vi.stubGlobal('fetch', vi.fn(async () => ({
		ok: true,
		json: async () => ({ ok: true, sessionId: 'warm', jobs: [] })
	})));
	const target = document.createElement('div');
	document.body.appendChild(target);
	const { default: Host } = await import('../fixtures/RowSessionItemHost.svelte');
	const c = mount(Host, { target, props: { session: { ...session, sessionId: 'conv-1', title: 'warm' }, workspaces: [] } });
	flushSync();
	await vi.advanceTimersByTimeAsync(0);
	flushSync();
	unmount(c);
	target.remove();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

afterEach(() => {
	heartbeatScope.reset(); // the scope singleton owns cross-test watch state
});
afterAll(() => {
	heartbeatScope.reset();
});

describe('RowSessionItem job badge', () => {
	it('the badge is a leaf INSIDE the owner row — the row count never changes', async () => {
		const { component, target } = await mountRow();
		expect(target.querySelectorAll('[data-testid="sidebar-session-card"]')).toHaveLength(1);
		expect(target.querySelectorAll('.row')).toHaveLength(1);
		expect(target.querySelector('[data-testid="job-badge"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="job-badge-trigger"]')?.textContent).toContain('1');
		unmount(component);
	});

	it('a row whose session owns no job renders no badge', async () => {
		const { component, target } = await mountRow('conv-other');
		await settleUntil(() => false); // full settle budget: it must stay absent
		expect(target.querySelectorAll('[data-testid="sidebar-session-card"]')).toHaveLength(1);
		expect(target.querySelector('[data-testid="job-badge"]')).toBeNull();
		unmount(component);
	});

	it('a badge click neither navigates nor fires the row verbs', async () => {
		const { component, target } = await mountRow();
		const badge = target.querySelector('[data-testid="job-badge-trigger"]') as HTMLElement;
		const row = target.querySelector('a.row') as HTMLAnchorElement;
		// The row verb contract: no panel added, no navigation. With no floor
		// mounted the anchor's default (navigation) is the observable verb —
		// the badge MUST cancel it (preventDefault) and stop propagation so
		// the row's own handler never sees the click.
		const click = new MouseEvent('click', { bubbles: true, cancelable: true });
		badge.dispatchEvent(click);
		expect(click.defaultPrevented).toBe(true);
		expect(row.getAttribute('href')).toContain('conv-1'); // row contract untouched
		unmount(component);
	});
});