/**
 * TerminalTabHeader tests — the desk's tablist strip (Terminal Desk ADR D1,
 * Wave 2). The component is presentation only: it renders the tab buttons
 * passed as its children and, when the desk passes an actions snippet, rides
 * it to the RIGHT edge (ml-auto) — that is where the copy-as-image button
 * lives. The desk owns selection state, so these tests pin the render
 * contract, not any selection behavior:
 *
 *  - the tablist role + data-testid marker are always present
 *  - children render inside the strip
 *  - without an actions snippet, no actions container exists
 *  - with an actions snippet, it renders inside its own marked container
 *  - children keep their DOM position ahead of the actions strip
 */
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';

import TerminalTabHeader from '$lib/components/terminal/TerminalTabHeader.svelte';

function snippet(html: string) {
	return createRawSnippet(() => ({ render: () => html }));
}

function mountHeader(props: { actions?: ReturnType<typeof snippet> } = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(TerminalTabHeader, {
		target,
		props: {
			children: snippet('<button data-testid="fake-tab">tab-a</button>'),
			...(props.actions ? { actions: props.actions } : {})
		}
	});
	flushSync();
	return { target, instance };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('TerminalTabHeader — the tablist strip', () => {
	it('renders the tablist role and its children tabs', () => {
		const { target, instance } = mountHeader();
		const strip = target.querySelector('[data-testid="terminal-tabstrip"]');
		expect(strip).not.toBeNull();
		expect(strip?.getAttribute('role')).toBe('tablist');
		expect(target.querySelector('[data-testid="fake-tab"]')?.textContent).toBe('tab-a');
		unmount(instance);
	});

	it('renders no actions container when the desk passes no actions snippet', () => {
		const { target, instance } = mountHeader();
		expect(target.querySelector('[data-testid="terminal-tab-header-actions"]')).toBeNull();
		expect(target.querySelector('[data-testid="fake-tab"]')).not.toBeNull();
		unmount(instance);
	});

	it('renders the actions snippet inside its own right-edge container', () => {
		const { target, instance } = mountHeader({
			actions: snippet('<button data-testid="fake-action">copy</button>')
		});
		const actions = target.querySelector('[data-testid="terminal-tab-header-actions"]');
		expect(actions).not.toBeNull();
		expect(actions?.classList.contains('ml-auto')).toBe(true);
		expect(actions?.querySelector('[data-testid="fake-action"]')?.textContent).toBe('copy');
		unmount(instance);
	});

	it('keeps the tabs ahead of the actions strip in DOM order', () => {
		const { target, instance } = mountHeader({
			actions: snippet('<button data-testid="fake-action">copy</button>')
		});
		const strip = target.querySelector('[data-testid="terminal-tab-header"]')!;
		const tabs = strip.querySelector('[data-testid="fake-tab"]')!;
		const actions = strip.querySelector('[data-testid="terminal-tab-header-actions"]')!;
		expect(tabs.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		unmount(instance);
	});
});
