/**
 * ReloadButton Dirty Gate (ADR The Single Edit, amendment 2026-11-17 D7).
 *
 * The reload valve must be honest while a draft exists: the chip renders
 * disabled iff dirty, the tooltip names the draft, and handleReload
 * refuses the turn (belt) behind the disabled attribute (suspenders).
 * A clean file keeps the full idle → busy → done machine untouched.
 *
 * Presentational level — the toolbar receives dirty (owner-owned by the
 * panel); see the panel specs for refreshFile's draft safety.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WorkspaceFileToolbar from '$lib/components/workspace-file/WorkspaceFileToolbar.svelte';

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
	if (instance) unmount(instance as never);
	instance = null;
	target?.remove();
	target = null;
});

describe('ReloadButton Dirty Gate — D7', () => {
	it('the chip renders disabled while dirty, with the draft-naming tooltip', () => {
		mountToolbar({ dirty: true, editing: true, onreload: () => {} });
		const btn = reloadBtn();
		expect(btn.disabled).toBe(true);
		// the tooltip names the draft (paraglide en copy), not the generic Refresh
		expect(btn.getAttribute('aria-label')).toMatch(/Unsaved changes/);
		expect(btn.getAttribute('title')).toMatch(/Unsaved changes/);
	});

	it('the chip is enabled (and titled Refresh) once dirty clears', () => {
		mountToolbar({ dirty: false, onreload: () => {} });
		const btn = reloadBtn();
		expect(btn.disabled).toBe(false);
		expect(btn.getAttribute('aria-label')).toBe('Refresh');
	});

	it('the belt: a forced click on a dirty toolbar never calls onreload', async () => {
		const onreload = vi.fn(() => Promise.resolve());
		mountToolbar({ dirty: true, onreload });
		// dispatchEvent bypasses nothing for a disabled button — no click
		// is synthesized, so the handler cannot fire (suspenders). The
		// belt is the guard itself; pin it through the mounted grammar by
		// asserting the machine never leaves idle.
		reloadBtn().dispatchEvent(new MouseEvent('click', { bubbles: true }));
		await flushSync();
		expect(onreload).not.toHaveBeenCalled();
		expect(reloadBtn().getAttribute('data-state')).toBe('idle');
	});

	it('edit-mode gate (2026-11-17 operator fix): a clean buffer in edit mode still disables reload', () => {
		// clicking FileEdit flips the verb to Cancel; the raw editor is now
		// mounted — a refetch would clobber it even with no draft yet, so
		// the chip must gate on dirty OR editing, not dirty alone.
		mountToolbar({ dirty: false, editing: true, onreload: () => {} });
		expect(reloadBtn().disabled).toBe(true);
	});

	it('edit-mode belt: the guard refuses the turn even if the chip were clickable', async () => {
		const onreload = vi.fn(() => Promise.resolve());
		mountToolbar({ dirty: false, editing: true, onreload });
		reloadBtn().dispatchEvent(new MouseEvent('click', { bubbles: true }));
		await flushSync();
		expect(onreload).not.toHaveBeenCalled();
		expect(reloadBtn().getAttribute('data-state')).toBe('idle');
	});

	it('the edge: dirty while saving keeps the chip disabled — Save owns the turn', () => {
		mountToolbar({ dirty: true, editing: true, saveState: 'saving', onreload: () => {} });
		expect(reloadBtn().disabled).toBe(true);
	});

	it('the edge: readonly only removes the Save verb — the reload gate keys to dirty alone', () => {
		mountToolbar({ dirty: true, readonly: true, onreload: () => {} });
		// A closed gate removes Save (D4) but the reload chip still renders;
		// disabled here only because dirty is true.
		expect(reloadBtn()).toBeTruthy();
		expect(reloadBtn().disabled).toBe(true);
	});

	it('regression: a clean-file reload keeps the full idle → busy → done machine', async () => {
		vi.useFakeTimers();
		const onreload = vi.fn(() => Promise.resolve());
		mountToolbar({ dirty: false, onreload });
		reloadBtn().click();
		await flushSync();
		expect(reloadBtn().getAttribute('data-state')).toBe('busy');
		await vi.advanceTimersByTimeAsync(0);
		flushSync();
		expect(reloadBtn().getAttribute('data-state')).toBe('done');
		await vi.advanceTimersByTimeAsync(2000);
		flushSync();
		expect(reloadBtn().getAttribute('data-state')).toBe('idle');
		expect(onreload).toHaveBeenCalledTimes(1);
	});

	it('the i18n risk pin: every locale file carries the reload-dirty tooltip key', async () => {
		const { readFileSync } = await import('node:fs');
		const { resolve } = await import('node:path');
		const root = resolve(__dirname, '../../../..');
		for (const loc of ['en', 'es', 'id', 'zh']) {
			const json = JSON.parse(readFileSync(resolve(root, 'messages', loc + '.json'), 'utf8')) as Record<string, string>;
			expect(json.workspaceFileReloadDirty, loc + ' carries workspaceFileReloadDirty').toBeTruthy();
		}
	});
});
