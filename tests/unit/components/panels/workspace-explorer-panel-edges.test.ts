/**
 * workspace-explorer-panel-edges — branch-mop companions to
 * workspace-explorer-panel.test.ts. Each test drives one reachable
 * conditional arm the companion doesn't: the settings-home fetch plane
 * (Settings Tree ADR D2), the ?? fallbacks on a nullish sessionId, the
 * git-map/git-status failure ladders, the split-drag owner path, the
 * EventSource pulse (baseline / ring / heartbeat), and the file-surface
 * ladder (home vs session) in the tab strip.
 * fetch is stubbed; EventSource is stubbed for the pulse tests.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkspaceExplorerPanel from '$lib/components/workspace-explorer/WorkspaceExplorerPanel.svelte';

const fetchMock = vi.fn<typeof fetch>();
const allCalls: string[] = [];

/** Git-map canned answer (gate-off default — same channel split as the
 *  companion file: tests opt into an open gate per test). */
let gitMapReply: unknown = { ok: true, enabled: false };
/** Git-status canned answer; a thrown string simulates a network crash. */
let gitStatusReply: unknown = { ok: true, enabled: true, truncated: false, files: [] };
let gitStatusFail: { reject: unknown } | null = null;
let treeReply: unknown = { ok: true, listing: { path: '', entries: [], truncated: false } };
let treeFail: { reject: unknown } | null = null;

function listing(
	entries: Array<{ name: string; type: 'file' | 'directory' | 'other' }>,
	truncated = false
) {
	return { ok: true, listing: { path: '', entries, truncated } };
}

function json(reply: unknown, status = 200): Response {
	return new Response(JSON.stringify(reply), { status });
}

/** Minimal EventSource double: records listeners, never connects. */
class FakeEventSource {
	static last: FakeEventSource | null = null;
	url: string;
	listeners = new Map<string, ((event: MessageEvent) => void)[]>();
	constructor(url: string) {
		this.url = url;
		FakeEventSource.last = this;
	}
	addEventListener(type: string, fn: (event: MessageEvent) => void): void {
		const list = this.listeners.get(type) ?? [];
		list.push(fn);
		this.listeners.set(type, list);
	}
	close(): void {}
	emit(type: string, data: string): void {
		for (const fn of this.listeners.get(type) ?? []) fn({ data } as MessageEvent);
	}
}

interface MountOverrides {
	[prop: string]: unknown;
}

function mountPanel(overrides: MountOverrides = {}) {
	const onToggle = vi.fn();
	const onOpenFile = vi.fn();
	const onOpenTab = vi.fn();
	const onCollapseAll = vi.fn();
	const onTreePctChange = vi.fn();
	const onTabChange = vi.fn();
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(WorkspaceExplorerPanel, {
		target,
		props: {
			sessionId: 's1',
			root: '/ws',
			expanded: [],
			onToggle,
			onOpenFile,
			onOpenTab,
			onCollapseAll,
			onTreePctChange,
			onTabChange,
			...overrides
		}
	});
	flushSync();
	return {
		target,
		onToggle,
		onOpenFile,
		onOpenTab,
		onCollapseAll,
		onTreePctChange,
		onTabChange,
		q: <T extends Element = Element>(sel: string): T | null => target.querySelector<T>(sel),
		qa: <T extends Element = Element>(sel: string): T[] => [...target.querySelectorAll<T>(sel)],
		cleanup: () => {
			unmount(instance);
			target.remove();
		}
	};
}

async function settle(): Promise<void> {
	// a macrotask per round: undici's Response body releases on a real tick
	for (let i = 0; i < 8; i++) {
		flushSync();
		await new Promise((r) => setTimeout(r, 0));
	}
	flushSync();
}

beforeEach(() => {
	gitMapReply = { ok: true, enabled: false };
	gitStatusReply = { ok: true, enabled: true, truncated: false, files: [] };
	gitStatusFail = null;
	treeReply = { ok: true, listing: { path: '', entries: [], truncated: false } };
	treeFail = null;
	allCalls.length = 0;
	vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
		const url = String(input);
		allCalls.push(url);
		if (url.includes('/api/workspace/git-map')) return Promise.resolve(json(gitMapReply));
		if (url.includes('/api/workspace/git-status')) {
			if (gitStatusFail !== null) return Promise.reject(gitStatusFail.reject);
			return Promise.resolve(json(gitStatusReply));
		}
		if (treeFail !== null) return Promise.reject(treeFail.reject);
		return fetchMock(input as never);
	});
});

