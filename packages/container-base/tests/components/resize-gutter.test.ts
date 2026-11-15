import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ResizeGutter from '../../src/components/ResizeGutter.svelte';

function mountGutter(opts: { index?: number; ariaLabel?: string; title?: string; onGutterDown?: (e: MouseEvent) => void } = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(ResizeGutter, {
		target,
		props: {
			index: opts.index ?? 0,
			ariaLabel: opts.ariaLabel ?? 'Resize pane',
			title: opts.title ?? 'Drag to resize',
			...(opts.onGutterDown ? { onGutterDown: opts.onGutterDown } : {})
		}
	});
	flushSync();
	return { target, instance };
}

function mouseDown(el: Element, clientX = 100): MouseEvent {
	const e = new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX });
	el.dispatchEvent(e);
	return e;
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('ResizeGutter — the 6px seam (ADR-0006 R8 / ADR-0062 W4 D6)', () => {
	it('renders a type=button with per-index test id and ARIA separator naming', () => {
		const { target } = mountGutter({ index: 2, ariaLabel: 'Resize pane 2', title: 'Drag seam' });
		const btn = target.querySelector<HTMLButtonElement>('[data-testid="panel-gutter-2"]');
		expect(btn).not.toBeNull();
		expect(btn!.tagName).toBe('BUTTON');
		expect(btn!.getAttribute('type')).toBe('button');
		// ARIA: accessible name comes from the consumer-localized label prop
		expect(btn!.getAttribute('aria-label')).toBe('Resize pane 2');
		expect(btn!.getAttribute('title')).toBe('Drag seam');
	});

	it('mousedown preventDefaults (no text selection) and reports the event upward through onGutterDown', () => {
		const seen: MouseEvent[] = [];
		const { target } = mountGutter({ index: 1, onGutterDown: (e) => seen.push(e) });
		const btn = target.querySelector('[data-testid="panel-gutter-1"]')!;
		const e = mouseDown(btn, 321);
		expect(e.defaultPrevented).toBe(true);
		expect(seen).toHaveLength(1);
		expect(seen[0].clientX).toBe(321);
	});

	it('mousedown without the onGutterDown hook still preventDefaults and does not throw', () => {
		const { target } = mountGutter({ index: 0 });
		const btn = target.querySelector('[data-testid="panel-gutter-0"]')!;
		const e = mouseDown(btn);
		expect(e.defaultPrevented).toBe(true);
	});

	it('keyboard interaction reports nothing upward (the HOST owns the drag; keyboard resize is a filed gap, ADR-0062 §7)', () => {
		const onGutterDown = vi.fn();
		const { target } = mountGutter({ index: 0, onGutterDown });
		const btn = target.querySelector('[data-testid="panel-gutter-0"]') as HTMLElement;
		btn.focus();
		for (const key of ['ArrowLeft', 'ArrowRight', 'Enter', ' ']) {
			btn.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
			btn.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }));
		}
		// a focused button's default click activation would fire click, not mousedown
		btn.click();
		flushSync();
		expect(onGutterDown).not.toHaveBeenCalled();
	});

	it('unmount releases the seam from the DOM without errors', () => {
		const { target, instance } = mountGutter({ index: 3 });
		expect(target.querySelector('[data-testid="panel-gutter-3"]')).not.toBeNull();
		unmount(instance);
		expect(target.querySelector('[data-testid="panel-gutter-3"]')).toBeNull();
	});

	it('renders with a missing index prop — the compiled testid fallback arm stays covered', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(ResizeGutter, {
			target,
			props: { index: undefined as unknown as number, ariaLabel: 'L', title: 'T' }
		});
		flushSync();
		const btn = target.querySelector('button');
		const testid = btn?.getAttribute('data-testid') ?? '';
		expect(testid.startsWith('panel-gutter-')).toBe(true);
		expect(btn?.getAttribute('aria-label')).toBe('L');
		unmount(instance);
		expect(target.querySelector('button')).toBeNull();
	});

	it('mousedown from a foreign (non-button) target does not report upward (delegated propagation)', () => {
		const onGutterDown = vi.fn();
		const { target } = mountGutter({ index: 5, onGutterDown });
		target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 7 }));
		expect(onGutterDown).not.toHaveBeenCalled();
	});
});
