/**
 * WorkspaceExplorerPanel tests (W3 task 3.1-T) — the tree render +
 * intent contract (Workspace Explorer ADR D1/D4):
 *   - title = workspace basename; separator-only root shows the root;
 *   - a fetch once per expanded level via /api/dsh/directory;
 *   - dirs-first natural ordering;
 *   - failure / truncated / empty rows render (never blank);
 *   - dir click fires onToggle with the root-RELATIVE path; file click
 *     fires onOpenFile; the panel never mutates expanded itself;
 *   - the header toolbar emits refresh (levels re-fetch) and collapse-all
 *     (owner intent) — WorkspaceExplorerHeader extraction. The workspace
 *     TITLE and the full-path COPY live in PanelColumn's PanelHeader
 *     (pinned in panel-column-header-passthrough.test.ts).
 * fetch is stubbed; the clipboard API is stubbed on navigator.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkspaceExplorerPanel from '$lib/components/workspace-explorer/WorkspaceExplorerPanel.svelte';

const fetchMock = vi.fn<typeof fetch>();

/** Git Eye (Wave 3): the git-map probe's canned answer (gate-off default). */
let gitMapReply: unknown = { ok: true, enabled: false };
function setGitMapReply(v: unknown): void {
	gitMapReply = v;
}

function listing(
	entries: Array<{ name: string; type: 'file' | 'directory' | 'other' }>,
	truncated = false
) {
	return {
		ok: true,
		listing: { path: '', entries, truncated }
	};
}

function mountPanel(root: string, expanded: readonly string[] = []) {
	const onToggle = vi.fn();
	const onOpenFile = vi.fn();
	const onOpenTab = vi.fn();
	const onCollapseAll = vi.fn();
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(WorkspaceExplorerPanel, {
		target,
		props: { sessionId: 's1', root, expanded, onToggle, onOpenFile, onOpenTab, onCollapseAll }
	});
	flushSync();
	return {
		target,
		onToggle,
		onOpenFile,
		onOpenTab,
		onCollapseAll,
		q: <T extends Element = Element>(sel: string): T | null => target.querySelector<T>(sel),
		qa: <T extends Element = Element>(sel: string): T[] => [...target.querySelectorAll<T>(sel)],
		cleanup: () => {
			unmount(instance);
			target.remove();
		}
	};
}

beforeEach(() => {
	gitMapReply = { ok: true, enabled: false };
	// Git Eye (Wave 3): git-map probes ride a SEPARATE canned answer so the
	// Once-queues and call-count pins below keep measuring ONLY the tree
	// channel. Tests opt into an open gate via setGitMapReply().
	vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.includes('/api/workspace/git-map')) {
			return Promise.resolve(new Response(JSON.stringify(gitMapReply), { status: 200 }));
		}
		if (url.includes('/api/workspace/git-status')) {
			// Git Eye statuses ride their own channel — the tree Once-queues
			// below keep measuring ONLY the tree channel.
			return Promise.resolve(
				new Response(JSON.stringify({ ok: true, enabled: true, truncated: false, files: [] }), { status: 200 })
			);
		}
		return fetchMock(input as never);
	});
});

afterEach(() => {
	fetchMock.mockReset();
	vi.unstubAllGlobals();
});

describe('WorkspaceExplorerPanel — root level (3.1-T)', () => {
	it('fetches the root level once on mount, path URL-encoded', async () => {
		fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(listing([
			{ name: 'README.md', type: 'file' as const }
		])), { status: 200 }));
		const view = mountPanel('/tmp/dsi-e2e-ws');
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		// Exactly ONE fetch: the root level, path URL-encoded. (The title
		// and the full-path copy live in PanelColumn's PanelHeader —
		// panel-column-header-passthrough.test.ts pins them.)
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(String(fetchMock.mock.calls[0]![0])).toContain('/api/dsh/workspace-tree?sessionId=s1&path=' + encodeURIComponent('/tmp/dsi-e2e-ws'));
		expect(view.qa('[data-testid="tree-file"]')).toHaveLength(1);
		view.cleanup();
	});
});

