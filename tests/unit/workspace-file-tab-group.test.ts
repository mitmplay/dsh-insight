/**
 * WorkspaceFileTabGroup unit tests — the File Eye toggle (ADR D6,
 * Plugin Rack amendment IV 2026-10-31): a thin adapter over the shared
 * SegmentedTabs speaking the edit/diff vocabulary.
 *
 * Covered arms: default view (edit), explicit diff view, the
 * onviewchange bridge (present + absent — the optional call), and the
 * 'diff' vs 'edit' mapping inside the onchange bridge.
 */
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import WorkspaceFileTabGroup from '../../src/lib/components/workspace-file/WorkspaceFileTabGroup.svelte';

function mountGroup(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(WorkspaceFileTabGroup, { target, props: props as never });
	flushSync();
	return { target, instance };
}

describe('WorkspaceFileTabGroup — the File Eye toggle', () => {
	it('defaults to the Preview (edit) segment active', () => {
		const { target, instance } = mountGroup();
		const group = target.querySelector('[data-testid="file-view-toggle"]');
		expect(group).not.toBeNull();
		const edit = target.querySelector('[data-testid="file-view-edit"]');
		const diff = target.querySelector('[data-testid="file-view-diff"]');
		expect(edit?.getAttribute('aria-pressed')).toBe('true');
		expect(diff?.getAttribute('aria-pressed')).toBe('false');
		expect(edit?.getAttribute('disabled')).toBeNull();
		expect(diff?.getAttribute('disabled')).toBeNull();
		unmount(instance);
	});

	it('marks the Diff segment active when view=diff', () => {
		const { target, instance } = mountGroup({ view: 'diff' });
		expect(target.querySelector('[data-testid="file-view-diff"]')?.getAttribute('aria-pressed')).toBe('true');
		expect(target.querySelector('[data-testid="file-view-edit"]')?.getAttribute('aria-pressed')).toBe('false');
		unmount(instance);
	});

	it('bridges click intent to onviewchange, mapping ids to the edit/diff vocabulary', () => {
		const onviewchange = vi.fn();
		const { target, instance } = mountGroup({ view: 'edit', onviewchange });
		const diffBtn = target.querySelector('[data-testid="file-view-diff"]') as HTMLButtonElement;
		diffBtn.click();
		flushSync();
		expect(onviewchange).toHaveBeenCalledWith('diff');
		const editBtn = target.querySelector('[data-testid="file-view-edit"]') as HTMLButtonElement;
		editBtn.click();
		flushSync();
		expect(onviewchange).toHaveBeenCalledWith('edit');
		unmount(instance);
	});

	it('clicks without an onviewchange handler are safe (optional-call arm)', () => {
		const { target, instance } = mountGroup({ view: 'edit' });
		const diffBtn = target.querySelector('[data-testid="file-view-diff"]') as HTMLButtonElement;
		expect(() => {
			diffBtn.click();
			flushSync();
		}).not.toThrow();
		unmount(instance);
	});
});
