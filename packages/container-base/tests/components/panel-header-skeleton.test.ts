import { createRawSnippet, flushSync, mount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import PanelHeaderSkeleton from '../../src/components/PanelHeaderSkeleton.svelte';

const s = (html: string) => createRawSnippet(() => ({ render: () => html }));

function mountSkeleton(props: { selected?: boolean; labelTestId?: string; title?: string } = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(PanelHeaderSkeleton, {
		target,
		props: {
			title: props.title,
			selected: props.selected ?? false,
			...(props.labelTestId ? { labelTestId: props.labelTestId } : {}),
			headerEl: undefined,
			leading: s('<b data-testid="lead">L</b>'),
			actions: s('<i data-testid="act">A</i>')
		}
	});
	flushSync();
	return { target, instance };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('PanelHeaderSkeleton — slot geometry (W4 4.5-T)', () => {
	it('strip geometry: label side + actions side, space-between order', () => {
		const { target } = mountSkeleton();
		const strip = target.querySelector<HTMLElement>('[data-testid="panel-header"]');
		expect(strip).not.toBeNull();
		const kids = Array.from(strip?.children ?? []).map((el) => el.classList.contains('label') ? 'label' : el.classList.contains('actions') ? 'actions' : el.className);
		expect(kids).toEqual(['label', 'actions']);
		// slots render INSIDE their sides, leading first
		expect(strip?.querySelector('.label [data-testid="lead"]')).not.toBeNull();
		expect(strip?.querySelector('.actions [data-testid="act"]')).not.toBeNull();
	});

	it('title prop lands on the strip tooltip; testid defaults to panel-header-label', () => {
		const { target } = mountSkeleton({ title: 'sess-1' });
		const strip = target.querySelector<HTMLElement>('[data-testid="panel-header"]');
		expect(strip?.getAttribute('title')).toBe('sess-1');
		expect(target.querySelector('[data-testid="panel-header-label"]')).not.toBeNull();
	});

	it('labelTestId override lands on the label span (the consumer variant hook)', () => {
		const { target } = mountSkeleton({ labelTestId: 'explorer-title' });
		expect(target.querySelector('[data-testid="explorer-title"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="panel-header-label"]')).toBeNull();
	});

	it('selected wash class', () => {
		const { target } = mountSkeleton({ selected: true });
		expect(target.querySelector('[data-testid="panel-header"]')?.classList.contains('selected')).toBe(true);
	});

	it('strip is a DIV carrying the panel-header testid (the bind target)', () => {
		// headerEl binding itself is exercised through the real consumer
		// (DSI PanelHeader binds it and aims CanvasCopyButton at the strip's
		// parent — pinned by panel-column-header-passthrough + e2e).
		const { target } = mountSkeleton();
		const strip = target.querySelector('div[data-testid="panel-header"]');
		expect(strip).not.toBeNull();
	});
});
