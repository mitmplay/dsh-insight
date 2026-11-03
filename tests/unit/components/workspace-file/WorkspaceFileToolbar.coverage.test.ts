/**
 * WorkspaceFileToolbar — coverage-mop suite (2026-10-31).
 *
 * One file, five slices, each authored to close a specific uncovered arm
 * in the toolbar (global gate: every metric >= 80% per file):
 *   1. handleReload machine (busy guard, absent-prop arm, done->idle timer, catch arm)
 *   2. Save verb matrix (disabled expression arms + saving/saved label ternary + readonly)
 *   3. Indicator chips (dirty / saved-stale / external-stale, all conditional arms)
 *   4. Preview/edit tab pair (aria/active grammar + both $bindable onclick arrows)
 *   5. Explorer toggle (handler-gated render + explorerHidden glyph/label arms + click)
 *
 * Presentational component mounted DIRECTLY (required props: dirty, onsave, path).
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WorkspaceFileToolbar from '$lib/components/workspace-file/WorkspaceFileToolbar.svelte';

// ═══ slice 1 — reload machine ═══
{
let target: HTMLElement | null = null;
let instance: Record<string, unknown> | null = null;

function mountToolbar(props: Record<string, unknown>) {
	target = document.createElement('div');
	document.body.appendChild(target);
	instance = mount(WorkspaceFileToolbar, {
		target: target!,
		props: { dirty: false, onsave: () => {}, path: 'a.ts', ...props } as never
	});
	flushSync();
}

function reloadBtn(): HTMLButtonElement {
	return target!.querySelector('[data-testid="file-reload"]') as HTMLButtonElement;
}

afterEach(() => {
	vi.useRealTimers();
	if (instance) unmount(instance as never);
	instance = null;
	target?.remove();
	target = null;
});

describe('WorkspaceFileToolbar — handleReload machine', () => {
	it('the busy guard: a second click during an in-flight onreload does not call it again', async () => {
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const onreload = vi.fn(() => gate);
		mountToolbar({ onreload });

		reloadBtn().click();
		flushSync();
		expect(reloadBtn().getAttribute('data-state')).toBe('busy');

		// second click while busy — the guard arm swallows it
		reloadBtn().click();
		reloadBtn().click();
		flushSync();
		expect(onreload).toHaveBeenCalledTimes(1);

		release();
		await vi.waitFor(() => expect(reloadBtn().getAttribute('data-state')).toBe('done'));
	});

	it('the !onreload structural guard: no reload button renders without the prop', () => {
		mountToolbar({}); // no onreload
		expect(target!.querySelector('[data-testid="file-toolbar"]')).toBeTruthy();
		expect(target!.querySelector('[data-testid="file-reload"]')).toBeNull();
	});

	it('happy path: busy (spinner + aria-busy) → done (check) → idle after 2000ms', async () => {
		vi.useFakeTimers();
		const onreload = vi.fn(() => Promise.resolve());
		mountToolbar({ onreload });

		const btn = reloadBtn();
		expect(btn.getAttribute('data-state')).toBe('idle');
		btn.click();
		await flushSync();
		// happy-dom paints the state attribute synchronously; the busy arm
		// shows the Loader2 spinner per ReloadButton's render ladder.
		expect(btn.getAttribute('data-state')).toBe('busy');
		expect(btn.querySelector('.animate-spin')).toBeTruthy();
		expect(btn.querySelector('svg[class*="animate-spin"]')).toBeTruthy();

		// flush only the promise microtasks — NOT the 2000ms timeout
		await vi.advanceTimersByTimeAsync(0);
		flushSync();
		// done arm: the Check glyph, no spinner
		expect(onreload).toHaveBeenCalledTimes(1);
		expect(reloadBtn().getAttribute('data-state')).toBe('done');
		expect(reloadBtn().querySelector('.animate-spin')).toBeNull();
		expect(reloadBtn().querySelector('svg')).toBeTruthy();

		// the 2000ms timeout returns to idle
		await vi.advanceTimersByTimeAsync(2000);
		flushSync();
		flushSync();
		expect(reloadBtn().getAttribute('data-state')).toBe('idle');
	});

	it('rejection path: a rejecting onreload returns the machine to idle, not busy/done', async () => {
		const onreload = vi.fn(() => Promise.reject(new Error('boom')));
		mountToolbar({ onreload });

		reloadBtn().click();
		flushSync();
		expect(reloadBtn().getAttribute('data-state')).toBe('busy');

		await vi.waitFor(() => {
			expect(onreload).toHaveBeenCalledTimes(1);
			expect(reloadBtn().getAttribute('data-state')).toBe('idle');
		});
		// not stuck done either: no check-mark state lingers
		expect(reloadBtn().getAttribute('data-state')).not.toBe('done');
	});
});
}

// ═══ slice 2 — save verb matrix ═══
{
let target: HTMLElement | null = null;
let instance: Record<string, unknown> | null = null;

function mountToolbar(props: Record<string, unknown>) {
	target = document.createElement('div');
	document.body.appendChild(target);
	instance = mount(WorkspaceFileToolbar, { target: target!, props: props as never });
	flushSync();
}

function saveBtn(): HTMLButtonElement | null {
	return target!.querySelector('[data-testid="file-save"]');
}

afterEach(() => {
	if (instance) unmount(instance as never);
	target?.remove();
	target = null;
	instance = null;
});

describe('WorkspaceFileToolbar — the Save verb matrix', () => {
	// The Single Edit ADR D3 (2026-10-31): Save RENDERS only while a
	// draft exists (editing AND dirty) — not "always rendered, disabled".

	it('editing + dirty + idle → present, enabled, Save label', () => {
		mountToolbar({ editing: true, dirty: true, onsave: vi.fn(), path: 'a.ts' });
		const btn = saveBtn();
		expect(btn).toBeTruthy();
		expect(btn!.disabled).toBe(false);
		expect(btn!.getAttribute('aria-label')).toBe('Save');
	});

	it('editing but clean → Save absent (no permanent ghost button)', () => {
		mountToolbar({ editing: true, dirty: false, onsave: vi.fn(), path: 'a.ts' });
		expect(saveBtn()).toBeNull();
	});

	it('dirty but NOT editing → Save absent (a draft only exists in edit mode)', () => {
		mountToolbar({ editing: false, dirty: true, onsave: vi.fn(), path: 'a.ts' });
		expect(saveBtn()).toBeNull();
	});

	it("saveState 'saving' disables the Save verb (Saving label arm)", () => {
		mountToolbar({ editing: true, dirty: true, saveState: 'saving', onsave: vi.fn(), path: 'a.ts' });
		const btn = saveBtn();
		expect(btn!.disabled).toBe(true);
		expect(btn!.getAttribute('aria-label')).toBe('Saving…');
	});

	it("view 'diff' no longer disables Save (ADR D4 — the dirty lock is retired)", () => {
		mountToolbar({ editing: true, dirty: true, view: 'diff', onsave: vi.fn(), path: 'a.ts' });
		expect(saveBtn()!.disabled).toBe(false);
	});

	it('readonly=true → the Save verb is absent even with a draft', () => {
		mountToolbar({ editing: true, dirty: true, readonly: true, onsave: vi.fn(), path: 'a.ts' });
		expect(saveBtn()).toBeNull();
	});

	it('clicking the enabled Save fires onsave exactly once', () => {
		const onsave = vi.fn();
		mountToolbar({ editing: true, dirty: true, onsave, path: 'a.ts' });
		saveBtn()!.click();
		flushSync();
		expect(onsave).toHaveBeenCalledTimes(1);
	});
});
}

// ═══ slice 3 — indicator chips ═══
{
let target: HTMLElement | null = null;
let instance: Record<string, unknown> | null = null;

function mountToolbar(props: Record<string, unknown>) {
  target = document.createElement('div');
  document.body.appendChild(target);
  instance = mount(WorkspaceFileToolbar, {
    target: target!,
    props: { onsave: vi.fn(), path: 'app/src/a.ts', ...props } as never
  });
  flushSync();
}

afterEach(() => {
  if (instance) unmount(instance as never);
  target?.remove();
  target = null;
  instance = null;
});

describe('WorkspaceFileToolbar — indicator chips', () => {
  it('dirty=true renders the dirty chip; dirty=false omits it', () => {
    mountToolbar({ dirty: true });
    expect(target!.querySelector('[data-testid="file-dirty"]')).toBeTruthy();
    expect(target!.querySelector('[data-testid="file-stale"]')).toBeNull();
    if (instance) unmount(instance as never);
    target!.remove();

    target = document.createElement('div');
    document.body.appendChild(target);
    instance = mount(WorkspaceFileToolbar, {
      target: target!,
      props: { dirty: false, onsave: vi.fn(), path: 'app/src/a.ts' } as never
    });
    flushSync();
    expect(target!.querySelector('[data-testid="file-dirty"]')).toBeNull();
  });

  it('saved && !dirty renders the saved chip; each false arm hides it', () => {
    // saved + clean → present
    mountToolbar({ dirty: false, saveState: 'saved' });
    expect(target!.querySelector('[data-testid="file-stale"]')).toBeTruthy();
    if (instance) unmount(instance as never);
    target!.remove();

    // saved but dirty → && false arm
    target = document.createElement('div');
    document.body.appendChild(target);
    instance = mount(WorkspaceFileToolbar, {
      target: target!,
      props: { dirty: true, saveState: 'saved', onsave: vi.fn(), path: 'app/src/a.ts' } as never
    });
    flushSync();
    expect(target!.querySelector('[data-testid="file-stale"]')).toBeNull();
    if (instance) unmount(instance as never);
    target!.remove();

    // not saved and clean → && false arm
    target = document.createElement('div');
    document.body.appendChild(target);
    instance = mount(WorkspaceFileToolbar, {
      target: target!,
      props: { dirty: false, saveState: 'idle', onsave: vi.fn(), path: 'app/src/a.ts' } as never
    });
    flushSync();
    expect(target!.querySelector('[data-testid="file-stale"]')).toBeNull();
  });

  it('stale=true shows the external-edit note with the panel note text; stale=false omits it', () => {
    mountToolbar({ dirty: true, stale: true, staleNote: 'external edit' });
    const chip = target!.querySelector('[data-testid="file-stale-external"]');
    expect(chip).toBeTruthy();
    expect(chip!.textContent).toContain('external edit');
    if (instance) unmount(instance as never);
    target!.remove();

    target = document.createElement('div');
    document.body.appendChild(target);
    instance = mount(WorkspaceFileToolbar, {
      target: target!,
      props: { dirty: true, stale: false, staleNote: 'external edit', onsave: vi.fn(), path: 'app/src/a.ts' } as never
    });
    flushSync();
    expect(target!.querySelector('[data-testid="file-stale-external"]')).toBeNull();
  });

  it('hasTabs=false renders no tablist', () => {
    mountToolbar({ dirty: false, hasTabs: false });
    expect(target!.querySelector('[role="tablist"]')).toBeNull();
    expect(target!.querySelector('[data-testid="file-toolbar"]')).toBeTruthy();
  });
});
}

// ═══ slice 4 — preview/edit tab pair ═══
{
type Tab = 'preview' | 'edit';

let target: HTMLElement | null = null;
let instance: Record<string, unknown> | null = null;

function mountToolbar(initialTab: Tab) {
	const bound: { value: Tab } = { value: initialTab };
	target = document.createElement('div');
	document.body.appendChild(target);
	instance = mount(WorkspaceFileToolbar, {
		target: target!,
		props: {
			dirty: false,
			onsave: () => {},
			path: 'notes/a.md',
			hasTabs: true,
			get tab() {
				return bound.value;
			},
			set tab(v: Tab) {
				bound.value = v;
			}
		} as never
	});
	flushSync();
	return bound;
}

/** Fresh mount carrying the given tab as a plain prop — the DOM-grammar
 *  oracle (aria-selected + .active must agree with the tab value). */
