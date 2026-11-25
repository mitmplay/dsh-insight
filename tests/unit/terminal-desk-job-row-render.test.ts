/**
 * TerminalDesk JOB ROW RENDER tests (The Job Bridge, ADR-0081 — Task 3.3-T).
 * A job row is a read-only strip stacked in its tab's split container, AFTER the
 * shells: `data-rows` = shell rows + job rows (A10).
 *   - one shell row + one job row → the split container reports data-rows="2"
 *   - the job row renders a [data-testid="job-tail"] and NO terminal panel
 *   - the wrapper is non-focusable (tabindex=-1): the ✕ is the ONLY focusable element,
 *     so nothing in a job row looks typeable (a keystroke has no token to ride)
 *   - follow events paint into the row's tail; a status event flips the indicator
 *   - the close control removes the row (and its dismissal sticks — trap 1)
 *   - a source-level pin: the job-row block names JobTail only — never
 *     TerminalPanel, never a key handler
 *
 * The shell-only pins live in tests/unit/terminal-desk.test.ts and run beside this
 * file in the wave gate — this file only ADDS row geometry.
 *
 * Harness: terminal-desk-job-rows.test.ts shape (happy-dom, mount + flushSync, a
 * FakeEventSource double, a fetch double, the shared TerminalPanelStub).
 */
import { readFileSync } from 'node:fs';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TerminalDesk from '../../src/lib/components/terminal/TerminalDesk.svelte';
import { clearJobTab, __resetFollowClientForTests } from '$lib/services/jobs/follow-client.svelte';
import { __resetRosterPushForTests } from '$lib/services/jobs/roster-push-client.svelte';
import { resetAppConfigForTests } from '$lib/services/config/app-config.svelte';
import { resetStreamHubForTests } from '../../src/lib/services/terminal/stream-hub.svelte';
import type { DsiJobView } from '$lib/types';

vi.mock('$lib/components/terminal/TerminalPanel.svelte', async () =>
	await import('./TerminalPanelStub.svelte')
);

class FakeEventSource {
	static instances: FakeEventSource[] = [];
	closed = false;
	onmessage: ((e: { data: string }) => void) | null = null;
	constructor(public url: string) {
		FakeEventSource.instances.push(this);
	}
	close(): void {
		this.closed = true;
	}
	emit(data: string): void {
		this.onmessage?.({ data });
	}
}

const OWNER = 'session-a';

const job = (id: string, status: DsiJobView['status'] = 'running', owner?: string): DsiJobView => ({
	id,
	kind: 'bash',
	label: 'coverage ' + id,
	...(owner === undefined ? {} : { owner }),
	status,
	startedAt: 1,
	output: { total: 0, earliest: 0 }
});

const frame = (sessionId: string, jobs: DsiJobView[]): string => JSON.stringify({ sessionId, jobs });

function pushSource(): FakeEventSource {
	const es = FakeEventSource.instances.find((i) => i.url === '/api/dsh/jobs/stream');
	if (!es) throw new Error('no roster push stream open');
	return es;
}

function followFor(jobId: string): FakeEventSource {
	const es = FakeEventSource.instances.find((i) => i.url.includes('/api/dsh/jobs/follow') && i.url.includes('jobId=' + jobId));
	if (!es) throw new Error('no follow stream open for ' + jobId);
	return es;
}

/** A fetch double's Response — `ok`/`status`/`json()` only, microtask-bound (see the
 *  rows suite). Every request is recorded: a keystroke must open no terminal write. */
const fetchCalls: string[] = [];
function jsonResponse(body: unknown): Response {
	return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function installFetch(): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			fetchCalls.push((init?.method ?? 'GET') + ' ' + url);
			if (url.startsWith('/api/config')) return jsonResponse({ ok: true });
			if (url === '/api/terminal' && init) return jsonResponse({ sessionId: 'minted-1', token: 'tok', totalBytes: 0 });
			return jsonResponse({}); // the roster stays dark: the push is the only signal
		})
	);
}