describe('WorkspaceExplorerPanel — rows (3.1-T)', () => {
	it('a failed root level renders the failure row — never blank', async () => {
		fetchMock.mockRejectedValueOnce(new Error('502'));
		const view = mountPanel('/ws');
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		expect(view.q('[data-testid="explorer-failed"]')).not.toBeNull();
		view.cleanup();
	});

	it('a truncated child level renders the truncated row', async () => {
		fetchMock
			// root: one dir named "big"
			.mockResolvedValueOnce(new Response(JSON.stringify(listing([{ name: 'big', type: 'directory' as const }])), { status: 200 }))
			// big/: truncated listing
			.mockResolvedValueOnce(new Response(JSON.stringify(listing([{ name: 'a.txt', type: 'file' as const }], true)), { status: 200 }));
		const view = mountPanel('/ws', ['big']);
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		expect(view.qa('[data-testid="tree-file"]').map((el) => el.querySelector('.entry-name')?.textContent)).toEqual(['a.txt']);
		expect(view.target.textContent).toContain('truncated');
		view.cleanup();
	});

	it('an empty child level renders the empty row', async () => {
		fetchMock
			.mockResolvedValueOnce(new Response(JSON.stringify(listing([{ name: 'void', type: 'directory' as const }])), { status: 200 }))
			.mockResolvedValueOnce(new Response(JSON.stringify(listing([])), { status: 200 }));
		const view = mountPanel('/ws', ['void']);
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		expect(view.target.textContent).toContain('Empty folder');
		view.cleanup();
	});

	it('orders directories first, then natural name order', async () => {
		fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(listing([
				{ name: 'zeta.txt', type: 'file' as const },
				{ name: 'src', type: 'directory' as const },
				{ name: 'app.ts', type: 'file' as const },
				{ name: 'docs', type: 'directory' as const }
		])), { status: 200 }));
		const view = mountPanel('/ws');
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		// dirs (src, docs) first — no fetched level yet, so the no-dot
		// heuristic orders them; files follow in natural order.
		const labels = view.qa('[data-testid="tree-dir"], [data-testid="tree-file"]').map(
			(el) => el.querySelector('.entry-name')!.textContent!.trim()
		);
		expect(labels.indexOf('src')).toBeLessThan(labels.indexOf('app.ts'));
		expect(labels.indexOf('docs')).toBeLessThan(labels.indexOf('zeta.txt'));
		view.cleanup();
	});
});

describe('WorkspaceExplorerPanel — intent callbacks (3.1-T)', () => {
	it('a dir click fires onToggle with the ROOT-RELATIVE path (nested)', async () => {
		fetchMock
			.mockResolvedValueOnce(new Response(JSON.stringify(listing([{ name: 'a', type: 'directory' as const }])), { status: 200 }))
			.mockResolvedValueOnce(new Response(JSON.stringify(listing([{ name: 'b', type: 'directory' as const }])), { status: 200 }));
		const view = mountPanel('/ws');
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		view.q<HTMLButtonElement>('[data-testid="tree-dir"]')!.click();
		flushSync();
		expect(view.onToggle).toHaveBeenCalledWith('a');
		view.cleanup();
	});

	it('a file click opens a TAB — onOpenTab with the nested relative path (Settings Tree D1)', async () => {
		fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(listing([
			{ name: 'notes', type: 'directory' as const },
			{ name: 'app.ts', type: 'file' as const }
		])), { status: 200 }));
		const view = mountPanel('/ws');
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		const file = view.qa<HTMLButtonElement>('[data-testid="tree-file"]').find(
			(el) => el.querySelector('.entry-name')!.textContent!.trim() === 'app.ts'
		)!;
		file.click();
		flushSync();
		expect(view.onOpenTab).toHaveBeenCalledWith('app.ts');
		view.cleanup();
	});
});

