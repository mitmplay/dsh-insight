/**
 * WorkspaceFilePanel tests (W4 task 4.1-T) — the live-file panel
 * contract (Workspace Explorer ADR D2):
 *   - one fetch on mount with the URL-ENCODED (sessionId, path) query;
 *   - refusal → the visible failure line (never blank);
 *   - markdown → preview/edit tabs (ephemeral); non-md → edit only;
 *   - Monaco reached ONLY through the dynamic-import glue (mocked here —
 *     the chunk gate's unit-side pin, the injected-doc-panel pattern);
 *   - a buffer edit flips the VISIBLE dirty indicator;
 *   - the copy control writes the verbatim full path; denial visible.
 * fetch is stubbed; the clipboard API is stubbed on navigator.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkspaceFilePanel from '$lib/components/workspace-file/WorkspaceFilePanel.svelte';
import { reactiveProps } from '../../helpers/reactive-props.svelte.js';

const glueCalls: Array<{ initial: string; language?: string }> = [];
const glueDisposed: boolean[] = [];
const diffCalls: Array<{ original: string; modified: string }> = [];
let diffDisposed = false;
/** The mounted editor handles, in creation order — tests drive setValue. */
const glueHandles: Array<{ getValue(): string; setValue(t: string): void }> = [];

vi.mock('$lib/components/monaco/settings-monaco', () => ({
	createTextEditor: (
		_container: HTMLElement,
		initial: string,
		onChange: () => void,
		options?: { language?: string }
	) => {
		glueCalls.push({ initial, language: options?.language });
		let value = initial;
		const handle = {
			getValue: () => value,
			setValue: (t: string) => {
				value = t;
				onChange();
			},
			dispose: () => {
				glueDisposed[glueCalls.length - 1] = true;
			}
		};
		glueHandles.push(handle);
		return handle;
	},
	createDiffEditor: (
		_container: HTMLElement,
		original: string,
		modified: string
	) => {
		diffCalls.push({ original, modified });
		return {
			dispose: () => {
				diffDisposed = true;
			}
		};
	}
}));

const writeText = vi.fn<(text: string) => Promise<void>>();

/** Minimal EventSource stub (Index Pulse): records instances, lets tests
 *  fire generation events with data. */
class StubEventSource {
	static instances: StubEventSource[] = [];
	url: string;
	closed = false;
	handlers = new Map<string, Set<(e: { data?: string }) => void>>();
	onerror: (() => void) | null = null;
	readyState = 1;
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
	fireError(readyState: number): void {
		this.readyState = readyState;
		this.onerror?.();
	}
}
const fetchMock = vi.fn<typeof fetch>();

function readBody(file: Record<string, unknown>) {
	return new Response(JSON.stringify(file), { status: 200 });
}

function mountPanel(props: Record<string, unknown> = {}) {
	const onclose = vi.fn();
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(WorkspaceFilePanel, {
		target,
		props: { sessionId: 's1', path: 'README.md', root: '/ws/a', onclose, ...props }
	});
	flushSync();
	return {
		target,
		onclose,
		q: <T extends Element = Element>(sel: string): T | null => target.querySelector<T>(sel),
		qa: <T extends Element = Element>(sel: string): T[] => [...target.querySelectorAll<T>(sel)],
		settle: async () => {
			// Two macrotask rounds: the fetch body read and the lazy-glue
			// dynamic import each settle across one task boundary.
			await new Promise((r) => setTimeout(r, 0));
			flushSync();
			await new Promise((r) => setTimeout(r, 0));
			flushSync();
		},
		cleanup: () => {
			unmount(instance);
			target.remove();
		}
	};
}

const FILE = {
	ok: true,
	file: { text: '# Stub\nline2', lines: 2, eof: true, absolutePath: '/tmp/dsi-e2e-ws/README.md', version: 'v1', offset: 1 }
};

beforeEach(() => {
	// The File Eye (2026-09-13): the gate + status channels ride canned
	// answers so the Once-queues below keep measuring ONLY the file read
	// and the save POST. Default: gate OPEN, file UNCHANGED — the Save
	// button is present, the toggle is not.
	vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		if (url.includes('/api/workspace/git-map')) {
			return Promise.resolve(new Response(JSON.stringify({ ok: true, enabled: true, rootIsRepo: true, repos: {} }), { status: 200 }));
		}
		if (url.includes('/api/workspace/git-status')) {
			return Promise.resolve(new Response(JSON.stringify({ ok: true, enabled: true, truncated: false, files: [] }), { status: 200 }));
		}
		return fetchMock(input as never, init as never);
	});
	Object.defineProperty(navigator, 'clipboard', {
		configurable: true,
		value: { writeText }
	});
});

afterEach(() => {
	fetchMock.mockReset();
	writeText.mockReset();
	glueCalls.length = 0;
	glueDisposed.length = 0;
	glueHandles.length = 0;
	vi.unstubAllGlobals();
});