function remountPlain(tab: Tab) {
	if (instance) unmount(instance);
	target!.remove();
	target = document.createElement('div');
	document.body.appendChild(target);
	instance = mount(WorkspaceFileToolbar, {
		target: target!,
		props: { dirty: false, onsave: () => {}, path: 'notes/a.md', hasTabs: true, tab } as never
	});
	flushSync();
}

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	target?.remove();
	target = null;
});

function tabs() {
	return {
		preview: target!.querySelector('[data-testid="tab-preview"]') as HTMLButtonElement,
		edit: target!.querySelector('[data-testid="tab-edit"]') as HTMLButtonElement
	};
}

describe('WorkspaceFileToolbar — preview/edit tabs (hasTabs)', () => {
	it("initial tab='preview': preview aria-selected + .active, edit not; tablist present", () => {
		const bound = mountToolbar('preview');
		const { preview, edit } = tabs();
		expect(preview.getAttribute('role')).toBe('tab');
		expect(edit.getAttribute('role')).toBe('tab');
		expect(target!.querySelector('[role="tablist"]')).toBeTruthy();
		expect(preview.getAttribute('aria-selected')).toBe('true');
		expect(edit.getAttribute('aria-selected')).toBe('false');
		expect(preview.classList.contains('active')).toBe(true);
		expect(edit.classList.contains('active')).toBe(false);
		// no click yet: the bound prop is untouched
		expect(bound.value).toBe('preview');
	});

	it("initial tab='edit': edit aria-selected + .active, preview not", () => {
		mountToolbar('edit');
		const { preview, edit } = tabs();
		expect(edit.getAttribute('aria-selected')).toBe('true');
		expect(preview.getAttribute('aria-selected')).toBe('false');
		expect(edit.classList.contains('active')).toBe(true);
		expect(preview.classList.contains('active')).toBe(false);
	});

	it('click tab-edit → the $bindable writes edit back out; grammar follows', () => {
		const bound = mountToolbar('preview');
		tabs().edit.click();
		flushSync();
		// the inline onclick arm ran and the $bindable carried it outward
		expect(bound.value).toBe('edit');
		// the panel-bound grammar: a mount on the bound value renders edit active
		remountPlain(bound.value);
		const { preview, edit } = tabs();
		expect(edit.getAttribute('aria-selected')).toBe('true');
		expect(preview.getAttribute('aria-selected')).toBe('false');
		expect(edit.classList.contains('active')).toBe(true);
		expect(preview.classList.contains('active')).toBe(false);
	});

	it('click tab-preview → flips back out to preview; grammar follows', () => {
		const bound = mountToolbar('edit');
		tabs().preview.click();
		flushSync();
		expect(bound.value).toBe('preview');
		remountPlain(bound.value);
		const { preview, edit } = tabs();
		expect(preview.getAttribute('aria-selected')).toBe('true');
		expect(edit.getAttribute('aria-selected')).toBe('false');
		expect(preview.classList.contains('active')).toBe(true);
		expect(edit.classList.contains('active')).toBe(false);
	});
});
}