describe('WorkspaceExplorerPanel — header toolbar (WorkspaceExplorerToolbar)', () => {
	it('the refresh button drops the levels cache and re-fetches root + expanded', async () => {
		fetchMock
			.mockResolvedValueOnce(new Response(JSON.stringify(listing([{ name: 'src', type: 'directory' as const }])), { status: 200 }))
			.mockResolvedValueOnce(new Response(JSON.stringify(listing([{ name: 'a.ts', type: 'file' as const }])), { status: 200 }))
			// refresh: root + still-expanded src again
			.mockResolvedValueOnce(new Response(JSON.stringify(listing([{ name: 'src', type: 'directory' as const }])), { status: 200 }))
			.mockResolvedValueOnce(new Response(JSON.stringify(listing([{ name: 'b.ts', type: 'file' as const }])), { status: 200 }));
		const view = mountPanel('/ws', ['src']);
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		expect(fetchMock).toHaveBeenCalledTimes(2);
		view.q<HTMLButtonElement>('[data-testid="explorer-refresh"]')!.click();
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		expect(fetchMock).toHaveBeenCalledTimes(4);
		expect(String(fetchMock.mock.calls[2]![0])).toContain(encodeURIComponent('/ws'));
		expect(String(fetchMock.mock.calls[3]![0])).toContain(encodeURIComponent('/ws/src'));
		view.cleanup();
	});

	it('the collapse-all button fires onCollapseAll (owner intent)', () => {
		fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(listing([])), { status: 200 }));
		const view = mountPanel('/ws', ['a', 'b']);
		view.q<HTMLButtonElement>('[data-testid="explorer-collapse-all"]')!.click();
		flushSync();
		expect(view.onCollapseAll).toHaveBeenCalledOnce();
		view.cleanup();
	});
});

// ── Shared Tree ADR D4 (2026-09-16): sessionId stays on the persisted
// shape as PROVENANCE — the blob validates and restores UNCHANGED; only
// its meaning moved (the root is the identity, D1). The restore path
// (loadPanelPrefs) is the hard shape boundary; pin it byte-stable.