afterEach(() => {
	fetchMock.mockReset();
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

// ── Settings Tree ADR D2: a home explorer rides /api/settings-home/tree,
// keyed by the home path, not a session id.

describe('WorkspaceExplorerPanel edges — settings-home plane (D2)', () => {
	it('fetches levels through the home URL; both childRel arms render (root + nested)', async () => {
		treeReply = listing([{ name: 'docs', type: 'directory' as const }]);
		fetchMock
			.mockResolvedValueOnce(json(listing([{ name: 'docs', type: 'directory' as const }])))
			.mockResolvedValueOnce(json(listing([{ name: 'guide.md', type: 'file' as const }])));
		const view = mountPanel({ sessionId: null, home: 'dsi', expanded: ['docs'] });
		await settle();
		const homeUrl = String(fetchMock.mock.calls[0]![0]);
		expect(homeUrl).toContain('/api/settings-home/tree?home=' + encodeURIComponent('dsi'));
		// root child ('' + name) and nested child ('docs' + '/' + name)
		const nested = view.q('[data-testid="tree-file"] .entry-name');
		expect(nested?.textContent?.trim()).toBe('guide.md');
		view.cleanup();
	});

	it('a home file click fires onOpenTab (the only behavior, D1)', async () => {
		fetchMock.mockResolvedValue(json(listing([{ name: 'README.md', type: 'file' as const }])));
		const view = mountPanel({ sessionId: null, home: 'dsi' as never });
		await settle();
		view.q<HTMLButtonElement>('[data-testid="tree-file"]')!.click();
		flushSync();
		expect(view.onOpenTab).toHaveBeenCalledWith('README.md');
		view.cleanup();
	});

	it('a persisted active home tab mounts the home editor (Settings Tree D2, no git faces)', async () => {
		// tree listing + the home file content channel
		fetchMock
			.mockResolvedValueOnce(json(listing([{ name: 'README.md', type: 'file' as const }])))
			.mockResolvedValue(json({ ok: true, file: { content: 'a: 1\n' } }));
		const view = mountPanel({ sessionId: null, home: 'dsi' as never, openTabs: ['README.md'], activeFile: 'README.md' });
		await settle();
		expect(view.q('[data-testid="workspace-file-tab-README.md"]')?.getAttribute('aria-selected')).toBe('true');
		view.cleanup();
	});
});

// ── Nullish sessionId: the ?? '' arms on every workspace URL builder.

describe('WorkspaceExplorerPanel edges — nullish sessionId ?? arms', () => {
	it('a missing sessionId builds workspace URLs with an empty session param', async () => {
		const view = mountPanel({ sessionId: undefined as never });
		await settle();
		expect(String(fetchMock.mock.calls[0]![0])).toContain('/api/dsh/workspace-tree?sessionId=&path=');
		view.cleanup();
	});

	it('git-status failure reasons ladder message → code → status; git-unavailable is its own kind', async () => {
		// open gate + one known repo so the status effect fetches
		gitMapReply = { ok: true, enabled: true, rootIsRepo: true, repos: { '.': true } };
		const mk = () => mountPanel({ sessionId: undefined as never, changesRepos: ['.'], tab: 'changes' as never });
		fetchMock.mockResolvedValue(json(listing([])));

		gitStatusReply = { ok: false, code: 'git-unavailable' };
		const a = mk();
		await settle();
		expect(a.q('[data-testid="git-changes-unavailable"]')).not.toBeNull();
		a.cleanup();

		gitStatusReply = { ok: false, message: 'boom-msg' };
		const b = mk();
		await settle();
		expect(b.target.textContent).toContain('boom-msg');
		b.cleanup();

		gitStatusReply = { ok: false, code: 'boom-code' };
		const c = mk();
		await settle();
		expect(c.target.textContent).toContain('boom-code');
		c.cleanup();

		gitStatusReply = { ok: false };
		const d = mk();
		await settle();
		expect(d.target.textContent).toContain('200');
		d.cleanup();
	});

	it('a ready status with truncated and missing files falls back; a network crash reports "network"', async () => {
		gitMapReply = { ok: true, enabled: true, rootIsRepo: true, repos: { '.': true } };
		fetchMock.mockResolvedValue(json(listing([])));
		gitStatusReply = { ok: true, truncated: true, files: [{ code: 'M ', path: 'a.txt' }] };
		const a = mountPanel({ sessionId: undefined as never, changesRepos: ['.'], tab: 'changes' as never });
		await settle();
		expect(a.target.textContent).toContain('truncated');
		a.cleanup();

		gitStatusFail = { reject: 'socket-down' };
		const b = mountPanel({ sessionId: undefined as never, changesRepos: ['.'], tab: 'changes' as never });
		await settle();
		expect(b.q('[data-testid="git-changes"]')?.textContent).toContain('network');
		b.cleanup();
	});
});

// ── Tree fetch / git-map crash ladders

describe('WorkspaceExplorerPanel edges — crash ladders', () => {
	it('a non-Error tree rejection shows the "network" failure row', async () => {
		treeFail = { reject: 'reset' };
		const view = mountPanel();
		await settle();
		expect(view.q('[data-testid="explorer-failed"]')?.textContent).toContain('network');
		view.cleanup();
	});

	it('a git-map crash closes the gate honestly (gitReady false, no statuses)', async () => {
		gitMapReply = { reject: true };
		// the stub above returns json() — simulate a reject via a bad body
		vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes('/api/workspace/git-map')) return Promise.reject(new Error('down'));
			if (url.includes('/api/workspace/git-status')) {
				return Promise.resolve(json(gitStatusReply));
			}
			return fetchMock(input as never);
		});
		fetchMock.mockResolvedValue(json(listing([])));
		const view = mountPanel({ changesRepos: ['.'] });
		await settle();
		// gate off ⇒ no changes surface
		expect(view.q('[data-testid="git-changes"]')).toBeNull();
		view.cleanup();
	});
});

