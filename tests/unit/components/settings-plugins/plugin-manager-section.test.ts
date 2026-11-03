/**
 * PluginManagerSection direct-mount branch tests: the section is a pure
 * row renderer — the panel (state owner) hands it one source, the shelf's
 * collapsed flag, star map, tab, and the selection Set. These tests pin
 * every template branch the panel-level tests only skim:
 *   - source.author present vs absent (name ?? id fallback)
 *   - collapsed chevron (right/down) + aria-expanded + hidden rows
 *   - checkbox grammar (uninstall tab always; install tab only when not installed)
 *   - selected-row highlight class + description rendering
 */
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import PluginManagerSection, { type RackPlugin, type RackSource } from '$lib/components/settings-plugins/PluginManagerSection.svelte';

function render(props: {
	source: RackSource;
	collapsed: boolean;
	stars?: Record<string, number>;
	tab?: 'install' | 'uninstall';
	selected?: ReadonlySet<string>;
	ontoggle?: () => void;
	ontoggleselect?: (n: string) => void;
}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(PluginManagerSection, {
		target,
		props: {
			stars: {},
			tab: 'install' as const,
			selected: new Set<string>(),
			ontoggle: () => {},
			ontoggleselect: () => {},
			...props
		}
	});
	flushSync();
	return { target, unmount: () => unmount(comp) };
}

const plugin = (over: Partial<RackPlugin> = {}): RackPlugin => ({
	n: '1',
	id: 'alpha-plugin',
	repo: 'https://github.com/a/alpha',
	author: null,
	installed: false,
	...over
});
const source = (plugins: RackPlugin[], over: Partial<RackSource> = {}): RackSource => ({
	id: 'a-alpha',
	author: 'alice',
	repo: 'https://github.com/a/alpha',
	plugins,
	...over
});

describe('PluginManagerSection source head', () => {
	it('shows "by <author>" when the source has an author', () => {
		const { target, unmount } = render({ source: source([]), collapsed: false });
		const head = target.querySelector('[data-testid="rack-source-head-a-alpha"]');
		expect(head?.querySelector('.rack-source-author')?.textContent).toContain('by alice');
		expect(head?.querySelector('.rack-source-name')).toBeNull();
		unmount();
	});

	it('falls back to name ?? id when the source has no author', () => {
		const { target, unmount } = render({ source: source([], { author: null, name: 'Alpha Pack' }), collapsed: false });
		expect(target.querySelector('[data-testid="rack-source-head-a-alpha"] .rack-source-name')?.textContent?.trim()).toBe('Alpha Pack');
		unmount();

		const bare = render({ source: source([], { author: null, id: 'bare-source', name: undefined }), collapsed: false });
		expect(bare.target.querySelector('[data-testid="rack-source-head-bare-source"] .rack-source-name')?.textContent?.trim()).toBe('bare-source');
		bare.unmount();
	});

	it('numbers the source via its display number', () => {
		const { target, unmount } = render({ source: source([], { n: '3' }), collapsed: true });
		expect(target.querySelector('.rack-source-num')?.textContent).toContain('3.');
		unmount();
	});

	it('aria-expanded tracks collapsed and clicks fire ontoggle', () => {
		const ontoggle = vi.fn();
		const { target, unmount } = render({ source: source([]), collapsed: true, ontoggle });
		const head = target.querySelector('[data-testid="rack-source-head-a-alpha"]') as HTMLButtonElement;
		expect(head.getAttribute('aria-expanded')).toBe('false');
		head.click();
		flushSync();
		expect(ontoggle).toHaveBeenCalledTimes(1);
		unmount();

		const open = render({ source: source([]), collapsed: false, ontoggle });
		expect(open.target.querySelector('[data-testid="rack-source-head-a-alpha"]')?.getAttribute('aria-expanded')).toBe('true');
		open.unmount();
	});
});

describe('PluginManagerSection rows', () => {
	it('hides rows while collapsed, renders them when open', () => {
		const rows = source([plugin()]);
		const closed = render({ source: rows, collapsed: true });
		expect(closed.target.querySelector('[data-testid="rack-rows-a-alpha"]')).toBeNull();
		closed.unmount();

		const open = render({ source: rows, collapsed: false });
		expect(open.target.querySelector('[data-testid="rack-row-alpha-plugin"]')?.textContent).toContain('alpha-plugin');
		open.unmount();
	});

	it('checkbox grammar: install tab shows it only for uninstalled rows', () => {
		const src = source([plugin({ n: '1', installed: false }), plugin({ n: '2', id: 'beta-plugin', installed: true })]);
		const { target, unmount } = render({ source: src, collapsed: false, tab: 'install' });
		expect(target.querySelector('[data-testid="rack-select-1"]')).toBeTruthy();
		expect(target.querySelector('[data-testid="rack-select-2"]')).toBeNull();
		unmount();
	});

	it('checkbox grammar: uninstall tab shows it for every row (installed or not)', () => {
		const src = source([plugin({ n: '1', installed: true }), plugin({ n: '2', id: 'beta-plugin', installed: false })]);
		const { target, unmount } = render({ source: src, collapsed: false, tab: 'uninstall' });
		expect(target.querySelector('[data-testid="rack-select-1"]')).toBeTruthy();
		expect(target.querySelector('[data-testid="rack-select-2"]')).toBeTruthy();
		unmount();
	});

	it('checkbox checked mirrors the selection Set; change fires ontoggleselect with the row n', () => {
		const ontoggleselect = vi.fn();
		const src = source([plugin({ n: '1' })]);
		const { target, unmount } = render({
			source: src,
			collapsed: false,
			selected: new Set(['1']),
			ontoggleselect
		});
		const check = target.querySelector('[data-testid="rack-select-1"]') as HTMLInputElement;
		expect(check.checked).toBe(true);
		expect((target.querySelector('[data-testid="rack-row-alpha-plugin"]') as HTMLElement).className).toContain('rack-row-selected');
		check.click();
		flushSync();
		expect(ontoggleselect).toHaveBeenCalledWith('1');
		unmount();

		const unselected = render({ source: src, collapsed: false, selected: new Set<string>() });
		expect((unselected.target.querySelector('[data-testid="rack-select-1"]') as HTMLInputElement).checked).toBe(false);
		expect((unselected.target.querySelector('[data-testid="rack-row-alpha-plugin"]') as HTMLElement).className).not.toContain('rack-row-selected');
		unselected.unmount();
	});

	it('renders display number when present; description span only when the row has one', () => {
		const src = source([
			plugin({ n: '1', dn: '1.1', description: 'First plugin does things' }),
			plugin({ n: '2', id: 'beta-plugin', dn: '1.2', description: null })
		]);
		const { target, unmount } = render({ source: src, collapsed: false });
		const row1 = target.querySelector('[data-testid="rack-row-alpha-plugin"]');
		expect(row1?.querySelector('.rack-n')?.textContent).toBe('1.1');
		expect(row1?.querySelector('.rack-desc')?.textContent).toContain('First plugin does things');
		const row2 = target.querySelector('[data-testid="rack-row-beta-plugin"]');
		expect(row2?.querySelector('.rack-desc')).toBeNull();
		expect(row2?.querySelector('.rack-n')?.textContent).toBe('1.2');
		unmount();
	});
});
