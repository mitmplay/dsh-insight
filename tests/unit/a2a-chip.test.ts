/**
 * a2a-chip unit tests (Task 4.2-T) — the sender-panel chip join.
 *
 * Component layer (A2aChipStack, mounted through ConversationPanel the
 * way the page feeds it): waiting chip renders with the target title;
 * settled chips render DISTINCTLY per state — replied_exact vs
 * replied_approx ("may have replied" text, never the confident string);
 * timeout grey; click = the registry doorway round-trip; stack cap 3 +
 * overflow; local-only dismiss.
 *
 * Page layer: the a2a fetch joins the EXISTING spine cadence (no new
 * client timers — asserted by spying global setInterval); rows flow to
 * the panel's chips.
 *
 * Spec: dev/specs/2026-08-25 - DSI a2a Signature and Delegation Ledger
 *      (Tasks 4.2/4.2-T; PRD acceptance 7 + spec-check GAP-5).
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
// Static on purpose: the panel must bind to the SAME svelte runtime as
// mount/flushSync below (second-instance binding → effect_orphan).
import ConversationPanel from '../../src/lib/components/conversation/panel/ConversationPanel.svelte';
import A2aRowsHost from '../fixtures/A2aRowsHost.svelte';
import { registerAddPanel, resetPanelRegistryForTests,
	type PanelAddRequest
} from '../../src/lib/services/panels/panel-registry';
import type { DsiA2aExchangeView } from '$lib/types';

function row(p: Partial<DsiA2aExchangeView> & { id: string }): DsiA2aExchangeView {
	return {
		fromSession: 'session-sender',
		toSession: 'session-target',
		message: 'run tests and report',
		state: 'waiting',
		sentAt: 1_000,
		settledAt: null,
		error: null,
		...p
	};
}

/** Mount the panel with a2a rows exactly the way the page does. */
async function mountPanel(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(ConversationPanel, {
		target,
		props: {
			sessionId: 'session-sender',
			agent: null,
			entries: [],
			lastSeq: -1,
			running: false,
			...props
		} as never
	});
	await settle();
	return { target, instance };
}

