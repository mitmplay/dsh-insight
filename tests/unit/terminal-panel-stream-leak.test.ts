/**
 * TerminalPanel stream-leak tests, migrated to the ADR-0053 hub
 * transport (Wave 3): the row no longer owns an EventSource — it
 * subscribes to the page's ONE stream hub, and unmount unsubscribes. The
 * pins keep their teeth: the hub source closes when the last row leaves
 * (BC-7), a pending hub-ladder timer never re-opens after teardown, and
 * the ladder still climbs while the row is mounted.
 */
import { mount, unmount, flushSync } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStreamHubForTests } from '../../src/lib/services/terminal/stream-hub.svelte';

vi.mock('@xterm/xterm', () => ({
	Terminal: class {
		options = {};
		loadAddon() {}
		open() {
			throw new Error('no xterm in the leak harness');
		}
		write() {}
		onResize() {}
		onData() {}
		focus() {}
		dispose() {}
	}
}));

vi.mock('@xterm/addon-fit', () => ({
	FitAddon: class {
		fit() {}
	}
}));

class FakeResizeObserver {
	observe() {}
	disconnect() {}
}

interface FakeES {
	url: string;
	closed: boolean;
	onerror: ((e: unknown) => void) | null;
	fail(): void;
}

const sources: FakeES[] = [];

class FakeEventSource implements FakeES {
	url: string;
	closed = false;
	onmessage: ((e: { data: string }) => void) | null = null;
	onerror: ((e: unknown) => void) | null = null;
	listeners = new Map<string, Array<(e: MessageEvent) => void>>();
	constructor(url: string) {
		this.url = url;
		sources.push(this);
	}
	close() {
		this.closed = true;
	}
	addEventListener(kind: string, fn: (e: MessageEvent) => void) {
		const arr = this.listeners.get(kind) ?? [];
		arr.push(fn);
		this.listeners.set(kind, arr);
	}
	fail() {
		this.onerror?.(new Event('error'));
	}
}

beforeEach(() => {
	resetStreamHubForTests();
	sources.length = 0;
	vi.stubGlobal('EventSource', FakeEventSource);
	vi.stubGlobal('ResizeObserver', FakeResizeObserver);
	vi.stubGlobal(
		'fetch',
		vi.fn(() => Promise.resolve(new Response(JSON.stringify({ enabled: true, sessions: [] }), { headers: { 'content-type': 'application/json' } })))
	);
});

async function tick(ms = 10): Promise<void> {
	await new Promise((r) => setTimeout(r, ms));
}

async function mountAssigned(): Promise<() => void> {
	const { default: Host } = await import('./TerminalPanelHost.svelte');
	const target = document.body.appendChild(document.createElement('div'));
	const app = mount(Host, {
		target,
		props: { assigned: { sessionId: 't-1', token: 'tok' } }
	});
	flushSync();
	await tick();
	flushSync();
	return () => {
		unmount(app);
		target.remove();
	};
}

describe('TerminalPanel stream lifecycle (the pool-leak fix)', () => {
	it('row mode opens exactly one EventSource', async () => {
		const cleanup = await mountAssigned();
		expect(sources.length).toBe(1);
		// the hub transport (ADR-0053): ONE source, ids=[t-1]
		expect(sources[0].url).toContain('/api/terminal/stream?');
		expect(sources[0].url).toContain('ids=' + encodeURIComponent('["t-1"]'));
		cleanup();
	});

	it('unmount closes the live EventSource (the orphan leak)', async () => {
		const cleanup = await mountAssigned();
		expect(sources[0].closed).toBe(false);
		cleanup();
		expect(sources[0].closed).toBe(true);
	});

	it('unmount kills the reconnect ladder — a pending timer never re-opens (regression)', async () => {
		const cleanup = await mountAssigned();
		sources[0].fail(); // onerror schedules a 1s reconnect
		expect(sources[0].closed).toBe(true);
		cleanup(); // destroys BEFORE the timer fires
		await tick(1200); // the old ladder timer would have fired here
		expect(sources.length).toBe(1); // no orphan re-attach
	});

	it('the ladder still climbs while mounted — the fix does not over-close', async () => {
		const cleanup = await mountAssigned();
		sources[0].fail();
		await tick(1100); // backoff min 1s
		expect(sources.length).toBe(2); // re-attached
		expect(sources[0].closed).toBe(true);
		expect(sources[1].closed).toBe(false);
		expect(sources[1].url).toContain('resume=' + encodeURIComponent('{"t-1":0}')); // resumed from the painted offset
		cleanup();
		expect(sources[1].closed).toBe(true); // and the re-attached source is closed on unmount too
	});
});