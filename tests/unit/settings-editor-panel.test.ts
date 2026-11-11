/**
 * SettingsEditorPanel host tests (Task 4.2-T) — the panel's contracts:
 * load per target through /api/settings (missing → default document),
 * save round-trip, parse-failure 400 keeps the buffer with the line
 * surfaced, revert restores the saved text, root-scoped Escape closes
 * only its own panel, dispose on unmount. Monaco glue mocked — the
 * component never loads the real chunk under happy-dom.
 *
 * Spec: dev/specs/2026-09-07 - DSI Settings Panel (ADR D4–D6; Tasks
 *      4.2/4.2-T).
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SettingsEditorPanelHost from './SettingsEditorPanelHost.svelte';

/** The mocked glue's live state — the tests drive edits through it. */
const glueState = {
	value: '',
	initial: '',
	onChange: (): void => {},
	disposed: false
};

vi.mock('$lib/components/common/settings-monaco', () => ({
	createYamlEditor: (
		_container: HTMLElement,
		initial: string,
		onChange: () => void
	) => {
		glueState.value = initial;
		glueState.initial = initial;
		glueState.onChange = onChange;
		return {
			getValue: () => glueState.value,
			setValue: (text: string) => {
				glueState.value = text;
			},
			dispose: () => {
				glueState.disposed = true;
			}
		};
	}
}));

type Route = { get: unknown; put?: { status: number; body: unknown } };

function stubFetch(route: Route): { calls: Array<{ url: string; init?: RequestInit }> } {
	const calls: Array<{ url: string; init?: RequestInit }> = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string | URL, init?: RequestInit) => {
			calls.push({ url: String(url), init });
			const isPut = init?.method === 'PUT';
			if (isPut) {
				const put = route.put ?? { status: 200, body: { ok: true } };
				return new Response(JSON.stringify(put.body), { status: put.status });
			}
			return new Response(JSON.stringify(route.get), { status: 200 });
		})
	);
	return { calls };
}

async function settle(): Promise<void> {
	await new Promise((r) => setTimeout(r, 0));
	flushSync();
}

function mountHost(target: 'dsi' | 'dsh', id = 'a') {
	const target2 = document.createElement('div');
	document.body.appendChild(target2);
	const instance = mount(SettingsEditorPanelHost, { target: target2, props: { target, id } });
	return { target: target2, instance };
}