describe('workspace-explorer persisted shape restore (Shared Tree D4)', () => {
	it('a stored explorer blob with sessionId, root, expanded and tab restores field-for-field', async () => {
		const { loadPanelPrefs, PANEL_PREFS_KEY } = await import('$lib/utils/panel-prefs');
		const blob = {
			panels: [
				{
					id: 'w1',
					kind: 'workspace-explorer',
					sessionId: 's-origin',
					root: '/repo/deep',
					expanded: ['src', 'docs'],
					tab: 'changes',
					width: 280
				}
			],
			selectedPanelId: 'w1',
			panelWidth: 730,
			zoom: 1
		};
		localStorage.setItem(PANEL_PREFS_KEY, JSON.stringify(blob));
		const prefs = loadPanelPrefs(null);
		const restored = prefs.panels.find((p) => p.kind === 'workspace-explorer');
		expect(restored).toMatchObject({
			id: 'w1',
			kind: 'workspace-explorer',
			sessionId: 's-origin', // provenance survives — no migration (D4)
			root: '/repo/deep', // identity — the dedupe key (D1)
			expanded: ['src', 'docs'],
			tab: 'changes',
			// Settings Tree D1: the 280 fixture clamps UP into the wide lane.
			width: 520
		});
		expect(prefs.selectedPanelId).toBe('w1');
	});

	it('an explorer blob missing root is still hard junk; missing sessionId is still hard junk', async () => {
		const { loadPanelPrefs, PANEL_PREFS_KEY } = await import('$lib/utils/panel-prefs');
		localStorage.setItem(
			PANEL_PREFS_KEY,
			JSON.stringify({
				panels: [
					{ id: 'w1', kind: 'workspace-explorer', sessionId: 's1', expanded: [], width: 280 },
					{ id: 'w2', kind: 'workspace-explorer', root: '/r', expanded: [], width: 280 }
				],
				selectedPanelId: null,
				panelWidth: 730,
				zoom: 1
			})
		);
		const prefs = loadPanelPrefs(null);
		// both entries fail the hard shape check — the floor restores empty.
		expect(prefs.panels.filter((p) => p.kind === 'workspace-explorer')).toHaveLength(0);
	});

	it('openTabs and activeFile persist through the prefs round trip (Shared Tree amendment)', async () => {
		localStorage.setItem(
			'dsi-panels',
			JSON.stringify({
				panels: [
					{
						id: 'w1',
						kind: 'workspace-explorer',
						sessionId: 's1',
						root: '/r',
						expanded: [],
						openTabs: ['docs/x.md', 'README.md', 42, 'docs/x.md'],
						activeFile: 'README.md',
						width: 600
					}
				],
				selectedPanelId: 'w1',
				panelWidth: 730,
				zoom: 1
			})
		);
		const { loadPanelPrefs } = await import('$lib/utils/panel-prefs');
		const prefs = loadPanelPrefs(null);
		const ex = prefs.panels.find((p) => p.kind === 'workspace-explorer') as {
			openTabs?: string[];
			activeFile?: string | null;
		};
		// junk member (42) drops, duplicate keeps first — same clamp as expanded.
		expect(ex.openTabs).toEqual(['docs/x.md', 'README.md']);
		expect(ex.activeFile).toBe('README.md');
	});

	it('a non-string activeFile sanitizes to null', async () => {
		localStorage.setItem(
			'dsi-panels',
			JSON.stringify({
				panels: [
					{ id: 'w1', kind: 'workspace-explorer', sessionId: 's1', root: '/r', expanded: [], activeFile: 7, width: 600 }
				],
				selectedPanelId: null,
				panelWidth: 730,
				zoom: 1
			})
		);
		const { loadPanelPrefs } = await import('$lib/utils/panel-prefs');
		const prefs = loadPanelPrefs(null);
		const ex = prefs.panels.find((p) => p.kind === 'workspace-explorer') as { activeFile?: string | null };
		expect(ex.activeFile).toBeNull();
	});

	// The file click needs a real tab strip target; a dedicated mount with
	// explorer-layout props (Task 2.4-T — The Explorer Layout ADR D3/D5).
	function mountExplorerLayout(overrides: Record<string, unknown> = {}) {
		const onToggle = vi.fn();
		const onOpenFile = vi.fn();
		const onTreePctChange = vi.fn();
		const onPendingOpenConsumed = vi.fn();
		const onCollapseAll = vi.fn();
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(WorkspaceExplorerPanel, {
			target,
			props: {
				sessionId: 's1',
				root: '/repo',
				expanded: [],
				layout: 'explorer',
				onToggle,
				onOpenFile,
				onCollapseAll: vi.fn(),
				onTreePctChange,
				onPendingOpenConsumed,
				...overrides
			}
		});
		flushSync();
		return {
			target,
			onOpenFile,
			onTreePctChange,
			onPendingOpenConsumed,
			q: <T extends Element = Element>(sel: string): T | null => target.querySelector<T>(sel),
			qa: <T extends Element = Element>(sel: string): T[] => [...target.querySelectorAll<T>(sel)],
			cleanup: () => {
				unmount(instance);
				target.remove();
			}
		};
	}

	describe('WorkspaceExplorerPanel — explorer layout (Explorer Layout ADR D3/D5, 2.4-T)', () => {
		beforeEach(() => {
			fetchMock.mockReset();
			fetchMock.mockReturnValue(Promise.resolve(new Response(JSON.stringify(listing([])), { status: 200 })));
		});

		it('the pendingOpenFile intent fires the OWNER open-tab callback', () => {
			const onOpenTab = vi.fn();
			const view = mountExplorerLayout({
				pendingOpenFile: { path: 'src/a.ts', nonce: 7 },
				onOpenTab
			});
			expect(view.onPendingOpenConsumed).toHaveBeenCalledWith(7);
			expect(onOpenTab).toHaveBeenCalledWith('src/a.ts');
			view.cleanup();
		});

		it('PERSISTED tabs render from the owner props — hard-reload restoration', () => {
			const view = mountExplorerLayout({
				openTabs: ['src/a.ts', 'README.md'],
				activeFile: 'README.md'
			});
			const tabs = view.qa('[data-testid^="workspace-file-tab-"][role="tab"]');
			expect(tabs).toHaveLength(2);
			// the persisted ACTIVE tab is selected, and its file surface mounts.
			expect(view.q('[data-testid="workspace-file-tab-README.md"]')?.getAttribute('aria-selected')).toBe('true');
			expect(view.q('[data-testid="workspace-file-tab-src/a.ts"]')?.getAttribute('aria-selected')).toBe('false');
			view.cleanup();
		});

		it('the per-tab [x] fires the OWNER close callback (the owner owns the list)', () => {
			const onCloseTab = vi.fn();
			const view = mountExplorerLayout({
				openTabs: ['src/a.ts'],
				activeFile: 'src/a.ts',
				onCloseTab
			});
			const close = view.q('[data-testid="workspace-file-tabclose-src/a.ts"]') as HTMLElement;
			close.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			flushSync();
			expect(onCloseTab).toHaveBeenCalledWith('src/a.ts');
			view.cleanup();
		});

		it('clicking a sibling tab fires the OWNER activate callback', () => {
			const onActivateTab = vi.fn();
			const view = mountExplorerLayout({
				openTabs: ['src/a.ts', 'README.md'],
				activeFile: 'src/a.ts',
				onActivateTab
			});
			const tab = view.q('[data-testid="workspace-file-tab-README.md"]') as HTMLElement;
			tab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			flushSync();
			expect(onActivateTab).toHaveBeenCalledWith('README.md');
			view.cleanup();
		});

		it('the split renders the FIXED px lane: default 280 before measurement, then treePct converted once (ADR D4 amendment 2026-10-27)', () => {
			// Before any ResizeObserver measurement the lane renders at
			// PANEL_WORKSPACE_EXPLORER_WIDTH — a specific number, not a %.
			const view = mountExplorerLayout({ treePct: 44 });
			const split = view.q<HTMLElement>('.split');
			expect(split?.getAttribute('style')).toContain('--tree-basis: 280px');
			view.cleanup();

			// With a measured width, the persisted percent converts to px ONCE.
			class FakeRO {
				static last: FakeRO | null = null;
				cb: ResizeObserverCallback;
				constructor(cb: ResizeObserverCallback) {
					this.cb = cb;
					FakeRO.last = this;
				}
				observe(): void {}
				disconnect(): void {}
				unobserve(): void {}
				fire(width: number): void {
					this.cb(
						[{ contentRect: { width } } as ResizeObserverEntry],
						this as unknown as ResizeObserver
					);
				}
			}
			vi.stubGlobal('ResizeObserver', FakeRO as unknown as typeof ResizeObserver);
			try {
				const measured = mountExplorerLayout({ treePct: 44 });
				FakeRO.last!.fire(800);
				flushSync();
				// 44% of 800px = 352px
				expect(measured.q<HTMLElement>('.split')!.getAttribute('style')).toContain('--tree-basis: 352px');

				// A PARENT resize (observer fires again, no drag) leaves the lane
				// fixed — only the file region absorbs the change.
				FakeRO.last!.fire(400);
				flushSync();
				expect(measured.q<HTMLElement>('.split')!.getAttribute('style')).toContain('--tree-basis: 352px');

				// The old percent twin var is gone — the file region is plain
				// `flex: 1 1 auto` in the style block (happy-dom can't resolve
				// computed flex, so the pin is on the removed custom property).
				expect(measured.q<HTMLElement>('.split')!.getAttribute('style')).not.toContain('--file-basis');
				measured.cleanup();

				// Junk percent still clamps through the same single bound site
				// before conversion — clampTreePct(999) → 70 → 70% of 800px.
				const junked = mountExplorerLayout({ treePct: 999 });
				FakeRO.last!.fire(800);
				flushSync();
				expect(junked.q<HTMLElement>('.split')!.getAttribute('style')).toContain('--tree-basis: 560px');
				junked.cleanup();
			} finally {
				vi.unstubAllGlobals();
			}
		});
	});
});
// ── Fullpath Bow ADR 2026-09-26 D3 — the reveal: expand THEN scroll ──

