/**
 * Workspaces pill group unit tests — pins the presentational contract of
 * Workspaces.svelte (the workspace pill group of SidebarSessionFilter):
 *  - no workspaces → nothing renders, not even the divider;
 *  - hybrid registry truth: registered=true paints .reg, registered=false
 *    paints .ghost + the registry annotation in the tooltip and
 *    data-registered="false"; an unannotated option defaults
 *    data-registered="true" with neither class;
 *  - tooltip prefers the full cwd path, falls back to the key;
 *  - the trailing divider renders only when asked;
 *  - hideGhosts (the [folder] registered-only view) drops ghost pills from
 *    the RENDER — and with only ghosts present renders nothing;
 *  - selection state (.on + aria-pressed) and the pick reporting.
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Workspaces from '$lib/components/common/layout/Workspaces.svelte';
import type { FilterOption } from '$lib/utils/session-filters';

const WORKSPACES: FilterOption[] = [
	{ key: '/home/me/project', label: 'project', count: 4, path: '/home/me/project', registered: true },
	{ key: '/tmp/orphan', label: 'orphan', count: 1, path: '/tmp/orphan', registered: false },
	{ key: '/opt/unlisted', label: 'unlisted', count: 0 }
];

function mountWorkspaces(
	workspaces: FilterOption[],
	opts: { selected?: string | null; divider?: boolean; hideGhosts?: boolean } = {}
) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const onpick = vi.fn();
	const instance = mount(Workspaces, {
		target,
		props: {
			workspaces,
			selected: opts.selected ?? null,
			onpick,
			divider: opts.divider ?? false,
			hideGhosts: opts.hideGhosts ?? false
		}
	});
	flushSync();
	return { target, instance, onpick };
}

function pills(target: HTMLElement): HTMLButtonElement[] {
	return [...target.querySelectorAll<HTMLButtonElement>('.pill')];
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('Workspaces pill group — render', () => {
	it('renders nothing without workspaces', () => {
		const { target, instance } = mountWorkspaces([]);
		expect(target.querySelectorAll('.pill').length).toBe(0);
		expect(target.querySelector('.divider')).toBeNull();
		expect(target.textContent?.trim()).toBe('');
		unmount(instance);
	});

	it('paints the hybrid registry truth: reg / ghost / unannotated', () => {
		const { target, instance } = mountWorkspaces(WORKSPACES);
		const [reg, ghost, unlisted] = pills(target);
		expect(reg?.classList.contains('reg')).toBe(true);
		expect(reg?.classList.contains('ghost')).toBe(false);
		expect(ghost?.classList.contains('ghost')).toBe(true);
		expect(ghost?.classList.contains('reg')).toBe(false);
		// unannotated: neither cue — existence without registry status
		expect(unlisted?.classList.contains('reg')).toBe(false);
		expect(unlisted?.classList.contains('ghost')).toBe(false);
		unmount(instance);
	});

	it('annotates data-registered: false for ghosts, true otherwise (default)', () => {
		const { target, instance } = mountWorkspaces(WORKSPACES);
		const [reg, ghost, unlisted] = pills(target);
		expect(reg?.getAttribute('data-registered')).toBe('true');
		expect(ghost?.getAttribute('data-registered')).toBe('false');
		expect(unlisted?.getAttribute('data-registered')).toBe('true');
		unmount(instance);
	});

	it('tooltips carry the full cwd path; ghosts add the registry annotation', () => {
		const { target, instance } = mountWorkspaces(WORKSPACES);
		const [reg, ghost, unlisted] = pills(target);
		expect(reg?.getAttribute('title')).toBe('/home/me/project');
		expect(ghost?.getAttribute('title')).toBe('/tmp/orphan — not in the workspace registry');
		// no path → the key stands in (preset-shaped options)
		expect(unlisted?.getAttribute('title')).toBe('/opt/unlisted');
		unmount(instance);
	});

	it('renders labels and counts, testid keyed by label (stable basenames)', () => {
		const { target, instance } = mountWorkspaces(WORKSPACES);
		const [reg, ghost, unlisted] = pills(target);
		expect(reg?.dataset.testid).toBe('filter-workspace-project');
		expect(reg?.textContent).toContain('4');
		expect(ghost?.dataset.testid).toBe('filter-workspace-orphan');
		expect(unlisted?.textContent).toContain('0');
		unmount(instance);
	});
});

describe('Workspaces pill group — divider', () => {
	it('renders the trailing divider only when asked (agents render after it)', () => {
		const withDivider = mountWorkspaces(WORKSPACES, { divider: true });
		expect(withDivider.target.querySelector('.divider')).not.toBeNull();
		unmount(withDivider.instance);
		const without = mountWorkspaces(WORKSPACES);
		expect(without.target.querySelector('.divider')).toBeNull();
		unmount(without.instance);
	});
});

describe('Workspaces pill group — hideGhosts (registered-only view)', () => {
	it('hides ghost pills while the registered-only view holds; keeps registered ones', () => {
		const { target, instance } = mountWorkspaces(WORKSPACES, { hideGhosts: true });
		const shown = pills(target);
		expect(shown.length).toBe(2);
		expect(shown.some((p) => p.classList.contains('ghost'))).toBe(false);
		unmount(instance);
	});

	it('renders ghost pills again once the view lifts (default)', () => {
		const { target, instance } = mountWorkspaces(WORKSPACES, { hideGhosts: false });
		expect(pills(target).length).toBe(3);
		unmount(instance);
	});

	it('renders nothing (no divider either) when every option is a ghost', () => {
		const ghostsOnly: FilterOption[] = [
			{ key: '/tmp/orphan', label: 'orphan', count: 1, path: '/tmp/orphan', registered: false }
		];
		const { target, instance } = mountWorkspaces(ghostsOnly, { hideGhosts: true, divider: true });
		expect(pills(target).length).toBe(0);
		expect(target.querySelector('.divider')).toBeNull();
		expect(target.textContent?.trim()).toBe('');
		unmount(instance);
	});
});

describe('Workspaces pill group — selection + pick', () => {
	it('marks only the selected workspace: .on + aria-pressed="true"', () => {
		const { target, instance } = mountWorkspaces(WORKSPACES, { selected: '/tmp/orphan' });
		const [reg, ghost] = pills(target);
		expect(reg?.classList.contains('on')).toBe(false);
		expect(reg?.getAttribute('aria-pressed')).toBe('false');
		expect(ghost?.classList.contains('on')).toBe(true);
		expect(ghost?.getAttribute('aria-pressed')).toBe('true');
		unmount(instance);
	});

	it('reports the picked workspace key upward (the full cwd path)', () => {
		const { target, instance, onpick } = mountWorkspaces(WORKSPACES);
		const all = pills(target);
		all[0].click();
		all[1].click();
		expect(onpick.mock.calls).toEqual([['/home/me/project'], ['/tmp/orphan']]);
		unmount(instance);
	});
});
