/**
 * SessionsList unit tests — the sidebar body's rendering shell.
 *
 * Component-direct mount (sidebar-panel-list.test.ts pattern): the
 * shell receives resolved state and reports writes upward, so every
 * test mounts with cold props and spies on the callback props.
 *
 * Covers the previously-uncovered paths:
 *  - paneledSessionIds default [] vs an explicit array (L29 branch)
 *  - the ready-phase footer: the "+ New chat" surface renders and its
 *    oncreated relay fires ONLY on a successful armed create (the
 *    footer arrow `(id) => oncreated(id)`); the unarmed click answers
 *    with the inline selection alert and never POSTs
 *  - the loading / error phase branches beside the ready branch
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SessionsList from '$lib/components/sessions/SessionsList.svelte';
import SidebarSessions from '$lib/components/sessions/SidebarSessions.svelte';
import { registerAddPanel, registerReplaceSelected } from '$lib/services/panels/panel-registry';
import { DEFAULT_SESSION_FILTER, type SessionFilterState } from '$lib/utils/session-filters';
import { defaultSpineGroupPrefs, type SpineGroupPrefs } from '$lib/utils/spine-group-prefs';
import type { DsiSessionSummary, DsiWorkspaceSummary } from '$lib/types';

/** One summary row — the full DsiSessionSummary shape. */
function summary(
	sessionId: string,
	over: Partial<DsiSessionSummary> = {}
): DsiSessionSummary {
	return {
		sessionId,
		title: `Session ${sessionId}`,
		agentPreset: 'research',
		running: false,
		blank: false,
		updatedAt: Date.now(),
		workspace: '/tmp/e2e-harness',
		turns: null,
		...over
	};
}

const jsonResponse = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function mountList(props: {
	phase?: 'loading' | 'ready' | 'error';
	message?: string;
	current?: DsiSessionSummary | null;
	visible?: DsiSessionSummary[];
	workspaces?: DsiWorkspaceSummary[];
	paneledSessionIds?: string[];
	depthById?: Record<string, number>;
	filter?: SessionFilterState;
	spine?: SpineGroupPrefs;
	onspinechange?: (partial: Partial<SpineGroupPrefs>) => void;
	onfilterchange?: (next: SessionFilterState) => void;
	oncreated?: (sessionId: string, agentPreset: string | null) => void;
	onreplace?: (sessionId: string, agentPreset: string | null) => void;
}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const onfilterchange = props.onfilterchange ?? vi.fn<(next: SessionFilterState) => void>();
	const oncreated =
		props.oncreated ?? vi.fn<(sessionId: string, agentPreset: string | null) => void>();
	const onreplace =
		props.onreplace ?? vi.fn<(sessionId: string, agentPreset: string | null) => void>();
	const onspinechange =
		props.onspinechange ?? vi.fn<(partial: Partial<SpineGroupPrefs>) => void>();
	const instance = mount(SessionsList, {
		target,
		props: {
			phase: props.phase ?? 'ready',
			message: props.message ?? '',
			current: props.current ?? null,
			visible: props.visible ?? [],
			depthById: props.depthById ?? {},
			workspaces: props.workspaces ?? [],
			...(props.paneledSessionIds !== undefined ? { paneledSessionIds: props.paneledSessionIds } : {}),
			wsPills: [],
			presets: [],
			filter: props.filter ?? DEFAULT_SESSION_FILTER,
			spine: props.spine ?? defaultSpineGroupPrefs(),
			onspinechange,
			onfilterchange,
			oncreated,
			...(props.onreplace !== undefined ? { onreplace } : {})
		}
	});
	flushSync();
	return { target, instance, onfilterchange, oncreated, onreplace, onspinechange };
}

/** Let the New chat fetch chain settle (add-workspace-button pattern). */
async function settle(rounds = 8): Promise<void> {
	for (let i = 0; i < rounds; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
	localStorage.clear();
});

describe('SessionsList — phase branches', () => {
	it('loading renders the hint, no rows — footer rides EVERY phase (W0 net fix)', () => {
		const { target, instance } = mountList({ phase: 'loading' });
		expect(target.querySelector('[data-testid="sidebar-sessions-loading"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="new-chat-button"]')).not.toBeNull();
		unmount(instance);
	});

	it('error renders the message with role=alert', () => {
		const { target, instance } = mountList({ phase: 'error', message: 'host unreachable' });
		const el = target.querySelector('[data-testid="sidebar-sessions-error"]');
		expect(el?.getAttribute('role')).toBe('alert');
		expect(el?.textContent).toBe('host unreachable');
		unmount(instance);
	});
});

