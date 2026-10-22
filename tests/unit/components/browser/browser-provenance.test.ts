import { mount, unmount } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import BrowserPanel from '$lib/components/browser/BrowserPanel.svelte';
import BrowserManager from '$lib/components/browser/BrowserManager.svelte';

/**
 * ADR-0036 3.1-T / 3.2-T: the lineage chip. The panel's mount touches
 * /api/browser (open or re-bind) — stubbed to a never-settling promise so
 * the glass stays in 'opening' and the CHIP (static markup off the props)
 * is the only thing under test.
 */
beforeAll(() => {
	vi.stubGlobal(
		'fetch',
		vi.fn(() => new Promise(() => undefined))
	);
});

afterEach(() => {
	document.body.innerHTML = '';
});

function mountPanel(props: Record<string, unknown>): ReturnType<typeof mount> {
	const target = document.createElement('div');
	document.body.appendChild(target);
	return mount(BrowserPanel, { target, props: Object.assign({ onclose: () => undefined }, props) as never });
}

describe('BrowserPanel lineage chip (ADR-0036 D3)', () => {
	it('renders the opener title and depth marker when provenance exists', () => {
		const instance = mountPanel({ openedBy: 'sess-a', parentTitle: 'Research chat', depth: 2 });
		const chip = document.querySelector('[data-testid="browser-provenance"]');
		expect(chip).not.toBeNull();
		expect(chip?.textContent).toContain('Research chat');
		expect(chip?.textContent).toContain('d2');
		unmount(instance);
	});

	it('degrades to the raw session id when the spine has no title yet', () => {
		const instance = mountPanel({ openedBy: 'sess-raw', parentTitle: null, depth: 0 });
		const chip = document.querySelector('[data-testid="browser-provenance"]');
		expect(chip?.textContent).toContain('sess-raw');
		expect(chip?.textContent).not.toContain('d0');
		unmount(instance);
	});

	it('shows NO chip without provenance (the honest ControlBar open)', () => {
		const instance = mountPanel({});
		expect(document.querySelector('[data-testid="browser-provenance"]')).toBeNull();
		unmount(instance);
	});
});

describe('BrowserManager provenance pass-through (ADR-0036 3.1-T)', () => {
	it('forwards openedBy, parentTitle and depth to the glass', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(BrowserManager, {
			target,
			props: { onclose: () => undefined, openedBy: 'sess-a', parentTitle: 'Host chat', depth: 1 } as never
		});
		const chip = target.querySelector('[data-testid="browser-provenance"]');
		expect(chip).not.toBeNull();
		expect(chip?.textContent).toContain('Host chat');
		expect(chip?.classList.contains('depth-tinted')).toBe(true);
		unmount(instance);
	});

	it('forwards absence — no chip node at all', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(BrowserManager, { target, props: { onclose: () => undefined } as never });
		expect(target.querySelector('[data-testid="browser-provenance"]')).toBeNull();
		unmount(instance);
	});
});