/** Let async work land (the config load releases held roster frames). ~10 microtask
 *  turns — the config chain alone costs ~8. */
async function settle(): Promise<void> {
	for (let i = 0; i < 10; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}

let mounted: Record<string, unknown> | null = null;
let target: HTMLElement | null = null;

async function mountDesk(): Promise<HTMLElement> {
	target = document.createElement('div');
	document.body.appendChild(target);
	mounted = mount(TerminalDesk, { target, props: {} as never }) as unknown as Record<string, unknown>;
	await settle();
	return target;
}

const rowsOf = (root: HTMLElement): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>('[data-testid="terminal-job-row"]'));

function tabContainer(root: HTMLElement, index: number): HTMLElement {
	const el = root.querySelector<HTMLElement>('[data-testid="terminal-tab-container-' + index + '"]');
	if (!el) throw new Error('no tab container ' + index);
	return el;
}

const splitRows = (root: HTMLElement, index: number): string | null =>
	tabContainer(root, index).querySelector('[data-testid="terminal-split-container"]')?.getAttribute('data-rows') ?? null;

/** A roster frame with one live job for the owner → one job row on the selected tab. */
async function mountWithJobRow(): Promise<HTMLElement> {
	const root = await mountDesk();
	pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER)]));
	flushSync();
	expect(rowsOf(root)).toHaveLength(1);
	return root;
}

/** Focusable descendants of a node: real controls, or anything with a tabindex. */
const focusable = (node: Element): Element[] =>
	Array.from(node.querySelectorAll('button, a[href], input, select, textarea, [tabindex]'));

beforeEach(() => {
	fetchCalls.length = 0;
	installFetch();
	vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
});