describe('SessionsList — ready branch: rows, default prop, footer', () => {
	it('renders the shell, spine rows, and the + New chat footer (no paneledSessionIds prop → default [])', () => {
		const { target, instance } = mountList({ visible: [summary('s-one')] });
		expect(target.querySelector('[data-testid="sidebar-sessions"]')).not.toBeNull();
		expect(target.querySelectorAll('[data-testid="sidebar-session-card"]')).toHaveLength(1);
		// The footer's button surface is present in the ready branch, the
		// version STACK riding before it (2026-09-07 chip; 2f1e421 added the
		// pinned DSH release as a second line — RCA 2026-09-14): exactly two
		// lines, each semver-shaped.
		const footer = target.querySelector('.footer');
		expect(footer).not.toBeNull();
		const versionLines = [
			...(footer?.querySelectorAll('[data-testid="sidebar-footer-version"] > span') ?? [])
		].map((el) => el.textContent ?? '');
		expect(versionLines).toHaveLength(2);
		const SEMVER = /^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
		for (const line of versionLines) expect(line).toMatch(SEMVER);
		expect(footer?.querySelector('[data-testid="new-chat-button"]')).not.toBeNull();
		// The circled-A About trigger moved OUT of the footer to the app
		// sidebar header prefix (87f4f16, 2026-09-12) — its contract is
		// pinned by tests/unit/about-button.test.ts, not here.
		flushSync();
		expect(document.querySelector('[data-testid="about-title"]')).toBeNull();
		unmount(instance);
	});

	it('an explicit paneledSessionIds array renders the same ready branch', () => {
		const { target, instance } = mountList({
			visible: [summary('s-one'), summary('s-two')],
			paneledSessionIds: ['s-two']
		});
		// Rows pass through verbatim — paneled filtering is the owner's.
		expect(target.querySelectorAll('[data-testid="sidebar-session-card"]')).toHaveLength(2);
		expect(target.querySelector('[data-testid="new-chat-button"]')).not.toBeNull();
		unmount(instance);
	});
});

describe('SessionsList — footer + New chat (oncreated relay)', () => {
	it('unarmed filter (no agent/workspace) answers with the selection alert and never creates', async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		const { target, instance, oncreated } = mountList({
			filter: DEFAULT_SESSION_FILTER // preset null, workspace null
		});
		expect(target.querySelector('[data-testid="new-chat-selection-alert"]')).toBeNull();
		(target.querySelector('[data-testid="new-chat-button"]') as HTMLButtonElement).click();
		await settle();
		expect(
			target.querySelector('[data-testid="new-chat-selection-alert"]')?.textContent
		).toContain('You cannot chat unless you select an Agent (+ Workspace)');
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(oncreated).not.toHaveBeenCalled();
		unmount(instance);
	});

	it('armed filter creates via POST /api/dsh/sessions and relays oncreated(sessionId)', async () => {
		const fetchSpy = vi.fn(async () =>
			jsonResponse({ ok: true, sessionId: 's-fresh', agentPreset: 'research' })
		);
		vi.stubGlobal('fetch', fetchSpy);
		const armed: SessionFilterState = {
			workspace: '/tmp/e2e-harness',
			preset: 'research',
			blankMode: 'any'
		};
		const { target, instance, oncreated } = mountList({ filter: armed });
		(target.querySelector('[data-testid="new-chat-button"]') as HTMLButtonElement).click();
		await settle();
		// The create POST carries the pill selection (agent + cwd).
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const [input, init] = fetchSpy.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit | undefined];
		expect(String(input)).toBe('/api/dsh/sessions');
		expect(init?.method).toBe('POST');
		expect(JSON.parse(String(init?.body))).toEqual({
			agentPreset: 'research',
			cwd: '/tmp/e2e-harness'
		});
		// The footer's relay fires with the fresh id + the echoed preset.
		expect(oncreated).toHaveBeenCalledTimes(1);
		expect(oncreated).toHaveBeenCalledWith('s-fresh', 'research');
		unmount(instance);
	});

	it('a failed create shows the inline error and never relays oncreated', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				jsonResponse({ ok: false, error: { code: 'e', message: 'preset vanished' } }, 502)
			)
		);
		const armed: SessionFilterState = {
			workspace: '/tmp/e2e-harness',
			preset: 'research',
			blankMode: 'any'
		};
		const { target, instance, oncreated } = mountList({ filter: armed });
		(target.querySelector('[data-testid="new-chat-button"]') as HTMLButtonElement).click();
		await settle();
		expect(target.querySelector('[data-testid="new-chat-error"]')?.textContent).toContain(
			'preset vanished'
		);
		expect(oncreated).not.toHaveBeenCalled();
		// Unlocked after the failure — the button reads idle again.
		expect(
			(target.querySelector('[data-testid="new-chat-button"]') as HTMLButtonElement).disabled
		).toBe(false);
		unmount(instance);
	});
});