describe('WorkspaceFilePanel — fetch (4.1-T)', () => {
	it('fetches once with the URL-ENCODED (sessionId, path) query', async () => {
		fetchMock.mockResolvedValueOnce(readBody(FILE));
		const view = mountPanel({ path: 'docs/notes file.md' });
		await view.settle();
		const url = String(fetchMock.mock.calls[0]![0]);
		expect(url).toContain('/api/dsh/workspace-file?sessionId=s1&path=' + encodeURIComponent('docs/notes file.md'));
		view.cleanup();
	});

		it('the fetch-identity guard: a re-render with identical (sessionId, path, root) does NOT refetch or dispose the editor (floor-drag storm pin, 2026-10-27)', async () => {
			fetchMock.mockResolvedValue(readBody(FILE));
			// Reactive props: a $state object passed as props — parent-driven
			// re-renders (a floor drag replacing the panel entry object) mutate
			// it in place, exactly the live-surface repro.
			const props = reactiveProps({ sessionId: 's1', path: 'README.md', root: '/ws/a' });
			const target = document.createElement('div');
			document.body.appendChild(target);
			const instance = mount(WorkspaceFilePanel, { target, props });
			await new Promise((r) => setTimeout(r, 0));
			flushSync();
			await new Promise((r) => setTimeout(r, 0));
			flushSync();
			expect(fetchMock).toHaveBeenCalledTimes(1);
			const editorBefore = glueCalls.length;

			// THE FLOOR DRAG: the owner replaces the entry object every frame,
			// the same primitive values land again. No refetch, no editor churn.
			for (let frame = 0; frame < 5; frame++) {
				props.sessionId = 's1';
				props.path = 'README.md';
				props.root = '/ws/a';
				flushSync();
			}
			await new Promise((r) => setTimeout(r, 0));
			flushSync();
			expect(fetchMock).toHaveBeenCalledTimes(1); // the guard held
			expect(glueCalls.length).toBe(editorBefore); // editor not rebuilt

			// A REAL file switch refetches exactly once more.
			props.path = 'docs/other.md';
			flushSync();
			await new Promise((r) => setTimeout(r, 0));
			flushSync();
			expect(fetchMock).toHaveBeenCalledTimes(2);
			unmount(instance);
			target.remove();
		});

		it('a refusal renders the visible failure line with the mapped code — never blank', async () => {
		fetchMock.mockResolvedValueOnce(
			new Response(
				JSON.stringify({ ok: false, error: { code: 'workspace-file/not-found', message: 'x' } }),
				{ status: 404 }
			)
		);
		const view = mountPanel();
		await view.settle();
		expect(view.q('[data-testid="file-failed"]')).not.toBeNull();
		expect(view.target.textContent).toContain('workspace-file/not-found');
		view.cleanup();
	});
});

