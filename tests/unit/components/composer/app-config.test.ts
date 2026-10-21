/**
 * app-config store + wiring tests (~/.dsi/settings.yaml, 2026-08-25).
 *
 * Store: singleton GET /api/config — one fetch per page load, defaults
 * until the load lands, invalid payloads and failures keep the default.
 * Wiring: the prompt clamp (data-max-rows), the BC-7 poll cadence
 * (orchestrator fallback), and the panel/sidebar layout bounds all read
 * the store — config values win, code constants are the fallback.
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Composer from '$lib/components/composer/Composer.svelte';
import {
	appConfig,
	loadAppConfig,
	resetAppConfigForTests
} from '$lib/services/config/app-config.svelte';
import { createPollingOrchestrator } from '$lib/services/conversation/polling-orchestrator.svelte';
import { createConversationStore } from '$lib/services/conversation/store.svelte';
import {
	clampPanelWidth,
	clampPanelZoom,
	defaultPanelPrefs
} from '$lib/utils/panel-prefs';
import {
	clampSidebarWidth,
	defaultSidebarPrefs
} from '$lib/utils/sidebar-prefs';

afterEach(() => {
	resetAppConfigForTests();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

function body(sections: Record<string, unknown>): Response {
	return new Response(JSON.stringify({ ok: true, ...sections }), {
		status: 200,
		headers: { 'content-type': 'application/json' }
	});
}

function okBody(maxRows: number): Response {
	return body({ chat: { input: { maxRows } } });
}

async function settle(): Promise<void> {
	for (let i = 0; i < 6; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}

describe('app-config store', () => {
	it('starts at the shared defaults (every section)', () => {
		expect(appConfig()).toEqual({
			chat: { input: { maxRows: 15 }, accessConfirmTimeoutMs: 12_000, macro: { maxLines: 25, maxDepth: 3 } },
			conversation: {
				pollRunningMs: 500,
				pollIdleMs: 2000,
				statsBar: 'full-ledger',
				collapsable: false,
				progressiveFold: false,
				heartbeatType: 'viewport-cap'
			},
			home: { refreshMs: 5000 },
			jobs: { autoClose: false },
			a2a: { fastPollMs: 1000, watchTimeoutMs: 600_000, retentionDays: 90 },
			panel: {
				defaultWidth: 730,
				minWidth: 480,
				maxWidth: 860,
				minZoom: 0.25,
				maxZoom: 1.25
			},
			sidebar: { defaultWidth: 400, minWidth: 200, maxWidth: 500, placement: 'none' },
			prompts: { tags: ['session', 'git', 'plan', 'rca', 'kb'], dbPath: '' },
			settingsHomes: { dsi: '~/.dsi', dsh: '~/.dsh' }
		});
	});

	it('applies chat.input.maxRows when the load lands', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => okBody(7)));
		const p = loadAppConfig();
		expect(appConfig().chat.input.maxRows).toBe(15); // default until settle
		await p;
		expect(appConfig().chat.input.maxRows).toBe(7);
	});

	it('applies chat.macro caps from a landed body; bad values keep defaults', async () => {
		// Valid override lands whole.
		vi.stubGlobal(
			'fetch',
			vi.fn(() => body({ chat: { macro: { maxLines: 40, maxDepth: 2 } } }))
		);
		await loadAppConfig();
		expect(appConfig().chat.macro).toEqual({ maxLines: 40, maxDepth: 2 });
	});

	it('clamps out-of-range chat.macro values back to defaults (mirror of the server reader)', async () => {
		for (const maxLines of [0, -3, 501, 2.5, '25', null, true]) {
			resetAppConfigForTests();
			vi.stubGlobal('fetch', vi.fn(() => body({ chat: { macro: { maxLines } } })));
			await loadAppConfig();
			expect(appConfig().chat.macro.maxLines).toBe(25);
		}
		for (const maxDepth of [0, -1, 11, 1.5, '3', null]) {
			resetAppConfigForTests();
			vi.stubGlobal('fetch', vi.fn(() => body({ chat: { macro: { maxDepth } } })));
			await loadAppConfig();
			expect(appConfig().chat.macro.maxDepth).toBe(3);
		}
		// A non-object macro section keeps the whole default.
		resetAppConfigForTests();
		vi.stubGlobal('fetch', vi.fn(() => body({ chat: { macro: 'nope' } })));
		await loadAppConfig();
		expect(appConfig().chat.macro).toEqual({ maxLines: 25, maxDepth: 3 });
	});

	it('is a singleton — concurrent loads share one fetch', async () => {
		const fetchMock = vi.fn(async () => okBody(9));
		vi.stubGlobal('fetch', fetchMock);
		await Promise.all([loadAppConfig(), loadAppConfig(), loadAppConfig()]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(appConfig().chat.input.maxRows).toBe(9);
	});

	it('applies every section from one body', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				body({
					chat: { input: { maxRows: 9 }, accessConfirmTimeoutMs: 5000 },
					conversation: {
						pollRunningMs: 250,
						pollIdleMs: 4000,
						statsBar: 'partial',
						collapsable: true,
						progressiveFold: true
					},
					home: { refreshMs: 1500 },
					a2a: { fastPollMs: 250, watchTimeoutMs: 120_000, retentionDays: 7 },
					panel: { defaultWidth: 700, minWidth: 600, maxWidth: 900, minZoom: 0.75, maxZoom: 2 },
					sidebar: { defaultWidth: 300, minWidth: 240, maxWidth: 400, placement: 'panels-zoom' }
				})
			)
		);
		await loadAppConfig();
		const c = appConfig();
		expect(c.chat.input.maxRows).toBe(9);
		expect(c.chat.accessConfirmTimeoutMs).toBe(5000);
		expect(c.conversation).toEqual({
			pollRunningMs: 250,
			pollIdleMs: 4000,
			statsBar: 'partial',
			collapsable: true,
			progressiveFold: true,
			// not in the served body → the literal gate keeps the default
			heartbeatType: 'viewport-cap'
		});
		expect(c.home.refreshMs).toBe(1500);
		expect(c.a2a).toEqual({ fastPollMs: 250, watchTimeoutMs: 120_000, retentionDays: 7 });
		expect(c.panel).toEqual({ defaultWidth: 700, minWidth: 600, maxWidth: 900, minZoom: 0.75, maxZoom: 2 });
		expect(c.sidebar).toEqual({ defaultWidth: 300, minWidth: 240, maxWidth: 400, placement: 'panels-zoom' });
	});

	it('sidebar.placement is literal-gated — unknown values fall back to none', async () => {
		// A foreign value must not smuggle an unknown mode past the store —
		// the browser gate is the same literal check the server runs.
		vi.stubGlobal('fetch', vi.fn(async () => body({ sidebar: { placement: 'inside-panes' } })));
		await loadAppConfig();
		expect(appConfig().sidebar.placement).toBe('none');
	});

	it('invalid payloads keep the defaults (per key, cross-section)', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				body({
					chat: { input: { maxRows: 0 } },
					conversation: { pollRunningMs: 10 },
					home: { refreshMs: 'fast' },
					a2a: { fastPollMs: -5, watchTimeoutMs: 10, retentionDays: 0 },
					panel: { minWidth: 900, maxWidth: 500 }, // crossed → revert
					sidebar: { defaultWidth: null }
				})
			)
		);
		await loadAppConfig();
		const c = appConfig();
		expect(c.chat.input.maxRows).toBe(15);
		expect(c.conversation.pollRunningMs).toBe(500);
		expect(c.home.refreshMs).toBe(5000);
		expect(c.a2a).toEqual({ fastPollMs: 1000, watchTimeoutMs: 600_000, retentionDays: 90 });
		expect(c.panel.minWidth).toBe(480);
		expect(c.panel.maxWidth).toBe(860);
		expect(c.sidebar.defaultWidth).toBe(400);
	});

	it('HTTP error and network failure keep the defaults, never reject', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
		await expect(loadAppConfig()).resolves.toBeUndefined();
		expect(appConfig().chat.input.maxRows).toBe(15);

		resetAppConfigForTests();
		vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('down'))));
		await expect(loadAppConfig()).resolves.toBeUndefined();
		expect(appConfig().chat.input.maxRows).toBe(15);
	});

	it('a fetch that throws synchronously is still swallowed', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => {
				throw new Error('Failed to parse URL');
			})
		);
		await expect(loadAppConfig()).resolves.toBeUndefined();
		expect(appConfig().chat.input.maxRows).toBe(15);
	});
});

describe('app-config prompts.tags gate (Prompt Tags ADR D5, client mirror)', () => {
	it('applies an array of tags — drops non-string and grammar-failing words', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				body({ prompts: { tags: ['Session', 'git', 42, null, 'Bad Word!', 'x'.repeat(33), 'rca_kb'] } })
			)
		);
		await loadAppConfig();
		// lowercased, grammar-gated (1..32 of [a-z0-9_-]); non-strings dropped.
		expect(appConfig().prompts.tags).toEqual(['session', 'git', 'rca_kb']);
	});

	it('splits a plain-string tags field on whitespace/comma/semicolon', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => body({ prompts: { tags: 'plan, git;  kb' } }))
		);
		await loadAppConfig();
		expect(appConfig().prompts.tags).toEqual(['plan', 'git', 'kb']);
	});

	it('an empty/invalid tags list keeps the landed default', async () => {
		for (const tags of [[], ['!!!', '...'], '   ', undefined]) {
			resetAppConfigForTests();
			vi.stubGlobal('fetch', vi.fn(async () => body({ prompts: { tags } })));
			await loadAppConfig();
			expect(appConfig().prompts.tags).toEqual(['session', 'git', 'plan', 'rca', 'kb']);
		}
		// a non-record prompts section keeps the default too.
		resetAppConfigForTests();
		vi.stubGlobal('fetch', vi.fn(async () => body({ prompts: 'nope' })));
		await loadAppConfig();
		expect(appConfig().prompts.tags).toEqual(['session', 'git', 'plan', 'rca', 'kb']);
	});

	// ── settingsHomes (The Settings Tree ADR 2026-09-18 D2) — replaces the
	// retired workspace.layout gate: the homes are plain read-only strings;
	// a stale `workspace` block in the served document is IGNORED (D1).
	describe('app-config settingsHomes (client mirror)', () => {
		it('applies the served home roots; junk keeps the tilde fallbacks', async () => {
			resetAppConfigForTests();
			vi.stubGlobal('fetch', vi.fn(async () => body({ settingsHomes: { dsi: '/Users/x/.dsi', dsh: 7 } })));
			await loadAppConfig();
			expect(appConfig().settingsHomes).toEqual({ dsi: '/Users/x/.dsi', dsh: '~/.dsh' });
		});

		it('ignores a stale workspace block entirely', async () => {
			resetAppConfigForTests();
			vi.stubGlobal('fetch', vi.fn(async () => body({ workspace: { layout: 'panels' } })));
			await loadAppConfig();
			expect(appConfig().settingsHomes).toEqual({ dsi: '~/.dsi', dsh: '~/.dsh' });
		});
	});
});

describe('Composer × app-config (chat.input.maxRows)', () => {
	function mountInput() {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(Composer, {
			target,
			props: {
				onsubmit: () => Promise.resolve(true),
				oncancel: () => Promise.resolve(),
				isStreaming: false,
				sending: false
			}
		});
		return { target, comp };
	}

	it('renders the default clamp as data-max-rows', () => {
		vi.stubGlobal('fetch', vi.fn(async () => okBody(15)));
		const { target, comp } = mountInput();
		const ta = target.querySelector('[data-testid="prompt-textarea"]') as HTMLTextAreaElement;
		expect(ta.getAttribute('data-max-rows')).toBe('15');
		unmount(comp);
	});

	it('re-clamps when the config load lands', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => okBody(7)));
		const { target, comp } = mountInput();
		// onMount kicked the singleton load — await its settlement, then
		// flush so the derived attribute re-renders.
		await loadAppConfig();
		await settle();
		const ta = target.querySelector('[data-testid="prompt-textarea"]') as HTMLTextAreaElement;
		expect(ta.getAttribute('data-max-rows')).toBe('7');
		unmount(comp);
	});

	it('a failed load keeps the default clamp', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('err', { status: 500 })));
		const { target, comp } = mountInput();
		await loadAppConfig();
		await settle();
		const ta = target.querySelector('[data-testid="prompt-textarea"]') as HTMLTextAreaElement;
		expect(ta.getAttribute('data-max-rows')).toBe('15');
		unmount(comp);
	});
});

describe('config-driven layout bounds (panel/sidebar)', () => {
	it('panel clamps + default width follow config', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				body({ panel: { defaultWidth: 700, minWidth: 600, maxWidth: 900, minZoom: 0.75, maxZoom: 2 } })
			)
		);
		await loadAppConfig();
		expect(clampPanelWidth(10_000)).toBe(900);
		expect(clampPanelWidth(100)).toBe(600);
		expect(clampPanelZoom(0.1)).toBe(0.75);
		expect(clampPanelZoom(9)).toBe(2);
		expect(defaultPanelPrefs().panelWidth).toBe(700);
	});

	it('sidebar clamps + default width follow config', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => body({ sidebar: { defaultWidth: 320, minWidth: 240, maxWidth: 420 } }))
		);
		await loadAppConfig();
		expect(clampSidebarWidth(10_000)).toBe(420);
		expect(clampSidebarWidth(10)).toBe(240);
		expect(defaultSidebarPrefs().width).toBe(320);
	});

	it('without config the constants are the bounds (fallback parity)', () => {
		expect(clampPanelWidth(10_000)).toBe(860);
		expect(clampPanelZoom(9)).toBe(1.25);
		expect(clampSidebarWidth(10)).toBe(200);
		expect(defaultPanelPrefs().panelWidth).toBe(730);
		expect(defaultSidebarPrefs().width).toBe(400);
	});
});

describe('polling-orchestrator × app-config (BC-7 cadence)', () => {
	it('cadence falls back to config values when deps do not override', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => body({ conversation: { pollRunningMs: 250, pollIdleMs: 4000 } }))
		);
		await loadAppConfig();

		const store = createConversationStore('s1');
		const scheduled: number[] = [];
		const transport = (async () =>
			new Response(JSON.stringify({ ok: true, entries: [], lastSeq: 0, running: false }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})) as unknown as typeof fetch;
		const orch = createPollingOrchestrator(store, {
			fetchFn: transport,
			setTimer: (fn: () => void, ms: number) => {
				scheduled.push(ms);
				return 0;
			},
			clearTimer: () => {}
		});
		await orch.start(); // immediate first poll → idle → next at config idleMs
		expect(scheduled.at(-1)).toBe(4000);
		orch.stop();
	});
});
