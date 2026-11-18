import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import PanelListboxHeader from '../../src/components/PanelListboxHeader.svelte';
import PanelListboxList from '../../src/components/PanelListboxList.svelte';

/**
 * Branch-coverage companion to panel-listbox.test.ts — the arms the
 * family suite leaves out: List's EMPTY-children branch and the
 * class-prop passthrough; Header's custom testids, class prop, and
 * the label-fallback arm mounted WITHOUT any snippet.
 */

const textSnippet = (text: string) => createRawSnippet(() => ({ render: () => text, setup: () => {} }));

let instance: Record<string, unknown> | null = null;

function mountBody(Comp: typeof PanelListboxHeader | typeof PanelListboxList, props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	instance = mount(Comp, { target, props: props as never });
	flushSync();
	return target;
}

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
});

describe('PanelListboxList — branch coverage', () => {
	it('renders an empty shell when NO children snippet is passed ({#if children} false arm)', () => {
		const target = mountBody(PanelListboxList);
		const list = target.querySelector('[data-testid="panel-listbox-list"]')!;
		expect(list).not.toBeNull();
		expect(list.textContent!.trim()).toBe('');
	});

	it('renders children when the snippet IS passed ({#if children} true arm)', () => {
		const target = mountBody(PanelListboxList, { children: textSnippet('ROWS') });
		expect(target.querySelector('[data-testid="panel-listbox-list"]')!.textContent).toContain('ROWS');
	});

	it('applies a custom class alongside the shell class and keeps the testid default', () => {
		const target = mountBody(PanelListboxList, { class: 'shrink-me' });
		const list = target.querySelector<HTMLElement>('[data-testid="panel-listbox-list"]')!;
		expect(list.classList.contains('panel-listbox-list')).toBe(true);
		expect(list.classList.contains('shrink-me')).toBe(true);
	});
});

describe('PanelListboxHeader — branch coverage', () => {
	it('falls back to the default label when children is ABSENT ({:else} arm, default props)', () => {
		const target = mountBody(PanelListboxHeader);
		expect(target.querySelector('.lb-label')!.textContent).toBe('Panels');
		// absent snippet branches: no search slot content, no trailing cluster
		expect(target.querySelector('.lb-trailing')).toBeNull();
	});

	it('carries custom testids for both the header and the toggle', () => {
		const target = mountBody(PanelListboxHeader, { testid: 'my-head', toggleTestid: 'my-toggle' });
		expect(target.querySelector('[data-testid="my-head"]')).not.toBeNull();
		const btn = target.querySelector<HTMLButtonElement>('[data-testid="my-toggle"]')!;
		expect(btn).not.toBeNull();
		expect(btn.getAttribute('aria-expanded')).toBe('true');
	});

	it('applies the class prop to the header shell', () => {
		const target = mountBody(PanelListboxHeader, { class: 'group-head-row' });
		const head = target.querySelector<HTMLElement>('[data-testid="panel-listbox-header"]')!;
		expect(head.classList.contains('panel-listbox-header')).toBe(true);
		expect(head.classList.contains('group-head-row')).toBe(true);
	});

	it('renders label + search + trailing TOGETHER (all true arms at once)', () => {
		const target = mountBody(PanelListboxHeader, {
			label: 'Panels',
			children: textSnippet('STEM'),
			search: textSnippet('SEARCH'),
			trailing: textSnippet('TRAILING')
		});
		expect(target.textContent).toContain('STEM');
		expect(target.querySelector('.lb-title')!.textContent).toContain('SEARCH');
		expect(target.querySelector('.lb-trailing')!.textContent).toContain('TRAILING');
	});

	it('collapsed aria-expanded false arm with controls wired', () => {
		const target = mountBody(PanelListboxHeader, { expanded: false, controls: 'rows' });
		const btn = target.querySelector<HTMLButtonElement>('button')!;
		expect(btn.getAttribute('aria-expanded')).toBe('false');
		expect(btn.getAttribute('aria-controls')).toBe('rows');
	});
});