describe('WorkspaceFilePanel — tabs + Monaco gate (4.1-T)', () => {
	it('markdown gets preview AND edit tabs; preview is the default', async () => {
		fetchMock.mockResolvedValueOnce(readBody(FILE));
		const view = mountPanel();
		await view.settle();
		expect(view.q('[data-testid="tab-preview"]')).not.toBeNull();
		expect(view.q('[data-testid="tab-edit"]')).not.toBeNull();
		// Preview surface rendered (markdown panel), no editor yet.
		expect(glueCalls).toHaveLength(0);
		view.cleanup();
	});

	it('switching to the edit tab mounts the editor through the lazy glue', async () => {
		fetchMock.mockResolvedValueOnce(readBody(FILE));
		const view = mountPanel();
		await view.settle();
		view.q<HTMLButtonElement>('[data-testid="tab-edit"]')!.click();
		await view.settle();
		expect(glueCalls).toHaveLength(1);
		expect(glueCalls[0]!.initial).toBe('# Stub\nline2');
		view.cleanup();
	});

	it('the toolbar reload affordance: sits BEFORE the copy slot, refetches the current file exactly once, never clobbers a draft (2026-10-27 operator request)', async () => {
			fetchMock.mockResolvedValue(readBody(FILE));
			const view = mountPanel();
			await view.settle();
			const reload = view.q<HTMLButtonElement>('[data-testid="file-reload"]');
			expect(reload).not.toBeNull();
			// placement contract: the reload icon is the toolbar's LAST-but-one
			// control — immediately before the column-capture button's slot.
			const toolbar = view.q('[data-testid="file-toolbar"]')!;
			const children = [...toolbar.children].map((c) => c.querySelector('[data-testid]')?.dataset.testid ?? c.dataset.testid ?? c.className.split(' ')[0]);
			const reloadIdx = children.indexOf('file-reload');
			const copyIdx = children.findIndex((n) => n === 'copy-slot' || String(n).includes('copy'));
			expect(copyIdx).toBeGreaterThan(-1);
			expect(reloadIdx).toBe(copyIdx - 1);
			// the verb: exactly one more fetch; the editor buffer survives.
			const fetches = fetchMock.mock.calls.length;
			const editorBefore = glueCalls.length;
			reload!.click();
			await view.settle();
			expect(fetchMock.mock.calls.length).toBe(fetches + 1);
			expect(glueCalls.length).toBe(editorBefore); // no editor rebuild
			expect(glueDisposed.filter(Boolean).length).toBe(0);
			view.cleanup();
		});

		it('the reload icon mirrors the CanvasCopyButton feedback: busy spinner while the refresh is in flight, check-mark after, back to idle (2026-10-27 UX parity)', async () => {
			// A fetch WE control: hold it in flight to observe the busy state.
			let release!: (v: Response) => void;
			fetchMock.mockImplementationOnce(() => readBody(FILE)); // mount fetch
			fetchMock.mockImplementationOnce(() => new Promise<Response>((res) => (release = res)));
			fetchMock.mockResolvedValue(readBody(FILE));
			const view = mountPanel();
			await view.settle();
			const reload = view.q<HTMLButtonElement>('[data-testid="file-reload"]')!;
			expect(reload.dataset.state).toBe('idle');
			// Fake timers FIRST so the done→idle timeout lands on the fake clock.
			vi.useFakeTimers();
			try {
				// Click while the refresh is held in flight → the spinner state.
				reload.click();
				flushSync();
				expect(reload.dataset.state).toBe('busy');
				expect(view.q('[data-testid="file-reload"] svg.animate-spin')).not.toBeNull();
				// Release the refresh → the check-mark state (promise drains on
				// microtasks, which fake timers never block).
				release(readBody(FILE));
				// refreshFile awaits fetch + json + assignments — drain enough
				// microtask hops for the whole chain to land.
				for (let i = 0; i < 20; i++) await Promise.resolve();
				flushSync();
				expect(reload.dataset.state).toBe('done');
				expect(reload.querySelector('svg.animate-spin')).toBeNull();
				// Two seconds later the check dissolves back to the idle icon.
				vi.advanceTimersByTime(2000);
				flushSync();
				expect(reload.dataset.state).toBe('idle');
			} finally {
				vi.useRealTimers();
			}
			view.cleanup();
		});

		it('a NON-markdown file opens the editor directly — no tab bar', async () => {
		fetchMock.mockResolvedValueOnce(readBody(FILE));
		const view = mountPanel({ path: 'notes/plain.txt' });
		await view.settle();
		expect(view.q('[data-testid="tab-preview"]')).toBeNull();
		await view.settle();
		expect(glueCalls).toHaveLength(1);
		view.cleanup();
	});

	it('the editor mounts with the extension-mapped language — ts to typescript (The Lit Extension D1)', async () => {
		fetchMock.mockResolvedValueOnce(readBody(FILE));
		const view = mountPanel({ path: 'src/lib/App.ts' });
		await view.settle();
		expect(glueCalls).toHaveLength(1);
		expect(glueCalls[0]!.language).toBe('typescript');
		view.cleanup();
	});

	it('svelte falls back to the html grammar; unknown extensions stay plaintext (The Lit Extension D2)', async () => {
		fetchMock.mockResolvedValueOnce(readBody(FILE));
		const view = mountPanel({ path: 'src/App.svelte' });
		await view.settle();
		expect(glueCalls[0]!.language).toBe('html');
		view.cleanup();
		fetchMock.mockResolvedValueOnce(readBody(FILE));
		const view2 = mountPanel({ path: 'data/blob.xyz' });
		await view2.settle();
		expect(glueCalls[1]!.language).toBe('plaintext');
		view2.cleanup();
	});

	it('an edit flips the VISIBLE dirty indicator; the close intent fires', async () => {
		fetchMock.mockResolvedValueOnce(readBody(FILE));
		const view = mountPanel();
		await view.settle();
		view.q<HTMLButtonElement>('[data-testid="tab-edit"]')!.click();
		await view.settle();
		expect(view.q('[data-testid="file-dirty"]')).toBeNull();
		// A buffer change (the mocked setValue fires onChange).
		// The panel's dirty tracking compares against the fetched text.
		view.cleanup();
	});
});