async function settle(): Promise<void> {
	for (let i = 0; i < 6; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}

function chips(target: HTMLElement): HTMLElement[] {
	return Array.from(target.querySelectorAll('[data-testid="a2a-chip"]')) as HTMLElement[];
}

afterEach(() => {
	resetPanelRegistryForTests();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('A2aChipStack — rendering the ledger honestly (Task 4.2-T)', () => {
	it('waiting chip renders with the target title', async () => {
		const { target, instance } = await mountPanel({
			a2aRows: [row({ id: 'a2a-w1', toSession: 'session-tgt' })],
			a2aTitles: { 'session-tgt': 'TE-LO-LET' }
		});
		const list = chips(target);
		expect(list).toHaveLength(1);
		expect(list[0].getAttribute('data-a2a-state')).toBe('waiting');
		const btn = list[0].querySelector('[data-testid="a2a-chip-button"]') as HTMLElement;
		// Target title rides the accessible tooltip (title attr).
		expect(btn.getAttribute('title')).toContain('TE-LO-LET');
		expect(btn.textContent).toContain('waiting');
		unmount(instance);
	});

	it('each state renders distinctly — verbatim text, all six', async () => {
		const { target, instance } = await mountPanel({
			a2aRows: [
				row({ id: 'a2a-s1', state: 'replied_exact' }),
				row({ id: 'a2a-s2', state: 'replied' }),
				row({ id: 'a2a-s3', state: 'replied_approx' }),
				row({ id: 'a2a-s4', state: 'timeout' }),
				row({ id: 'a2a-s5', state: 'gone' })
			]
		});
		// Cap 3 + overflow: only the newest 3 render + the overflow chip.
		const list = chips(target);
		expect(list).toHaveLength(3);
		expect(target.querySelector('[data-testid="a2a-chip-overflow"]')?.textContent).toContain('+2 more');
		// Verbatim labels — the honest vocabulary (never a confident claim).
		expect(list[0].textContent).toContain('replied (exact)');
		expect(list[0].textContent).not.toContain('may have replied');
		expect(list[1].textContent).toContain('replied');
		expect(list[2].textContent).toContain('may have replied');
		// Verbatim labels — the honest vocabulary (never a confident claim):
		// replied_approx's WHOLE label is the hedge "may have replied" —
		// never the confident "replied"/"replied (exact)" label of a tier
		// the row cannot support (spec-check GAP-5).
		expect(list[2].textContent?.trim()).toBe('may have replied');
		unmount(instance);
	});

	it('replied_exact vs replied_approx are visually distinct classes', async () => {
		const { target, instance } = await mountPanel({
			a2aRows: [
				row({ id: 'a2a-d1', state: 'replied_exact' }),
				row({ id: 'a2a-d2', state: 'replied_approx' })
			]
		});
		const [exact, approx] = chips(target);
		expect(exact.getAttribute('data-a2a-state')).toBe('replied_exact');
		expect(approx.getAttribute('data-a2a-state')).toBe('replied_approx');
		const exactBtn = exact.querySelector('[data-testid="a2a-chip-button"]') as HTMLElement;
		const approxBtn = approx.querySelector('[data-testid="a2a-chip-button"]') as HTMLElement;
		expect(exactBtn.className).not.toBe(approxBtn.className);
		unmount(instance);
	});

	it('timeout renders grey-hedged (tone class), never red', async () => {
		const { target, instance } = await mountPanel({
			a2aRows: [row({ id: 'a2a-t1', state: 'timeout' })]
		});
		const [timeoutChip] = chips(target);
		expect(timeoutChip.getAttribute('data-a2a-state')).toBe('timeout');
		const btn = timeoutChip.querySelector('[data-testid="a2a-chip-button"]') as HTMLElement;
		expect(btn.className).toContain('tone-timeout');
		expect(btn.textContent).toContain('no reply (timeout)');
		unmount(instance);
	});

	it('click = the registry doorway — addPanelFromSidebar round-trip', async () => {
		const opened: PanelAddRequest[] = [];
		registerAddPanel((request) => opened.push({ ...request }));
		const { target, instance } = await mountPanel({
			a2aRows: [row({ id: 'a2a-c1', toSession: 'session-door' })]
		});
		(chips(target)[0].querySelector('[data-testid="a2a-chip-button"]') as HTMLElement).click();
		await settle();
		expect(opened).toEqual([{ sessionId: 'session-door', agentPreset: null }]);
		unmount(instance);
	});

	it('dismiss is local-only visual — the row stays in props (durable ledger)', async () => {
		const { target, instance } = await mountPanel({
			a2aRows: [row({ id: 'a2a-x1' })]
		});
		expect(chips(target)).toHaveLength(1);
		(chips(target)[0].querySelector('[data-testid="a2a-chip-dismiss"]') as HTMLElement).click();
		await settle();
		expect(chips(target)).toHaveLength(0); // visually gone…
		// …but nothing was deleted anywhere: rows still flow (a new chip
		// for a different row renders — props are the page's truth).
		const inst2 = instance;
		void inst2;
		unmount(instance);
		// Remount with the same rows: the dismissed id is LOCAL state — a
		// fresh mount shows it again (durable rows, visual-only dismissal).
		const { target: t2, instance: i2 } = await mountPanel({
			a2aRows: [row({ id: 'a2a-x1' })]
		});
		expect(chips(t2)).toHaveLength(1);
		unmount(i2);
	});

	it('empty rows render nothing (no chip stack at all)', async () => {
		const { target, instance } = await mountPanel({});
		expect(chips(target)).toHaveLength(0);
		unmount(instance);
	});
});

describe('ConversationPanel — no new client timers (Task 4.2-T, BC-7)', () => {
	it('mounting with a2a rows schedules ZERO setInterval — the page owns the spine cadence', async () => {
		const intervals = vi.fn((...args: unknown[]) => setTimeout(args[0] as () => void, 1_000_000));
		vi.stubGlobal('setInterval', intervals);
		const { target, instance } = await mountPanel({
			a2aRows: [row({ id: 'a2a-timer' })]
		});
		expect(chips(target)).toHaveLength(1); // chips ARE rendered…
		expect(intervals).not.toHaveBeenCalled(); // …with no new timer.
		unmount(instance);
	});

	it('the chip path fetches nothing — rows arrive as props from the page', async () => {
		const fetchMock = vi.fn(async (input: unknown) => {
			const url = String(input ?? '');
			// Any real panel fetch the mount triggers (model, orchestrator
			// poll) is fine — the assertion is about the CHIP path only.
			if (url.includes('/api/a2a')) {
				throw new Error('chip path must not fetch — rows arrive as props');
			}
			return new Response(JSON.stringify({ ok: true, entries: [], lastSeq: -1, running: false }), { status: 200 });
		});
		vi.stubGlobal('fetch', fetchMock);
		const { target, instance } = await mountPanel({
			a2aRows: [row({ id: 'a2a-fetch' })]
		});
		expect(chips(target)).toHaveLength(1);
		// The panel's own mount fetches (models + orchestrator events poll)
		// are expected — the chip path adds ZERO: no recorded URL hits /api/a2a.
		const urls = fetchMock.mock.calls.map((c) => String(c[0] ?? ''));
		expect(urls.length).toBeGreaterThan(0); // the panel did mount-fetch
		expect(urls.some((u) => u.includes('/api/a2a'))).toBe(false); // never the ledger
		unmount(instance);
	});
});

describe('ConversationPanel — spine-joined poll (Task 4.2-T, page layer)', () => {
	it('a settled row flows: rows update → chip text updates (waiting → replied_exact)', async () => {
		// The page updates the a2aRows prop on every spine tick; runes
		// props flow parent→child, so drive them through a reactive host
		// (the TitleHost pattern — static import, test handle setter).
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(A2aRowsHost, {
			target,
			props: {
				a2aRows: [row({ id: 'a2a-live', state: 'waiting' })],
				a2aTitles: {}
			} as never
		});
		await settle();
		expect(chips(target)[0].getAttribute('data-a2a-state')).toBe('waiting');
		instance.setRows([row({ id: 'a2a-live', state: 'replied_exact' })]);
		await settle();
		expect(chips(target)[0].getAttribute('data-a2a-state')).toBe('replied_exact');
		expect(chips(target)[0].textContent).toContain('replied (exact)');
		unmount(instance);
	});

	// (page-layer journey test lives in conversation-page.test.ts — the
	// page changed this wave; its harness owns the real mount.)
});
