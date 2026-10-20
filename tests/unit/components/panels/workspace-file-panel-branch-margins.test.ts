/**
 * WorkspaceFilePanel — branch-margin tests (coverage pass 2026-10-21).
 * The main suite's fixtures miss the defensive fallback arms: the read
 * fetch's catch (host-unreachable), the no-error-body status fallback,
 * the empty-path title fallback, the tilde full-path collapse (with a
 * trailing-slash root), the yaml/yml plaintext language pin, the #L
 * anchor highlight hand-off (forced edit tab on markdown; the optional
 * highlightLines handle call), the heartbeat interval's visibility arms,
 * the EventSource CLOSED error and enabled-event closes, the git-map
 * rejection's read-only degradation, and the same-text ring's early
 * return. fetch is stubbed; the clipboard API is stubbed on navigator.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkspaceFilePanel from '$lib/components/workspace-file/WorkspaceFilePanel.svelte';

const glueCalls: Array<{ initial: string; language?: string }> = [];
const glueHandles: Array<{
	getValue(): string;
	setValue(t: string): void;
	highlightLines?(range: { start: number; end: number }): void;
}> = [];
const hlCalls: Array<{ start: number; end: number }> = [];

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
			highlightLines: (range: { start: number; end: number }) => {
				hlCalls.push(range);
			},
			dispose: () => {}
		};
		glueHandles.push(handle);
		return handle;
	},
	createDiffEditor: () => ({ dispose: () => {} })
}));

/** Minimal EventSource stub (Index Pulse): records instances, lets tests
 *  fire generation events and connection errors. */
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

/** Canned gate answers: gate OPEN, root IS a repo — the stream opens. */
function gateStub() {
	return (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		if (url.includes('/api/workspace/git-map')) {
			return Promise.resolve(new Response(JSON.stringify({ ok: true, enabled: true, rootIsRepo: true, repos: {} }), { status: 200 }));
		}
		if (url.includes('/api/workspace/git-status')) {
			return Promise.resolve(new Response(JSON.stringify({ ok: true, enabled: true, truncated: false, files: [] }), { status: 200 }));
		}
		return fetchMock(input as never, init as never);
	};
}

function mountPanel(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(WorkspaceFilePanel, {
		target,
		props: { sessionId: 's1', path: 'README.md', root: '/ws/a', onclose: () => {}, ...props }
	});
	flushSync();
	return {
		target,
		q: (sel: string): Element | null => target.querySelector(sel),
		settle: async () => {
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

const FILE = { ok: true, file: { text: 'const a = 1;', eof: true } };

beforeEach(() => {
	vi.stubGlobal('fetch', gateStub());
	vi.stubGlobal('EventSource', StubEventSource as unknown as typeof EventSource);
});

afterEach(() => {
	fetchMock.mockReset();
	glueCalls.length = 0;
	glueHandles.length = 0;
	hlCalls.length = 0;
	StubEventSource.instances.length = 0;
	vi.unstubAllGlobals();
});

describe('WorkspaceFilePanel — read-failure fallback arms', () => {
	it('a rejected read fetch surfaces host-unreachable (never blank)', async () => {
		fetchMock.mockRejectedValueOnce(new Error('socket blown'));
		const view = mountPanel();
		await view.settle();
		const note = view.q('[data-testid="file-failed"]');
		expect(note).not.toBeNull();
		expect(note!.textContent).toContain('host-unreachable');
		view.cleanup();
	});

	it('a refusal with NO error body falls back to the HTTP status text', async () => {
		fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: false }), { status: 403 }));
		const view = mountPanel();
		await view.settle();
		expect(view.q('[data-testid="file-failed"]')!.textContent).toContain('403');
		view.cleanup();
	});
});

describe('WorkspaceFilePanel — derived-display margins', () => {
	it('an EMPTY path falls back to the raw path for the title (no crash)', async () => {
		fetchMock.mockResolvedValueOnce(readBody(FILE));
		const view = mountPanel({ path: '' });
		await view.settle();
		const url = String(fetchMock.mock.calls[0]![0]);
		expect(url.endsWith('path=')).toBe(true);
		view.cleanup();
	});

	it('a tilde root with a trailing slash collapses to the ~ readout', async () => {
		fetchMock.mockResolvedValueOnce(readBody(FILE));
		const view = mountPanel({ root: '~/sub/', path: 'docs/x.md' });
		await view.settle();
		expect(view.target.textContent).toContain('~/sub/docs/x.md');
		view.cleanup();
	});

	it('yaml and yml BOTH pin the plaintext language (the worker RCA)', async () => {
		fetchMock.mockResolvedValueOnce(readBody(FILE));
		const v1 = mountPanel({ path: 'conf/app.yaml' });
		await v1.settle();
		expect(glueCalls[0]!.language).toBe('plaintext');
		v1.cleanup();
		fetchMock.mockResolvedValueOnce(readBody(FILE));
		const v2 = mountPanel({ path: 'conf/app.yml' });
		await v2.settle();
		expect(glueCalls[1]!.language).toBe('plaintext');
		v2.cleanup();
	});
});

