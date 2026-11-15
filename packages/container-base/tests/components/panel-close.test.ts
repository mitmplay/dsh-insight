import { flushSync, mount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import PanelClose from '../../src/components/PanelClose.svelte';

/**
 * 1.2-T (Container Base R6, ADR-0066) - the close button's contract
 * survives the promotion verbatim: testid, lens-disabled, the
 * onremove({shiftKey}) upward report - and the NEW label props (D3)
 * with English defaults, because the base never translates.
 */

function mountClose(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(PanelClose, { target, props: { sessionId: 'sess-1', ...props } });
	flushSync();
	const btn = target.querySelector<HTMLButtonElement>('[data-testid="panel-close"]')!;
	return { instance, btn, target };
}

describe('PanelClose (R6 promotion)', () => {
	it('keeps the panel-close testid verbatim (D5)', () => {
		const { btn } = mountClose();
		expect(btn.dataset.testid).toBe('panel-close');
	});

	it('defaults labels to English and names the session in the accessible label (D3)', () => {
		const { btn } = mountClose();
		expect(btn.getAttribute('aria-label')).toContain('Close panel');
		expect(btn.getAttribute('aria-label')).toContain('sess-1');
		expect(btn.getAttribute('title')).toBe('Close panel');
	});

	it('accepts translated label props (D3 - the consumer translates)', () => {
		const { btn } = mountClose({ closeLabel: 'Fermer le panneau', closeHint: 'Fermer' });
		expect(btn.getAttribute('aria-label')).toContain('Fermer le panneau');
		expect(btn.getAttribute('title')).toBe('Fermer');
	});

	it('is visible-disabled in lens mode', () => {
		const { btn } = mountClose({ lens: true });
		expect(btn.disabled).toBe(true);
	});

	it('reports onremove with the shiftKey flag', () => {
		const onremove = vi.fn();
		const { btn } = mountClose({ onremove });
		btn.click();
		expect(onremove).toHaveBeenCalledWith({ shiftKey: false });
	});

	it('does not report while lens-disabled', () => {
		const onremove = vi.fn();
		const { btn } = mountClose({ lens: true, onremove });
		btn.click();
		expect(onremove).not.toHaveBeenCalled();
	});

	it('tolerates a click with no onremove bound (optional callback branch)', () => {
		const { btn } = mountClose({});
		expect(() => btn.click()).not.toThrow();
	});

	it('reports the shiftKey flag as true on Shift+Click', () => {
		const onremove = vi.fn();
		const { btn } = mountClose({ onremove });
		btn.dispatchEvent(new MouseEvent('click', { shiftKey: true, bubbles: true }));
		expect(onremove).toHaveBeenCalledWith({ shiftKey: true });
	});

	it('falls back to the bare label when sessionId is empty (ternary branch)', () => {
		const { btn } = mountClose({ sessionId: '', closeLabel: 'Close panel' });
		expect(btn.getAttribute('aria-label')).toBe('Close panel');
	});
});