// ── Replace chat footer button (2026-08-31) ──────────────────────────
describe('SessionsList — footer verb toggle (dual-purpose New chat, 2026-08-31)', () => {
	const ARMED: SessionFilterState = {
		workspace: '/tmp/e2e-harness',
		preset: 'research',
		blankMode: 'any'
	};

	it('no onreplace prop — no mode toggle, label stays + New chat (home-page shape)', async () => {
		const { target, instance } = mountList({});
		expect(target.querySelector('[data-testid="chat-mode-toggle"]')).toBeNull();
		const main = target.querySelector('[data-testid="new-chat-button"]') as HTMLButtonElement;
		expect(main).not.toBeNull();
		expect(main.textContent).toContain('+ New chat');
		unmount(instance);
	});

	it('toggle renders with Add selected; flipping updates aria-pressed AND the label', async () => {
		const { target, instance } = mountList({ filter: ARMED, onreplace: () => {} });
		const add = target.querySelector('[data-testid="chat-mode-add"]') as HTMLButtonElement;
		const replace = target.querySelector('[data-testid="chat-mode-replace"]') as HTMLButtonElement;
		// Default mode: Add.
		expect(add.getAttribute('aria-pressed')).toBe('true');
		expect(replace.getAttribute('aria-pressed')).toBe('false');
		expect(target.querySelector('[data-testid="new-chat-button"]')?.textContent).toContain(
			'+ New chat'
		);
		// Flip to Replace — the segments swap and the button relabels.
		replace.click();
		await settle();
		expect(replace.getAttribute('aria-pressed')).toBe('true');
		expect(add.getAttribute('aria-pressed')).toBe('false');
		expect(target.querySelector('[data-testid="new-chat-button"]')?.textContent).toContain(
			'Replace chat'
		);
		// Flip back — the plain create shape returns.
		add.click();
		await settle();
		expect(target.querySelector('[data-testid="new-chat-button"]')?.textContent).toContain(
			'+ New chat'
		);
		unmount(instance);
	});

	it('replace mode: armed click creates and relays onreplace(sessionId, agentPreset)', async () => {
		const fetchSpy = vi.fn(async () =>
			jsonResponse({ ok: true, sessionId: 's-swap', agentPreset: 'research' })
		);
		vi.stubGlobal('fetch', fetchSpy);
		const onreplace = vi.fn<(sessionId: string, agentPreset: string | null) => void>();
		const oncreated = vi.fn<(sessionId: string, agentPreset: string | null) => void>();
		const { target, instance } = mountList({ filter: ARMED, oncreated, onreplace });
		(target.querySelector('[data-testid="chat-mode-replace"]') as HTMLButtonElement).click();
		await settle();
		(target.querySelector('[data-testid="new-chat-button"]') as HTMLButtonElement).click();
		await settle();
		// The same create POST the Add verb sends.
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const [input, init] = fetchSpy.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit | undefined];
		expect(String(input)).toBe('/api/dsh/sessions');
		expect(JSON.parse(String(init?.body))).toEqual({
			agentPreset: 'research',
			cwd: '/tmp/e2e-harness'
		});
		expect(onreplace).toHaveBeenCalledTimes(1);
		expect(onreplace).toHaveBeenCalledWith('s-swap', 'research');
		// The two verbs stay distinct — add never fired.
		expect(oncreated).not.toHaveBeenCalled();
		unmount(instance);
	});

	it('add mode (default): armed click relays oncreated without touching the toggle', async () => {
		const fetchSpy = vi.fn(async () =>
			jsonResponse({ ok: true, sessionId: 's-add', agentPreset: 'research' })
		);
		vi.stubGlobal('fetch', fetchSpy);
		const onreplace = vi.fn<(sessionId: string, agentPreset: string | null) => void>();
		const oncreated = vi.fn<(sessionId: string, agentPreset: string | null) => void>();
		const { target, instance } = mountList({ filter: ARMED, oncreated, onreplace });
		(target.querySelector('[data-testid="new-chat-button"]') as HTMLButtonElement).click();
		await settle();
		expect(oncreated).toHaveBeenCalledTimes(1);
		expect(oncreated).toHaveBeenCalledWith('s-add', 'research');
		expect(onreplace).not.toHaveBeenCalled();
		unmount(instance);
	});

	it('unarmed filter in replace mode answers with the selection alert and never creates', async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		const onreplace = vi.fn<(sessionId: string, agentPreset: string | null) => void>();
		const { target, instance } = mountList({
			filter: DEFAULT_SESSION_FILTER, // preset null, workspace null
			onreplace
		});
		(target.querySelector('[data-testid="chat-mode-replace"]') as HTMLButtonElement).click();
		(target.querySelector('[data-testid="new-chat-button"]') as HTMLButtonElement).click();
		await settle();
		expect(
			target.querySelector('[data-testid="new-chat-selection-alert"]')?.textContent
		).toContain('You cannot chat unless you select an Agent (+ Workspace)');
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(onreplace).not.toHaveBeenCalled();
		unmount(instance);
	});

	it('a failed create in replace mode shows the inline error and never relays', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				jsonResponse({ ok: false, error: { code: 'e', message: 'preset vanished' } }, 502)
			)
		);
		const onreplace = vi.fn<(sessionId: string, agentPreset: string | null) => void>();
		const { target, instance } = mountList({ filter: ARMED, onreplace });
		(target.querySelector('[data-testid="chat-mode-replace"]') as HTMLButtonElement).click();
		(target.querySelector('[data-testid="new-chat-button"]') as HTMLButtonElement).click();
		await settle();
		expect(target.querySelector('[data-testid="new-chat-error"]')?.textContent).toContain(
			'preset vanished'
		);
		expect(onreplace).not.toHaveBeenCalled();
		expect(
			(target.querySelector('[data-testid="new-chat-button"]') as HTMLButtonElement).disabled
		).toBe(false);
		unmount(instance);
	});
});

