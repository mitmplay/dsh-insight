import { flushSync, mount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import SidebarCollapseButton from '../../src/components/SidebarCollapseButton.svelte';

/**
 * 1.1-T (Container Base R7, ADR-0067) — the collapse verb's contract:
 * glyph swap on `collapsed`, aria-expanded, label defaults + overrides,
 * onToggle on click, testid passthrough. Dressing stays consumer-side.
 */

function mountBtn(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(SidebarCollapseButton, { target, props });
	flushSync();
	const sel = props.testid ? `[data-testid="${props.testid}"]` : 'button';
	const btn = target.querySelector<HTMLButtonElement>(sel)!;
	return { instance, btn, target };
}

describe('SidebarCollapseButton (R7 organ)', () => {
	it('defaults to the expanded glyph and the English label', () => {
		const { btn } = mountBtn();
		expect(btn.getAttribute('aria-label')).toBe('Collapse sidebar');
		expect(btn.getAttribute('title')).toBe('Collapse sidebar');
		expect(btn.getAttribute('aria-expanded')).toBe('true');
		// expanded glyph = panel-left-close: rect + one inner line
		expect(btn.querySelectorAll('path').length).toBe(1);
	});

	it('swaps glyph and words when collapsed (D1)', () => {
		const { btn } = mountBtn({ collapsed: true });
		expect(btn.getAttribute('aria-label')).toBe('Restore sidebar');
		expect(btn.getAttribute('aria-expanded')).toBe('false');
		// collapsed glyph = panel-left-open: rect + line + arrow head (2 paths)
		expect(btn.querySelectorAll('path').length).toBe(2);
	});

	it('accepts translated label props (D3 — the consumer translates)', () => {
		const { btn } = mountBtn({ label: 'Seitenleiste einklappen', labelCollapsed: 'Ausklappen' });
		expect(btn.getAttribute('aria-label')).toBe('Seitenleiste einklappen');
	});

	it('fires onToggle on click', () => {
		const onToggle = vi.fn();
		const { btn } = mountBtn({ onToggle });
		btn.click();
		expect(onToggle).toHaveBeenCalledTimes(1);
	});

	it('survives a missing onToggle', () => {
		const { btn } = mountBtn();
		expect(() => btn.click()).not.toThrow();
	});

	it('passes the testid prop verbatim (consumer hook, e.g. pg-sidebar-restore)', () => {
		const { btn } = mountBtn({ testid: 'pg-sidebar-restore' });
		expect(btn.dataset.testid).toBe('pg-sidebar-restore');
	});

	it('applies the consumer dressing class (D5 — no skin in the base)', () => {
		const { btn } = mountBtn({ class: 'icon-btn' });
		expect(btn.className).toContain('icon-btn');
	});
});
