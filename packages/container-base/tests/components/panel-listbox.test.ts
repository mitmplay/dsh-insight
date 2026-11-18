import { createRawSnippet, flushSync, mount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import PanelListbox from '../../src/components/PanelListbox.svelte';
import PanelListboxHeader from '../../src/components/PanelListboxHeader.svelte';
import PanelListboxList from '../../src/components/PanelListboxList.svelte';
import PanelListboxListItem from '../../src/components/PanelListboxListItem.svelte';
import boxSrc from '../../src/components/PanelListbox.svelte?raw';
import listSrc from '../../src/components/PanelListboxList.svelte?raw';

/**
 * 1.1-T (Container Base R8, ADR-0070) — the four-organ family contract:
 * linked emphasis follows selectedId; unlinked ignores it; onselect fires
 * with the item; zero rows + absent empty snippet renders NOTHING;
 * testid defaults + overrides; CSS-var defaults present.
 */

const textSnippet = (text: string) => createRawSnippet(() => ({ render: () => text, setup: () => {} }));

function mountBody(Comp: typeof PanelListbox | typeof PanelListboxList, props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(Comp, { target, props: props as never });
	flushSync();
	return { instance, target };
}

describe('PanelListbox (group box)', () => {
	it('renders NOTHING with zero rows and no emptysnippet (D7)', () => {
		const { target } = mountBody(PanelListbox, { count: 0 });
		expect(target.querySelector('.panel-listbox')).toBeNull();
		expect(target.textContent!.trim()).toBe('');
	});

	it('renders the box with an emptysnippet even at zero rows (D7)', () => {
		const { target } = mountBody(PanelListbox, {
			count: 0,
			emptysnippet: textSnippet('nothing here yet')
		});
		// snippet render through mount: assert box exists
		expect(target.querySelector('.panel-listbox')).not.toBeNull();
	});

	it('renders the box when rows exist and hides children when collapsed', () => {
		const { target } = mountBody(PanelListbox, {
			count: 2,
			header: textSnippet('H'),
			children: textSnippet('ROWS')
		});
		const box = target.querySelector<HTMLElement>('.panel-listbox')!;
		expect(box.dataset.collapsed).toBe('false');
		expect(box.textContent).toContain('H');

		const { target: t2 } = mountBody(PanelListbox, {
			count: 2,
			collapsed: true,
			header: textSnippet('H'),
			children: textSnippet('ROWS')
		});
		const c = t2.querySelector<HTMLElement>('.panel-listbox')!;
		expect(c.dataset.collapsed).toBe('true');
		expect(c.textContent).not.toContain('ROWS');
		expect(c.textContent).toContain('H');
	});

	it('carries the neutral testid default and the override (D6)', () => {
		const { target } = mountBody(PanelListbox, { count: 1 });
		expect(target.querySelector('[data-testid="panel-listbox"]')).not.toBeNull();
		const { target: t2 } = mountBody(PanelListbox, { count: 1, testid: 'pg-lower-tray' });
		expect(t2.querySelector('[data-testid="pg-lower-tray"]')).not.toBeNull();
	});

	it('paints through --panel-listbox-* vars with neutral defaults (D5) — happy-dom reads the style contract from source', () => {
		const { target } = mountBody(PanelListbox, { count: 1 });
		expect(target.querySelector('.panel-listbox')).not.toBeNull();
		// every paint property reads a --panel-listbox-* var with a neutral default
		expect(boxSrc).toContain('var(--panel-listbox-wash)');
		expect(boxSrc).toContain('var(--panel-listbox-border)');
		expect(boxSrc).toContain('var(--panel-listbox-radius)');
		expect(boxSrc).not.toMatch(/accent-blue|spine|green|live-set/); // no consumer color name in the base
	});
});

describe('PanelListboxHeader (chevron + label + trailing)', () => {
	it('defaults expanded with the down chevron and honest aria-expanded', () => {
		const { target } = mountBody(PanelListboxHeader);
		const btn = target.querySelector<HTMLButtonElement>('[data-testid="panel-listbox-header-toggle"]')!;
		expect(btn.getAttribute('aria-expanded')).toBe('true');
		expect(btn.querySelectorAll('path').length).toBe(1); // down chevron
	});

	it('swaps to the right chevron when collapsed (D3)', () => {
		const { target } = mountBody(PanelListboxHeader, { expanded: false });
		const btn = target.querySelector<HTMLButtonElement>('[data-testid="panel-listbox-header-toggle"]')!;
		expect(btn.getAttribute('aria-expanded')).toBe('false');
		expect(btn.querySelectorAll('path').length).toBe(1); // right chevron (one path)
	});

	it('falls back to the English label prop and renders a rich stem snippet', () => {
		const { target } = mountBody(PanelListboxHeader, { label: 'Sessions' });
		expect(target.textContent).toContain('Sessions');
		const { target: t2 } = mountBody(PanelListboxHeader, {
			children: textSnippet('Focused - notes')
		});
		expect(t2.textContent).toContain('Focused - notes');
	});

	it('carries aria-controls when the consumer pins its rows region', () => {
		const { target } = mountBody(PanelListboxHeader, { controls: 'sidebar-panel-group-rows' });
		const btn = target.querySelector<HTMLButtonElement>('button')!;
		expect(btn.getAttribute('aria-controls')).toBe('sidebar-panel-group-rows');
		const { target: t2 } = mountBody(PanelListboxHeader);
		expect(t2.querySelector('button')!.getAttribute('aria-controls')).toBeNull();
	});

	it('reports onToggle on chevron click and survives a missing handler', () => {
		const onToggle = vi.fn();
		const { target } = mountBody(PanelListboxHeader, { onToggle });
		target.querySelector<HTMLButtonElement>('button')!.click();
		expect(onToggle).toHaveBeenCalledTimes(1);
		const { target: t2 } = mountBody(PanelListboxHeader);
		expect(() => t2.querySelector<HTMLButtonElement>('button')!.click()).not.toThrow();
	});

	it('renders the trailing-actions snippet (consumer domain controls)', () => {
		const { target } = mountBody(PanelListboxHeader, {
			trailing: textSnippet('TRAILING')
		});
		expect(target.querySelector('.lb-trailing')!.textContent).toContain('TRAILING');
	});

	// R9 UX amendment (operator 2026-11-18): the search slot renders inside
	// the title container — title and search share ONE container; trailing
	// stays the icons/pills cluster.
	it('renders the search slot inside the title container, BEFORE trailing', () => {
		const { target } = mountBody(PanelListboxHeader, {
			search: textSnippet('SEARCH'),
			trailing: textSnippet('TRAILING')
		});
		const title = target.querySelector('.lb-title')!;
		expect(title.textContent).toContain('SEARCH');
		expect(title.textContent).not.toContain('TRAILING');
		expect(target.querySelector('.lb-trailing')!.textContent).toContain('TRAILING');
		// document order: title (label + search) precedes the trailing cluster
		const trail = target.querySelector('.lb-trailing')!;
		expect(title.compareDocumentPosition(trail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
	});
});

describe('PanelListboxList (internal scroll grammar, D8)', () => {
	it('owns only flex/min-height/overflow-y (D8) — happy-dom reads the style contract from source', () => {
		const { target } = mountBody(PanelListboxList);
		expect(target.querySelector('.panel-listbox-list')).not.toBeNull();
		expect(listSrc).toContain('flex: 1 1 auto;');
		expect(listSrc).toContain('min-height: 0;');
		expect(listSrc).toContain('overflow-y: auto;');
		// the cap stays consumer-side: no max-height anywhere in the STYLE block
		const listStyle = listSrc.slice(listSrc.indexOf('<style'));
		expect(listStyle).not.toMatch(/max-height/);
	});

	it('carries an optional id for the header aria-controls target', () => {
		const { target } = mountBody(PanelListboxList, { id: 'sidebar-spine-group-rows' });
		expect(target.querySelector('.panel-listbox-list')!.id).toBe('sidebar-spine-group-rows');
	});

	it('renders children and carries the testid override', () => {
		const { target } = mountBody(PanelListboxList, {
			children: textSnippet('ITEMS'),
			testid: 'spine-list'
		});
		expect(target.querySelector('[data-testid="spine-list"]')!.textContent).toContain('ITEMS');
	});
});

describe('PanelListboxListItem (row shell, D2/D4)', () => {
	it('linked + selected → active emphasis and aria-selected', () => {
		const { target } = mountBody(PanelListboxListItem, { linked: true, selected: true, testid: 'row-notes' });
		const row = target.querySelector<HTMLButtonElement>('[data-testid="row-notes"]')!;
		expect(row.classList.contains('is-active')).toBe(true);
		expect(row.getAttribute('aria-current')).toBe('true');
	});

	it('linked + deselected → no emphasis (emphasis follows selectedId both directions)', () => {
		const { target } = mountBody(PanelListboxListItem, { linked: true, selected: false, testid: 'row-notes' });
		const row = target.querySelector<HTMLButtonElement>('[data-testid="row-notes"]')!;
		expect(row.classList.contains('is-active')).toBe(false);
		expect(row.getAttribute('aria-current')).toBeNull();
	});

	it('unlinked IGNORES selectedId — no emphasis, no selected attribute (D2)', () => {
		const { target } = mountBody(PanelListboxListItem, { linked: false, selected: true, testid: 'row-a' });
		const row = target.querySelector<HTMLButtonElement>('[data-testid="row-a"]')!;
		expect(row.classList.contains('is-active')).toBe(false);
		expect(row.getAttribute('aria-current')).toBeNull();
	});

	it('fires onselect on click; without handlers the row is inert and clicks do nothing', () => {
		const onselect = vi.fn();
		const { target } = mountBody(PanelListboxListItem, { onselect, testid: 'row-b' });
		target.querySelector<HTMLButtonElement>('[data-testid="row-b"]')!.click();
		expect(onselect).toHaveBeenCalledTimes(1);
		const { target: t2 } = mountBody(PanelListboxListItem);
		const inert = t2.querySelector('[data-testid="panel-listbox-item"], .panel-listbox-item')!;
		expect(() => (inert as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }))).not.toThrow();
	});

	it('never ships consumer verbs — the content is a snippet passthrough (D4)', () => {
		const { target } = mountBody(PanelListboxListItem, {
			children: textSnippet('notes')
		});
		expect(target.querySelector('.panel-listbox-item')!.textContent).toContain('notes');
		expect(target.querySelectorAll('svg').length).toBe(0); // no built-in verb glyphs
	});

	// R9 (ADR-0071 D2): three renderings of ONE grammar.
	it('href → anchor that STILL fires onselect; consumer may preventDefault (1.2-T)', () => {
		const onselect = vi.fn();
		const { target } = mountBody(PanelListboxListItem, {
			href: '/?seed=abc',
			onselect,
			testid: 'row-anchor'
		});
		const row = target.querySelector<HTMLAnchorElement>('[data-testid="row-anchor"]')!;
		expect(row.tagName).toBe('A');
		expect(row.getAttribute('href')).toBe('/?seed=abc');
		row.click();
		expect(onselect).toHaveBeenCalledTimes(1);
		// the event forwards to the consumer, which may swallow the navigation
		expect(onselect.mock.calls[0][0]).toBeInstanceOf(Event);
		const { target: t2 } = mountBody(PanelListboxListItem, {
			href: '/?seed=abc',
			testid: 'row-anchor-2',
			onselect: (e: Event) => e.preventDefault()
		});
		const a2 = t2.querySelector<HTMLAnchorElement>('[data-testid="row-anchor-2"]')!;
		const swallowed = vi.fn<(e: Event) => void>();
		a2.addEventListener('click', swallowed);
		a2.click();
		expect(swallowed.mock.calls[0][0].defaultPrevented).toBe(true);
	});

	it('onselect without href → button (1.2-T)', () => {
		const onselect = vi.fn();
		const { target } = mountBody(PanelListboxListItem, { onselect, testid: 'row-btn' });
		expect(target.querySelector('[data-testid="row-btn"]')!.tagName).toBe('BUTTON');
		target.querySelector<HTMLButtonElement>('[data-testid="row-btn"]')!.click();
		expect(onselect).toHaveBeenCalledTimes(1);
	});

	it('neither href nor onselect → inert element with NO click handler (1.2-T)', () => {
		const { target } = mountBody(PanelListboxListItem, { testid: 'row-inert' });
		const row = target.querySelector('[data-testid="row-inert"]')!;
		expect(row.tagName).toBe('DIV');
		// no click listener was attached: dispatching clicks fires nothing
		// no handler was wired: no onclick property, no Svelte listener
		expect((row as HTMLElement).onclick).toBeNull();
	});

	it('selected emphasis works in all three modes (1.2-T)', () => {
		const modes = [
			{ href: '/x', testid: 'row-a' },
			{ onselect: () => {}, testid: 'row-b' },
			{ testid: 'row-c' }
		];
		for (const mode of modes) {
			const { target } = mountBody(PanelListboxListItem, {
				...mode,
				linked: true,
				selected: true
			});
			const row = target.querySelector('[data-testid="' + mode.testid + '"]')!;
			expect(row.classList.contains('is-active')).toBe(true);
			expect(row.getAttribute('aria-current')).toBe('true');
		}
	});
});
