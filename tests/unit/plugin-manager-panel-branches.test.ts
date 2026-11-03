/**
 * PluginManagerPanel branch coverage — the base and edges suites pin the
 * happy paths and simple failures; this file drives the remaining branch
 * arms: per-group fold + collapse-all/expand-all, the v2 sources wire
 * (owned vs external racks, dn numbering), the batch install verb's
 * restart bounce / failure / success arms, and the refreshToken refetch
 * contract (BUG 2026-10-05).
 */
import { flushSync } from 'svelte';
import { mount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PluginManagerPanel from '$lib/components/settings-plugins/PluginManagerPanel.svelte';
import PluginManagerPanelTokenHost from './PluginManagerPanelTokenHost.svelte';

const SNAP = {
	ok: true,
	snapshot: {
		generatedAt: '2026-09-27T00:00:00Z',
		profile: 'web',
		plugins: [
			{ n: '1', id: 'alpha', repo: 'https://github.com/a/alpha', author: 'Temoa', installed: false },
			{ n: '2', id: 'beta', repo: 'https://github.com/b/beta', author: null, description: 'Beta does beta things', installed: false },
			{ n: '3', id: 'gamma', repo: 'https://github.com/b/beta', author: null, installed: true }
		]
	}
};

// v2 wire: sources are authoritative; owned and external racks in one list.
const SNAP_V2 = {
	ok: true,
	snapshot: {
		generatedAt: 't',
		profile: 'web',
		sources: [
			{ id: 'owned', name: 'owned', author: 'omdsh-dev', repo: 'https://github.com/omdsh-dev/owned', plugins: [{ n: '1', id: 'owned-plugin', repo: 'https://github.com/omdsh-dev/owned', author: 'omdsh-dev', installed: false }] },
			{ id: 'external', name: 'external', author: null, repo: 'https://github.com/ext/external', plugins: [{ n: '2', id: 'external-plugin', repo: 'https://github.com/ext/external', author: null, installed: false }] }
		],
		plugins: [
			{ n: '1', id: 'owned-plugin', repo: 'https://github.com/omdsh-dev/owned', author: 'omdsh-dev', installed: false },
			{ n: '2', id: 'external-plugin', repo: 'https://github.com/ext/external', author: null, installed: false }
		]
	}
};

const jsonRes = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

function stubFetch(impl: (input: string, init?: RequestInit) => Promise<Response>): ReturnType<typeof vi.fn> {
	const fetchMock = vi.fn(impl);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

function mountPanel(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(PluginManagerPanel, { target, props });
	flushSync();
	return { target, instance };
}

afterEach(() => {
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('PluginManagerPanel branches', () => {
	it('a group chevron folds one repo; collapse-all folds every rack, expand-all re-opens all', async () => {
		stubFetch(() => Promise.resolve(jsonRes(SNAP)));
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-rows-a-alpha"]')).toBeTruthy());
		const ownedHead = target.querySelector('[data-testid="rack-source-head-a-alpha"]') as HTMLButtonElement;
		// every group starts expanded (Shelf Chrome: collapsed ONLY by verb)
		expect(ownedHead.getAttribute('aria-expanded')).toBe('true');
		ownedHead.click();
		flushSync();
		expect((target.querySelector('[data-testid="rack-source-head-a-alpha"]') as HTMLButtonElement).getAttribute('aria-expanded')).toBe('false');
		expect(target.querySelector('[data-testid="rack-rows-a-alpha"]')).toBeNull();
		// the other repo was untouched
		expect(target.querySelector('[data-testid="rack-rows-b-beta"]')).toBeTruthy();
		// chevron re-opens the folded repo
		(target.querySelector('[data-testid="rack-source-head-a-alpha"]') as HTMLButtonElement).click();
		flushSync();
		expect(target.querySelector('[data-testid="rack-rows-a-alpha"]')).toBeTruthy();

		// collapse-all folds BOTH racks at once
		(target.querySelector('[data-testid="rack-collapse-all"]') as HTMLButtonElement).click();
		flushSync();
		expect(target.querySelector('[data-testid="rack-rows-a-alpha"]')).toBeNull();
		expect(target.querySelector('[data-testid="rack-rows-b-beta"]')).toBeNull();
		expect((target.querySelector('[data-testid="rack-source-head-b-beta"]') as HTMLButtonElement).getAttribute('aria-expanded')).toBe('false');
		// expand-all re-opens every rack
		(target.querySelector('[data-testid="rack-expand-all"]') as HTMLButtonElement).click();
		flushSync();
		expect(target.querySelector('[data-testid="rack-rows-a-alpha"]')).toBeTruthy();
		expect(target.querySelector('[data-testid="rack-rows-b-beta"]')).toBeTruthy();
	});

	it('the v2 sources wire renders owned and external racks with source numbers as display numbers', async () => {
		stubFetch(() => Promise.resolve(jsonRes(SNAP_V2)));
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-rows-owned"]')).toBeTruthy());
		// both racks render; the author-less external rack shows its name
		expect(target.querySelector('[data-testid="rack-rows-external"]')).toBeTruthy();
		expect(target.textContent).toContain('omdsh-dev');
		expect(target.textContent).toContain('external');
		// display numbers: source number . row number (1.1, 2.1)
		expect(target.querySelector('[data-testid="rack-row-owned-plugin"]')?.textContent).toContain('1.1');
		expect(target.querySelector('[data-testid="rack-row-external-plugin"]')?.textContent).toContain('2.1');
	});

	it('a restarting batch install announces the bounce, clears the selection, and refreshes itself', async () => {
		let applied = false;
		const fetchMock = stubFetch((input) => {
			if (String(input).includes('/api/plugins/apply')) {
				applied = true;
				return Promise.resolve(jsonRes({ ok: true, restarting: true }));
			}
			if (String(input).includes('/api/plugins/snapshot')) {
				return Promise.resolve(jsonRes(applied
					? { ok: true, snapshot: { ...SNAP.snapshot, plugins: SNAP.snapshot.plugins.map((p) => (p.id === 'alpha' ? { ...p, installed: true } : p)) } }
					: SNAP));
			}
			return Promise.reject(new Error('unexpected ' + String(input)));
		});
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-rows-a-alpha"]')).toBeTruthy(), { timeout: 5000 });
		// select two rows, then fire the ONE batched install
		(target.querySelector('[data-testid="rack-select-1"]') as HTMLInputElement).click();
		(target.querySelector('[data-testid="rack-select-2"]') as HTMLInputElement).click();
		flushSync();
		(target.querySelector('[data-testid="rack-install"]') as HTMLButtonElement).click();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-bounce"]')).toBeTruthy());
		// while the floor is down the reload verb refuses to fire (loading/floorBounce guard)
		const callsAtBounce = fetchMock.mock.calls.length;
		(target.querySelector('[data-testid="rack-reload"]') as HTMLButtonElement)?.click();
		flushSync();
		expect(fetchMock.mock.calls.length).toBe(callsAtBounce);
		const applyCall = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([u]) => String(u).includes('/api/plugins/apply'));
		expect(JSON.parse(String(applyCall?.[1]?.body))).toEqual({ action: 'install', targets: ['1', '2'] });
		// the poll rides the bounce out; the panel reloads and clears the banner
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-bounce"]')).toBeNull(), { timeout: 10_000 });
		// selection cleared, alpha left the install tab
		expect(target.querySelector('[data-testid="rack-row-alpha"]')).toBeNull();
	});

	it('a failed batch install relays per-row diagnostics and clears the selection', async () => {
		stubFetch((input) => {
			if (String(input).includes('/api/plugins/apply')) {
				return Promise.resolve(jsonRes({ ok: false, results: [{ n: '1', ok: false, error: 'allowBuilds hint' }, { n: '2', ok: true }] }));
			}
			return Promise.resolve(jsonRes(SNAP));
		});
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-rows-a-alpha"]')).toBeTruthy(), { timeout: 5000 });
		(target.querySelector('[data-testid="rack-select-1"]') as HTMLInputElement).click();
		(target.querySelector('[data-testid="rack-select-2"]') as HTMLInputElement).click();
		flushSync();
		(target.querySelector('[data-testid="rack-install"]') as HTMLButtonElement).click();
		// the failed row is named by its row number's id, the passing row is silent
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-errors"]')?.textContent).toContain('alpha: allowBuilds hint'));
		expect(target.querySelector('[data-testid="rack-errors"]')?.textContent).not.toContain('beta');
	});

	it('a batch install with an empty results list still names the first target', async () => {
		stubFetch((input) => {
			if (String(input).includes('/api/plugins/apply')) return Promise.resolve(jsonRes({ ok: false, results: [] }));
			return Promise.resolve(jsonRes(SNAP));
		});
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-rows-a-alpha"]')).toBeTruthy(), { timeout: 5000 });
		(target.querySelector('[data-testid="rack-select-1"]') as HTMLInputElement).click();
		flushSync();
		(target.querySelector('[data-testid="rack-install"]') as HTMLButtonElement).click();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-errors"]')?.textContent).toContain('alpha: '));
	});

	it('a successful batch install clears the selection and refetches', async () => {
		let applied = false;
		stubFetch((input) => {
			if (String(input).includes('/api/plugins/apply')) {
				applied = true;
				return Promise.resolve(jsonRes({ ok: true, results: [{ id: 'alpha', ok: true }] }));
			}
			return Promise.resolve(jsonRes(applied
				? { ok: true, snapshot: { ...SNAP.snapshot, plugins: SNAP.snapshot.plugins.map((p) => (p.id === 'alpha' ? { ...p, installed: true } : p)) } }
				: SNAP));
		});
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-rows-a-alpha"]')).toBeTruthy(), { timeout: 5000 });
		(target.querySelector('[data-testid="rack-select-1"]') as HTMLInputElement).click();
		flushSync();
		(target.querySelector('[data-testid="rack-install"]') as HTMLButtonElement).click();
		// the refetch flips installed -> the row leaves the install tab
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-row-alpha"]')).toBeNull(), { timeout: 5000 });
		expect(target.querySelector('[data-testid="rack-errors"]')).toBeNull();
	});

	it('a refreshToken change re-fetches the snapshot (the --reload dedupe contract)', async () => {
		const fetchMock = stubFetch(() => Promise.resolve(jsonRes(SNAP)));
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(PluginManagerPanelTokenHost, { target });
		flushSync();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-rows-a-alpha"]')).toBeTruthy());
		const before = fetchMock.mock.calls.length;
		// the host bumps refreshToken after a server-side rebuild
		(target.querySelector('[data-testid="host-bump-token"]') as HTMLButtonElement).click();
		flushSync();
		await vi.waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before));
	});
});

describe('PluginManagerPanel row-verb branches', () => {
	it('the uninstall batch bar applies remove, then the refetch drops the row', async () => {
		let removed = false;
		const fetchMock = stubFetch((input) => {
			if (String(input).includes('/api/plugins/apply')) {
				removed = true;
				return Promise.resolve(jsonRes({ ok: true, results: [{ id: 'gamma', ok: true }] }));
			}
			return Promise.resolve(jsonRes(removed
				? { ok: true, snapshot: { ...SNAP.snapshot, plugins: SNAP.snapshot.plugins.filter((p) => p.id !== 'gamma') } }
				: SNAP));
		});
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-row-gamma"]')).toBeNull()); // install tab hides gamma
		(target.querySelector('[data-testid="rack-tab-uninstall"]') as HTMLButtonElement).click();
		flushSync();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-select-3"]')).toBeTruthy());
		(target.querySelector('[data-testid="rack-select-3"]') as HTMLInputElement).click();
		flushSync();
		(target.querySelector('[data-testid="rack-install"]') as HTMLButtonElement).click();
		// the refetch drops gamma from the snapshot -> even the uninstall tab empties
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-tab-empty"]')).toBeTruthy());
		const applyCall = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([u]) => String(u).includes('/api/plugins/apply'));
		expect(JSON.parse(String(applyCall?.[1]?.body))).toEqual({ action: 'remove', targets: ['3'] });
	});

	it('a failing row uninstall relays the dsh diagnostic into the error list', async () => {
		stubFetch((input) => {
			if (String(input).includes('/api/plugins/apply')) {
				return Promise.resolve(jsonRes({ ok: false, results: [{ id: 'gamma', ok: false, error: 'dsh plugin remove failed (exit 4)' }] }));
			}
			return Promise.resolve(jsonRes(SNAP));
		});
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-tabs"]')).toBeTruthy());
		(target.querySelector('[data-testid="rack-tab-uninstall"]') as HTMLButtonElement).click();
		flushSync();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-select-3"]')).toBeTruthy());
		(target.querySelector('[data-testid="rack-select-3"]') as HTMLInputElement).click();
		flushSync();
		(target.querySelector('[data-testid="rack-install"]') as HTMLButtonElement).click();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-errors"]')?.textContent).toContain('gamma: dsh plugin remove failed (exit 4)'));
	});

	it('a restarting row uninstall rides the bounce banner out and refreshes itself', async () => {
		let removed = false;
		stubFetch((input) => {
			if (String(input).includes('/api/plugins/apply')) {
				removed = true;
				return Promise.resolve(jsonRes({ ok: true, restarting: true }));
			}
			return Promise.resolve(jsonRes(removed
				? { ok: true, snapshot: { ...SNAP.snapshot, plugins: SNAP.snapshot.plugins.filter((p) => p.id !== 'gamma') } }
				: SNAP));
		});
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-tabs"]')).toBeTruthy());
		(target.querySelector('[data-testid="rack-tab-uninstall"]') as HTMLButtonElement).click();
		flushSync();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-select-3"]')).toBeTruthy());
		(target.querySelector('[data-testid="rack-select-3"]') as HTMLInputElement).click();
		flushSync();
		(target.querySelector('[data-testid="rack-install"]') as HTMLButtonElement).click();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-bounce"]')).toBeTruthy());
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-bounce"]')).toBeNull(), { timeout: 10_000 });
		// back on the install tab the rack re-renders without gamma
		(target.querySelector('[data-testid="rack-tab-install"]') as HTMLButtonElement).click();
		flushSync();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-row-beta"]')).toBeTruthy());
		expect(target.querySelector('[data-testid="rack-row-gamma"]')).toBeNull();
	}, 15000);

	it('a network failure on the row uninstall names the plugin with the network error', async () => {
		stubFetch((input) => {
			if (String(input).includes('/api/plugins/apply')) return Promise.reject(new Error('floor down'));
			return Promise.resolve(jsonRes(SNAP));
		});
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-tabs"]')).toBeTruthy());
		(target.querySelector('[data-testid="rack-tab-uninstall"]') as HTMLButtonElement).click();
		flushSync();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-select-3"]')).toBeTruthy());
		(target.querySelector('[data-testid="rack-select-3"]') as HTMLInputElement).click();
		flushSync();
		(target.querySelector('[data-testid="rack-install"]') as HTMLButtonElement).click();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-errors"]')?.textContent).toContain('gamma: network'));
	});

	it('the reload verb rebuilds; a rejected rebuild names the failed note', async () => {
		let failReload = false;
		stubFetch((input) => {
			if (String(input).includes('/api/plugins/reload')) {
				if (failReload) return Promise.resolve(jsonRes({ ok: false }));
				return Promise.resolve(jsonRes({ ok: true, snapshot: { ...SNAP.snapshot, generatedAt: '2026-09-28T00:00:00Z' } }));
			}
			return Promise.resolve(jsonRes(SNAP));
		});
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-generated"]')?.textContent).toContain('2026-09-27'));
		(target.querySelector('[data-testid="rack-reload"]') as HTMLButtonElement).click();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-generated"]')?.textContent).toContain('2026-09-28'));
		// now a rejected rebuild: the failed note replaces the rack
		failReload = true;
		(target.querySelector('[data-testid="rack-reload"]') as HTMLButtonElement).click();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-load-failed"]')).toBeTruthy());
	});

	it('a bounce that outlasts the deadline gives way to the retry UI (poll never hangs)', async () => {
		vi.useFakeTimers();
		try {
			let floorDown = false;
			stubFetch((input) => {
				if (String(input).includes('/api/plugins/apply')) {
					floorDown = true;
					return Promise.resolve(jsonRes({ ok: true, restarting: true }));
				}
				// the floor NEVER comes back: every bounce poll rejects
				if (floorDown) return Promise.reject(new Error('floor down'));
				return Promise.resolve(jsonRes(SNAP));
			});
			const { target } = mountPanel({ initialTab: 'uninstall' });
			await vi.advanceTimersByTimeAsync(50);
			(target.querySelector('[data-testid="rack-select-3"]') as HTMLInputElement).click();
			flushSync();
			(target.querySelector('[data-testid="rack-install"]') as HTMLButtonElement).click();
			await vi.advanceTimersByTimeAsync(100);
			expect(target.querySelector('[data-testid="rack-bounce"]')).toBeTruthy();
			// drive past BOUNCE_TIMEOUT_MS: the poll gives up, the banner clears,
			// and the failed note (with the retry verb) replaces the rack.
			await vi.advanceTimersByTimeAsync(130_000);
			expect(target.querySelector('[data-testid="rack-bounce"]')).toBeNull();
			expect(target.querySelector('[data-testid="rack-load-failed"]')).toBeTruthy();
		} finally {
			vi.useRealTimers();
		}
	}, 15000);

	it('a batch install whose bounce outlasts the deadline gives way to the retry UI too', async () => {
		vi.useFakeTimers();
		try {
			let floorDown = false;
			stubFetch((input) => {
				if (String(input).includes('/api/plugins/apply')) {
					floorDown = true;
					return Promise.resolve(jsonRes({ ok: true, restarting: true }));
				}
				if (floorDown) return Promise.reject(new Error('floor down'));
				return Promise.resolve(jsonRes(SNAP));
			});
			const { target } = mountPanel();
			await vi.advanceTimersByTimeAsync(50);
			(target.querySelector('[data-testid="rack-select-1"]') as HTMLInputElement).click();
			flushSync();
			(target.querySelector('[data-testid="rack-install"]') as HTMLButtonElement).click();
			await vi.advanceTimersByTimeAsync(100);
			expect(target.querySelector('[data-testid="rack-bounce"]')).toBeTruthy();
			// drive past BOUNCE_TIMEOUT_MS: the poll gives up, the banner clears,
			// and the failed note replaces the rack.
			await vi.advanceTimersByTimeAsync(130_000);
			expect(target.querySelector('[data-testid="rack-bounce"]')).toBeNull();
			expect(target.querySelector('[data-testid="rack-load-failed"]')).toBeTruthy();
		} finally {
			vi.useRealTimers();
		}
	}, 15000);

	it('a reload that throws (network) names the failed note too', async () => {
		let throwReload = false;
		const fetchMock2 = stubFetch((input) => {
			if (String(input).includes('/api/plugins/reload')) {
				if (throwReload) return Promise.reject(new Error('floor down mid-rebuild'));
				return Promise.resolve(jsonRes({ ok: true, snapshot: SNAP.snapshot }));
			}
			return Promise.resolve(jsonRes(SNAP));
		});
		const { target } = mountPanel();
		// wait until the mount load has settled: the reload guard refuses a busy panel
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-rows-a-alpha"]')).toBeTruthy());
		throwReload = true;
		(target.querySelector('[data-testid="rack-reload"]') as HTMLButtonElement).click();
		await new Promise((resolve) => setTimeout(resolve, 300));
		const reloadCalls = (fetchMock2.mock.calls as unknown as [string, RequestInit][]).filter(([u]) => String(u).includes('/api/plugins/reload'));
		expect(reloadCalls.length).toBe(1);
		expect(target.querySelector('[data-testid="rack-load-failed"]')).toBeTruthy();
	});

	it('deselecting a checked row removes it from the batch selection', async () => {
		stubFetch(() => Promise.resolve(jsonRes(SNAP)));
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-rows-a-alpha"]')).toBeTruthy());
		const check = target.querySelector('[data-testid="rack-select-1"]') as HTMLInputElement;
		check.click();
		flushSync();
		expect((target.querySelector('[data-testid="rack-select-1"]') as HTMLInputElement).checked).toBe(true);
		(target.querySelector('[data-testid="rack-select-1"]') as HTMLInputElement).click();
		flushSync();
		expect((target.querySelector('[data-testid="rack-select-1"]') as HTMLInputElement).checked).toBe(false);
	});
});

