/**
 * Unit: the sidebar column budget — an open Scheduler shelf is paid out
 * of the Focused cap (ADR-0084, W1 task 1.1-T).
 *
 * Source pins (the floating-anchor source-contract pattern): the pane's
 * rule reads the column's custom property with today's 50% as its
 * fallback; the column declares both budgets — 50% by default, 30% under
 * the open-shelf `:has()` selector; the pane file holds exactly ONE
 * max-height declaration (the 2026-09-02 regression put a second one on
 * the rows wrapper and the cap computed to `none`).
 *
 * DOM pins (SessionsList mounted in the ready phase with one published
 * panel — happy-dom lays nothing out, so these pin the PRECONDITIONS the
 * CSS rule rests on, never pixels): the shelf root sits inside the column
 * AFTER the Focused pane; its `data-collapsed` is "true" by default,
 * "false" after a toggle click and "true" again after a second; a
 * prefs-seeded expanded shelf mounts "false". The geometry itself is
 * measured on the built app by tests/e2e/panel-floor.spec.ts test 25.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SessionsList from '$lib/components/sessions/SessionsList.svelte';
import {
	setWorkspaceState,
	type WorkspaceState,
} from '$lib/services/conversation/workspace-context.svelte';
import { resetPanelRegistryForTests } from '$lib/services/panels/panel-registry';
import { SCHEDULER_PREFS_KEY } from '$lib/utils/scheduler-prefs';
import { DEFAULT_SESSION_FILTER } from '$lib/utils/session-filters';
import { defaultSpineGroupPrefs } from '$lib/utils/spine-group-prefs';

const COMPONENTS = join(process.cwd(), 'src/lib/components');
const columnSrc = readFileSync(join(COMPONENTS, 'sessions/SessionsList.svelte'), 'utf8');
const paneSrc = readFileSync(
	join(COMPONENTS, 'sidebar/session-open/SidebarSessionOpen.svelte'),
	'utf8'
);

/** Every max-height DECLARATION (a property colon) — prose mentions of the
 *  property carry no colon and never count. */
function maxHeightDeclarations(src: string): string[] {
	return src.match(/max-height\s*:[^;]*;/g) ?? [];
}

/** Node.DOCUMENT_POSITION_FOLLOWING — the bitmask `a.compareDocumentPosition(b)`
 *  returns when b comes after a in document order. */
const FOLLOWING = 4;

/** The shelf's ledger read — stubbed per test (the setup's fetch-double is
 *  replaced and restored), so every mount's wire traffic is countable. */
function installFetch(items: unknown[]) {
	const fetchSpy = vi.fn(
		async (_input: RequestInfo | URL) =>
			new Response(JSON.stringify({ items }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			})
	);
	vi.stubGlobal('fetch', fetchSpy);
	return fetchSpy;
}

/** Publish ONE open panel in the floor owner's shape (the sidebar-panel-list
 *  publishState pattern) so the Focused pane renders a row. */
function publishOnePanel(): void {
	const state: WorkspaceState = {
		rows: [
			{
				panel: {
					id: 'p-1',
					kind: 'conversation',
					sessionId: 's-1',
					agentPreset: null,
					width: 730,
				},
				title: 'One panel',
				workspace: null,
				dead: false,
				running: false,
			},
		],
		selectedPanelId: 'p-1',
		profile: null,
		select: () => undefined,
		remove: () => undefined,
	};
	setWorkspaceState(state);
}

interface ColumnHandle {
	target: HTMLElement;
	instance: Record<string, unknown>;
}

/** Let the stubbed reads' bodies resolve before teardown. */
async function settle(rounds = 8): Promise<void> {
	for (let i = 0; i < rounds; i++) {
		flushSync();
		await Promise.resolve();
	}
}

/** Every mount of this file — unmounted once, in afterEach (the shelf host
 *  owns a 30s refresh interval that only its destroy clears). */
const mounted: ColumnHandle[] = [];

/** The sidebar body column in its ready phase, minimal props. */
function mountColumn(): ColumnHandle {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(SessionsList, {
		target,
		props: {
			phase: 'ready',
			current: null,
			visible: [],
			workspaces: [],
			wsPills: [],
			presets: [],
			filter: DEFAULT_SESSION_FILTER,
			spine: defaultSpineGroupPrefs(),
			onspinechange: vi.fn(),
			onfilterchange: vi.fn(),
			oncreated: vi.fn(),
		},
	});
	flushSync();
	const handle = {
		target,
		instance: instance as unknown as Record<string, unknown>,
	};
	mounted.push(handle);
	return handle;
}

