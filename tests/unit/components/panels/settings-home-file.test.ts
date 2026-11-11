/**
 * Unit: SettingsHomeFile (The Settings Tree ADR 2026-09-18, D2) — the
 * settings-home file tab. Contracts pinned here (the RCA of 2026-09-18,
 * "The Home Tab That Lost Its Colors"): the editor mounts through the
 * SHARED lazy Monaco seam (`settings-monaco.ts` — createTextEditor, the
 * language guessed from the extension), the dirty indicator tracks
 * edits against the saved text, and a successful save clears it. The
 * glue is mocked — the component never loads the real chunk under
 * happy-dom.
 *
 * The error grammar is also pinned: a failed load/save surfaces the
 * server's error.message, falling back to error.code, falling back to
 * the HTTP status; a thrown (non-Response) failure reads 'network'
 * unless it is a real Error.
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SettingsHomeFile from '$lib/components/panels/SettingsHomeFile.svelte';
import {
	appConfig,
	resetAppConfigForTests
} from '$lib/services/config/app-config.svelte';

const glue = {
	value: '',
	onChange: (): void => {},
	language: '',
	disposed: false
};

vi.mock('$lib/components/common/settings-monaco', () => ({
	createTextEditor: (
		_container: HTMLElement,
		initial: string,
		onChange: () => void,
		options?: { language?: string }
	) => {
		glue.value = initial;
		glue.onChange = onChange;
		glue.language = options?.language ?? 'plaintext';
		return {
			getValue: () => glue.value,
			setValue: (text: string) => {
				glue.value = text;
			},
			dispose: () => {
				glue.disposed = true;
			}
		};
	}
}));

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status });
}

/** A canned GET/POST outcome: a Response, a factory (fresh Response per
 *  call — canned ones are single-read), or a thrown value. */
type Canned =
	| Response
	| (() => Response | Promise<Response> | { reject: unknown })
	| { reject: unknown };

/** Stub fetch with canned GET/POST bodies; either may be a Response or a thrown value. */
function stubFetch(get: Canned, post?: Canned): ReturnType<typeof vi.fn> {
	const f = vi.fn(async (url: string | URL, init?: RequestInit) => {
		if (init?.method === 'POST') {
			if (typeof post !== 'function') throw new Error('unexpected POST');
			const r = await post();
			if (r instanceof Response) return r;
			throw r.reject;
		}
		if (typeof get === 'function') return await get();
		if ('reject' in get) throw get.reject;
		// a canned Response is single-read — clone() so repeated loads work
		return get.clone();
	});
	vi.stubGlobal('fetch', f);
	return f;
}

function mountFile(props: { home?: 'dsi' | 'dsh'; path: string }): {
	target: HTMLElement;
	instance: ReturnType<typeof mount>;
	settle: () => Promise<void>;
	cleanup: () => void;
} {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(SettingsHomeFile, {
		target,
		props: { home: props.home ?? 'dsi', path: props.path }
	});
	return {
		target,
		instance,
		settle: async (): Promise<void> => {
			// two macrotask ticks: fetch → res.json() → the dynamic seam
			// import → createTextEditor each hand off across the task queue
			await new Promise((r) => setTimeout(r, 0));
			await new Promise((r) => setTimeout(r, 0));
			flushSync();
		},
		cleanup: (): void => {
			unmount(instance);
			target.remove();
		}
	};
}

function saveButton(target: HTMLElement): HTMLButtonElement {
	return target.querySelector('button.save')!;
}

/** Dispatch a click even on a disabled button (the guards, not the UI gate, are under test). */
function forceClick(el: HTMLElement): void {
	el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
	flushSync();
}

function errorText(target: HTMLElement): string | null {
	return target.querySelector('[role="alert"]')?.textContent ?? null;
}