// ── 4.1-T: spine nesting render (2026-08-27 W4, ADR D6) ───────────────
describe('SidebarSessionList — lineage nesting (task 4.1-T)', () => {
	it('depth rows align — the branch slot carries the cue, the row never pads', () => {
		const s = (sessionId: string): DsiSessionSummary => summary(sessionId);
		const { target, instance } = mountList({
			visible: [s('head'), s('kid'), s('plain')]
		});
		const rows = target.querySelectorAll('[data-testid="sidebar-session-card"]');
		expect(rows[0].getAttribute('data-depth')).toBe('0');
		expect(rows[0].getAttribute('style')).toBeNull();
		expect(rows[1].getAttribute('data-depth')).toBe('0'); // no map → 0
		expect(target.querySelectorAll('[data-testid="sidebar-workspace-branch"]')).toHaveLength(0);
		unmount(instance);

		const nested = mountList({
			visible: [s('head'), s('kid'), s('plain')],
			depthById: { kid: 1 }
		});
		const rows2 = nested.target.querySelectorAll('[data-testid="sidebar-session-card"]');
		expect(rows2[0].getAttribute('data-depth')).toBe('0');
		expect(rows2[1].getAttribute('data-depth')).toBe('1');
		// The row never indents — columns after the workspace start at the
		// same x on every row.
		expect(rows2[1].getAttribute('style')).toBeNull();
		expect(rows2[2].getAttribute('data-depth')).toBe('0');
		expect(rows2[2].getAttribute('style')).toBeNull();
		// The depth cue lives in the workspace slot: ONE branch on the
		// sub-agent row, inset depth × 0.75rem, chip suppressed.
		const branches = nested.target.querySelectorAll('[data-testid="sidebar-workspace-branch"]');
		expect(branches).toHaveLength(1);
		expect(rows2[1].contains(branches[0])).toBe(true);
		expect((branches[0] as HTMLElement).style.paddingLeft).toBe('0.75rem');
		expect(rows2[1].querySelector('[data-testid="sidebar-workspace-chip"]')).toBeNull();
		// Depth-0 rows keep the chip (the fixture workspace is set).
		expect(rows2[0].querySelector('[data-testid="sidebar-workspace-chip"]')).not.toBeNull();
		unmount(nested.instance);
	});

	it('a fork child paints its tree line the fork green; a spawned child stays muted (2026-09-01)', () => {
		const { target, instance } = mountList({
			visible: [
				summary('head'),
				summary('fork', { parentSessionId: 'head' }), // origin absent — a fork
				summary('kid', { parentSessionId: 'head', origin: 'subagent' })
			],
			depthById: { fork: 1, kid: 1 }
		});
		const rows = target.querySelectorAll('[data-testid="sidebar-session-card"]');
		const forkSlot = rows[1].querySelector('[data-testid="sidebar-workspace-branch"]')!;
		const kidSlot = rows[2].querySelector('[data-testid="sidebar-workspace-branch"]')!;
		expect(forkSlot.className).toContain('fork'); // the fork-green variant
		expect(kidSlot.className).not.toContain('fork'); // spawn line stays muted
		unmount(instance);
	});

	it('nested rows keep the SAME anchor grammar (href, testid, click contract)', () => {
		const { target, instance } = mountList({
			visible: [summary('kid')],
			depthById: { kid: 2 }
		});
		const row = target.querySelector('[data-testid="sidebar-session-card"]')!;
		expect(row.tagName).toBe('A');
		expect(row.getAttribute('href')).toContain('sessionKey=kid');
		expect(row.className).toContain('child');
		// The branch insets depth × 0.75rem INSIDE the fixed slot.
		const branch = row.querySelector('[data-testid="sidebar-workspace-branch"]')!;
		expect((branch as HTMLElement).style.paddingLeft).toBe('1.5rem');
		unmount(instance);
	});
});

