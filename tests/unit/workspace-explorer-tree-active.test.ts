/** File Link Intent — tree active-row highlight pins (Wave 2):
 *  the row whose rel path equals activePath gets li.active + aria-selected. */
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';

import WorkspaceExplorerTree from '../../src/lib/components/workspace-explorer/WorkspaceExplorerTree.svelte';
import type { Level } from '../../src/lib/components/workspace-explorer/workspace-explorer-tree-types';

const LEVELS: Record<string, Level> = {
	'': { kind: 'ready', entries: [{ name: 'src', type: 'directory' }], truncated: false },
	'src': { kind: 'ready', entries: [{ name: 'app.css', type: 'file' }], truncated: false }
};

function mountTree(activeFile: string | null): { target: HTMLElement; cleanup: () => void } {
	const target = document.body.appendChild(document.createElement('div'));
	const comp = mount(WorkspaceExplorerTree, {
		target,
		props: {
			root: '/tmp',
			levels: LEVELS,
			expanded: ['src', 'deepseek-insight', 'deepseek-insight/src'],
			repoMaps: {},
			changedPaths: new Set<string>(),
			changedDirs: new Set<string>(),
			onToggle: () => {},
			onOpenFile: () => {},
			activeFile
		}
	});
	flushSync();
	return { target, cleanup: () => { unmount(comp); target.remove(); } };
}

describe('WorkspaceExplorerTree activePath highlight', () => {
	it('marks the row matching activePath with li.active + aria-selected', () => {
		const { target, cleanup } = mountTree('src/app.css');
		const li = target.querySelector('li.active');
		expect(li).not.toBeNull();
		expect(li?.textContent).toContain('app.css');
		expect(li?.getAttribute('aria-selected')).toBe('true');
		cleanup();
	});

	it('no li.active when activePath is null', () => {
		const { target, cleanup } = mountTree(null);
		expect(target.querySelectorAll('li.active').length).toBe(0);
		cleanup();
	});
});
