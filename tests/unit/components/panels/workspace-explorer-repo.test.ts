/**
 * WorkspaceExplorerRepo direct-mount tests: one repo's group in the Git
 * Eye Changes tab — every status arm (undefined/loading/unavailable/
 * failed±reason/empty/rows±truncated), the root-vs-child heading and
 * open-path joins, the blank-code '??' fallback, and the collapse
 * default + toggle/caret arms. Presentation only: statuses arrive as
 * props, intents emit back.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import WorkspaceExplorerRepo, { type ChangeStatus } from '$lib/components/workspace-explorer/WorkspaceExplorerRepo.svelte';

function mountRepo(props: {
	repoRel?: string;
	root?: string;
	st?: ChangeStatus;
	collapsed?: boolean;
	onToggleRepo?: (repoRel: string) => void;
	onOpenFile?: (path: string) => void;
}) {
	const onToggleRepo = props.onToggleRepo ?? vi.fn();
	const onOpenFile = props.onOpenFile ?? vi.fn();
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(WorkspaceExplorerRepo, {
		target,
		props: {
			repoRel: props.repoRel ?? 'app',
			root: props.root ?? '/ws',
			st: props.st,
			...(props.collapsed === undefined ? {} : { collapsed: props.collapsed }),
			onToggleRepo,
			onOpenFile
		}
	});
	flushSync();
	return {
		target,
		onToggleRepo,
		onOpenFile,
		q: (sel: string) => target.querySelector(sel),
		qa: (sel: string) => [...target.querySelectorAll(sel)],
		cleanup: () => {
			unmount(instance);
			target.remove();
		}
	};
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('WorkspaceExplorerRepo — status arms', () => {
	it('undefined status renders the loading note (not-yet-fetched arm)', () => {
		const view = mountRepo({ st: undefined });
		expect(view.qa('li.note')).toHaveLength(1);
		expect(view.q('[data-testid="git-changes-failed"]')).toBeNull();
		view.cleanup();
	});

	it('a loading status renders the loading note', () => {
		const view = mountRepo({ st: { kind: 'loading' } });
		expect(view.qa('li.note')).toHaveLength(1);
		view.cleanup();
	});

	it('an unavailable status renders the unavailable row', () => {
		const view = mountRepo({ st: { kind: 'unavailable' } });
		expect(view.q('[data-testid="git-changes-unavailable"]')).not.toBeNull();
		view.cleanup();
	});

	it('a failed status with an EMPTY reason omits the reason suffix', () => {
		const view = mountRepo({ st: { kind: 'failed', reason: '' } });
		const row = view.q('[data-testid="git-changes-failed"]')!;
		expect(row.textContent).not.toContain(' — ');
		view.cleanup();
	});

	it('a failed status with a reason renders the — reason suffix', () => {
		const view = mountRepo({ st: { kind: 'failed', reason: 'exit 128' } });
		const row = view.q('[data-testid="git-changes-failed"]')!;
		expect(row.textContent).toContain(' — exit 128');
		view.cleanup();
	});

	it('a ready status with NO files renders the empty note', () => {
		const view = mountRepo({ st: { kind: 'ready', truncated: false, files: [] } });
		expect(view.qa('li.note')).toHaveLength(1);
		expect(view.qa('[data-testid="git-change-row"]')).toHaveLength(0);
		view.cleanup();
	});
});

describe('WorkspaceExplorerRepo — rows and intents', () => {
	const ready = (truncated: boolean, files: Array<{ code: string; path: string }>): ChangeStatus => ({
		kind: 'ready',
		truncated,
		files
	});

	it('a blank change code falls back to ??; a real code renders trimmed', () => {
		const view = mountRepo({ st: ready(false, [{ code: '  ', path: 'new.ts' }, { code: 'M ', path: 'old.ts' }]) });
		const codes = view.qa('[data-testid="git-change-row"] .change-code').map((el) => el.textContent);
		expect(codes).toEqual(['??', 'M']);
		view.cleanup();
	});

	it('a CHILD repo row opens repoRel + / + path; truncated suffix renders when flagged', () => {
		const view = mountRepo({
			st: ready(true, [{ code: 'M', path: 'n.ts' }]),
			repoRel: 'app'
		});
		(view.q('[data-testid="git-change-row"]') as HTMLButtonElement).click();
		expect(view.onOpenFile).toHaveBeenCalledWith('app/n.ts');
		expect(view.target.textContent).toContain('truncated');
		view.cleanup();
	});

	it('the ROOT repo (repoRel empty) opens the bare path and shows the root as the heading', () => {
		const view = mountRepo({ repoRel: '', root: '/ws', st: ready(false, [{ code: 'M', path: 'n.ts' }]) });
		expect(view.q('.repo-head')!.textContent).toContain('/ws');
		(view.q('[data-testid="git-change-row"]') as HTMLButtonElement).click();
		expect(view.onOpenFile).toHaveBeenCalledWith('n.ts');
		// truncated:false — no suffix row.
		expect(view.qa('li.note')).toHaveLength(0);
		view.cleanup();
	});
});

describe('WorkspaceExplorerRepo — collapse arms', () => {
	it('default is EXPANDED (no collapsed prop): the list renders, aria-expanded true', () => {
		const view = mountRepo({ st: { kind: 'unavailable' } });
		expect(view.q('ul.tree')).not.toBeNull();
		expect(view.q('[data-testid="git-changes-toggle"]')!.getAttribute('aria-expanded')).toBe('true');
		view.cleanup();
	});

	it('collapsed: NO list, aria-expanded false, and the caret swaps to the closed svg', () => {
		const view = mountRepo({ st: { kind: 'unavailable' }, collapsed: true });
		expect(view.q('ul.tree')).toBeNull();
		expect(view.q('[data-testid="git-changes-toggle"]')!.getAttribute('aria-expanded')).toBe('false');
		view.cleanup();
	});

	it('clicking the head emits onToggleRepo with the repo rel path', () => {
		const view = mountRepo({ st: { kind: 'loading' }, repoRel: 'docs' });
		(view.q('[data-testid="git-changes-toggle"]') as HTMLButtonElement).click();
		expect(view.onToggleRepo).toHaveBeenCalledWith('docs');
		view.cleanup();
	});
});
