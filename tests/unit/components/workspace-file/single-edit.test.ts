/**
 * The Single Edit (ADR 2026-10-31) — the toolbar's mode-verb contract.
 *
 * D2: the Edit/Cancel verb owns editability — one word "Edit" on the row.
 * D4: the Preview | Diff segments carry NO disabled lock in any state.
 * D5: the md/html eye/pencil tabs are untouched.
 *
 * Presentational level: the panel owns editing (see the panel specs);
 * here we pin the DOM grammar the operator reads.
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
		props: { dirty: false, onsave: vi.fn(), path: 'AGENTS.md', ...props } as never
	});
	flushSync();
}

function editVerb(): HTMLButtonElement | null {
	return target!.querySelector('[data-testid="file-edit"]');
}

afterEach(() => {
	if (instance) unmount(instance as never);
	instance = null;
	target?.remove();
	target = null;
});

describe('The Single Edit — the mode verb', () => {
	it('renders when the gate is open (readonly=false), even on an unchanged file (D6)', () => {
		mountToolbar({ readonly: false, editing: false });
		expect(editVerb()).toBeTruthy();
		// icon-only verb (2026-11-01): the label rides aria-label
		expect(editVerb()!.getAttribute('aria-label')).toBe('Edit');
	});

	it('readonly (gate closed) removes the verb entirely — no dead Edit (D6)', () => {
		mountToolbar({ readonly: true });
		expect(editVerb()).toBeNull();
	});

	it('editing=true flips the label to Cancel and the click asks to LEAVE', () => {
		const ontoggledit = vi.fn();
		mountToolbar({ editing: true, ontoggledit });
		expect(editVerb()!.getAttribute('aria-label')).toBe('Cancel');
		editVerb()!.click();
		flushSync();
		expect(ontoggledit).toHaveBeenCalledWith(false);
	});

	it('editing=false: the click asks to ENTER edit mode', () => {
		const ontoggledit = vi.fn();
		mountToolbar({ editing: false, ontoggledit });
		editVerb()!.click();
		flushSync();
		expect(ontoggledit).toHaveBeenCalledWith(true);
	});

	it('ONE word Edit: a mounted changed md file shows the verb and NO diffDisabled grammar anywhere', () => {
		mountToolbar({ editing: false, dirty: true, showToggle: true, view: 'edit' });
		// the row must not contain a second "Edit" affordance: the view
		// toggle's first segment reads Preview (fileEyePreview copy)
		const seg = target!.querySelector('[data-testid="file-view-edit"]');
		expect(seg?.textContent?.trim()).toBe('Preview');
		expect(editVerb()!.getAttribute('aria-label')).toBe('Edit');
	});

	it('the Preview | Diff segments are never disabled — even dirty (D4)', () => {
		mountToolbar({ showToggle: true, view: 'edit', dirty: true, editing: true });
		const segEdit = target!.querySelector('[data-testid="file-view-edit"]') as HTMLButtonElement;
		const segDiff = target!.querySelector('[data-testid="file-view-diff"]') as HTMLButtonElement;
		expect(segEdit.disabled).toBe(false);
		expect(segDiff.disabled).toBe(false);
	});
});
