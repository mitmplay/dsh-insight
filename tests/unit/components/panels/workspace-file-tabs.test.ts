/**
 * WorkspaceFileTabs unit tests (The Explorer Layout ADR 2026-09-17 D3/D5,
 * Task 2.3-T) — the presentation contract: render N tabs keyed by path,
 * the per-tab [x] closes EXACTLY one, activate switches the highlight,
 * and the empty state renders an honest empty marker — never a blank.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';

import WorkspaceFileTabs from '$lib/components/workspace-file/filetab/WorkspaceFileTabs.svelte';

function mountTabs(
	tabs: Array<{ path: string }>,
	activePath: string | null,
	intents: { activate: string[]; close: string[] }
) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(WorkspaceFileTabs, {
		target,
		props: {
			tabs,
			activePath,
			onActivate: (p: string) => intents.activate.push(p),
			onClose: (p: string) => intents.close.push(p),
			children: (() => null) as never
		}
	});
	flushSync();
	return { target, instance };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('WorkspaceFileTabs — the Explorer Layout tab strip', () => {
	it('renders one tab per open file with the leaf label and full-path title', () => {
		const { target, instance } = mountTabs(
			[{ path: 'docs/deep.md' }, { path: 'README.md' }],
			'docs/deep.md',
			{ activate: [], close: [] }
		);
		expect(target.querySelector('[data-testid="workspace-file-tab-docs/deep.md"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="workspace-file-tab-README.md"]')).not.toBeNull();
		const active = target.querySelector(
			'[data-testid="workspace-file-tab-docs/deep.md"]'
		) as HTMLElement;
		expect(active.classList.contains('active')).toBe(true);
		expect(active.getAttribute('title')).toBe('docs/deep.md');
		const label = active.querySelector('.label') as HTMLElement;
		expect(label.textContent).toBe('deep.md');
		unmount(instance);
	});

	it('the [x] close intent fires for EXACTLY that path — never a neighbor', () => {
		const intents = { activate: [] as string[], close: [] as string[] };
		const { target, instance } = mountTabs(
			[{ path: 'a.ts' }, { path: 'b.ts' }],
			'a.ts',
			intents
		);
		const closeB = target.querySelector(
			'[data-testid="workspace-file-tabclose-b.ts"]'
		) as HTMLElement;
		closeB.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		expect(intents.close).toEqual(['b.ts']);
		expect(intents.activate).toEqual([]);
		unmount(instance);
	});

	it('activate switches the focused tab', () => {
		const intents = { activate: [] as string[], close: [] as string[] };
		const { target, instance } = mountTabs([{ path: 'a.ts' }, { path: 'b.ts' }], 'a.ts', intents);
		const tabB = target.querySelector('[data-testid="workspace-file-tab-b.ts"]') as HTMLElement;
		tabB.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		expect(intents.activate).toEqual(['b.ts']);
		unmount(instance);
	});

	it('an aria-selected tab is announced for a11y', () => {
		const { target, instance } = mountTabs([{ path: 'a.ts' }], 'a.ts', {
			activate: [],
			close: []
		});
		const tab = target.querySelector('[data-testid="workspace-file-tab-a.ts"]') as HTMLElement;
		expect(tab.getAttribute('aria-selected')).toBe('true');
		unmount(instance);
	});

	// No focused tab (the panel closed the last focused file but kept the
	// strip): every tab takes the NOT-equal arm of the active comparison —
	// no highlight, aria-selected false for all.
	it('activePath null with tabs open highlights NOTHING', () => {
		const { target, instance } = mountTabs([{ path: 'a.ts' }, { path: 'b.ts' }], null, {
			activate: [],
			close: []
		});
		const tabs = Array.from(target.querySelectorAll('[role="tab"]')) as HTMLElement[];
		expect(tabs).toHaveLength(2);
		expect(tabs.every((t) => !t.classList.contains('active'))).toBe(true);
		expect(tabs.every((t) => t.getAttribute('aria-selected') === 'false')).toBe(true);
		unmount(instance);
	});

	it('the empty state renders the honest empty marker', () => {
		const { target, instance } = mountTabs([], null, { activate: [], close: [] });
		expect(target.querySelector('[data-testid="workspace-file-tabs-empty"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="workspace-file-tabstrip"]')).toBeNull();
		unmount(instance);
	});

	// The compiled tab button carries a `tab.path ?? ""` fallback for the
	// data-testid attribute. It is reachable ONLY by a nullish path, which
	// then crashes leaf() in the label — so the mount throws AFTER the
	// fallback arm already ran. This pins that crash order honestly: the
	// panel dedupes by path, so a nullish path never reaches this
	// component through WorkspaceExplorerPanel.
	it('a nullish tab.path takes the ?? "" testid fallback arm, then leaf() throws', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		expect(() => {
			const instance = mount(WorkspaceFileTabs, {
				target,
				props: {
					tabs: [{ path: undefined as never }],
					activePath: null,
					onActivate: () => {},
					onClose: () => {},
					children: (() => null) as never
				}
			});
			flushSync();
			unmount(instance);
		}).toThrow();
	});

	// The compiled template reads `tab.path` FRESH at every use site (each
	// key, leaf() label, class:active, data-testid, title, aria-selected,
	// tabclose-testid). A nullish path crashes leaf() BEFORE the effect
	// body runs (the test above renders NOTHING), so the `?? ""` fallback
	// arms of the two data-testid expressions are NOT reachable that way.
	// They ARE reachable by a path that is a valid string on its FIRST
	// read (satisfying leaf()) and nullish on every later read: the label
	// keeps the cached leaf value while both testid expressions take the
	// `?? ""` arm -- the tab still renders, minus its testid suffixes.
	it('a path gone nullish after the leaf read takes both ?? "" testid fallback arms', () => {
		let reads = 0;
		const vanishing = {
			get path(): string {
				// Read order (Svelte 5.56 compiled template): 1-2 each-key,
				// 3 leaf(), 4 class:active, 5 tab data-testid, 6 title,
				// 7 aria-selected, 8 tabclose data-testid. Vanish exactly on
				// the two testid reads; every other read (including the keyed
				// each's idempotency re-checks) must stay a STABLE key or
				// Svelte throws each_key_volatile.
				reads += 1;
				if (reads === 5 || reads === 8) return undefined as never;
				return 'vanish/gone.ts';
			}
		};
		const { target, instance } = mountTabs([vanishing], null, {
			activate: [],
			close: []
		});
		const tab = target.querySelector('[role="tab"]') as HTMLElement;
		// Both fallback arms ran: the testid suffixes are the empty string.
		expect(tab.getAttribute('data-testid')).toBe('workspace-file-tab-');
		const close = tab.querySelector('.close') as HTMLElement;
		expect(close.getAttribute('data-testid')).toBe('workspace-file-tabclose-');
		// The label keeps the value leaf() saw on the first read.
		const label = tab.querySelector('.label') as HTMLElement;
		expect(label.textContent).toBe('gone.ts');
		// No highlight, no crash -- the strip rendered honestly.
		expect(tab.classList.contains('active')).toBe(false);
		unmount(instance);
	});
});
