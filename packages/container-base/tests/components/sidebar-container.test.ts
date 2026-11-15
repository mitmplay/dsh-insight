import { createRawSnippet, flushSync, mount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SidebarContainer, SIDEBAR_COLLAPSED_WIDTH } from '../../src/index';

// R2 W5 5.1-T (ADR-0063 D5) — the generic sidebar shell contract.

const targets: HTMLElement[] = [];
function host(): HTMLElement {
	const el = document.createElement('div');
	document.body.appendChild(el);
	targets.push(el);
	return el;
}
afterEach(() => {
	for (const el of targets) el.remove();
	targets.length = 0;
});

const textSnippet = (text: string) => createRawSnippet(() => ({ render: () => text, setup: () => {} }));

function mountShell(props: Record<string, unknown> = {}): HTMLElement {
	const root = host();
	mount(SidebarContainer, {
		target: root,
		props: { width: 400, children: textSnippet('BODY'), ...props }
	});
	flushSync();
	return root;
}

describe('SidebarContainer — shell contract (5.1-T)', () => {
	it('standalone: width wrapper carries the px width, gutter is the rail flex sibling', () => {
		const root = mountShell();
		const wrap = root.querySelector('[data-testid="sidebar-wrap"]') as HTMLElement;
		expect(wrap).toBeTruthy();
		expect(wrap.style.width).toBe('400px');
		expect(root.querySelector('[data-testid="sidebar-gutter"]')).toBeTruthy();
		expect(root.querySelector('[data-testid="sidebar"]')).toBeTruthy();
	});

	it('gutter reports mousedown to onResizeStart (page owns drag + clamp)', () => {
		const onResizeStart = vi.fn();
		const root = mountShell({ onResizeStart });
		const gutter = root.querySelector('[data-testid="sidebar-gutter"]') as HTMLElement;
		gutter.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
		expect(onResizeStart).toHaveBeenCalledTimes(1);
	});

	it('embedded: bare rail — no width wrapper, no gutter, same rail testid', () => {
		const root = mountShell({ embedded: true });
		expect(root.querySelector('[data-testid="sidebar"]')).toBeTruthy();
		expect(root.querySelector('[data-testid="sidebar-wrap"]')).toBeNull();
		expect(root.querySelector('[data-testid="sidebar-gutter"]')).toBeNull();
	});

	it('collapsed: stub branch renders consumer content, no rail/gutter', () => {
		const root = host();
		mount(SidebarContainer, {
			target: root,
			props: { collapsed: true, collapsedContent: textSnippet('STUB') }
		});
		flushSync();
		const stub = root.querySelector('[data-testid="sidebar-collapsed"]') as HTMLElement;
		expect(stub).toBeTruthy();
		expect(stub.textContent).toContain('STUB');
		expect(root.querySelector('[data-testid="sidebar"]')).toBeNull();
		expect(root.querySelector('[data-testid="sidebar-gutter"]')).toBeNull();
		expect(SIDEBAR_COLLAPSED_WIDTH).toBe(34);
	});

	it('sections render from the default snippet; header slot renders above', () => {
		const root = mountShell({ header: textSnippet('HEADER') });
		expect(root.textContent).toContain('HEADER');
		expect(root.textContent).toContain('BODY');
	});

	it('NO words of its own: the rail text is only what the consumer snippets rendered', () => {
		const root = mountShell();
		const rail = root.querySelector('[data-testid="sidebar"]') as HTMLElement;
		expect(rail.textContent?.trim()).toBe('BODY');
	});
});