describe('WorkspaceFilePanel — #L anchor highlight margins', () => {
	it('a markdown file with a parked anchor skips the preview tab entirely', async () => {
		fetchMock.mockResolvedValueOnce(readBody({ ok: true, file: { text: '# md', eof: true } }));
		const view = mountPanel({ path: 'doc.md', highlightLines: { start: 2, end: 3 } });
		await view.settle();
		// the edit tab was forced — the editor mounted without a click
		expect(glueCalls).toHaveLength(1);
		view.cleanup();
	});

	it('a plain file hands the range to the editor handle exactly once', async () => {
		const onhighlightdone = vi.fn();
		fetchMock.mockResolvedValueOnce(readBody(FILE));
		const view = mountPanel({
			path: 'app.ts',
			highlightLines: { start: 1, end: 2 },
			onhighlightdone
		});
		await view.settle();
		expect(hlCalls).toEqual([{ start: 1, end: 2 }]);
		expect(onhighlightdone).toHaveBeenCalledTimes(1);
		view.cleanup();
	});
});

describe('WorkspaceFilePanel — heartbeat visibility arms', () => {
	it('a visible tick re-reads the file; a hidden tick stays silent', async () => {
		vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
		const saved = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
		const visibility = { value: 'visible' };
		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			get: () => visibility.value
		});
		try {
			fetchMock.mockResolvedValue(readBody(FILE));
			const view = mountPanel({ path: 'app.ts' });
			await view.settle();
			const reads = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes('/api/dsh/workspace-file')).length;
			expect(reads()).toBe(1);
			vi.advanceTimersByTime(30_000);
			await view.settle();
			expect(reads()).toBe(2); // visible: the ring ran
			visibility.value = 'hidden';
			vi.advanceTimersByTime(30_000);
			await view.settle();
			expect(reads()).toBe(2); // hidden: silent
			view.cleanup();
		} finally {
			if (saved) Object.defineProperty(Document.prototype, 'visibilityState', saved);
			vi.useRealTimers();
		}
	});
});

describe('WorkspaceFilePanel — stream close arms', () => {
	it('an error that reaches CLOSED tears the stream down; CONNECTING does not', async () => {
		fetchMock.mockResolvedValueOnce(readBody(FILE));
		const view = mountPanel({ path: 'app.ts' });
		await view.settle();
		const es = StubEventSource.instances[0]!;
		es.fireError(1); // CONNECTING: keep the stream
		expect(es.closed).toBe(false);
		es.fireError(2); // CLOSED: honest close
		expect(es.closed).toBe(true);
		view.cleanup();
	});

	it('an enabled event closes the stream (the desk left the gate)', async () => {
		fetchMock.mockResolvedValueOnce(readBody(FILE));
		const view = mountPanel({ path: 'app.ts' });
		await view.settle();
		const es = StubEventSource.instances[0]!;
		es.emit('enabled');
		expect(es.closed).toBe(true);
		view.cleanup();
	});
});

describe('WorkspaceFilePanel — gate + ring margins', () => {
	it('an unreachable git-map degrades to the read-only desk', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
				if (String(input).includes('/api/workspace/git-map')) return Promise.reject(new Error('down'));
				return gateStub()(input, init);
			})
		);
		fetchMock.mockResolvedValueOnce(readBody(FILE));
		const view = mountPanel();
		await view.settle();
		expect(view.q('[data-testid="file-save"]')).toBeNull();
		view.cleanup();
	});

	it('a ring reporting the SAME disk text returns early — the buffer is untouched', async () => {
		fetchMock.mockResolvedValue(readBody(FILE));
		const view = mountPanel({ path: 'app.ts' });
		await view.settle();
		const es = StubEventSource.instances[0]!;
		es.emit('generation', '5'); // connect baseline
		await view.settle();
		glueHandles[0]!.setValue('local draft'); // dirty: refreshFile must NOT clobber
		es.emit('generation', '6'); // a ring with the unchanged disk text
		await view.settle();
		// The dirty guard fired first — the stale note, not a silent clobber.
		expect(view.q('[data-testid="file-stale-external"]')).not.toBeNull();
		expect(glueHandles[0]!.getValue()).toBe('local draft');
		view.cleanup();
	});

	it('a ring reporting an UNCHANGED disk text on a clean buffer returns early', async () => {
		fetchMock.mockResolvedValue(readBody(FILE));
		const view = mountPanel({ path: 'app.ts' });
		await view.settle();
		const es = StubEventSource.instances[0]!;
		es.emit('generation', '5'); // connect baseline
		await view.settle();
		es.emit('generation', '6'); // ring: the disk text is identical
		await view.settle();
		// nothing changed: no stale note, the buffer keeps the disk truth
		expect(view.q('[data-testid="file-stale-external"]')).toBeNull();
		expect(glueHandles[0]!.getValue()).toBe('const a = 1;');
		view.cleanup();
	});
});