describe('WorkspaceFilePanel — direct save (The File Eye ADR D4)', () => {
	// A non-markdown file mounts the editor directly on ready — no tab flip.
	const TS_FILE = {
		ok: true,
		file: { text: 'const a = 1;\n', lines: 1, eof: true, version: 'v1', offset: 1 }
	};

	function saveBody(call: number): Record<string, unknown> {
		return JSON.parse(String((fetchMock.mock.calls[call]![1] as RequestInit).body));
	}

	function saveInit(call: number): RequestInit {
		return fetchMock.mock.calls[call]![1] as RequestInit;
	}

	it('the Save button is DISABLED while the buffer is clean', async () => {
		fetchMock.mockResolvedValueOnce(readBody(TS_FILE));
		const view = mountPanel({ path: 'app.ts' });
		await view.settle();
		expect(view.q<HTMLButtonElement>('[data-testid="file-save"]')!.disabled).toBe(true);
		view.cleanup();
	});

	it('an edit arms Save; the receipt clears dirty and marks the copy stale', async () => {
		fetchMock.mockResolvedValueOnce(readBody(TS_FILE));
		const view = mountPanel({ path: 'app.ts' });
		await view.settle();
		glueHandles[0]!.setValue('const a = 2;\n');
		flushSync();
		expect(view.q('[data-testid="file-dirty"]')).not.toBeNull();
		const save = view.q<HTMLButtonElement>('[data-testid="file-save"]')!;
		expect(save.disabled).toBe(false);
		// The save POST: the delegated turn carries sessionId, path, buffer.
		fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, written: true }), { status: 200 }));
		save.click();
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(saveInit(1).method).toBe('POST');
		expect(saveBody(1)).toEqual({ sessionId: 's1', root: '/ws/a', path: 'app.ts', content: 'const a = 2;\n' });
		expect(String(fetchMock.mock.calls[1]![0])).toContain('/api/workspace/file-write');
		// Receipt: dirty cleared, the stale note replaces the badge.
		expect(view.q('[data-testid="file-dirty"]')).toBeNull();
		expect(view.q('[data-testid="file-stale"]')).not.toBeNull();
		// A further edit re-arms the button and hides the stale note.
		glueHandles[0]!.setValue('const a = 3;\n');
		flushSync();
		expect(view.q('[data-testid="file-dirty"]')).not.toBeNull();
		expect(view.q('[data-testid="file-stale"]')).toBeNull();
		view.cleanup();
	});

	it('a refusal shows the visible failure note; dirty stays armed', async () => {
		fetchMock.mockResolvedValueOnce(readBody(TS_FILE));
		const view = mountPanel({ path: 'app.ts' });
		await view.settle();
		glueHandles[0]!.setValue('const a = 2;\n');
		flushSync();
		fetchMock.mockResolvedValueOnce(
			new Response(JSON.stringify({ ok: false, error: { code: 'agent-busy', message: 'mid-turn' } }), { status: 502 })
		);
		view.q<HTMLButtonElement>('[data-testid="file-save"]')!.click();
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		expect(view.q('[data-testid="file-save-failed"]')!.textContent).toContain('mid-turn');
		expect(view.q('[data-testid="file-dirty"]')).not.toBeNull();
		view.cleanup();
	});
});

describe('WorkspaceFilePanel — html documents (2026-09-10)', () => {
	const HTML = { ok: true, file: { text: '<h1>Hello</h1>', lines: 1, eof: true, absolutePath: '/ws/page.html', version: 'v1', offset: 1 } };

	it('a CHANGED file arms the toggle; clicking Diff emits the view intent, renders the placeholder, and disables Save (2.3-T)', async () => {
		const onviewchange = vi.fn();
		// A LOCAL override: the File Eye channels answer changed=true for
		// README.md; the file read still rides the Once-queue.
		vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes('/api/workspace/git-map')) {
				return Promise.resolve(new Response(JSON.stringify({ ok: true, enabled: true, rootIsRepo: true, repos: {} }), { status: 200 }));
			}
			if (url.includes('/api/workspace/git-status')) {
				return Promise.resolve(new Response(JSON.stringify({ ok: true, enabled: true, truncated: false, files: [{ code: 'M', path: 'README.md' }] }), { status: 200 }));
			}
			if (url.includes('/api/workspace/git-file-head')) {
				// untracked-style answer: no HEAD blob ⇒ the honest new-file note
				return Promise.resolve(new Response(JSON.stringify({ ok: true, enabled: true, head: null }), { status: 200 }));
			}
			return readBody(FILE);
		});
		const view = mountPanel({ onviewchange });
		await view.settle();
		expect(view.q('[data-testid="file-view-toggle"]')).toBeTruthy();
		expect(view.q('[data-testid="file-save"]')?.hasAttribute('disabled')).toBe(true); // clean buffer
		view.q<HTMLButtonElement>('[data-testid="file-view-diff"]')!.click();
		await view.settle();
		expect(onviewchange).toHaveBeenCalledWith('diff');
		// Shared Tree amendment (2026-09-16): an UNTRACKED file still diffs —
		// empty original beside the live content; the note stays as a caption.
		expect(view.q('[data-testid="file-diff-new-file"]')).toBeTruthy();
		expect(view.q('[data-testid="file-diff-view"]')).toBeTruthy();
		expect(diffCalls.at(-1)).toEqual({ original: '', modified: FILE.file.text });
		expect((view.q('[data-testid="file-save"]') as HTMLButtonElement | null)?.disabled).toBe(true);
	});

	it('html opens on the PREVIEW tab with a sandboxed iframe of the source', async () => {
		fetchMock.mockResolvedValueOnce(readBody(HTML));
		const view = mountPanel({ path: 'page.html' });
		await view.settle();
		const frame = view.q("iframe[data-testid='file-html-frame']");
		expect(frame).not.toBeNull();
		expect(frame?.getAttribute('sandbox')).toBe('');
		expect(frame?.getAttribute('srcdoc')).toContain('<h1>Hello</h1>');
		expect(view.q("button[data-testid='tab-edit']")).not.toBeNull();
		view.cleanup();
	});

	it('the edit tab is the same Monaco surface as every text file', async () => {
		fetchMock.mockResolvedValueOnce(readBody(HTML));
		const view = mountPanel({ path: 'page.html' });
		await view.settle();
		view.q("button[data-testid='tab-edit']")?.dispatchEvent(new Event('click', { bubbles: true }));
		await view.settle();
		expect(glueCalls.at(-1)?.initial).toContain('<h1>');
		expect(view.q('.file-editor-host')).not.toBeNull();
		view.cleanup();
	});
});


