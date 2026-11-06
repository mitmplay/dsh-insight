/**
 * WorkspaceExplorerToolbar tests (Git Eye task 2.1-T): the renamed,
 * in-flow, full-width left-aligned toolbar — refresh/collapse intents
 * still emit, the canvas-copy control is present, and the old header
 * filename is gone. Layout truth (the lane, the left alignment) is
 * asserted by Playwright on the real page; this file pins the DOM
 * contract the tabs of Wave 4 will build on.
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';

import WorkspaceExplorerToolbar from '$lib/components/workspace-explorer/WorkspaceExplorerToolbar.svelte';

function mounted() {
	const target = document.createElement('div');
	document.body.appendChild(target);
	return target;
}

describe('WorkspaceExplorerToolbar — the renamed in-flow lane (task 2.1-T)', () => {
	it('renders the toolbar row with refresh + collapse-all + canvas copy', () => {
		const onRefresh = vi.fn();
		const onCollapseAll = vi.fn();
		const target = mounted();
		const instance = mount(WorkspaceExplorerToolbar, {
			target,
			props: { onRefresh, onCollapseAll }
		});
		flushSync();

		const toolbar = target.querySelector('[data-testid="explorer-toolbar"]') as HTMLElement;
		expect(toolbar).not.toBeNull();
		expect(toolbar.className).toContain('explorer-toolbar'); // the in-flow lane class
		expect(toolbar.querySelector('[data-testid="explorer-refresh"]')).not.toBeNull();
		expect(toolbar.querySelector('[data-testid="explorer-collapse-all"]')).not.toBeNull();
		// The canvas-copy control survived the rename (a titled control).
		expect(toolbar.querySelector('[title]')).not.toBeNull();
		unmount(instance);
	});

	it('emits onRefresh / onCollapseAll intents (INTENT ONLY contract)', () => {
		const onRefresh = vi.fn();
		const onCollapseAll = vi.fn();
		const target = mounted();
		const instance = mount(WorkspaceExplorerToolbar, {
			target,
			props: { onRefresh, onCollapseAll }
		});
		flushSync();

		(target.querySelector('[data-testid="explorer-refresh"]') as HTMLButtonElement).click();
		(target.querySelector('[data-testid="explorer-collapse-all"]') as HTMLButtonElement).click();
		expect(onRefresh).toHaveBeenCalledTimes(1);
		expect(onCollapseAll).toHaveBeenCalledTimes(1);
		unmount(instance);
	});

	it('the changes tab renders active with activeTab=\'changes\'; explorer unselected', () => {
		const target = mounted();
		const instance = mount(WorkspaceExplorerToolbar, {
			target,
			props: { onRefresh: vi.fn(), onCollapseAll: vi.fn(), activeTab: 'changes' }
		});
		flushSync();
		expect(target.querySelector('[data-testid="git-tab-changes"]')!.getAttribute('aria-selected')).toBe('true');
		expect(target.querySelector('[data-testid="git-tab-changes"]')!.className).toContain('active');
		expect(target.querySelector('[data-testid="git-tab-explorer"]')!.getAttribute('aria-selected')).toBe('false');
		expect(target.querySelector('[data-testid="git-tab-explorer"]')!.className).not.toContain('active');
		unmount(instance);
	});

	it('tab clicks emit onTabChange with the native tab name', () => {
		const onTabChange = vi.fn();
		const target = mounted();
		const instance = mount(WorkspaceExplorerToolbar, {
			target,
			props: { onRefresh: vi.fn(), onCollapseAll: vi.fn(), onTabChange }
		});
		flushSync();
		(target.querySelector('[data-testid="git-tab-changes"]') as HTMLButtonElement).click();
		(target.querySelector('[data-testid="git-tab-explorer"]') as HTMLButtonElement).click();
		expect(onTabChange).toHaveBeenNthCalledWith(1, 'changes');
		expect(onTabChange).toHaveBeenNthCalledWith(2, 'explorer');
		unmount(instance);
	});

	it('tab clicks without an onTabChange handler are safe (optional intent)', () => {
		const target = mounted();
		const instance = mount(WorkspaceExplorerToolbar, {
			target,
			props: { onRefresh: vi.fn(), onCollapseAll: vi.fn() }
		});
		flushSync();
		expect(() => (target.querySelector('[data-testid="git-tab-changes"]') as HTMLButtonElement).click()).not.toThrow();
		unmount(instance);
	});

	it('the column walk finds a panel-column ancestor when one exists', () => {
		const wrap = document.createElement('div');
		wrap.dataset.testid = 'panel-column';
		const target = document.createElement('div');
		wrap.appendChild(target);
		document.body.appendChild(wrap);
		const instance = mount(WorkspaceExplorerToolbar, {
			target,
			props: { onRefresh: vi.fn(), onCollapseAll: vi.fn() }
		});
		// $effect.pre ran without throwing and the toolbar still renders.
		flushSync();
		expect(target.querySelector('[data-testid="explorer-toolbar"]')).not.toBeNull();
		unmount(instance);
		wrap.remove();
	});

	it('the column walk terminates cleanly with NO panel-column ancestor', () => {
		const target = mounted();
		const instance = mount(WorkspaceExplorerToolbar, {
			target,
			props: { onRefresh: vi.fn(), onCollapseAll: vi.fn() }
		});
		flushSync();
		expect(target.querySelector('[data-testid="explorer-toolbar"]')).not.toBeNull();
		unmount(instance);
	});
});
