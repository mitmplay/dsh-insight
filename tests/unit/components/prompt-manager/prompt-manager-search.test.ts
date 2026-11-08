/**
 * PromptManagerSearch unit tests: the debounced search textarea of the
 * prompts manager toolbar. Direct mount (filter-date-button.test.ts
 * pattern) — the component is presentational plus one callback.
 *
 * Branches covered:
 * - empty value → the clear disc is NOT rendered ({#if value.length > 0} false arm)
 * - non-empty value (initial prop AND a typed keystroke) → the disc renders (true arm)
 * - typing fires oninput and two-way binds the value ($bindable arm)
 * - clear() disc click → value resets to '', oninput fires, the disc
 *   unmounts and the textarea is re-focused (ClearIconButton target arm)
 */
import { mount, unmount, flushSync } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import PromptManagerSearch from '$lib/components/prompt-manager/PromptManagerSearch.svelte';

function mountSearch(initialValue = '', oninput = vi.fn()) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(PromptManagerSearch, {
		target,
		props: { value: initialValue, oninput }
	});
	flushSync();
	return {
		target,
		oninput,
		instance: comp as unknown as { value: string },
		textarea: () => target.querySelector('.mgr-search') as HTMLTextAreaElement,
		clearBtn: () => target.querySelector('button.clear-icon-btn') as HTMLButtonElement | null,
		cleanup: () => {
			unmount(comp);
			target.remove();
		}
	};
}

describe('PromptManagerSearch', () => {
	it('empty value: the textarea renders with an i18n placeholder and NO clear disc', () => {
		const h = mountSearch();
		const ta = h.textarea();
		expect(ta).not.toBeNull();
		expect(String(ta.rows)).toBe('2'); // markup rows="2" reflects as string
		// t(m.searchPrompts) resolved — the placeholder is a non-empty string.
		expect(ta.placeholder.length).toBeGreaterThan(0);
		expect(h.clearBtn()).toBeNull();
		h.cleanup();
	});

	it('non-empty initial value: the clear disc renders inside the wrapper', () => {
		const h = mountSearch('+rca');
		expect(h.clearBtn()).not.toBeNull();
		expect((h.textarea() as HTMLTextAreaElement).value).toBe('+rca');
		h.cleanup();
	});

	it('typing fires oninput per keystroke and two-way binds the value', () => {
		const h = mountSearch();
		const ta = h.textarea();
		ta.value = '+git';
		ta.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(h.oninput).toHaveBeenCalledTimes(1);
		// bind:value lifted the keystroke back to the bindable prop —
		// observable on the textarea (mount does not expose prop accessors).
		expect(ta.value).toBe('+git');
		// The {#if} flipped: the disc appeared without a prop change.
		expect(h.clearBtn()).not.toBeNull();
		h.cleanup();
	});

	it('clear disc click: value resets to empty, oninput fires, disc unmounts, textarea re-focuses', () => {
		const h = mountSearch('+git +rca');
		const ta = h.textarea();
		const focusSpy = vi.spyOn(ta, 'focus');
		h.clearBtn()!.click();
		flushSync();
		expect(h.oninput).toHaveBeenCalledTimes(1);
		expect(ta.value).toBe('');
		// Back to the empty arm: the disc is gone again.
		expect(h.clearBtn()).toBeNull();
		// ClearIconButton re-focuses the field via the target prop.
		expect(focusSpy).toHaveBeenCalled();
		h.cleanup();
	});

	it('typing back to empty removes the disc without the clear path', () => {
		const h = mountSearch('x');
		expect(h.clearBtn()).not.toBeNull();
		const ta = h.textarea();
		ta.value = '';
		ta.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(h.oninput).toHaveBeenCalledTimes(1);
		expect(h.clearBtn()).toBeNull();
		h.cleanup();
	});
});