beforeEach(() => {
	glueState.disposed = false;
	glueState.value = '';
	glueState.onChange = () => {};
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe('SettingsEditorPanel (W4 4.2-T)', () => {
	it('loads its target through /api/settings and seeds the editor clean', async () => {
		const { calls } = stubFetch({
			get: { ok: true, text: 'server:\n  ringCapacity: 500\n', missing: false }
		});
		const h = mountHost('dsi');
		await settle();
		expect(calls[0]?.url).toBe('/api/settings?target=dsi');
		expect(glueState.initial).toBe('server:\n  ringCapacity: 500\n');
		const state = h.target.querySelector('[data-testid="settings-state"]');
		expect(state?.textContent).toBe('clean');
		unmount(h.instance);
		h.target.remove();
	});

	it('a missing file seeds the default document and says so', async () => {
		stubFetch({
			get: { ok: true, text: '', missing: true, defaultText: 'chat:\n  input:\n    maxRows: 15\n' }
		});
		const h = mountHost('dsi');
		await settle();
		expect(glueState.initial).toContain('maxRows: 15');
		expect(h.target.querySelector('.settings-title')?.textContent).toContain('new file');
		unmount(h.instance);
		h.target.remove();
	});

	it('an edit marks dirty; Save PUTs the whole buffer and reports saved', async () => {
		const { calls } = stubFetch({
			get: { ok: true, text: 'a: 1\n', missing: false },
			put: { status: 200, body: { ok: true, target: 'dsh' } }
		});
		const h = mountHost('dsh');
		await settle();
		glueState.value = 'a: 2\n';
		glueState.onChange(); // the editor fired its change event
		flushSync();
		const save = h.target.querySelector('[data-testid="settings-save"]') as HTMLButtonElement;
		expect(save.disabled).toBe(false);
		save.click();
		await settle();
		const put = calls.find((c) => c.init?.method === 'PUT');
		expect(put?.url).toBe('/api/settings?target=dsh');
		expect(JSON.parse(String(put?.init?.body))).toEqual({ text: 'a: 2\n' });
		expect(h.target.querySelector('[data-testid="settings-state"]')?.textContent).toBe('saved');
		expect(save.disabled).toBe(true); // clean again
		unmount(h.instance);
		h.target.remove();
	});

	it('a parse-failed PUT keeps the buffer and surfaces the line; Revert restores', async () => {
		stubFetch({
			get: { ok: true, text: 'good: 1\n', missing: false },
			put: { status: 400, body: { ok: false, error: 'bad indentation', line: 3, column: 2 } }
		});
		const h = mountHost('dsi');
		await settle();
		glueState.value = 'bad: [\n';
		glueState.onChange();
		flushSync();
		(h.target.querySelector('[data-testid="settings-save"]') as HTMLButtonElement).click();
		await settle();
		const err = h.target.querySelector('[data-testid="settings-error"]');
		expect(err?.textContent).toContain('line 3');
		expect(err?.textContent).toContain('bad indentation');
		expect(glueState.value).toBe('bad: [\n'); // the buffer survives
		(h.target.querySelector('[data-testid="settings-reload"]') as HTMLButtonElement).click();
		flushSync();
		expect(glueState.value).toBe('good: 1\n');
		unmount(h.instance);
		h.target.remove();
	});

	it('root-scoped Escape closes only its own panel (two live editors coexist)', async () => {
		stubFetch({
			get: { ok: true, text: 'a: 1\n', missing: false }
		});
		const a = mountHost('dsi', 'a');
		const b = mountHost('dsh', 'b');
		await settle();
		const rootA = a.target.querySelector('[data-testid="settings-editor"]') as HTMLElement;
		rootA.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		flushSync();
		const logA = document.getElementById('event-log-a') as HTMLInputElement;
		const logB = document.getElementById('event-log-b') as HTMLInputElement;
		expect(logA.value).toBe('close:a');
		expect(logB.value).toBe(''); // b never heard it
		unmount(a.instance);
		unmount(b.instance);
		a.target.remove();
		b.target.remove();
	});

	it('disposes the editor on unmount', async () => {
		stubFetch({ get: { ok: true, text: 'a: 1\n', missing: false } });
		const h = mountHost('dsi');
		await settle();
		expect(glueState.disposed).toBe(false);
		unmount(h.instance);
		h.target.remove();
		expect(glueState.disposed).toBe(true);
	});


	it('a failed GET (network/500) surfaces the read error and still opens the buffer', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new TypeError('network down');
			})
		);
		const h = mountHost('dsh');
		await settle();
		expect(h.target.querySelector('[data-testid="settings-error"]')?.textContent).toContain(
			'could not read the settings file (dsh)'
		);
		expect(glueState.initial).toBe(''); // the editor still opens, empty
		unmount(h.instance);
		h.target.remove();
	});

	it('an ok:false GET surfaces the read error without seeding the editor', async () => {
		stubFetch({ get: { ok: false } });
		const h = mountHost('dsi');
		await settle();
		expect(h.target.querySelector('[data-testid="settings-error"]')?.textContent).toContain(
			'could not read the settings file (dsi)'
		);
		unmount(h.instance);
		h.target.remove();
	});

	it('a 400 without a line and error falls back to the plain parse-error note', async () => {
		stubFetch({
			get: { ok: true, text: 'a: 1\n', missing: false },
			put: { status: 400, body: { ok: false } }
		});
		const h = mountHost('dsi');
		await settle();
		glueState.value = 'bad: [\n';
		glueState.onChange();
		flushSync();
		(h.target.querySelector('[data-testid="settings-save"]') as HTMLButtonElement).click();
		await settle();
		const err = h.target.querySelector('[data-testid="settings-error"]')?.textContent ?? '';
		expect(err).toContain('not saved — invalid YAML');
		expect(err).not.toContain('line');
		expect(err.endsWith('parse error')).toBe(true);
		unmount(h.instance);
		h.target.remove();
	});

	it('a save whose PUT throws keeps the buffer and surfaces the request failure', async () => {
		stubFetch({ get: { ok: true, text: 'a: 1\n', missing: false } });
		const h = mountHost('dsi');
		await settle();
		glueState.value = 'a: 2\n';
		glueState.onChange();
		flushSync();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new TypeError('save failed');
			})
		);
		(h.target.querySelector('[data-testid="settings-save"]') as HTMLButtonElement).click();
		await settle();
		expect(h.target.querySelector('[data-testid="settings-error"]')?.textContent).toBe(
			'not saved — the save request failed'
		);
		expect(glueState.value).toBe('a: 2\n');
		unmount(h.instance);
		h.target.remove();
	});

	it('a missing file without defaultText seeds an empty buffer', async () => {
		stubFetch({ get: { ok: true, missing: true } });
		const h = mountHost('dsi');
		await settle();
		expect(glueState.initial).toBe('');
		expect(h.target.querySelector('.settings-title')?.textContent).toContain('new file');
		unmount(h.instance);
		h.target.remove();
	});
});