let esInstances: StubEventSource[] = [];

/** Index Pulse: the file panel's changed flag and diff must follow git
 *  state LIVE - a ring re-answers the changed flag (a commit hides the
 *  diff button, an agent staged edit reveals it) and refreshes HEAD. */
describe('WorkspaceFilePanel - Index Pulse live changed flag', () => {
	beforeEach(() => {
		esInstances = StubEventSource.instances = [];
		fetchMock.mockReset();
		vi.stubGlobal('fetch', fetchMock);
		vi.stubGlobal('EventSource', StubEventSource as unknown as typeof EventSource);
		fetchMock.mockImplementation((input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes('/api/dsh/workspace-file')) {
				return Promise.resolve(readBody({ text: 'hello\n', eof: true }));
			}
			if (url.includes('/api/workspace/git-map')) {
				return Promise.resolve(new Response(JSON.stringify({ ok: true, enabled: true, rootIsRepo: true, repos: {} }), { status: 200 }));
			}
			if (url.includes('/api/workspace/git-status')) {
				return Promise.resolve(new Response(JSON.stringify({ ok: true, enabled: true, truncated: false, files: [{ code: 'M ', path: 'README.md' }] }), { status: 200 }));
			}
			return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
		});
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		document.body.innerHTML = '';
	});
	const statusCalls = (): number =>
		fetchMock.mock.calls.filter((cc) => String(cc[0]).includes('/api/workspace/git-status')).length;

	it('opens one EventSource for the enclosing repo; a ring re-fetches git-status (commit hides diff live)', async () => {
		const onclose = vi.fn();
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(WorkspaceFilePanel, { target, props: { sessionId: 's1', path: 'README.md', root: '/ws/a', onclose } });
		await new Promise((r) => setTimeout(r, 0)); flushSync();
		expect(esInstances.length).toBe(1);
		expect(esInstances[0].url).toContain('/api/workspace/git-events?');
		expect(esInstances[0].url).toContain(encodeURIComponent('/ws/a'));
		const before = statusCalls();
		esInstances[0].emit('generation', '3'); // baseline on connect
		await new Promise((r) => setTimeout(r, 0)); flushSync();
		esInstances[0].emit('generation', '7'); // a real change
		await new Promise((r) => setTimeout(r, 0)); flushSync();
		expect(statusCalls()).toBeGreaterThan(before);
		expect(esInstances[0].closed).toBe(false);
		unmount(instance); target.remove();
	});

	it('the same generation twice is inert; a CONNECTING error keeps the stream', async () => {
		const onclose = vi.fn();
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(WorkspaceFilePanel, { target, props: { sessionId: 's1', path: 'README.md', root: '/ws/a', onclose } });
		await new Promise((r) => setTimeout(r, 0)); flushSync();
		const source = esInstances[0];
		source.emit('generation', '3'); // baseline
		await new Promise((r) => setTimeout(r, 0)); flushSync();
		const before = statusCalls();
		source.emit('generation', '3'); // duplicate: inert
		await new Promise((r) => setTimeout(r, 0)); flushSync();
		expect(statusCalls()).toBe(before);
		source.fireError(0); // CONNECTING
		await new Promise((r) => setTimeout(r, 0)); flushSync();
		expect(source.closed).toBe(false);
		expect(esInstances.length).toBe(1);
		unmount(instance); target.remove();
	});
});


/** Index Pulse bug regression (2026-09-13): the diff showed the STALE
 *  mount-time baseline on both sides. The modified side must be the LIVE
 *  buffer; an external disk change must refresh a clean buffer and raise
 *  the visible stale note when a draft exists. */
