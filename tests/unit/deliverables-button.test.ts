/**
 * DeliverablesButton unit tests (ADR-0027f D2/D3): the empty gate, the
 * popup inventory over a two-event fixture, the row-click file-open
 * callback, and the outside-click close (plan-button pattern).
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import DeliverablesButton from '../../src/lib/components/anchor/deliverables-anchor/DeliverablesButton.svelte';
import type { PresentedDelivery } from '../../src/lib/services/conversation/deliverables';

function mountButton(deliveries: PresentedDelivery[] | null, onfileopen?: (path: string) => void) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(DeliverablesButton, { target, props: { deliveries, onfileopen } });
	flushSync();
	return { target, instance };
}

const FIXTURE: PresentedDelivery[] = [
	{ turn: 1, callId: 'c1', files: [{ path: '/tmp/report.md', description: 'the report' }] },
	{
		turn: 2,
		callId: 'c2',
		files: [{ path: '/tmp/chart.png' }, { path: '/tmp/data.csv', description: 'raw numbers' }]
	}
];

describe('DeliverablesButton', () => {
	it('renders nothing without presented files (null or empty)', () => {
		const a = mountButton(null);
		expect(a.target.querySelector('[data-testid="deliverables-button"]')).toBeNull();
		unmount(a.instance);
		const b = mountButton([]);
		expect(b.target.querySelector('[data-testid="deliverables-button"]')).toBeNull();
		unmount(b.instance);
	});

	it('the button carries the file-count title; the popup opens on click', () => {
		const { target, instance } = mountButton(FIXTURE);
		const button = target.querySelector('[data-testid="deliverables-button"]') as HTMLButtonElement;
		expect(button.getAttribute('title')).toBe('Deliverables (3 files)');
		expect(target.querySelector('[data-testid="deliverables-popup"]')).toBeNull();
		button.click();
		flushSync();
		const popup = target.querySelector('[data-testid="deliverables-popup"]');
		expect(popup).not.toBeNull();
		expect(target.querySelector('[data-testid="deliverables-popup-header"]')?.textContent).toContain(
			'3 files'
		);
		unmount(instance);
	});

	it('rows are ONE line: description is the label, filename the fallback', () => {
		const { target, instance } = mountButton(FIXTURE);
		(target.querySelector('[data-testid="deliverables-button"]') as HTMLButtonElement).click();
		flushSync();
		const rows = [...target.querySelectorAll('[data-testid="deliverables-popup-row"]')];
		expect(rows.map((r) => r.getAttribute('data-turn'))).toEqual(['1', '2', '2']);
		// description present → it IS the single line (active foreground)
		expect(rows[0]?.textContent?.trim()).toBe('the report');
		expect(rows[0]?.getAttribute('title')).toBe('/tmp/report.md');
		// no description → bare filename fallback (extension stripped)
		expect(rows[1]?.textContent?.trim()).toBe('chart');
		expect((rows[1] as HTMLElement).getAttribute('title')).toBe('/tmp/chart.png');
		expect(rows[2]?.textContent?.trim()).toBe('raw numbers');
		// the label carries the active (not muted) foreground, theme-tokened
		const label = rows[0]?.querySelector('span:not([data-testid])') as HTMLElement;
		expect(label.className).toContain('text-text-primary');
		expect(label.className).not.toContain('text-text-muted');
		// every row carries its own copy-the-full-path button
		expect(target.querySelectorAll('[data-testid="copy-text-button"]').length).toBe(3);
		unmount(instance);
	});

	it('a row click invokes the file-open callback with the file path', () => {
		const onfileopen = vi.fn();
		const { target, instance } = mountButton(FIXTURE, onfileopen);
		(target.querySelector('[data-testid="deliverables-button"]') as HTMLButtonElement).click();
		flushSync();
		const rows = [...target.querySelectorAll('[data-testid="deliverables-popup-row"]')];
		(rows[1] as HTMLButtonElement).click();
		flushSync();
		expect(onfileopen).toHaveBeenCalledWith('/tmp/chart.png');
		unmount(instance);
	});

	it('outside click closes the popup', () => {
		const { target, instance } = mountButton(FIXTURE);
		(target.querySelector('[data-testid="deliverables-button"]') as HTMLButtonElement).click();
		flushSync();
		expect(target.querySelector('[data-testid="deliverables-popup"]')).not.toBeNull();
		// isTrusted=false in happy-dom; shadowing it fakes a real user click
		// (the plan-button pattern).
		const trusted = new MouseEvent('click', { bubbles: true });
		Object.defineProperty(trusted, 'isTrusted', { get: () => true });
		document.body.dispatchEvent(trusted);
		flushSync();
		expect(target.querySelector('[data-testid="deliverables-popup"]')).toBeNull();
		unmount(instance);
	});
});
