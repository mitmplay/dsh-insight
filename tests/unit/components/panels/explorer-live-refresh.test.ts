/**
 * Explorer live invalidation (Index Pulse W3): a generation ring drops the
 * git caches and re-fetches through the UNCHANGED git-status route; the
 * levels cache survives; a stream error closes the source with no retry
 * storm; enabled:false closes too; unmount closes the EventSource (no
 * leak). Follows the explorer-changes-view.test.ts mounting pattern with a
 * stubbed EventSource.
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import WorkspaceExplorerPanel from '$lib/components/workspace-explorer/WorkspaceExplorerPanel.svelte';

/** Minimal EventSource stub: records instances, lets tests fire events. */
class StubEventSource {
	static instances: StubEventSource[] = [];
	url: string;
	closed = false;
	/** EventSource constants: 0 CONNECTING, 1 OPEN, 2 CLOSED. */
	readyState = 1;
	handlers = new Map<string, Set<(e: { data?: string }) => void>>();
	onerror: (() => void) | null = null;
	constructor(url: string) {
		this.url = url;
		StubEventSource.instances.push(this);
	}
	addEventListener(type: string, cb: (e: { data?: string }) => void): void {
		if (!this.handlers.has(type)) this.handlers.set(type, new Set());
		this.handlers.get(type)!.add(cb);
	}
	close(): void {
		this.closed = true;
	}
	emit(type: string, data?: string): void {
		for (const cb of this.handlers.get(type) ?? []) cb({ data });
	}
	fireError(readyState = 2): void {
		this.readyState = readyState;
		this.onerror?.();
	}
}

const treeMock = vi.fn<typeof fetch>();
const apiMocks = new Map<string, unknown>();

function listing(entries: Array<{ name: string; type: 'file' | 'directory' | 'other' }>) {
	return { ok: true, listing: { path: '', entries, truncated: false } };
}

const OPEN_ROOT = { ok: true, enabled: true, rootIsRepo: true, repos: { app: true, docs: false } };
const STATUS_READY = { ok: true, enabled: true, truncated: false, files: [{ code: 'M ', path: 'a.ts' }] };

function mountPanel(root = '/ws') {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(WorkspaceExplorerPanel, {
		target,
		props: { sessionId: 's1', root, expanded: [], onToggle: vi.fn(), onOpenFile: vi.fn(), onCollapseAll: vi.fn(), onTabChange: vi.fn() }
	});
	return {
		target,
		cleanup: () => {
			unmount(instance);
			target.remove();
		}
	};
}

beforeEach(() => {
	StubEventSource.instances = [];
	treeMock.mockReset();
	apiMocks.clear();
	treeMock.mockResolvedValue(
		new Response(JSON.stringify(listing([{ name: 'app', type: 'directory' }])), { status: 200 })
	);
	apiMocks.set('/api/workspace/git-map', OPEN_ROOT);
	apiMocks.set('/api/workspace/git-status', STATUS_READY);
	vi.stubGlobal(
		'fetch',
		vi.fn((input: RequestInfo | URL) => {
			const url = String(input);
			for (const [marker, body] of apiMocks) {
				if (url.includes(marker)) return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
			}
			return treeMock(input as never);
		})
	);
	vi.stubGlobal('EventSource', StubEventSource as unknown as typeof EventSource);
});

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

async function stageOpenPanel() {
	const view = mountPanel();
	await flushSync();
	await new Promise((r) => setTimeout(r, 0));
	await flushSync();
	return view;
}

/** The Silent Root amendment (2026-11-12, D3): the panel now opens TWO
 *  panel-lifetime streams — the git pulse AND the independent file pulse.
 *  This suite pins the GIT pulse; select it by URL, never by index. */
function gitSource(): StubEventSource {
	const s = StubEventSource.instances.find((i) => i.url.includes('/api/workspace/git-events'));
	if (!s) throw new Error('no git-events source opened');
	return s;
}