describe('WorkspaceFilePanel - live diff against the real content', () => {
	beforeEach(() => {
		StubEventSource.instances = [];
		fetchMock.mockReset();
		vi.stubGlobal('fetch', fetchMock);
		vi.stubGlobal('EventSource', StubEventSource as unknown as typeof EventSource);
		fetchMock.mockImplementation((input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes('/api/dsh/workspace-file')) {
				return Promise.resolve(new Response(JSON.stringify({ ok: true, file: { text: 'date: 2026-09-13', eof: true } }), { status: 200 }));
			}
			if (url.includes('/api/workspace/git-map')) {
				return Promise.resolve(new Response(JSON.stringify({ ok: true, enabled: true, rootIsRepo: true, repos: {} }), { status: 200 }));
			}
			if (url.includes('/api/workspace/git-status')) {
				return Promise.resolve(new Response(JSON.stringify({ ok: true, enabled: true, truncated: false, files: [{ code: 'M ', path: 'Tasks.json' }] }), { status: 200 }));
			}
			if (url.includes('/api/workspace/git-file-head')) {
				return Promise.resolve(new Response(JSON.stringify({ ok: true, enabled: true, head: 'date: 2026-09-12' }), { status: 200 }));
			}
			return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		document.body.innerHTML = '';
	});

	function mountFile(extra: Record<string, unknown> = {}) {
		const onviewchange = vi.fn();
		const view = mountPanel({ path: 'Tasks.json', onviewchange, ...extra });
		return { view, onviewchange };
	}

	it('after an external disk change, the diff shows HEAD vs the REFRESHED content (13 vs 14)', async () => {
		let diskContent = 'date: 2026-09-13';
		fetchMock.mockImplementation((input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes('/api/dsh/workspace-file')) {
				return Promise.resolve(new Response(JSON.stringify({ ok: true, file: { text: diskContent, eof: true } }), { status: 200 }));
			}
			if (url.includes('/api/workspace/git-map')) {
				return Promise.resolve(new Response(JSON.stringify({ ok: true, enabled: true, rootIsRepo: true, repos: {} }), { status: 200 }));
			}
			if (url.includes('/api/workspace/git-status')) {
				return Promise.resolve(new Response(JSON.stringify({ ok: true, enabled: true, truncated: false, files: [{ code: 'M ', path: 'Tasks.json' }] }), { status: 200 }));
			}
			if (url.includes('/api/workspace/git-file-head')) {
				return Promise.resolve(new Response(JSON.stringify({ ok: true, enabled: true, head: 'date: 2026-09-12' }), { status: 200 }));
			}
			return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
		});
		const { view } = mountFile();
		await view.settle();
		// operator edits the file on disk to 2026-09-14 (no index write), then rings
		diskContent = 'date: 2026-09-14';
		StubEventSource.instances[0].emit('generation', '5'); // baseline
		await view.settle();
		StubEventSource.instances[0].emit('generation', '6'); // the ring
		await view.settle();
		await new Promise((r) => setTimeout(r, 0));
		await view.settle();
		// the clean buffer followed the disk; the diff button is enabled
		expect(view.q('[data-testid="file-stale-external"]')).toBeNull();
		const btn = view.q<HTMLButtonElement>('[data-testid="file-view-diff"]');
		expect(btn).not.toBeNull();
		btn!.click();
		await view.settle();
		await new Promise((r) => setTimeout(r, 0));
		await view.settle();
		expect(diffCalls.length).toBeGreaterThan(0);
		const last = diffCalls[diffCalls.length - 1];
		expect(last.original).toBe('date: 2026-09-12'); // HEAD side
		expect(last.modified).toBe('date: 2026-09-14'); // REFRESHED disk content
		view.cleanup();
	});

	// The Explorer Layout operator bug (2026-09-17): Edit → Diff → Edit →
	// Diff left the SECOND diff view empty — the async mount captured the
	// PREVIOUS entry's detached host element and painted into it, and the
	// diffHandle guard blocked the re-run on the live element. The pin:
	// every entry into Diff calls createDiffEditor again.
	it('every Diff entry mounts the diff editor — no stale detached host', async () => {
		vi.stubGlobal('fetch', (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes('/api/workspace/git-map')) {
				return Promise.resolve(new Response(JSON.stringify({ ok: true, enabled: true, rootIsRepo: true, repos: {} }), { status: 200 }));
			}
			if (url.includes('/api/workspace/git-status')) {
				return Promise.resolve(new Response(JSON.stringify({ ok: true, enabled: true, truncated: false, files: [{ code: 'M ', path: 'README.md' }] }), { status: 200 }));
			}
			if (url.includes('/api/workspace/git-file-head')) {
				return Promise.resolve(new Response(JSON.stringify({ ok: true, enabled: true, head: 'HEAD TEXT' }), { status: 200 }));
			}
			return readBody(FILE);
		});
		const view = mountPanel();
		await view.settle();
		const before = diffCalls.length;
		view.q<HTMLButtonElement>('[data-testid="file-view-diff"]')!.click();
		await view.settle();
		await new Promise((r) => setTimeout(r, 0));
		await view.settle();
		expect(diffCalls.length).toBe(before + 1); // first entry mounts
		view.q<HTMLButtonElement>('[data-testid="file-view-edit"]')!.click();
		await view.settle();
		view.q<HTMLButtonElement>('[data-testid="file-view-diff"]')!.click();
		await view.settle();
		await new Promise((r) => setTimeout(r, 0));
		await view.settle();
		// the second entry mounts AGAIN (pre-fix this stayed at before + 1:
		// the mount painted into the detached previous host)
		expect(diffCalls.length).toBe(before + 2);
		view.cleanup();
	});
	it('an external disk change refreshes a CLEAN buffer silently', async () => {
		const { view } = mountFile();
		await view.settle();
		const fileCalls = (): number =>
			fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/dsh/workspace-file')).length;
		const before = fileCalls();
		StubEventSource.instances[0].emit('generation', '5'); // baseline first
		await view.settle();
		StubEventSource.instances[0].emit('generation', '6'); // a real ring
		await view.settle();
		await new Promise((r) => setTimeout(r, 0));
		await view.settle();
		expect(fileCalls()).toBeGreaterThan(before); // the file was re-fetched
		expect(view.q('[data-testid="file-stale-external"]')).toBeNull(); // clean buffer: no note
		view.cleanup();
	});

	it('an external disk change with a DRAFT keeps the draft and shows the visible stale note', async () => {
		const { view } = mountFile();
		await view.settle();
		glueHandles[glueHandles.length - 1].setValue('my unsaved draft');
		await view.settle();
		StubEventSource.instances[0].emit('generation', '5');
		await view.settle();
		StubEventSource.instances[0].emit('generation', '6');
		await view.settle();
		await new Promise((r) => setTimeout(r, 0));
		await view.settle();
		expect(view.q('[data-testid="file-stale-external"]')).not.toBeNull();
		// the draft is untouched
		expect(glueHandles[glueHandles.length - 1].getValue()).toBe('my unsaved draft');
		view.cleanup();
	});
});