function el<T extends HTMLElement>(target: HTMLElement, testid: string): T | null {
	return target.querySelector<T>(`[data-testid="${testid}"]`);
}

/** The organ's machine-readable fold on the shelf ROOT — the fact the
 *  column's `:has()` rule reads (ADR-0084 D3). */
function foldOf(target: HTMLElement): string | null {
	return el(target, 'scheduler-shelf')?.getAttribute('data-collapsed') ?? null;
}

function clickShelfToggle(target: HTMLElement): void {
	el<HTMLButtonElement>(target, 'scheduler-shelf-toggle')?.click();
	flushSync();
}

beforeEach(() => {
	localStorage.clear();
});

afterEach(() => {
	for (const h of mounted.splice(0)) unmount(h.instance as never);
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	localStorage.clear();
	setWorkspaceState(null);
	resetPanelRegistryForTests();
	document.body.innerHTML = '';
});

describe('column budget — source contract (ADR-0084 D2)', () => {
	it('the pane rule reads the column property with the half-column fallback — a standalone mount still caps at 50%', () => {
		expect(paneSrc).toMatch(/max-height:\s*var\(--sidebar-focused-cap,\s*50%\)/);
	});

	it('the column declares both budgets: 50% on .sessions, 30% under the open-shelf :has() selector', () => {
		expect(columnSrc).toMatch(/\.sessions\s*\{[^}]*--sidebar-focused-cap:\s*50%/);
		expect(columnSrc).toMatch(
			/\.sessions:has\(:global\(\.shelf\[data-collapsed=['"]false['"]\]\)\)\s*\{[^}]*--sidebar-focused-cap:\s*30%/
		);
	});

	it('exactly ONE max-height declaration exists in the pane file — the cap never lands on the rows wrapper', () => {
		expect(maxHeightDeclarations(paneSrc)).toEqual([
			'max-height: var(--sidebar-focused-cap, 50%);',
		]);
	});
});

describe('column budget — DOM preconditions (SessionsList, ready phase, one panel)', () => {
	it('the shelf root sits inside sidebar-sessions, AFTER the Focused pane', () => {
		publishOnePanel();
		const { target } = mountColumn();
		const column = el(target, 'sidebar-sessions');
		const pane = el(target, 'sidebar-panel-pane');
		const shelf = el(target, 'scheduler-shelf');
		expect(column).not.toBeNull();
		expect(pane).not.toBeNull();
		expect(shelf).not.toBeNull();
		expect(column!.contains(shelf!)).toBe(true);
		expect(column!.contains(pane!)).toBe(true);
		expect(pane!.compareDocumentPosition(shelf!) & FOLLOWING).toBe(FOLLOWING);
	});

	it('data-collapsed: "true" by default, "false" after a toggle click, "true" after a second', async () => {
		const fetchSpy = installFetch([]);
		publishOnePanel();
		const { target } = mountColumn();
		// The shipped default is FOLDED (ADR-0058 D2/D3). The column is not
		// silent at mount, but the SHELF is: the read(s) so far belong to the
		// Scheduled Mark's ledger join, which the pane's rows body mounts with
		// (SidebarOpenPanelRows $effect → refreshScheduleLedger, single-flight).
		// The shelf's own reads are counted as a DELTA from here.
		expect(foldOf(target)).toBe('true');
		const shelfSilent = fetchSpy.mock.calls.length;

		clickShelfToggle(target);
		expect(foldOf(target)).toBe('false');
		// Every expand re-reads the ledger — exactly one more read, of the
		// shelf's endpoint.
		expect(fetchSpy.mock.calls.length).toBe(shelfSilent + 1);
		expect(String(fetchSpy.mock.calls[shelfSilent][0])).toBe('/api/dsh/schedule');

		clickShelfToggle(target);
		expect(foldOf(target)).toBe('true');
		// Folding re-reads nothing.
		expect(fetchSpy.mock.calls.length).toBe(shelfSilent + 1);
		await settle();
	});

	it('a prefs-seeded expanded shelf mounts "false" (ADR-0058 D3 seed)', async () => {
		localStorage.setItem(SCHEDULER_PREFS_KEY, '{"collapsed":false}');
		// Two readers of the same endpoint fire on this mount — the Scheduled
		// Mark's join (the pane's rows body) and the shelf's own EXPANDED-mount
		// read (SidebarSessionScheduler onMount). The pin is the FOLD; the
		// stub only keeps the reads answered.
		installFetch([]);
		publishOnePanel();
		const { target } = mountColumn();
		expect(foldOf(target)).toBe('false');
		await settle();
	});
});