// ── The split drag owner path (Explorer Layout ADR D4)

describe('WorkspaceExplorerPanel edges — split drag owner', () => {
	function stubSplitWidth(view: ReturnType<typeof mountPanel>, width: number): void {
		const split = view.q<HTMLElement>('.split')!;
		split.getBoundingClientRect = () =>
			({ width, left: 0, top: 0, right: width, bottom: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
	}

	it('a live drag moves --tree-basis; mouseup hands the pct to the owner', async () => {
		fetchMock.mockResolvedValue(json(listing([])));
		const view = mountPanel({ layout: 'explorer', treePct: 40 });
		stubSplitWidth(view, 400);
		view.q<HTMLElement>('[data-testid="panel-gutter-0"]')!.dispatchEvent(
			new MouseEvent('mousedown', { clientX: 160, bubbles: true })
		);
		flushSync();
		window.dispatchEvent(new MouseEvent('mousemove', { clientX: 200 }));
		flushSync();
		// 40% + (200-160)/400*100 = 50% of the 400px split = 200px — the drag
		// stays percent-math (the persisted authority) and renders px live.
		expect(view.q<HTMLElement>('.split')!.getAttribute('style')).toContain('--tree-basis: 200px');
		window.dispatchEvent(new MouseEvent('mouseup', { clientX: 200 }));
		flushSync();
		expect(view.onTreePctChange).toHaveBeenCalledWith(50);
		view.cleanup();
	});
});

// ── The EventSource pulse: baseline ring, generation ring, heartbeat

describe('WorkspaceExplorerPanel edges — git pulse (EventSource)', () => {
	function openGate(view: ReturnType<typeof mountPanel>): void {
		// gate answers OPEN on the second probe (root first) — the panel
		// effect probes root + expanded; a single-level desk is enough.
	}
	it('a generation ring invalidates the git caches; a same-generation ring is a no-op', async () => {
		vi.stubGlobal('EventSource', FakeEventSource as never);
		gitMapReply = { ok: true, enabled: true, rootIsRepo: true, repos: { '.': true } };
		fetchMock.mockResolvedValue(json(listing([])));
		const view = mountPanel({ changesRepos: ['.'] });
		await settle();
		const source = FakeEventSource.last;
		expect(source).not.toBeNull();
		const gitCalls = (): number => allCalls.filter((u) => u.includes('git-map')).length;
		const probesAtStart = gitCalls();
		source!.emit('generation', 'g1'); // baseline — no re-probe
		await settle();
		source!.emit('generation', 'g1'); // same generation — no re-probe
		await settle();
		expect(gitCalls()).toBe(probesAtStart);
		source!.emit('generation', 'g2'); // new generation → invalidate + re-probe
		await settle();
		expect(gitCalls()).toBeGreaterThan(probesAtStart);
		view.cleanup();
	});

	it('the visible-tab heartbeat re-probes on interval; a hidden tab skips', async () => {
		vi.stubGlobal('EventSource', FakeEventSource as never);
		gitMapReply = { ok: true, enabled: true, rootIsRepo: true, repos: { '.': true } };
		fetchMock.mockResolvedValue(json(listing([])));
		const view = mountPanel({ changesRepos: ['.'] });
		await settle();
		vi.useFakeTimers();
		const callsAt = (): number => fetchMock.mock.calls.filter((c) => String(c[0]).includes('workspace-tree')).length;
		// visible → the 30s heartbeat invalidates (root re-probe)
		vi.advanceTimersByTime(30_000);
		expect(callsAt()).toBeGreaterThan(0);
		const afterVisible = callsAt();
		// hidden → the tick fires but skips invalidation
		Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
		vi.advanceTimersByTime(30_000);
		expect(callsAt()).toBe(afterVisible);
		Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
		view.cleanup();
	});
});
