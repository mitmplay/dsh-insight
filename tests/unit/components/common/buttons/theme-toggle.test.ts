import { mount, unmount, flushSync } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import ThemeToggle from '$lib/components/common/buttons/ThemeToggle.svelte';
import { THEME_BASE_KEY, themePrefs } from '$lib/utils/theme-prefs.svelte';

// Wave 3 task 3.1-T (ADR-0023): the footer toggle follows the LanguageMenu
// grammar — one trigger whose icon IS the current choice, a popup with the
// three states, check on the active one.

function render() {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(ThemeToggle, { target });
	return { target, instance };
}

function cleanup(instance: unknown, target: HTMLElement) {
	try {
		unmount(instance as never);
	} catch {
		/* already unmounted */
	}
	target.remove();
}

afterEach(() => {
	localStorage.clear();
	delete document.documentElement.dataset.theme;
});

describe('ThemeToggle (3.1, LanguageMenu grammar)', () => {
	it('lists exactly the three states in the popup', () => {
		const h = render();
		h.target.querySelector('[data-testid="theme-toggle-trigger"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		const list = h.target.querySelector('[data-testid="theme-toggle-list"]');
		expect(list).not.toBeNull();
		const options = [...h.target.querySelectorAll('[data-testid^="theme-option-"]')].map((o) =>
			o.getAttribute('data-testid')
		);
		expect(options).toEqual(['theme-option-system', 'theme-option-light', 'theme-option-dark']);
		cleanup(h.instance, h.target);
	});

	it('the trigger icon reflects the current choice (monitor/sun/moon via aria-label carry)', () => {
		themePrefs.set('dark');
		const h = render();
		// the trigger carries the label; the SVG inside is the choice's icon
		const trigger = h.target.querySelector('[data-testid="theme-toggle-trigger"]') as HTMLElement;
		expect(trigger).not.toBeNull();
		// dark choice → moon renders: exactly one svg inside the trigger
		expect(trigger.querySelectorAll('svg').length).toBe(1);
		cleanup(h.instance, h.target);
	});

	it('choosing an option writes through theme-prefs and closes the popup', () => {
		const h = render();
		h.target.querySelector('[data-testid="theme-toggle-trigger"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		const dark = h.target.querySelector('[data-testid="theme-option-dark"]') as HTMLElement;
		dark.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		expect(themePrefs.choice).toBe('dark');
		expect(localStorage.getItem(THEME_BASE_KEY)).toBe('dark');
		expect(document.documentElement.dataset.theme).toBe('dark');
		expect(h.target.querySelector('[data-testid="theme-toggle-list"]')).toBeNull(); // closed
		cleanup(h.instance, h.target);
	});

	it('marks the active option (data-active), like the language menu', () => {
		themePrefs.set('system');
		const h = render();
		h.target.querySelector('[data-testid="theme-toggle-trigger"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		expect(h.target.querySelector('[data-testid="theme-option-system"]')?.getAttribute('data-active')).toBe('true');
		expect(h.target.querySelector('[data-testid="theme-option-dark"]')?.getAttribute('data-active')).toBe('false');
		cleanup(h.instance, h.target);
	});

	// Coverage mop (2026-11-10): the light icon arm ({:else if light} → Sun),
	// the dropUp list placement arm, and the outside/inside click arms of
	// the document listener.
	it('light choice → the sun icon arm renders (choice light)', () => {
		themePrefs.set('light');
		const h = render();
		const trigger = h.target.querySelector('[data-testid="theme-toggle-trigger"]') as HTMLElement;
		expect(trigger.querySelectorAll('svg').length).toBe(1);
		cleanup(h.instance, h.target);
	});

	it('all three option labels render each open (labels run for every choice)', () => {
		themePrefs.set('light');
		const h = render();
		h.target.querySelector('[data-testid="theme-toggle-trigger"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		const labels = [...h.target.querySelectorAll('[data-testid^="theme-option-"]')].map((o) =>
			o.textContent?.trim()
		);
		expect(labels).toHaveLength(3);
		cleanup(h.instance, h.target);
	});

	it('dropUp → the list mounts upward (bottom-full arm)', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(ThemeToggle, { target, props: { dropUp: true } });
		target.querySelector('[data-testid="theme-toggle-trigger"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		const list = target.querySelector('[data-testid="theme-toggle-list"]') as HTMLElement;
		expect(list.className).toContain('bottom-full');
		expect(list.className).not.toContain('mt-1');
		unmount(instance);
		target.remove();
	});

	it('outside click closes the popup (listener true arm)', () => {
		const h = render();
		h.target.querySelector('[data-testid="theme-toggle-trigger"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		expect(h.target.querySelector('[data-testid="theme-toggle-list"]')).not.toBeNull();
		document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		expect(h.target.querySelector('[data-testid="theme-toggle-list"]')).toBeNull();
		cleanup(h.instance, h.target);
	});

	it('a click inside the root (the list shell) keeps the popup open (listener false arm)', () => {
		const h = render();
		h.target.querySelector('[data-testid="theme-toggle-trigger"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		const list = h.target.querySelector('[data-testid="theme-toggle-list"]') as HTMLElement;
		expect(list).not.toBeNull();
		list.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		expect(h.target.querySelector('[data-testid="theme-toggle-list"]')).not.toBeNull();
		cleanup(h.instance, h.target);
	});
});