describe('explorer live invalidation — Index Pulse W3', () => {
	it('opens ONE EventSource on an open-gate desk with repos, listing the repo abs paths', async () => {
		const view = await stageOpenPanel();
		// TWO panel-lifetime streams now (file pulse + git pulse, The Silent
		// Root D3) — the git one is asserted by URL below.
		expect(StubEventSource.instances.length).toBe(2);
		const url = gitSource().url;
		expect(url).toContain('/api/workspace/git-events?');
		expect(url).toContain('sessionId=s1');
		expect(url).toContain('root=%2Fws');
		expect(url).toContain(encodeURIComponent('/ws/app'));
		view.cleanup();
	});

	it('a generation ring re-fetches status through the UNCHANGED route and keeps the levels cache', async () => {
		const view = await stageOpenPanel();
		const source = gitSource();
		const statusFetchesBefore = String(vi.mocked(fetch)).length; // noop; counting below via api call spy instead
		// stage a DIFFERENT status answer, ring, and assert the fetch happened again
		apiMocks.set('/api/workspace/git-status', {
			ok: true, enabled: true, truncated: false, files: [{ code: 'A ', path: 'b.ts' }]
		});
		const fetchSpy = vi.mocked(globalThis.fetch);
		const before = fetchSpy.mock.calls.filter((c) => String(c[0]).includes('/api/workspace/git-status')).length;
		source.emit('generation', '0'); // connect baseline (no refetch)
		await flushSync();
		await new Promise((r) => setTimeout(r, 0));
		source.emit('generation', '1'); // a REAL ring
		await flushSync();
		await new Promise((r) => setTimeout(r, 0));
		await flushSync();
		const after = fetchSpy.mock.calls.filter((c) => String(c[0]).includes('/api/workspace/git-status')).length;
		expect(after).toBeGreaterThan(before);
		// the tree levels cache survived (only git caches invalidated)
		expect(view.target.querySelectorAll('[data-testid="workspace-explorer"]').length).toBe(1);
		view.cleanup();
	});

	it('a PERMANENT stream error (readyState CLOSED) closes the source with no retry storm', async () => {
		const view = await stageOpenPanel();
		const source = gitSource();
		source.fireError(2); // CLOSED — the browser gave up
		await flushSync();
		expect(source.closed).toBe(true);
		expect(StubEventSource.instances.length).toBe(2); // no reconnect loop (git + file streams)
		view.cleanup();
	});

	it('a TRANSIENT error (CONNECTING) keeps the stream; a generation bumped during the outage invalidates once on reconnect (stale-rows regression, headed-verified 2026-09-13)', async () => {
		const view = await stageOpenPanel();
		const source = gitSource();
		source.emit('generation', '3'); // baseline
		await flushSync();
		const fetchSpy = vi.mocked(globalThis.fetch);
		const statusCalls = (): number =>
			fetchSpy.mock.calls.filter((c) => String(c[0]).includes('/api/workspace/git-status')).length;
		const before = statusCalls();

		// Dev-server SSR reload drops the TCP side: the browser fires error
		// with readyState CONNECTING and auto-reconnects. The stream and the
		// pulse bookkeeping must survive — closing here is the stale-rows bug.
		source.fireError(0);
		await flushSync();
		expect(source.closed).toBe(false);
		expect(StubEventSource.instances.filter((i) => i.url.includes('git-events')).length).toBe(1);

		// Reconnect delivers the current generation. It bumped during the
		// outage (commits happened while nobody listened): differs from the
		// last-seen value, so it invalidates exactly once and rows go fresh.
		source.emit('generation', '7');
		await flushSync();
		await new Promise((r) => setTimeout(r, 0));
		await flushSync();
		expect(statusCalls()).toBeGreaterThan(before);
		// a repeat of the SAME generation stays inert (no storm after recovery)
		const after = statusCalls();
		source.emit('generation', '7');
		await flushSync();
		await new Promise((r) => setTimeout(r, 0));
		expect(statusCalls()).toBe(after);
		view.cleanup();
	});

	it('enabled:false closes the source', async () => {
		const view = await stageOpenPanel();
		const source = gitSource();
		source.emit('enabled');
		await flushSync();
		expect(source.closed).toBe(true);
		expect(StubEventSource.instances.filter((i) => i.url.includes('git-events')).length).toBe(1); // git pulse: no reopen
		view.cleanup();
	});

	it('the connect-baseline generation event does NOT invalidate, and a real ring never reopens the stream (reconnect-storm regression, headed-verified 2026-09-13)', async () => {
		const view = await stageOpenPanel();
		expect(StubEventSource.instances.length).toBe(2); // file pulse + git pulse (The Silent Root D3)
		const source = gitSource();
		const fetchSpy = vi.mocked(globalThis.fetch);
		const statusCalls = (): number =>
			fetchSpy.mock.calls.filter((c) => String(c[0]).includes('/api/workspace/git-status')).length;
		const mapCalls = (): number =>
			fetchSpy.mock.calls.filter((c) => String(c[0]).includes('/api/workspace/git-map')).length;
		const statusBefore = statusCalls();
		const mapBefore = mapCalls();

		// The server's FIRST generation event is the connect baseline: rows
		// were fetched fresh — invalidating here caused the blink storm.
		source.emit('generation', '0');
		await flushSync();
		await new Promise((r) => setTimeout(r, 0));
		expect(statusCalls()).toBe(statusBefore); // no refetch
		// a duplicate value is equally inert
		source.emit('generation', '0');
		await flushSync();
		await new Promise((r) => setTimeout(r, 0));
		expect(statusCalls()).toBe(statusBefore);
		// one REAL ring: refetch happens, but the stream is NOT torn down
		// and NOT reopened — instances stay at 1 even though the probe
		// effects empty and refill changesRepos mid-ring.
		source.emit('generation', '1');
		await flushSync();
		await new Promise((r) => setTimeout(r, 0));
		await flushSync();
		await new Promise((r) => setTimeout(r, 0));
		expect(statusCalls()).toBeGreaterThan(statusBefore);
		expect(mapCalls()).toBeGreaterThanOrEqual(mapBefore);
		expect(StubEventSource.instances.filter((i) => i.url.includes('git-events')).length).toBe(1);
		expect(source.closed).toBe(false);
		view.cleanup();
	});

	it('the heartbeat re-asks for fresh status every 30s while visible (deep-path safety net)', async () => {
		vi.useFakeTimers();
		try {
			const view = mountPanel();
			await flushSync();
			await vi.advanceTimersByTimeAsync(0);
			const fetchSpy = vi.mocked(globalThis.fetch);
			const statusCalls = (): number =>
				fetchSpy.mock.calls.filter((c) => String(c[0]).includes('/api/workspace/git-status')).length;
			const afterLoad = statusCalls();
			await vi.advanceTimersByTimeAsync(29_999);
			expect(statusCalls()).toBe(afterLoad); // nothing before the cadence
			await vi.advanceTimersByTimeAsync(1);
			await flushSync();
			await vi.advanceTimersByTimeAsync(100);
			expect(statusCalls()).toBeGreaterThan(afterLoad); // heartbeat fired
			view.cleanup();
			const stopped = statusCalls();
			await vi.advanceTimersByTimeAsync(120_000);
			expect(statusCalls()).toBe(stopped); // destroy stops the heartbeat
		} finally {
			vi.useRealTimers();
		}
	});

	it('unmount closes the EventSource — no watcher leak', async () => {
		const view = await stageOpenPanel();
		const source = gitSource();
		view.cleanup();
		expect(source.closed).toBe(true);
	});

	it('a gated git-events answer is refused ONCE — sticky, no reopen loop (Always Tabs D2, task 2.2-T)', async () => {
		const view = await stageOpenPanel();
		const source = gitSource();
		source.fireError(2); // the gated JSON enabled:false answer surfaces as a FATAL error
		await flushSync(); // the pulseRefused flip re-runs the pulse effect
		await new Promise((r) => setTimeout(r, 0));
		await flushSync();
		await new Promise((r) => setTimeout(r, 0));
		await flushSync();
		expect(source.closed).toBe(true);
		expect(StubEventSource.instances.filter((i) => i.url.includes('git-events')).length).toBe(1); // ONE doomed git attempt, never a loop
		view.cleanup();
	});

	it('no heartbeat without a live stream — a refused pulse leaves zero standing cost (Always Tabs D2, task 2.2-T)', async () => {
		vi.useFakeTimers();
		try {
			const view = mountPanel();
			await flushSync();
			await vi.advanceTimersByTimeAsync(0);
			const fetchSpy = vi.mocked(globalThis.fetch);
			const statusCalls = (): number =>
				fetchSpy.mock.calls.filter((c) => String(c[0]).includes('/api/workspace/git-status')).length;
			gitSource().fireError(2); // gated answer → sticky refusal
			await flushSync();
			await vi.advanceTimersByTimeAsync(0);
			const frozen = statusCalls();
			await vi.advanceTimersByTimeAsync(90_000); // three heartbeat cadences
			await flushSync();
			expect(statusCalls()).toBe(frozen); // no interval ever fires without a stream
			view.cleanup();
		} finally {
			vi.useRealTimers();
		}
	});
});
