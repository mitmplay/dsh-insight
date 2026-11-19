import { flushSync, mount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import SidebarHeaderActions from '../../src/components/SidebarHeaderActions.svelte';
import { createRawSnippet } from 'svelte';

/**
 * 1.1-T (Container Base R11, ADR-0074) — the corner's contract:
 * fixed organ order copy → collapse → extras; prop-gated copy (null
 * container still renders, click no-ops per the organ's contract);
 * extras present/absent (absent = no empty markup); labels render via
 * props; callbacks pass through; testids default DSI-compatible.
 * (Degraded visible state is pinned by CanvasCopyButton's own tests —
 * the cluster only arranges the organ.)
 */

const extras = createRawSnippet(() => {
	return { render: () => '<div class="extras-probe">EXTRAS</div>' };
});

function mountCluster(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(SidebarHeaderActions, { target, props });
	flushSync();
	/** The collapse organ is the SECOND button (index 1) — the first is
	 *  the copy camera. */
	const collapseBtn = () => target.querySelectorAll<HTMLButtonElement>('button')[1]!;
	return { instance, target, collapseBtn };
}

describe('SidebarHeaderActions (R11 corner organ)', () => {
	it('renders the corner with the DSI-compatible default anchors', () => {
		const { target } = mountCluster();
		const root = target.querySelector('.rail-header-actions')!;
		expect(root).toBeTruthy();
		expect(root.querySelector('[data-testid="canvas-copy-button"]')).toBeTruthy();
		expect(root.querySelector('button')).toBeTruthy();
	});

	it('keeps the fixed organ order: copy → collapse → extras (D1)', () => {
		const { target } = mountCluster({ children: extras });
		const kids = Array.from(target.querySelector('.rail-header-actions')!.children);
		const copyIdx = kids.findIndex((k) => k.dataset.testid === 'canvas-copy-button');
		const collapseIdx = kids.findIndex((k) => k.getAttribute('aria-expanded') !== null);
		const extrasIdx = kids.findIndex((k) => k.classList.contains('extras-probe'));
		expect(copyIdx).toBe(0);
		expect(collapseIdx).toBe(1);
		expect(extrasIdx).toBe(2);
	});

	it('renders the copy button without a container (null-container no-op contract)', () => {
		const { target } = mountCluster({ captureContainer: null });
		const btn = target.querySelector<HTMLButtonElement>('[data-testid="canvas-copy-button"]')!;
		expect(btn).toBeTruthy();
		expect(() => btn.click()).not.toThrow();
	});

	it('renders NO extras markup when the snippet is absent', () => {
		const { target } = mountCluster();
		expect(target.querySelector('.extras-probe')).toBeNull();
		expect(target.querySelector('.rail-header-actions')!.children.length).toBe(2);
	});

	it('passes labels through as props (the base never translates)', () => {
		const { target, collapseBtn } = mountCluster({
			captureTitle: 'Seite kopieren',
			collapseLabel: 'Seitenleiste einklappen'
		});
		expect(target.querySelector('[data-testid="canvas-copy-button"]')!.getAttribute('title')).toBe('Seite kopieren');
		expect(collapseBtn().getAttribute('aria-label')).toBe('Seitenleiste einklappen');
	});

	it('fires onToggleCollapse through the collapse organ', () => {
		const onToggleCollapse = vi.fn();
		const { target, collapseBtn } = mountCluster({ onToggleCollapse });
		collapseBtn().click();
		expect(onToggleCollapse).toHaveBeenCalledTimes(1);
	});

	it('propagates collapsed state to the collapse glyph', () => {
		const { target, collapseBtn } = mountCluster({ collapsed: true });
		expect(collapseBtn().getAttribute('aria-expanded')).toBe('false');
	});

	it('honors prop-overridable testids', () => {
		const { target } = mountCluster({ copyTestId: 'pg-copy', collapseTestId: 'pg-sidebar-toggle' });
		expect(target.querySelector('[data-testid="pg-copy"]')).toBeTruthy();
		expect(target.querySelector('[data-testid="pg-sidebar-toggle"]')).toBeTruthy();
	});
});