// ═══ slice 5 — explorer toggle ═══
{
const SHOW = 'Show explorer';
const HIDE = 'Hide explorer';

let target: HTMLElement | null = null;
let instance: Record<string, unknown> | null = null;

function mountToolbar(props: Record<string, unknown>) {
	target = document.createElement('div');
	document.body.appendChild(target);
	instance = mount(WorkspaceFileToolbar, {
		target: target!,
		props: { dirty: false, onsave: vi.fn(), path: 'a.ts', ...props } as never
	});
	flushSync();
}

afterEach(() => {
	if (instance) unmount(instance as never);
	target?.remove();
	target = null;
	instance = null;
});

describe('WorkspaceFileToolbar — explorer toggle', () => {
	it('ontoggleexplorer absent renders no explorer-toggle', () => {
		mountToolbar({});
		expect(target!.querySelector('[data-testid="explorer-toggle"]')).toBeNull();
	});

	it('present + visible lane: Hide label, PanelLeftClose glyph', () => {
		mountToolbar({ ontoggleexplorer: vi.fn(), explorerHidden: false });
		const btn = target!.querySelector('[data-testid="explorer-toggle"]');
		expect(btn).toBeTruthy();
		expect(btn?.getAttribute('aria-label')).toBe(HIDE);
		expect(btn?.getAttribute('title')).toBe(HIDE);
		// PanelLeftClose renders as an inline svg ({#if explorerHidden} false arm)
		expect(btn?.querySelector('svg')).toBeTruthy();
	});

	it('present + hidden lane: Show label, PanelLeftOpen glyph', () => {
		mountToolbar({ ontoggleexplorer: vi.fn(), explorerHidden: true });
		const btn = target!.querySelector('[data-testid="explorer-toggle"]');
		expect(btn).toBeTruthy();
		expect(btn?.getAttribute('aria-label')).toBe(SHOW);
		expect(btn?.getAttribute('title')).toBe(SHOW);
		expect(btn?.querySelector('svg')).toBeTruthy();
	});

	it('click delegates to ontoggleexplorer exactly once', () => {
		const ontoggleexplorer = vi.fn();
		mountToolbar({ ontoggleexplorer });
		const btn = target!.querySelector<HTMLButtonElement>('[data-testid="explorer-toggle"]');
		expect(btn).toBeTruthy();
		btn!.click();
		flushSync();
		expect(ontoggleexplorer).toHaveBeenCalledTimes(1);
	});
});
}