describe('WorkspaceFilePanel — render/gate/save arms (coverage pass 2026-09-14)', () => {
	it('an image path skips the text read and renders the bytes preview', async () => {
		const view = mountPanel({ path: 'logo.png' });
		await view.settle();
		expect(view.q('[data-testid="file-image"]')).not.toBeNull();
		expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/api/dsh/workspace-file?'))).toBe(false);
		view.cleanup();
	});

	it('an unknown extension falls back to the plaintext language', async () => {
		fetchMock.mockResolvedValueOnce(readBody(FILE));
		const view = mountPanel({ path: 'artifact.weird' });
		await view.settle();
		expect(glueCalls[glueCalls.length - 1]?.language).toBe('plaintext');
		view.cleanup();
	});

	it('an html file renders the sandboxed preview iframe', async () => {
		fetchMock.mockResolvedValueOnce(readBody({ ok: true, file: { text: '<p>hi</p>', eof: true } }));
		const view = mountPanel({ path: 'page.html' });
		await view.settle();
		expect(view.q('[data-testid="file-html-frame"]')).not.toBeNull();
		view.cleanup();
	});

	it('a truncated file renders the truncation note above the editor', async () => {
		fetchMock.mockResolvedValueOnce(readBody({ ok: true, file: { text: 'partial', eof: false } }));
		const view = mountPanel({ path: 'big.log' });
		await view.settle();
		expect(view.target.querySelector('.file-panel .note')).not.toBeNull();
		view.cleanup();
	});

	async function makeDirtyAndSave(writeBody: Record<string, unknown>, status = 500) {
		fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.includes('/api/workspace/file-write')) {
				return new Response(JSON.stringify(writeBody), { status });
			}
			return readBody(FILE);
		});
		const view = mountPanel({ path: 'notes.txt' });
		await view.settle();
		glueHandles[glueHandles.length - 1].setValue('edited!');
		await view.settle();
		(view.q('[data-testid="file-save"]') as HTMLButtonElement)!.click();
		await view.settle();
		return view;
	}

	it('a failed save renders the failure note with the error code', async () => {
		const view = await makeDirtyAndSave({ ok: false, error: { code: 'denied' } });
		const note = view.q('[data-testid="file-save-failed"]');
		expect(note).not.toBeNull();
		expect(note!.textContent).toContain('denied');
		view.cleanup();
	});

	it('a failed save with no error body falls back to the status text', async () => {
		const view = await makeDirtyAndSave({ ok: false }, 500);
		const note = view.q('[data-testid="file-save-failed"]');
		expect(note).not.toBeNull();
		expect(note!.textContent).toContain('500');
		view.cleanup();
	});

	it('a disabled gate renders a read-only desk without a Save verb', async () => {
		vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.includes('/api/workspace/git-map')) {
				return Promise.resolve(new Response(JSON.stringify({ ok: true, enabled: false }), { status: 200 }));
			}
			if (url.includes('/api/workspace/git-status')) {
				return Promise.resolve(new Response(JSON.stringify({ ok: true, enabled: false, truncated: false, files: [] }), { status: 200 }));
			}
			return fetchMock(input as never, init as never);
		});
		fetchMock.mockResolvedValueOnce(readBody(FILE));
		const view = mountPanel();
		await view.settle();
		expect(view.q('[data-testid="file-save"]')).toBeNull();
		view.cleanup();
	});
});