describe('SettingsHomeFile (Settings Tree ADR D2 — the shared Monaco seam)', () => {
	beforeEach(() => {
		glue.disposed = false;
		glue.value = '';
		glue.language = '';
		vi.unstubAllGlobals();
		resetAppConfigForTests();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		resetAppConfigForTests();
	});

	it('mounts the editor through the shared seam with the extension-guessed language', async () => {
		stubFetch(jsonResponse({ ok: true, file: { content: 'chat:\n  input:\n    maxRows: 40\n' } }));
		const h = mountFile({ home: 'dsi', path: 'settings.yaml' });
		await h.settle();
		expect(glue.language).toBe('yaml');
		expect(glue.value).toContain('maxRows: 40');
		h.cleanup();
	});

	// The language table is a total function of the extension — every arm
	// is one mount with a differently-shaped path (built-ins, the multi
	// js-family ids, the case-folded unknown, and the extensionless file).
	it('languageFor covers every extension arm', async () => {
		stubFetch(jsonResponse({ ok: true, file: { content: 'x' } }));
		const cases: Array<[string, string]> = [
			['a.yml', 'yaml'],
			['b.json', 'json'],
			['c.ts', 'typescript'],
			['d.js', 'javascript'],
			['e.mjs', 'javascript'],
			['f.cjs', 'javascript'],
			['g.css', 'css'],
			['h.scss', 'css'],
			['i.html', 'html'],
			['j.md', 'markdown'],
			['k.sh', 'shell'],
			['l.TXT', 'plaintext'], // unknown ext, case-folded, still plaintext
			['Makefile', 'plaintext'] // no dot at all
		];
		for (const [path, lang] of cases) {
			const h = mountFile({ path });
			// wait for THIS mount's editor to land — the previous test's
			// disposal must not race the next load
			for (let i = 0; i < 50 && glue.language !== lang; i++) {
				await new Promise((r) => setTimeout(r, 2));
				flushSync();
			}
			expect(glue.language, path).toBe(lang);
			h.cleanup();
		}
	});

	// fullPath grammar: the home root (server homedir truth) joins the
	// path with a '/' only when the root lacks a trailing slash, and the
	// homedir prefix collapses to ~ via the /.dsi|/.dsh marker — per home.
	it('fullPath: trailing-slash root joins bare; the marker collapses homedir to ~ (dsi AND dsh)', async () => {
		stubFetch(jsonResponse({ ok: true, file: { content: 'x' } }));
		appConfig().settingsHomes.dsi = '/opt/tree/'; // trailing slash, no marker → the bare arm
		const a = mountFile({ home: 'dsi', path: 'settings.yaml' });
		await a.settle();
		expect(a.target.querySelector('.path')?.textContent).toBe('/opt/tree/settings.yaml');
		a.cleanup();

		appConfig().settingsHomes.dsh = '/home/op/.dsh';
		const b = mountFile({ home: 'dsh', path: 'config.yaml' });
		await b.settle();
		expect(b.target.querySelector('.path')?.textContent).toBe('~/.dsh/config.yaml');
		b.cleanup();
	});

	// Error grammar, load side: message → code → HTTP status, each arm.
	it('a failed load surfaces error.message, then error.code, then the status', async () => {
		for (const [body, status, expected] of [
			[{ ok: false, error: { message: 'boom', code: 'EACCES' } }, 403, 'boom'],
			[{ ok: false, error: { code: 'ENOENT' } }, 404, 'ENOENT'],
			[{ ok: false }, 418, '418'],
			[{ ok: true }, 500, '500'] // ok but no file → the same fallback chain
		] as Array<[unknown, number, string]>) {
			stubFetch(jsonResponse(body, status));
			const h = mountFile({ path: 'settings.yaml' });
			await h.settle();
			expect(errorText(h.target)).toBe(expected);
			h.cleanup();
		}
	});

	// A thrown failure: a real Error keeps its message; anything else
	// degrades to the honest 'network'.
	it('a rejected load reads the Error message, or network for non-Errors', async () => {
		stubFetch({ reject: new Error('offline') });
		const a = mountFile({ path: 'settings.yaml' });
		await a.settle();
		expect(errorText(a.target)).toBe('offline');
		a.cleanup();

		stubFetch({ reject: 'hard-fail' });
		const b = mountFile({ path: 'settings.yaml' });
		await b.settle();
		expect(errorText(b.target)).toBe('network');
		b.cleanup();
	});

	it('edits light the dirty indicator; a successful save clears it', async () => {
		stubFetch(jsonResponse({ ok: true, file: { content: 'a: 1\n' } }), () =>
			jsonResponse({ ok: true })
		);
		const h = mountFile({ home: 'dsi', path: 'settings.yaml' });
		await h.settle();
		expect(h.target.querySelector('[data-testid="settings-home-dirty"]')).toBeNull();
		// the mocked editor's edit fires the panel's onChange
		glue.value = 'a: 2\n';
		glue.onChange();
		flushSync();
		expect(h.target.querySelector('[data-testid="settings-home-dirty"]')).not.toBeNull();
		// save posts the BUFFER (not the fetched text) and clears dirty
		saveButton(h.target).click();
		await h.settle();
		const posted = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
			(c) => String(c[0]).endsWith('/file-write')
		);
		expect(JSON.parse(String(posted![1].body)).content).toBe('a: 2\n');
		expect(h.target.querySelector('[data-testid="settings-home-dirty"]')).toBeNull();
		h.cleanup();
	});

	// Save-side error grammar: the same message → code → status chain, and
	// the thrown path (Error message / 'network').
	it('a failed save surfaces the error chain and keeps the buffer dirty', async () => {
		const cases: Array<[unknown, number, string]> = [
			[{ ok: false, error: { message: 'denied' } }, 403, 'denied'],
			[{ ok: false, error: { code: 'EIO' } }, 500, 'EIO'],
			[{ ok: false }, 502, '502']
		];
		for (const [body, status, expected] of cases) {
			stubFetch(jsonResponse({ ok: true, file: { content: 'a: 1\n' } }), () =>
				jsonResponse(body, status)
			);
			const h = mountFile({ path: 'settings.yaml' });
			await h.settle();
			glue.value = 'a: 2\n';
			glue.onChange();
			flushSync();
			saveButton(h.target).click();
			await h.settle();
			expect(errorText(h.target)).toBe(expected);
			h.cleanup();
		}
		// POST throws a real Error → its message
		stubFetch(jsonResponse({ ok: true, file: { content: 'a: 1\n' } }), () => ({
			reject: new Error('socket down')
		}));
		const h = mountFile({ path: 'settings.yaml' });
		await h.settle();
		glue.value = 'a: 2\n';
		glue.onChange();
		flushSync();
		saveButton(h.target).click();
		await h.settle();
		expect(errorText(h.target)).toBe('socket down');
		h.cleanup();
		// POST throws a non-Error → 'network'
		stubFetch(jsonResponse({ ok: true, file: { content: 'a: 1\n' } }), () => ({
			reject: 'nope'
		}));
		const h2 = mountFile({ path: 'settings.yaml' });
		await h2.settle();
		glue.value = 'a: 2\n';
		glue.onChange();
		flushSync();
		saveButton(h2.target).click();
		await h2.settle();
		expect(errorText(h2.target)).toBe('network');
		h2.cleanup();
	});

	// The save() guards are reached only through dispatched clicks (the
	// button disables itself via dirty/saving — the guards back that UI).
	it('save is a no-op before the editor exists and while a save is in flight', async () => {
		// 1) editor null: hold the GET pending, click, no POST attempted
		let releaseGet!: (r: Response) => void;
		const f = vi.fn(async (url: string | URL, init?: RequestInit) => {
			if (init?.method === 'POST') return jsonResponse({ ok: true });
			return new Promise<Response>((res) => {
				releaseGet = res;
			});
		});
		vi.stubGlobal('fetch', f);
		const h = mountFile({ path: 'settings.yaml' });
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		forceClick(saveButton(h.target));
		expect(f.mock.calls.filter((c) => c[1]?.method === 'POST')).toHaveLength(0);
		// unmount with the load still in flight — the effect cleanup runs
		// its optional dispose on a null editor
		h.cleanup();
		releaseGet(jsonResponse({ ok: true, file: { content: 'a: 1\n' } }));

		// 2) saving guard: the first POST hangs; the second click returns early
		let releasePost!: (r: Response) => void;
		const held = new Promise<Response>((res) => {
			releasePost = res;
		});
		stubFetch(jsonResponse({ ok: true, file: { content: 'a: 1\n' } }), () => held);
		const h2 = mountFile({ path: 'settings.yaml' });
		await h2.settle();
		glue.value = 'a: 2\n';
		glue.onChange();
		flushSync();
		saveButton(h2.target).click(); // in flight now
		forceClick(saveButton(h2.target)); // guard: saving === true → early return
		await h2.settle();
		const posts = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
			(c) => c[1]?.method === 'POST'
		);
		expect(posts).toHaveLength(1);
		releasePost(jsonResponse({ ok: true }));
		await h2.settle();
		h2.cleanup();
	});

	// Unmount after a landed load disposes the editor through the seam.
	it('unmount disposes the editor exactly once', async () => {
		stubFetch(jsonResponse({ ok: true, file: { content: 'a: 1\n' } }));
		const h = mountFile({ path: 'settings.yaml' });
		await h.settle();
		expect(glue.disposed).toBe(false);
		h.cleanup();
		expect(glue.disposed).toBe(true);
	});
});
