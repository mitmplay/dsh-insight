/**
 * PluginManagerPanel branch-gap coverage — the base/branches/edges suites
 * pin the happy paths and the common failure arms; this file drives the
 * remaining arms: the bounce poll that sees a non-ok response before the
 * floor returns, the batch-install network arm, a v2 source whose rows
 * are entirely filtered away (zero-row source dropped from the render),
 * the v1 group id fallback for an empty repo tail, and the description
 * needle arm of the search filter.
 */
import { flushSync } from 'svelte';
import { mount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PluginManagerPanel from '$lib/components/settings-plugins/PluginManagerPanel.svelte';

const SNAP = {
	ok: true,
	snapshot: {
		generatedAt: '2026-09-27T00:00:00Z',
		profile: 'web',
		plugins: [
			{ n: '1', id: 'alpha', repo: 'https://github.com/a/alpha', author: 'Temoa', installed: false },
			{ n: '2', id: 'beta', repo: 'https://github.com/b/beta', author: null, installed: true }
		]
	}
};

const jsonRes = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const serverError = () => new Response('floor down', { status: 500 });

function stubFetch(impl: (input: string, init?: RequestInit) => Promise<Response>): ReturnType<typeof vi.fn> {
	const fetchMock = vi.fn(impl);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

function mountPanel(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	mount(PluginManagerPanel, { target, props });
	flushSync();
	return { target };
}

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('PluginManagerPanel branch gaps', () => {
	it('the bounce poll rides through a non-ok snapshot response before the floor returns', async () => {
		let polls = 0;
		let applied = false;
		stubFetch((input) => {
			if (String(input).includes('/api/plugins/apply')) {
				applied = true;
				return Promise.resolve(jsonRes({ ok: true, restarting: true }));
			}
			if (applied) {
				polls++;
				if (polls === 1) return Promise.resolve(serverError()); // the chain is mid-restart: 500, not a throw
				return Promise.resolve(jsonRes({ ok: true, snapshot: { ...SNAP.snapshot, plugins: SNAP.snapshot.plugins.map((p) => (p.id === 'gamma' ? p : p)) } }));
			}
			return Promise.resolve(jsonRes(SNAP));
		});
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-rows-a-alpha"]')).toBeTruthy(), { timeout: 5000 });
		target.querySelector('[data-testid="rack-select-1"]')?.dispatchEvent(new Event('click'));
		const check = target.querySelector('[data-testid="rack-select-1"]') as HTMLInputElement;
		check.click();
		flushSync();
		(target.querySelector('[data-testid="rack-install"]') as HTMLButtonElement).click();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-bounce"]')).toBeTruthy());
		// the first poll answered 500 (res.ok false — the keep-polling arm),
		// the second answered with a snapshot: the panel refreshes itself.
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-bounce"]')).toBeNull(), { timeout: 10_000 });
		expect(polls).toBeGreaterThanOrEqual(2);
	}, 15000);

	it('a batch install whose apply throws records the network error for every selected target', async () => {
		stubFetch((input) => {
			if (String(input).includes('/api/plugins/apply')) return Promise.reject(new Error('floor down'));
			return Promise.resolve(jsonRes(SNAP));
		});
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-rows-a-alpha"]')).toBeTruthy(), { timeout: 5000 });
		(target.querySelector('[data-testid="rack-select-1"]') as HTMLInputElement).click();
		flushSync();
		(target.querySelector('[data-testid="rack-install"]') as HTMLButtonElement).click();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-errors"]')?.textContent).toContain('alpha: network'));
		expect(target.querySelector('[data-testid="rack-rows-a-alpha"]')).toBeTruthy();
	});

	it('a v2 source whose rows are all filtered away drops out of the render', async () => {
		stubFetch(() =>
			Promise.resolve(
				jsonRes({
					ok: true,
					snapshot: {
						generatedAt: 't',
						profile: 'web',
						sources: [
							{ id: 'owned', name: 'owned', author: 'omdsh-dev', repo: 'https://github.com/omdsh-dev/owned', plugins: [{ n: '1', id: 'owned-plugin', repo: 'https://github.com/omdsh-dev/owned', author: 'omdsh-dev', installed: false }] },
							{ id: 'ghost', name: 'ghost', author: null, repo: 'https://github.com/ext/ghost', plugins: [{ n: '2', id: 'ghost-plugin', repo: 'https://github.com/ext/ghost', author: null, installed: true }] }
						],
						plugins: [
							{ n: '1', id: 'owned-plugin', repo: 'https://github.com/omdsh-dev/owned', author: 'omdsh-dev', installed: false },
							{ n: '2', id: 'ghost-plugin', repo: 'https://github.com/ext/ghost', author: null, installed: true }
						]
					}
				})
			)
		);
		const { target } = mountPanel();
		// the install tab filters ghost-plugin out -> the whole ghost source is dropped
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-rows-owned"]')).toBeTruthy());
		expect(target.querySelector('[data-testid="rack-rows-ghost"]')).toBeNull();
	});

	it('a v1 row with an empty repo groups under the raw repo fallback', async () => {
		stubFetch(() =>
			Promise.resolve(
				jsonRes({
					ok: true,
					snapshot: {
						generatedAt: 't',
						profile: 'web',
						plugins: [{ n: '1', id: 'bare', repo: '', author: null, installed: false }]
					}
				})
			)
		);
		const { target } = mountPanel();
		// tail '' || repo '' -> gid ''; the row still renders, no crash
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-row-bare"]')).toBeTruthy());
	});

	it('the search needle matches a row description on the install tab', async () => {
		stubFetch(() =>
			Promise.resolve(
				jsonRes({
					ok: true,
					snapshot: {
						generatedAt: 't',
						profile: 'web',
						plugins: [
							{ n: '1', id: 'watcher', repo: 'https://github.com/w/watcher', author: null, description: 'Watches the floor ports', installed: false },
							{ n: '2', id: 'other', repo: 'https://github.com/o/other', author: null, installed: false }
						]
					}
				})
			)
		);
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-row-watcher"]')).toBeTruthy());
		const input = target.querySelector('[data-testid="rack-search"]') as HTMLInputElement;
		input.value = 'floor ports';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(target.querySelector('[data-testid="rack-row-watcher"]')).toBeTruthy();
		expect(target.querySelector('[data-testid="rack-row-other"]')).toBeNull();
	});
});

	it('a load whose body answers ok:false renders the failed note (retry recovers)', async () => {
		const fetchMock = stubFetch(() => Promise.resolve(jsonRes({ ok: false })));
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-load-failed"]')).toBeTruthy());
		// retry against a healthy floor recovers the rack
		fetchMock.mockImplementation(() => Promise.resolve(jsonRes(SNAP)));
		(target.querySelector('[data-testid="rack-load-failed"] button') as HTMLButtonElement).click();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-rows-a-alpha"]')).toBeTruthy());
	});

	it('two plugins sharing one repo group under a single v1 group (existing-group arm)', async () => {
		stubFetch(() =>
			Promise.resolve(
				jsonRes({
					ok: true,
					snapshot: {
						generatedAt: 't',
						profile: 'web',
						plugins: [
							{ n: '1', id: 'first', repo: 'https://github.com/w/share', author: null, installed: false },
							{ n: '2', id: 'second', repo: 'https://github.com/w/share/', author: null, installed: false }
						]
					}
				})
			)
		);
		const { target } = mountPanel();
		// both rows land in ONE group keyed by the repo tail 'w/share'
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-row-first"]')).toBeTruthy());
		expect(target.querySelector('[data-testid="rack-row-second"]')).toBeTruthy();
		expect(target.querySelectorAll('[data-testid^="rack-source-head-"]').length).toBe(1);
	});

	it('a reload click that double-fires inside one batch hits the busy guard (one POST)', async () => {
		stubFetch((input) => {
			if (String(input).includes('/api/plugins/reload')) return Promise.resolve(jsonRes({ ok: true, snapshot: SNAP.snapshot }));
			return Promise.resolve(jsonRes(SNAP));
		});
		const { target } = mountPanel();
		// wait until the mount load has settled: the reload verb is disabled
		// while loading, and a disabled button never fires its handler
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-rows-a-alpha"]')).toBeTruthy());
		const fetchMock = vi.mocked(fetch);
		const before = fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/plugins/reload')).length;
		const btn = target.querySelector('[data-testid="rack-reload"]') as HTMLButtonElement;
		// two clicks in ONE synchronous batch: the first sets loading=true,
		// the second lands on the guard before the disabled attr flushes
		btn.click();
		btn.click();
		flushSync();
		await vi.waitFor(() => {
			const after = fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/plugins/reload')).length;
			expect(after).toBe(before + 1);
		});
	});

	it('an install click whose selection emptied inside the same batch hits the zero-selection guard', async () => {
		stubFetch(() => Promise.resolve(jsonRes(SNAP)));
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-select-1"]')).toBeTruthy(), { timeout: 5000 });
		const check = target.querySelector('[data-testid="rack-select-1"]') as HTMLInputElement;
		check.click();
		flushSync();
		const fetchMock = vi.mocked(fetch);
		const applyBefore = fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/plugins/apply')).length;
		// deselect + install click in ONE batch: the handler sees installCount 0
		// before the disabled attribute flushes
		check.click();
		(target.querySelector('[data-testid="rack-install"]') as HTMLButtonElement).click();
		flushSync();
		await new Promise((resolve) => setTimeout(resolve, 50));
		const applyAfter = fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/plugins/apply')).length;
		expect(applyAfter).toBe(applyBefore);
	});

	it('a failed batch install with NO results array names the first target (results ?? [])', async () => {
		stubFetch((input) => {
			if (String(input).includes('/api/plugins/apply')) return Promise.resolve(jsonRes({ ok: false }));
			return Promise.resolve(jsonRes(SNAP));
		});
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-select-1"]')).toBeTruthy(), { timeout: 5000 });
		(target.querySelector('[data-testid="rack-select-1"]') as HTMLInputElement).click();
		flushSync();
		(target.querySelector('[data-testid="rack-install"]') as HTMLButtonElement).click();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-errors"]')?.textContent).toContain('alpha: '));
	});

	it('a failed batch install row with an unknown n falls back to the first target id', async () => {
		stubFetch((input) => {
			if (String(input).includes('/api/plugins/apply')) {
				return Promise.resolve(jsonRes({ ok: false, results: [{ n: '99', ok: false, error: 'ghost row failed' }] }));
			}
			return Promise.resolve(jsonRes(SNAP));
		});
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-select-1"]')).toBeTruthy(), { timeout: 5000 });
		(target.querySelector('[data-testid="rack-select-1"]') as HTMLInputElement).click();
		flushSync();
		(target.querySelector('[data-testid="rack-install"]') as HTMLButtonElement).click();
		// '99' is not a selected row key: the diagnostic names the first target
		// (targets[0] is the row-n key '1')
		await vi.waitFor(() =>
			expect(target.querySelector('[data-testid="rack-errors"]')?.textContent).toContain('1: ghost row failed')
		);
	});