// ── 4.2-T: owner integration (2026-08-27 W4 — suppression + family filter) ──
// The REAL SidebarSessions body with a stubbed /api/dsh/sessions feed
// carrying a family (main spawns kid+grand). Pins D5/D7 end to end:
// ghost-under-open-parent suppression and head-rides visibility.
describe('SidebarSessions — spine truth (task 4.2-T)', () => {
	function stubFamilyFeed() {
		const s = (sessionId: string, over: Partial<DsiSessionSummary> = {}): DsiSessionSummary =>
			summary(sessionId, { updatedAt: 1, ...over });
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				jsonResponse({
					ok: true,
					sessions: [
						s('plain'),
						s('head', { workspace: '/w/one' }),
						s('kid', { parentSessionId: 'head', origin: 'subagent', workspace: '/w/two' }),
						s('grand', { parentSessionId: 'kid', origin: 'subagent', workspace: '/w/three' })
					],
					workspaces: [],
					presets: []
				})
			)
		);
	}

	function mountBody(opts: { paneledSessionIds?: string[]; filter?: SessionFilterState } = {}) {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(SidebarSessions, {
			target,
			props: {
				currentSessionId: 'none',
				filter: opts.filter ?? DEFAULT_SESSION_FILTER,
				paneledSessionIds: opts.paneledSessionIds ?? [],
				onfilterchange: () => {}
			}
		});
		flushSync();
		return { target, instance };
	}

	const spineIds = (target: HTMLElement): string[] =>
		Array.from(target.querySelectorAll('[data-testid="sidebar-session-card"]')).map((el) =>
			(el.getAttribute('href') ?? '').split('sessionKey=').at(-1)?.split('&')[0] ?? ''
		);

	afterEach(() => {
		vi.unstubAllGlobals();
		document.body.innerHTML = '';
	});

	it('no floor: family rows all render, kid+grand INDENT under head (D6)', async () => {
		stubFamilyFeed();
		const { target, instance } = mountBody();
		await new Promise((r) => setTimeout(r, 20));
		flushSync();
		const rows = target.querySelectorAll('[data-testid="sidebar-session-card"]');
		expect(rows).toHaveLength(4);
		expect(rows[1].getAttribute('data-depth')).toBe('0'); // head
		expect(rows[2].getAttribute('data-depth')).toBe('1'); // kid
		expect(rows[3].getAttribute('data-depth')).toBe('2'); // grand
		unmount(instance);
	});

	it('parent paneled: its sub-agents LEAVE the spine (no double-listing, D5)', async () => {
		stubFamilyFeed();
		const { target, instance } = mountBody({ paneledSessionIds: ['head'] });
		await new Promise((r) => setTimeout(r, 20));
		flushSync();
		expect(spineIds(target)).toEqual(['plain']); // kid+grand suppressed with head paneled
		unmount(instance);
	});

	it('family filter: workspace pill matching ONLY the head keeps the family; not matching hides all (D7)', async () => {
		stubFamilyFeed();
		const keep = mountBody({ filter: { workspace: '/w/one', preset: null, blankMode: 'any' } });
		await new Promise((r) => setTimeout(r, 20));
		flushSync();
		expect(spineIds(keep.target).sort()).toEqual(['grand', 'head', 'kid']);
		unmount(keep.instance);

		const hide = mountBody({ filter: { workspace: '/w/two', preset: null, blankMode: 'any' } });
		await new Promise((r) => setTimeout(r, 20));
		flushSync();
		// Empty is CORRECT: the family hides (head /w/one ≠ /w/two — kid's own
		// cwd never surfaces it alone) AND plain's own cwd (/tmp/e2e-harness)
		// is filtered by the same pill.
		expect(spineIds(hide.target)).toEqual([]);
		unmount(hide.instance);
	});
});