afterEach(() => {
	if (mounted) {
		unmount(mounted);
		mounted = null;
	}
	target?.remove();
	target = null;
	__resetFollowClientForTests();
	__resetRosterPushForTests();
	resetStreamHubForTests();
	resetAppConfigForTests();
	FakeEventSource.instances = [];
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('TerminalDesk — job row render (The Job Bridge 3.3-T)', () => {
	it('one shell row + one job row → the split container reports data-rows="2"; the row sits in the selected tab, after the shell', async () => {
		const root = await mountDesk();
		expect(splitRows(root, 0)).toBe('1'); // shell only
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER)]));
		flushSync();
		const container = tabContainer(root, 0);
		const split = container.querySelector('[data-testid="terminal-split-container"]')!;
		expect(split.getAttribute('data-rows')).toBe('2'); // 1 shell + 1 job row
		expect(container.getAttribute('data-visible')).toBe('true'); // the selected tab
		const row = rowsOf(root)[0];
		expect(split.contains(row)).toBe(true);
		// stacked AFTER the shell, never replacing it
		const panels = container.querySelectorAll('[data-testid="terminal-panel"]');
		expect(panels).toHaveLength(1);
		expect(panels[0].compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});

	it('the job row renders a [data-testid="job-tail"] and NO terminal panel', async () => {
		const root = await mountWithJobRow();
		const row = rowsOf(root)[0];
		expect(row.querySelector('[data-testid="job-tail"]')).not.toBeNull();
		expect(row.querySelectorAll('[data-testid="terminal-panel"]')).toHaveLength(0); // never a shell
		expect(row.querySelector('textarea')).toBeNull(); // xterm's helper lives in a panel only
	});

	it('the header carries the label, a live/settled indicator and the ✕; the wrapper is non-focusable — the ✕ is the ONLY focusable element', async () => {
		const root = await mountWithJobRow();
		const row = rowsOf(root)[0];
		expect(row.getAttribute('tabindex')).toBe('-1');
		expect(row.querySelector('[data-testid="terminal-job-row-state"]')?.textContent).toBe('live');
		expect(row.getAttribute('data-state')).toBe('live');
		const close = row.querySelector('[data-testid="terminal-job-row-close"]');
		expect(close).not.toBeNull();
		expect(close?.getAttribute('aria-label')).toBe('Close job row');
		// nothing else in the strip can take focus: no input, no link, no tab stop
		expect(focusable(row).filter((el) => el !== row)).toEqual([close]);
	});

	it('a keystroke aimed at the row opens NO terminal write and changes nothing', async () => {
		const root = await mountWithJobRow();
		const row = rowsOf(root)[0];
		for (const type of ['keydown', 'keypress', 'keyup']) {
			row.dispatchEvent(new KeyboardEvent(type, { key: 'r', code: 'KeyR', bubbles: true, cancelable: true }));
		}
		flushSync();
		expect(fetchCalls.filter((c) => c.includes('/send'))).toEqual([]); // no session was written
		expect(rowsOf(root)).toHaveLength(1);
		expect(document.activeElement).not.toBe(row); // tabindex=-1: a click/keystroke does not park focus on it
	});

	it('follow events paint into the row\'s tail; a status event flips the indicator to settled', async () => {
		const root = await mountWithJobRow();
		const follow = followFor('j1');
		follow.emit(JSON.stringify({ type: 'output', text: 'RUN src/a.test.ts\n', next: 18 }));
		flushSync();
		const row = rowsOf(root)[0];
		expect(row.querySelector('[data-testid="job-tail"]')?.textContent).toContain('RUN src/a.test.ts');
		follow.emit(JSON.stringify({ type: 'status', job: job('j1', 'completed', OWNER) }));
		flushSync();
		expect(rowsOf(root)[0].getAttribute('data-state')).toBe('settled');
		expect(rowsOf(root)[0].querySelector('[data-testid="terminal-job-row-state"]')?.textContent).toBe('settled');
	});

	it('the close control removes the row, closes its follow, drops data-rows — and the dismissal sticks', async () => {
		const root = await mountWithJobRow();
		const follow = followFor('j1');
		const close = rowsOf(root)[0].querySelector('[data-testid="terminal-job-row-close"]') as HTMLElement;
		close.click();
		flushSync();
		expect(rowsOf(root)).toHaveLength(0);
		expect(follow.closed).toBe(true);
		expect(splitRows(root, 0)).toBe('1'); // back to the shell alone
		expect(tabContainer(root, 0).querySelectorAll('[data-testid="terminal-panel"]')).toHaveLength(1); // the shell is untouched
		// closed while live: the same job re-arrives on the next frame — no resurrection
		pushSource().emit(frame(OWNER, [job('j1', 'running', OWNER)]));
		flushSync();
		expect(rowsOf(root)).toHaveLength(0);
	});

	it('a row closed through the roster clear command (the bus) goes the same way', async () => {
		const root = await mountWithJobRow();
		const follow = followFor('j1');
		clearJobTab(OWNER, 'j1');
		flushSync();
		expect(rowsOf(root)).toHaveLength(0);
		expect(follow.closed).toBe(true);
		expect(splitRows(root, 0)).toBe('1');
	});

	it('source-level pin: the job-row block renders JobTail only — never a TerminalPanel, never a key handler', () => {
		const src = readFileSync('src/lib/components/terminal/TerminalDesk.svelte', 'utf8');
		const start = src.indexOf('{#each tab.jobRows as jobRow (jobRow.key)}');
		const end = src.indexOf('{/each}', start);
		expect(start).toBeGreaterThan(0);
		const block = src.slice(start, end);
		expect(block).toContain('<JobTail');
		expect(block).not.toContain('<TerminalPanel');
		expect(block).not.toMatch(/onkey(down|up|press)/);
		// the split container counts BOTH arrays — shells plus job rows
		expect(src).toContain('<TerminalSplitContainer rowCount={tab.rows.length + tab.jobRows.length}>');
	});
});
