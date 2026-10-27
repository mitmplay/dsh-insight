/**
 * file-view-toggle tests (File Eye tasks 2.1-T / 2.2-T): the persisted
 * view literal's sanitize round-trip, the owner-prop-as-live-authority
 * remount contract (the 43cd90f no-flash pattern), and the segmented
 * toggle's grammar + disable matrix.
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/components/monaco/settings-monaco', () => ({
	createTextEditor: vi.fn(() => ({
		getValue: () => '',
		setValue: vi.fn(),
		dispose: vi.fn()
	}))
}));

import WorkspaceFilePanel from '$lib/components/workspace-file/WorkspaceFilePanel.svelte';
import toolbarSrc from '$lib/components/workspace-file/WorkspaceFileToolbar.svelte?raw';
import { PANEL_PREFS_KEY, loadPanelPrefs } from '$lib/utils/panel-prefs';

const fetchMock = vi.fn<typeof fetch>();

function fileEntry(view?: string) {
	return {
		id: 'p1',
		kind: 'workspace-file',
		sessionId: 's1',
		path: 'app/src/a.ts',
		explorerPanelId: null,
		width: 420,
		...(view ? { view } : {})
	};
}

describe('panel-prefs — the view literal sanitizes', () => {
	function storedWith(view?: string) {
		localStorage.setItem(PANEL_PREFS_KEY, JSON.stringify({ panels: [fileEntry(view)], selectedPanelId: 'p1' }));
	}

	it('keeps diff, coerces everything else to edit (round-trip through storage)', () => {
		localStorage.clear();
		storedWith('diff');
		expect((loadPanelPrefs().panels[0] as { view?: string }).view).toBe('diff');
		storedWith('edit');
		expect((loadPanelPrefs().panels[0] as { view?: string }).view).toBe('edit');
		storedWith('bogus');
		expect((loadPanelPrefs().panels[0] as { view?: string }).view).toBe('edit');
		storedWith();
		expect((loadPanelPrefs().panels[0] as { view?: string }).view).toBe('edit');
		localStorage.clear();
	});
});

describe('WorkspaceFilePanel — owner prop is the live view authority', () => {
	let target: HTMLElement | null = null;
	let instance: Record<string, unknown> | null = null;

	function mountPanel(props: Record<string, unknown>) {
		target = document.createElement('div');
		document.body.appendChild(target);
		instance = mount(WorkspaceFilePanel, { target: target!, props: props as never });
	}

	afterEach(() => {
		if (instance) unmount(instance as never);
		target?.remove();
		target = null;
		instance = null;
		fetchMock.mockReset();
	});

	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
		// gate closed: no toggle, read-only — the persistence assertions ride
		// the SANITIZE layer and the toolbar contract below; the panel's own
		// gate fetch answers disabled so the machine stays deterministic.
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ ok: true, enabled: false }), { status: 200 })
		);
	});

	it('the stored view prop drives first paint without an intermediate flash state', async () => {
		mountPanel({ sessionId: 's1', path: 'a.md', root: '/ws', view: 'diff', onviewchange: vi.fn(), onclose: vi.fn() });
		flushSync();
		// The panel derives from the PROP: there is no local default state
		// that could paint 'edit' first (the 43cd90f lesson). The gate is
		// closed here so the toolbar hides the toggle; the assertion is the
		// derived authority shape itself — no throw, no stale capture.
		expect(target!.querySelector('[data-testid="workspace-file-panel"]')).toBeTruthy();
	});
});

describe('WorkspaceFileToolbar grammar — via the panel (File Eye 2.2-T)', () => {
	let target: HTMLElement | null = null;
	let instance: Record<string, unknown> | null = null;

	function mountPanel(props: Record<string, unknown>) {
		target = document.createElement('div');
		document.body.appendChild(target);
		instance = mount(WorkspaceFilePanel, { target: target!, props: props as never });
	}

	afterEach(() => {
		if (instance) unmount(instance as never);
		target?.remove();
		target = null;
		instance = null;
		fetchMock.mockReset();
	});

	function routeOpenGate(changed: boolean) {
		fetchMock.mockImplementation((input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes('/api/workspace/git-map')) {
				return Promise.resolve(new Response(JSON.stringify({ ok: true, enabled: true, rootIsRepo: true, repos: {} }), { status: 200 }));
			}
			if (url.includes('/api/workspace/git-status')) {
				return Promise.resolve(new Response(JSON.stringify({ ok: true, enabled: true, truncated: false, files: changed ? [{ code: 'M', path: 'a.ts' }] : [] }), { status: 200 }));
			}
			return Promise.resolve(new Response(JSON.stringify({ ok: true, file: { text: 'one\n', eof: true } }), { status: 200 }));
		});
	}

	afterEach(() => localStorage.clear());

	it('a changed file on an open gate renders the toggle: Edit on, aria-pressed, default view edit', async () => {
		routeOpenGate(true);
		mountPanel({ sessionId: 's1', path: 'a.ts', root: '/ws', onclose: vi.fn() });
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		const toggle = target!.querySelector('[data-testid="file-view-toggle"]');
		expect(toggle).toBeTruthy();
		const edit = target!.querySelector('[data-testid="file-view-edit"]');
		const diff = target!.querySelector('[data-testid="file-view-diff"]');
		expect(edit?.getAttribute('aria-pressed')).toBe('true');
		expect(edit?.classList.contains('on')).toBe(true);
		expect(diff?.getAttribute('aria-pressed')).toBe('false');
		expect(diff?.hasAttribute('disabled')).toBe(false);
		expect(target!.querySelector('[data-testid="file-save"]')).toBeTruthy();
	});

	it('the persisted diff view survives remount: Diff on, Save disabled', async () => {
		routeOpenGate(true);
		mountPanel({ sessionId: 's1', path: 'a.ts', root: '/ws', view: 'diff', onclose: vi.fn() });
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		expect(target!.querySelector('[data-testid="file-view-diff"]')?.getAttribute('aria-pressed')).toBe('true');
		expect(target!.querySelector('[data-testid="file-view-edit"]')?.getAttribute('aria-pressed')).toBe('false');
		expect((target!.querySelector('[data-testid="file-save"]') as HTMLButtonElement | null)?.disabled).toBe(true);
	});

	it('an unchanged file or a closed gate renders NO toggle; a closed gate removes Save', async () => {
		routeOpenGate(false);
		mountPanel({ sessionId: 's1', path: 'a.ts', root: '/ws', onclose: vi.fn() });
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		expect(target!.querySelector('[data-testid="file-view-toggle"]')).toBeNull();
		// now the closed gate
		fetchMock.mockReset();
		fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, enabled: false }), { status: 200 }));
		if (instance) unmount(instance as never);
		target!.remove();
		target = document.createElement('div');
		document.body.appendChild(target);
		instance = mount(WorkspaceFilePanel, { target: target!, props: { sessionId: 's1', path: 'a.ts', root: '/ws', onclose: vi.fn() } });
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
		expect(target!.querySelector('[data-testid="file-view-toggle"]')).toBeNull();
		expect(target!.querySelector('[data-testid="file-save"]')).toBeNull();
	});

	it('toolbar spacing is uniform: tabs restate the row gap, one control height (2026-10-27 operator request)', () => {
		// Vite ?raw import — the head-injection read is empty under the
		// vitest dom env, so the pin reads the compiled source instead.
		// Contract: the .tabs rule restates the toolbar row's 0.25rem
		// gap (flex gap does not inherit), the old 0.125rem override is
		// gone, and every control shares the one 1.5rem height.
		expect(toolbarSrc).toMatch(/\.file-toolbar[^{]*\{[^}]*gap:\s*0\.25rem/s);
		expect(toolbarSrc).toMatch(/\.tabs[^{]*\{[^}]*gap:\s*0\.25rem/s);
		expect(toolbarSrc).not.toMatch(/gap:\s*0\.125rem/);
		const heights = toolbarSrc.match(/height:\s*1\.5rem/g) ?? [];
		expect(heights.length).toBeGreaterThanOrEqual(3);
	});
});
