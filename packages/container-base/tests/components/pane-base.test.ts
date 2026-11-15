import { createRawSnippet, flushSync, mount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PaneBase from '../../src/components/PaneBase.svelte';

function snippet(html: string) {
	return createRawSnippet(() => ({ render: () => html }));
}

interface MountOpts {
	width?: number;
	paneId?: string;
	sessionTag?: string | null;
	selected?: boolean;
	onactivate?: () => void;
	onloupe?: () => void;
	toolbar?: boolean;
	footer?: boolean;
}

function mountPane(opts: MountOpts = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(PaneBase, {
		target,
		props: {
			width: opts.width ?? 500,
			paneId: opts.paneId ?? 'p1',
			sessionTag: opts.sessionTag === undefined ? 'sess-1' : opts.sessionTag,
			selected: opts.selected ?? false,
			...(opts.onactivate ? { onactivate: opts.onactivate } : {}),
			...(opts.onloupe ? { onloupe: opts.onloupe } : {}),
			header: snippet('<header data-testid="h">H</header>'),
			...(opts.toolbar ? { toolbar: snippet('<div data-testid="t">T</div>') } : {}),
			children: snippet('<div data-testid="c">C</div>'),
			...(opts.footer ? { footer: snippet('<footer data-testid="f">F</footer>') } : {})
		}
	});
	flushSync();
	return { target, instance };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('PaneBase — snippet-slot shell (W4 4.4-T)', () => {
	it('renders header, content in order; toolbar/footer only when given', () => {
		const { target } = mountPane({ toolbar: true, footer: true });
		const order = Array.from(
			target.querySelectorAll('[data-testid="h"],[data-testid="t"],[data-testid="c"],[data-testid="f"]')
		).map((el) => el.getAttribute('data-testid'));
		expect(order).toEqual(['h', 't', 'c', 'f']);
		const bare = mountPane().target;
		expect(bare.querySelector('[data-testid="t"]')).toBeNull();
		expect(bare.querySelector('[data-testid="f"]')).toBeNull();
	});

	it('props through: width triple-lock, data-panel-id, data-session-id, selected ring class', () => {
		const { target } = mountPane({ width: 640, paneId: 'x9', selected: true });
		const col = target.querySelector<HTMLElement>('[data-testid="panel-column"]');
		expect(col).not.toBeNull();
		expect(col?.style.width).toBe('640px');
		expect(col?.style.minWidth).toBe('640px');
		expect(col?.style.maxWidth).toBe('640px');
		expect(col?.dataset.panelId).toBe('x9');
		expect(col?.dataset.sessionId).toBe('sess-1');
		expect(col?.classList.contains('selected')).toBe(true);
	});

	it('sessionTag null drops the data-session-id attribute (non-conversation panes)', () => {
		const { target } = mountPane({ sessionTag: null });
		const col = target.querySelector<HTMLElement>('[data-testid="panel-column"]');
		// Svelte renders a null attribute as ABSENT — the pre-split
		// PanelColumn had the exact same semantics for non-conversation panes.
		expect(col?.getAttribute('data-session-id')).toBeNull();
	});

	it('activate gesture: pointerdown inside fires onactivate', () => {
		const onactivate = vi.fn();
		const { target } = mountPane({ onactivate });
		target.querySelector<HTMLElement>('[data-testid="panel-column"]')?.dispatchEvent(
			new Event('pointerdown', { bubbles: true })
		);
		expect(onactivate).toHaveBeenCalledTimes(1);
	});

	it('loupe gesture: Alt+Click fires onloupe; plain click and Alt+Click on a control do not', () => {
		const onloupe = vi.fn();
		const { target } = mountPane({ onloupe });
		const col = target.querySelector<HTMLElement>('[data-testid="panel-column"]');
		col?.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }));
		expect(onloupe).toHaveBeenCalledTimes(1);
		col?.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: false }));
		expect(onloupe).toHaveBeenCalledTimes(1);
		// a click on a CONTROL inside the column is excluded
		const btn = document.createElement('button');
		col?.appendChild(btn);
		btn.dispatchEvent(new MouseEvent('click', { bubbles: true, altKey: true }));
		expect(onloupe).toHaveBeenCalledTimes(1);
	});

	it('body wraps the content slot (flex column, overflow hidden)', () => {
		const { target } = mountPane();
		const body = target.querySelector('[data-testid="c"]')?.parentElement;
		expect(body?.classList.contains('body')).toBe(true);
	});
});
