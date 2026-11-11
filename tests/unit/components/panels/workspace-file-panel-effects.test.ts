/**
 * WorkspaceFilePanel effect-lifecycle pins (ADR-0047, "The Sole Undertaker"):
 *   - a drag-frame re-run of the fetch-identity effect with an UNCHANGED key
 *     must NOT dispose the editor (the 2026-11-02 bug: the old cleanup
 *     disposed on the first re-run and the plain `editor` var kept the mount
 *     effect blind — the host stayed empty forever);
 *   - a REAL file switch disposes the editor exactly once (via the mount
 *     effect's cleanup — the sole undertaker);
 *   - the initSeq abort survives: a switch retires the old mount token.
 * Mirrors the harness of workspace-file-panel.test.ts (glue mock, settle).
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkspaceFilePanel from '$lib/components/workspace-file/WorkspaceFilePanel.svelte';
import { reactiveProps } from '../../helpers/reactive-props.svelte.js';

const glueCalls: Array<{ initial: string }> = [];
const glueDisposed: boolean[] = [];

vi.mock('$lib/components/common/settings-monaco', () => ({
	createTextEditor: (_container: HTMLElement, initial: string) => {
		glueCalls.push({ initial });
		let value = initial;
		return {
			getValue: () => value,
			setValue: (t: string) => {
				value = t;
			},
			dispose: () => {
				glueDisposed[glueCalls.length - 1] = true;
			}
		};
	}
}));

const fetchMock = vi.fn<typeof fetch>();
const FILE = (path: string) => ({
	ok: true,
	file: { text: '# ' + path, lines: 1, eof: true, absolutePath: '/tmp/' + path, version: 'v1', offset: 1 }
});

beforeEach(() => {
	vi.stubGlobal('fetch', ((input: RequestInfo | URL) => {
		const url = String(input);
		if (url.includes('/api/workspace/git-map')) {
			return Promise.resolve(new Response(JSON.stringify({ ok: true, enabled: true, rootIsRepo: false, repos: {} }), { status: 200 }));
		}
		if (url.includes('/api/workspace/git-status')) {
			return Promise.resolve(new Response(JSON.stringify({ ok: true, enabled: true, files: [] }), { status: 200 }));
		}
		return fetchMock(input as never);
	}) as typeof fetch);
});
afterEach(() => {
	fetchMock.mockReset();
	glueCalls.length = 0;
	glueDisposed.length = 0;
	vi.unstubAllGlobals();
});

/** Mount with reactive props (the parent-replace repro surface). */
function mountReactive() {
	const props = reactiveProps({ sessionId: 's1', path: 'src/app.ts', root: '/ws/a', onclose: vi.fn() });
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(WorkspaceFilePanel, { target, props });
	const settle = async () => {
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
	};
	return {
		props,
		settle,
		cleanup: () => {
			unmount(instance);
			target.remove();
		}
	};
}

describe('ADR-0047 — the sole undertaker', () => {
	it('a drag-frame re-run with an unchanged key does NOT dispose the editor', async () => {
		fetchMock.mockResolvedValue(new Response(JSON.stringify(FILE('src/app.ts')), { status: 200 }));
		const view = mountReactive();
		await view.settle();
		expect(glueCalls.length).toBe(1);
		expect(glueDisposed[0]).toBeFalsy(); // alive before the storm

		// THE FLOOR DRAG: parent replaces the entry per frame, same values.
		for (let frame = 0; frame < 8; frame++) {
			view.props.sessionId = 's1';
			view.props.path = 'src/app.ts';
			view.props.root = '/ws/a';
			flushSync();
		}
		await view.settle();
		expect(glueCalls.length).toBe(1); // never rebuilt
		expect(glueDisposed[0]).toBeFalsy(); // ⛔ the 2026-11-02 bug — never disposed
		view.cleanup();
	});

	it('a REAL file switch disposes the old editor exactly once (mount effect owns it)', async () => {
		fetchMock.mockResolvedValue(new Response(JSON.stringify(FILE('src/app.ts')), { status: 200 }));
		const view = mountReactive();
		await view.settle();
		expect(glueCalls.length).toBe(1);

		fetchMock.mockResolvedValue(new Response(JSON.stringify(FILE('lib/other.ts')), { status: 200 }));
		view.props.path = 'lib/other.ts';
		await view.settle();
		expect(glueCalls.length).toBe(2); // new editor for the new file
		expect(glueDisposed[0]).toBe(true); // old one buried — once
		expect(glueDisposed[1]).toBeFalsy();
		view.cleanup();
		// unmount buries the survivor — the mount effect is still the undertaker
		expect(glueDisposed[1]).toBe(true);
	});
});