describe('intent reveal — deep row scrolls into view (Fullpath Bow D3)', () => {
	function scrollStub() {
		const stub = vi.fn();
		const original = Element.prototype.scrollIntoView;
		Element.prototype.scrollIntoView = stub as unknown as typeof Element.prototype.scrollIntoView;
		return { stub, restore: () => { Element.prototype.scrollIntoView = original; } };
	}

	function deepListing(dir: string) {
		const tree: Record<string, Array<{ name: string; type: string }>> = {
			'': [{ name: 'a', type: 'directory' }],
			a: [{ name: 'b', type: 'directory' }],
			'a/b': [{ name: 'c.ts', type: 'file' }, { name: 'c2.ts', type: 'file' }]
		};
		return tree[dir] ?? [];
	}

	function mountForReveal(props: Record<string, unknown>) {
		const onToggle = vi.fn();
		const onOpenFile = vi.fn();
		const onOpenTab = vi.fn();
		const onPendingOpenConsumed = vi.fn();
		const onCollapseAll = vi.fn();
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(WorkspaceExplorerPanel, {
			target,
			props: {
				sessionId: 's1',
				root: '/repo',
				expanded: [],
				onToggle,
				onOpenFile,
				onOpenTab,
				onPendingOpenConsumed,
				onCollapseAll,
				...props
			}
		});
		flushSync();
		return { target, onToggle, cleanup: () => { unmount(instance); target.remove(); } };
	}

	beforeEach(() => {
		vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes('git-map') || url.includes('git-status')) {
				return Promise.resolve(new Response(JSON.stringify({ ok: true, enabled: false }), { status: 200 }));
			}
			// the host route takes PATH (absolute under the root) — strip the
			// root prefix to key the fixture tree by root-relative dir
			const rawPath = decodeURIComponent(new URL(url, 'http://x').searchParams.get('path') ?? '');
			const dir = rawPath.replace(/^\/repo\/?/, '');
			return Promise.resolve(new Response(JSON.stringify({
				ok: true,
				listing: { path: dir, entries: deepListing(dir), truncated: false }
			}), { status: 200 }));
		});
	});

	afterEach(() => vi.unstubAllGlobals());

	it('a deep intent expands ancestors AND scrolls the active row into view', async () => {
		const { stub, restore } = scrollStub();
		const view = mountForReveal({ pendingOpenFile: { path: 'a/b/c.ts', nonce: 1 }, activeFile: 'a/b/c.ts', expanded: ['a', 'a/b'] });
		try {
			// the owner PRE-applied the ancestor expansion via props (expanded) —
			// in production the consumption effect's onToggle intents land first
			expect(view.onToggle).not.toHaveBeenCalled();
			// reveal fires once the deepest level's listing has landed
			await vi.waitFor(() => {
				const rows = view.target.querySelectorAll('li.active');
				if (rows.length === 0) throw new Error('no active row | li: ' + [...view.target.querySelectorAll('li')].map((l) => l.textContent?.trim().slice(0, 12)).join('|'));
				expect(stub).toHaveBeenCalled();
			}, { timeout: 3000, interval: 50 });
			// eslint-disable-next-line no-console
			console.log('ACTIVE ROWS:', view.target.querySelectorAll('li.active').length, 'SCROLL CALLS:', stub.mock.calls.length);
			expect(stub).toHaveBeenCalledWith(expect.objectContaining({ block: 'nearest' }));
		} finally {
			restore();
			view.cleanup();
		}
	});

	it('TAB NAVIGATION reveals too (D3 as amended): switching activeFile scrolls the new row', async () => {
		const { stub, restore } = scrollStub();
		const hTarget = document.createElement('div');
		document.body.appendChild(hTarget);
		const { mount } = await import('svelte');
		const Host = (await import('./RevealHost.svelte')).default;
		const host = mount(Host, { target: hTarget });
		const api = host as unknown as { setActive: (p: string | null) => void };
		try {
			api.setActive('a/b/c.ts');
			await vi.waitFor(() => expect(stub).toHaveBeenCalledTimes(1));
			stub.mockClear();
			// navigate the tabs: a different deep file in a different subtree
			api.setActive('a/b/c2.ts');
			await vi.waitFor(() => expect(stub).toHaveBeenCalledTimes(1));
			// switching BACK to c.ts is a navigation too — it re-reveals
			stub.mockClear();
			api.setActive('a/b/c.ts');
			await vi.waitFor(() => expect(stub).toHaveBeenCalledTimes(1));
			// idling on the SAME active file never re-yanks
			stub.mockClear();
			await new Promise((r) => setTimeout(r, 50));
			expect(stub).not.toHaveBeenCalled();
		} finally {
			restore();
			hTarget.remove();
		}
	});
});
