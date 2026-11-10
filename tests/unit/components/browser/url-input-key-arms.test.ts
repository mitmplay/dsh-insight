/**
 * UrlInput key-arm mop (coverage gap 2026-11-10).
 *
 * The header behavior suite exercises Escape, Enter, and the IME
 * composing arm; the uncovered branch is the fall-through arm of
 * `if (e.key === 'Enter')` — an ordinary key (typing) must NOT submit
 * and must NOT clear the draft. Component-direct mount (header suite
 * pattern) pins that arm plus the disabled passthrough.
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import UrlInput from '$lib/components/browser/buttons/UrlInput.svelte';

function mountInput(props: { onsubmit: (value: string) => void; disabled?: boolean }) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(UrlInput, {
		target,
		props: { value: 'https://example.dev', testid: 'browser-url-input', ...props }
	});
	flushSync();
	return {
		target,
		input: target.querySelector('input') as HTMLInputElement,
		cleanup: () => {
			unmount(instance);
			target.remove();
		}
	};
}

function key(el: Element, key: string, init: KeyboardEventInit = {}): void {
	el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('UrlInput — keydown fall-through arms', () => {
	it('an ordinary key neither submits nor clears the draft (Enter false arm)', () => {
		const onsubmit = vi.fn();
		const view = mountInput({ onsubmit });
		key(view.input, 'a');
		flushSync();
		expect(onsubmit).not.toHaveBeenCalled();
		expect(view.input.value).toBe('https://example.dev');
		view.cleanup();
	});

	it('Escape arm: clears the draft without submitting', () => {
		const onsubmit = vi.fn();
		const view = mountInput({ onsubmit });
		key(view.input, 'Escape');
		flushSync();
		expect(view.input.value).toBe('');
		expect(onsubmit).not.toHaveBeenCalled();
		view.cleanup();
	});

	it('Enter arm: submits the current draft value', () => {
		const onsubmit = vi.fn();
		const view = mountInput({ onsubmit });
		key(view.input, 'Enter');
		flushSync();
		expect(onsubmit).toHaveBeenCalledWith('https://example.dev');
		view.cleanup();
	});

	it('isComposing arm: Enter during IME composition is ignored', () => {
		const onsubmit = vi.fn();
		const view = mountInput({ onsubmit });
		key(view.input, 'Enter', { isComposing: true });
		flushSync();
		expect(onsubmit).not.toHaveBeenCalled();
		expect(view.input.value).toBe('https://example.dev');
		view.cleanup();
	});

	it('disabled passthrough renders a disabled input', () => {
		const view = mountInput({ disabled: true, onsubmit: vi.fn() });
		expect(view.input.disabled).toBe(true);
		view.cleanup();
	});
});