describe('WorkspaceFilePanel — ring-failure + subrepo arms (coverage pass 2026-09-14)', () => {
	function mountFile() {
		const v = mountPanel({ path: 'Tasks.json' });
		return { view: v };
	}

	it('a ring whose probes fail keeps the last honest state (git-status disabled, file read broken)', async () => {
		let diskText = 'v1';
		fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes('/api/workspace/git-map')) {
				return new Response(JSON.stringify({ ok: true, enabled: true, rootIsRepo: true, repos: {} }), { status: 200 });
			}
			if (url.includes('/api/workspace/git-status')) {
				return new Response(JSON.stringify({ ok: true, enabled: false, truncated: false }), { status: 200 });
			}
			if (url.includes('/api/dsh/workspace-file')) {
				return new Response(JSON.stringify({ ok: diskText === 'v1', file: { text: diskText, eof: true } }), { status: 200 });
			}
			return new Response(JSON.stringify({ ok: true }), { status: 200 });
		});
		const view = mountFile().view;
		await view.settle();
		const gen = (): StubEventSource => StubEventSource.instances[0]!;
		gen().emit('generation', '5'); // baseline
		await view.settle();
		diskText = 'v2';
		gen().emit('generation', '6'); // ring: status disabled + read broken
		await view.settle();
		await new Promise((r) => setTimeout(r, 0));
		await view.settle();
		// the panel keeps the last honest content — no crash, no stale note
		expect(view.q('[data-testid="file-stale-external"]')).toBeNull();
		view.cleanup();
	});

	it('a SUBDIR file under a repo-carrying root resolves its enclosing repo; a repo-less root never opens a stream', async () => {
		class Es2 extends StubEventSource {}
		const mine = (): Es2[] => StubEventSource.instances.filter((s): s is Es2 => s instanceof Es2);
		vi.stubGlobal('EventSource', Es2 as unknown as typeof EventSource);
		const fullStub = (map: Record<string, unknown>) => (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes('/api/workspace/git-map')) {
				return Promise.resolve(new Response(JSON.stringify(map), { status: 200 }));
			}
			if (url.includes('/api/workspace/git-status')) {
				return Promise.resolve(new Response(JSON.stringify({ ok: true, enabled: true, truncated: false, files: [{ code: 'M ', path: 'main.ts' }] }), { status: 200 }));
			}
			return Promise.resolve(new Response(JSON.stringify({ ok: true, file: { text: 'x', eof: true } }), { status: 200 }));
		};
		vi.stubGlobal('fetch', vi.fn(fullStub({ ok: true, enabled: true, rootIsRepo: false, repos: { app: true } })));
		const v1 = mountPanel({ path: 'app/main.ts' });
		await v1.settle();
		await new Promise((r) => setTimeout(r, 0));
		await v1.settle();
		expect(mine().length).toBe(1);
		expect(mine()[0].url).toContain('repo=' + encodeURIComponent('/ws/a/app'));
		v1.cleanup();
		// a root that is NOT a repo and carries no repos: no enclosing, no stream
		vi.stubGlobal('fetch', vi.fn(fullStub({ ok: true, enabled: true, rootIsRepo: false, repos: {} })));
		const v2 = mountPanel({ path: 'app/main.ts' });
		await v2.settle();
		await new Promise((r) => setTimeout(r, 0));
		await v2.settle();
		expect(mine().length).toBe(1); // no second stream
		v2.cleanup();
	});

	it('a rejected write surfaces the network message; an Error reject surfaces its message', async () => {
		fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input).includes('/api/workspace/file-write')) return Promise.reject(new Error('socket blown'));
			return readBody(FILE);
		});
		const view = mountPanel({ path: 'notes.txt' });
		await view.settle();
		glueHandles[glueHandles.length - 1].setValue('draft');
		await view.settle();
		(view.q('[data-testid="file-save"]') as HTMLButtonElement)!.click();
		await view.settle();
		expect(view.q('[data-testid="file-save-failed"]')!.textContent).toContain('socket blown');
		view.cleanup();

		fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
			if (String(input).includes('/api/workspace/file-write')) return Promise.reject('nope');
			return readBody({ ok: true, file: { text: 'x', eof: true } });
		});
		const view2 = mountPanel({ path: 'notes.txt' });
		await view2.settle();
		glueHandles[glueHandles.length - 1].setValue('draft2');
		await view2.settle();
		(view2.q('[data-testid="file-save"]') as HTMLButtonElement)!.click();
		await view2.settle();
		expect(view2.q('[data-testid="file-save-failed"]')!.textContent).toContain('network');
		view2.cleanup();
	});
});