describe('PluginManagerPanel bounce note (amendment IV, D5 ext.)', () => {
	it('arms the sessionStorage marker on a restarting apply', async () => {
		stubFetch((input) => {
			if (String(input).includes('/api/plugins/apply')) return Promise.resolve(jsonRes({ ok: true, results: [{ id: 'alpha', ok: true }], restarting: true }));
			return Promise.resolve(jsonRes(SNAP));
		});
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-select-1"]')).toBeTruthy());
		(target.querySelector('[data-testid="rack-select-1"]') as HTMLInputElement).click();
		flushSync();
		(target.querySelector('[data-testid="rack-install"]') as HTMLButtonElement).click();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-bounce"]')).toBeTruthy());
		const raw = sessionStorage.getItem('rack-just-applied');
		expect(raw).toBeTruthy();
		expect(JSON.parse(raw!).action).toBe('install');
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-bounce"]')).toBeNull(), { timeout: 10_000 });
	}, 15000);

	it('the remounted rack shows the apply note, and the tab switch acknowledges it', async () => {
		sessionStorage.setItem('rack-just-applied', JSON.stringify({ action: 'install', targets: ['1'], at: Date.now() }));
		stubFetch((input) => Promise.resolve(jsonRes(SNAP)));
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-apply-note"]')).toBeTruthy());
		// the note is the acknowledgment surface: a tab switch clears it
		(target.querySelector('[data-testid="rack-tab-uninstall"]') as HTMLButtonElement).click();
		flushSync();
		expect(target.querySelector('[data-testid="rack-apply-note"]')).toBeNull();
		expect(sessionStorage.getItem('rack-just-applied')).toBeNull();
	});

	it('a stale marker sanitizes away silently (no note)', async () => {
		sessionStorage.setItem('rack-just-applied', JSON.stringify({ action: 'install', targets: ['1'], at: Date.now() - 200_000 }));
		stubFetch((input) => Promise.resolve(jsonRes(SNAP)));
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-tabs"]')).toBeTruthy());
		expect(target.querySelector('[data-testid="rack-apply-note"]')).toBeNull();
		expect(sessionStorage.getItem('rack-just-applied')).toBeNull();
	});

	it('junk marker is removed, not thrown on', async () => {
		sessionStorage.setItem('rack-just-applied', '{oops');
		stubFetch((input) => Promise.resolve(jsonRes(SNAP)));
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-tabs"]')).toBeTruthy());
		expect(target.querySelector('[data-testid="rack-apply-note"]')).toBeNull();
		expect(sessionStorage.getItem('rack-just-applied')).toBeNull();
	});
});

describe('PluginManagerPanel door-scoped selection (amendment IV)', () => {
	it('switching tabs drops the selection (the bar never fires across doors)', async () => {
		stubFetch((input) => Promise.resolve(jsonRes(SNAP)));
		const { target } = mountPanel();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rack-select-1"]')).toBeTruthy());
		(target.querySelector('[data-testid="rack-select-1"]') as HTMLInputElement).click();
		flushSync();
		expect((target.querySelector('[data-testid="rack-install"]') as HTMLButtonElement).textContent).toContain('(1)');
		(target.querySelector('[data-testid="rack-tab-uninstall"]') as HTMLButtonElement).click();
		flushSync();
		// the uninstall tab starts from a clean selection
		expect((target.querySelector('[data-testid="rack-install"]') as HTMLButtonElement).textContent).toContain('(0)');
		expect((target.querySelector('[data-testid="rack-install"]') as HTMLButtonElement).disabled).toBe(true);
	});
});
