/**
 * WorkspaceExplorerPanel file-pulse — component host test (task 3.1-T,
 * "Explorer Freshness and Image Links" Wave 3; ADR "The Silent Root").
 *
 * Contract: ONE EventSource to /api/workspace/file-events opens at mount;
 * its FIRST generation event is the baseline (no action); a later ring
 * deletes ONLY levels[''] (the root refetches via the mount effect;
 * expanded levels survive); the focus callback respects the 2000 ms floor
 * (two immediate focus events after a fresh fetch → ONE fetch); onDestroy
 * closes the source.
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WorkspaceExplorerPanel from '$lib/components/workspace-explorer/WorkspaceExplorerPanel.svelte';

const ROOT = '/tmp/ws';
const ROOT_LISTING = {
	ok: true,
	listing: { entries: [{ name: 'a.txt', kind: 'file' as const }], truncated: false }
};
const CHILD_LISTING = {
	ok: true,
	listing: { entries: [{ name: 'b.txt', kind: 'file' as const }], truncated: false }
};

/** Route-aware fetch mock: counts ROOT-level tree fetches only. */
let rootFetches = 0;
let childFetches = 0;
let fetchMock: ReturnType<typeof vi.fn>;

class MockEventSource {
	static instances: MockEventSource[] = [];
	url: string;
	readyState = 0;
	closed = false;
	onerror: (() => void) | null = null;
	private listeners = new Map<string, Array<(ev: MessageEvent) => void>>();
	constructor(url: string) {
		this.url = url;
		MockEventSource.instances.push(this);
	}
	addEventListener(type: string, fn: (ev: MessageEvent) => void): void {
		const list = this.listeners.get(type) ?? [];
		list.push(fn);
		this.listeners.set(type, list);
	}
	close(): void {
		this.closed = true;
		this.readyState = 2;
	}
	emit(type: string, data: string): void {
		for (const fn of this.listeners.get(type) ?? []) fn({ data } as MessageEvent);
	}
	errorFatal(): void {
		this.readyState = 2;
		this.onerror?.();
	}
}

function install() {
	vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);
	fetchMock = vi.fn(async (input: string | URL | Request) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
		const path = new URL(url, 'http://localhost').searchParams.get('path');
		if (path === null) {
			// Non-tree route (git-map, git-status): ok:false so the panel's git
			// gate closes honestly; NOT counted as a tree fetch.
			return new Response(JSON.stringify({ ok: false, enabled: false }), {
				headers: { 'content-type': 'application/json' }
			});
		}
		const isRoot = path === ROOT || path === ROOT + '/';
		if (isRoot) rootFetches += 1;
		else childFetches += 1;
		return new Response(JSON.stringify(isRoot ? ROOT_LISTING : CHILD_LISTING), {
			headers: { 'content-type': 'application/json' }
		});
	});
	vi.stubGlobal('fetch', fetchMock);
}

function mountPanel(expanded: string[] = []) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const comp = mount(WorkspaceExplorerPanel as any, {
		target,
		props: {
			sessionId: 's',
			root: ROOT,
			expanded,
			onToggle: () => undefined,
			onOpenFile: () => undefined,
			onCollapseAll: () => undefined
		}
	});
	flushSync();
	return {
		target,
		cleanup: () => {
			unmount(comp);
			flushSync();
			target.remove();
		}
	};
}
const mountIntoPanel = mountPanel;

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
	MockEventSource.instances = [];
	rootFetches = 0;
	childFetches = 0;
});

describe('file pulse (The Silent Root D2/D3/D4/D5)', () => {
	it('opens ONE file-events stream at mount with the root param', () => {
		install();
		const { cleanup } = mountPanel();
		expect(MockEventSource.instances.length).toBe(1);
		expect(MockEventSource.instances[0]!.url).toContain('/api/workspace/file-events');
		expect(MockEventSource.instances[0]!.url).toContain('root=' + encodeURIComponent(ROOT));
		cleanup();
	});

	it('baseline ignored; a ring refetches ONLY the root — an expanded level survives', async () => {
		install();
		const { cleanup } = mountIntoPanel(['docs']);
		const source = MockEventSource.instances[0]!;

		await vi.waitFor(() => expect(rootFetches).toBeGreaterThan(0));
		await vi.waitFor(() => expect(childFetches).toBe(1)); // docs level fetched
		const rootAt = rootFetches;
		const childAt = childFetches;

		source.emit('generation', '0'); // baseline
		flushSync();
		expect(rootFetches).toBe(rootAt);

		source.emit('generation', '0'); // same generation — no ring
		flushSync();
		expect(rootFetches).toBe(rootAt);

		source.emit('generation', '1'); // ring: root refetches, docs survives
		flushSync();
		await vi.waitFor(() => expect(rootFetches).toBe(rootAt + 1));
		await new Promise((r) => setTimeout(r, 50));
		expect(childFetches).toBe(childAt);
		cleanup();
	});

	it('focus refresh respects the 2 s floor — events inside it never fetch, one fetch after it', async () => {
		install();
		const { cleanup } = mountPanel();
		const source = MockEventSource.instances[0]!;
		const atMount = rootFetches;

		// Immediate focus events after the mount fetch: floor holds, zero fetches.
		window.dispatchEvent(new Event('focus'));
		window.dispatchEvent(new Event('focus'));
		flushSync();
		await new Promise((r) => setTimeout(r, 50));
		expect(rootFetches).toBe(atMount);

		// After the floor elapses: the FIRST focus event fetches exactly once,
		// the immediate second stays floor-blocked.
		await new Promise((r) => setTimeout(r, 2100));
		window.dispatchEvent(new Event('focus'));
		flushSync();
		await vi.waitFor(() => expect(rootFetches).toBe(atMount + 1));
		window.dispatchEvent(new Event('focus'));
		flushSync();
		await new Promise((r) => setTimeout(r, 50));
		expect(rootFetches).toBe(atMount + 1);
		cleanup();
	});

	it('onDestroy closes the stream', () => {
		install();
		const { cleanup } = mountPanel();
		const source = MockEventSource.instances[0]!;
		expect(source.closed).toBe(false);
		cleanup();
		expect(source.closed).toBe(true);
	});
});