// ── Spine view state (2026-09-01): name filter + sub-agent toggle ──────
// The REAL SidebarSessions body over a stubbed feed carrying a family
// (head → kid → grand), a plain row, and a FORK child (parentSessionId
// without origin). Pins the owner wiring end to end: the group header's
// report lands in localStorage and shapes `visible` — view filters only,
// the + New chat pill census untouched.
describe('SidebarSessions — spine view state (2026-09-01)', () => {
	function stubViewFeed() {
		const s = (sessionId: string, over: Partial<DsiSessionSummary> = {}): DsiSessionSummary =>
			summary(sessionId, { updatedAt: 1, ...over });
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				jsonResponse({
					ok: true,
					sessions: [
						s('plain'),
						s('head', { workspace: '/w/one' }),
						s('kid', { parentSessionId: 'head', origin: 'subagent', workspace: '/w/two' }),
						s('grand', { parentSessionId: 'kid', origin: 'subagent', workspace: '/w/three' }),
						s('fork', { parentSessionId: 'head', workspace: '/w/one' }) // NO origin
					],
					workspaces: [],
					presets: []
				})
			)
		);
	}

	function mountView() {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(SidebarSessions, {
			target,
			props: {
				currentSessionId: 'none',
				filter: DEFAULT_SESSION_FILTER,
				onfilterchange: () => {}
			}
		});
		flushSync();
		return { target, instance };
	}

	const spineIds = (target: HTMLElement): string[] =>
		Array.from(target.querySelectorAll('[data-testid="sidebar-session-card"]')).map((el) =>
			(el.getAttribute('href') ?? '').split('sessionKey=').at(-1)?.split('&')[0] ?? ''
		);

	function typeQuery(target: HTMLElement, value: string): void {
		const input = target.querySelector<HTMLInputElement>('[data-testid="sidebar-spine-filter"]')!;
		input.value = value;
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
	}

	async function settled(): Promise<void> {
		await new Promise((r) => setTimeout(r, 20));
		flushSync();
	}

	it('typing the query keeps the matched head AND its family; unmatched rows drop (D7)', async () => {
		stubViewFeed();
		const view = mountView();
		await settled();
		expect(spineIds(view.target)).toEqual(['plain', 'head', 'kid', 'grand', 'fork']);
		typeQuery(view.target, 'session head');
		// The fork child rides its head's match too (2026-09-01: the name
		// filter nests by raw edges — forks are family, D7 for both kinds).
		expect(spineIds(view.target)).toEqual(['head', 'kid', 'grand', 'fork']);
		unmount(view.instance);
	});

	it('emptying the query via the search input restores the full list', async () => {
		stubViewFeed();
		const view = mountView();
		await settled();
		typeQuery(view.target, 'session head');
		const input = view.target.querySelector(
			'[data-testid="sidebar-spine-filter"]'
		) as HTMLInputElement;
		input.value = '';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(spineIds(view.target)).toEqual(['plain', 'head', 'kid', 'grand', 'fork']);
		unmount(view.instance);
	});

	it('the sub-agent toggle removes ONLY origin-subagent rows — fork children stay', async () => {
		stubViewFeed();
		const view = mountView();
		await settled();
		const btn = view.target.querySelector<HTMLButtonElement>('[data-testid="sidebar-spine-subagents"]')!;
		btn.click();
		flushSync();
		expect(btn.getAttribute('aria-pressed')).toBe('true');
		expect(spineIds(view.target)).toEqual(['plain', 'head', 'fork']);
		// Toggle back — sub-agents return (plain rows keep their feed order).
		btn.click();
		flushSync();
		expect(spineIds(view.target)).toEqual(['plain', 'head', 'kid', 'grand', 'fork']);
		unmount(view.instance);
	});

	it('view filters never touch the + New chat pill census (workspaceOptions over `others`)', async () => {
		stubViewFeed();
		const view = mountView();
		await settled();
		// Hide sub-agents; the pill row ships expanded (2026-09-18) — the
		// census is directly inspectable.
		(
			view.target.querySelector('[data-testid="sidebar-spine-subagents"]') as HTMLButtonElement
		).click();
		flushSync();
		const twoPill = view.target.querySelector('[data-testid="filter-workspace-two"]');
		expect(twoPill).not.toBeNull(); // kid's cwd is STILL a selectable pill
		expect(twoPill?.textContent).toContain('1');
		unmount(view.instance);
	});

	it('every change persists — a re-mount restores filter text, hide state, and the filtered list', async () => {
		stubViewFeed();
		const first = mountView();
		await settled();
		typeQuery(first.target, 'session head');
		(
			first.target.querySelector('[data-testid="sidebar-spine-subagents"]') as HTMLButtonElement
		).click();
		flushSync();
		const stored = JSON.parse(localStorage.getItem('dsi-spine-group') ?? '{}') as Record<string, unknown>;
		expect(stored).toEqual({ collapsed: false, nameFilter: 'session head', subagentsHidden: true, dateFilter: '' });
		unmount(first.instance);

		stubViewFeed();
		const second = mountView();
		await settled();
		expect(
			(second.target.querySelector('[data-testid="sidebar-spine-filter"]') as HTMLInputElement).value
		).toBe('session head');
		expect(
			second.target
				.querySelector('[data-testid="sidebar-spine-subagents"]')
				?.getAttribute('aria-pressed')
		).toBe('true');
		// Both view filters compose: the hide removes kid+grand BEFORE the
		// query matches, so only the head (and its fork child — family
		// promotion is kind-blind now) survive; a view filter never
		// resurrects rows the other one removed.
		expect(spineIds(second.target)).toEqual(['head', 'fork']);
		unmount(second.instance);
	});
});

