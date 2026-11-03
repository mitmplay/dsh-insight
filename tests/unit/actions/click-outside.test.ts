/**
 * clickOutside unit tests (spec 2026-11-01, Composer Popup Dismissal,
 * task 1.1-T): the shared popup dismissal action — outside pointerdown
 * dismisses, inside does not, Escape dismisses, and a closed consumer
 * costs zero live listeners (no dismissal after close, none after
 * destroy).
 */
import { flushSync } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { clickOutside } from '$lib/actions/click-outside';

function mount(params: { open: boolean; onDismiss: (r: 'outside' | 'escape') => void }) {
	const node = document.createElement('div');
	document.body.appendChild(node);
	const inst = clickOutside(node, params);
	return {
		node,
		set(next: Partial<{ open: boolean; onDismiss: (r: 'outside' | 'escape') => void }>): void {
			inst.update({ open: next.open ?? params.open, onDismiss: next.onDismiss ?? params.onDismiss });
			flushSync();
		},
		destroy(): void {
			inst.destroy();
			node.remove();
		}
	};
}

function outsidePointerDown(): void {
	const stranger = document.createElement('button');
	document.body.appendChild(stranger);
	stranger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
	stranger.remove();
}

function insidePointerDown(node: HTMLElement): void {
	node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
}

describe('clickOutside', () => {
	it('dismisses on a pointerdown outside the node', () => {
		const onDismiss = vi.fn();
		const c = mount({ open: true, onDismiss });
		outsidePointerDown();
		expect(onDismiss).toHaveBeenCalledWith('outside');
		c.destroy();
	});

	it('does NOT dismiss on a pointerdown inside the node', () => {
		const onDismiss = vi.fn();
		const c = mount({ open: true, onDismiss });
		insidePointerDown(c.node);
		expect(onDismiss).not.toHaveBeenCalled();
		c.destroy();
	});

	it('dismisses on Escape with reason escape', () => {
		const onDismiss = vi.fn();
		const c = mount({ open: true, onDismiss });
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		expect(onDismiss).toHaveBeenCalledWith('escape');
		c.destroy();
	});

	it('a non-Escape key never dismisses', () => {
		const onDismiss = vi.fn();
		const c = mount({ open: true, onDismiss });
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
		expect(onDismiss).not.toHaveBeenCalled();
		c.destroy();
	});

	it('no dismissal after the consumer closed (update to open=false removes listeners)', () => {
		const onDismiss = vi.fn();
		const c = mount({ open: true, onDismiss });
		c.set({ open: false });
		outsidePointerDown();
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		expect(onDismiss).not.toHaveBeenCalled();
		c.destroy();
	});

	it('re-arms when the consumer reopens', () => {
		const onDismiss = vi.fn();
		const c = mount({ open: true, onDismiss });
		c.set({ open: false });
		c.set({ open: true });
		outsidePointerDown();
		expect(onDismiss).toHaveBeenCalledWith('outside');
		c.destroy();
	});

	it('no dismissal after destroy', () => {
		const onDismiss = vi.fn();
		const c = mount({ open: true, onDismiss });
		c.destroy();
		outsidePointerDown();
		document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
		expect(onDismiss).not.toHaveBeenCalled();
	});
});