// ── Offline spine + create/replace handoff (2026-09-02) ──────────────
// SidebarSessions' own arms, pinned through the REAL body: the guarded
// load's catch (a rejecting feed never crashes the rail) and the
// create/replace handoff — on-floor through the registry, off-floor
// through the seed deep link.
describe('SidebarSessions — offline spine + create/replace handoff', () => {
	const ARMED: SessionFilterState = {
		workspace: '/tmp/e2e-harness',
		preset: 'research',
		blankMode: 'any'
	};

	/** Feed + create stub: GET answers the spine, POST answers the create. */
	function stubFeedWithCreate(): void {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				if (init?.method === 'POST') {
					return jsonResponse({ ok: true, sessionId: 's-fresh', agentPreset: 'research' });
				}
				return jsonResponse({
					ok: true,
					sessions: [summary('plain')],
					workspaces: [],
					presets: []
				});
			})
		);
	}

	function mountArmed(): { target: HTMLElement; instance: ReturnType<typeof mount> } {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(SidebarSessions, {
			target,
			props: {
				currentSessionId: 'none',
				filter: ARMED,
				paneledSessionIds: [],
				onfilterchange: () => {}
			}
		});
		flushSync();
		return { target, instance };
	}

	it('a rejecting spine feed lands in the error phase with the thrown message', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('spine unreachable');
			})
		);
		const { target, instance } = mountArmed();
		await settle();
		expect(target.querySelector('[data-testid="sidebar-sessions-error"]')?.textContent).toContain(
			'spine unreachable'
		);
		unmount(instance);
	});

	it('a non-Error throw stringifies — the rail errors, never crashes', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw 'boom';
			})
		);
		const { target, instance } = mountArmed();
		await settle();
		expect(target.querySelector('[data-testid="sidebar-sessions-error"]')?.textContent).toContain('boom');
		unmount(instance);
	});

	it('created on-floor: the fresh session joins the floor — registry add, never navigation', async () => {
		stubFeedWithCreate();
		const added: unknown[] = [];
		registerAddPanel((request) => {
			added.push(request);
		});
		try {
			const { target, instance } = mountArmed();
			await settle();
			(target.querySelector('[data-testid="new-chat-button"]') as HTMLButtonElement).click();
			await settle();
			expect(added).toEqual([{ sessionId: 's-fresh', agentPreset: 'research', focus: true }]);
			unmount(instance);
		} finally {
			registerAddPanel(null);
		}
	});

	it('created off-floor: the seed deep link is the fallback', async () => {
		stubFeedWithCreate();
		const assigned: string[] = [];
		const origAssign = window.location.assign;
		window.location.assign = ((url: string | URL) => {
			assigned.push(String(url));
		}) as never;
		try {
			const { target, instance } = mountArmed();
			await settle();
			(target.querySelector('[data-testid="new-chat-button"]') as HTMLButtonElement).click();
			await settle();
			expect(assigned).toEqual(['/?sessionKey=s-fresh']);
			unmount(instance);
		} finally {
			window.location.assign = origAssign;
		}
	});

	it('replace on-floor: the focused panel is swapped — registry replace, never navigation', async () => {
		stubFeedWithCreate();
		const replaced: unknown[] = [];
		registerReplaceSelected((request) => {
			replaced.push(request);
		});
		try {
			const { target, instance } = mountArmed();
			await settle();
			(target.querySelector('[data-testid="chat-mode-replace"]') as HTMLButtonElement).click();
			await settle();
			(target.querySelector('[data-testid="new-chat-button"]') as HTMLButtonElement).click();
			await settle();
			expect(replaced).toEqual([{ sessionId: 's-fresh', agentPreset: 'research', focus: true }]);
			unmount(instance);
		} finally {
			registerReplaceSelected(null);
		}
	});

	it('replace off-floor: the seed deep link is the fallback', async () => {
		stubFeedWithCreate();
		const assigned: string[] = [];
		const origAssign = window.location.assign;
		window.location.assign = ((url: string | URL) => {
			assigned.push(String(url));
		}) as never;
		try {
			const { target, instance } = mountArmed();
			await settle();
			(target.querySelector('[data-testid="chat-mode-replace"]') as HTMLButtonElement).click();
			await settle();
			(target.querySelector('[data-testid="new-chat-button"]') as HTMLButtonElement).click();
			await settle();
			expect(assigned).toEqual(['/?sessionKey=s-fresh']);
			unmount(instance);
		} finally {
			window.location.assign = origAssign;
		}
	});
});

// ── Chip label parity (Chip Menu ADR D5, propagated 2026-09-07) ──────
describe('SidebarSessionList — workspace chip label (title-first, D5 parity)', () => {
	it('a registered workspace renders its registry title, never the basename', () => {
		const { target, instance } = mountList({
			visible: [summary('main', { workspace: '/Users/x/harness' })],
			workspaces: [
				{ workspaceId: 'w-h', title: 'Renamed Home', path: '/Users/x/harness', sessionIds: [] }
			]
		});
		const chip = target.querySelector('[data-testid="sidebar-workspace-chip"]');
		expect(chip?.textContent).toContain('Renamed Home');
		expect(chip?.getAttribute('data-registered')).toBe('true');
		unmount(instance);
	});

	it('a ghost cwd keeps the basename (the registry no longer names it)', () => {
		const { target, instance } = mountList({
			visible: [summary('main', { workspace: '/Users/x/old' })],
			workspaces: [
				{ workspaceId: 'w-h', title: 'Renamed Home', path: '/Users/x/harness', sessionIds: [] }
			]
		});
		const chip = target.querySelector('[data-testid="sidebar-workspace-chip"]');
		expect(chip?.textContent).toContain('old');
		expect(chip?.getAttribute('data-registered')).toBe('false');
		unmount(instance);
	});
});
