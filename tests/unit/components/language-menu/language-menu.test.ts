/**
 * Header language menu — Three Tongues W2 task 2.2-T.
 * Mounts the real component: three locale options render from the
 * catalogs, the active one is marked, and a click reaches the service
 * (persistence asserted through document.cookie — no service mock).
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import LanguageMenu from '$lib/components/language-menu/LanguageMenu.svelte';

function render() {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(LanguageMenu, { target });
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
	document.body.innerHTML = '';
});

describe('LanguageMenu (2.2, bug-fix pass 2026-09-12)', () => {
	it('starts closed; the trigger toggles the list open', () => {
		const h = render();
		expect(h.target.querySelector('[data-testid="language-menu-trigger"]')).not.toBeNull();
		expect(h.target.querySelector('[data-testid="language-menu-list"]')).toBeNull();
		const trigger = h.target.querySelector(
			'[data-testid="language-menu-trigger"]'
		) as HTMLButtonElement;
		trigger.click();
		flushSync();
		expect(h.target.querySelector('[data-testid="language-menu-list"]')).not.toBeNull();
		trigger.click();
		flushSync();
		expect(h.target.querySelector('[data-testid="language-menu-list"]')).toBeNull();
		cleanup(h.instance, h.target);
	});

	it('open list renders one option per fleet locale from the catalogs', () => {
		const h = render();
		const trigger = h.target.querySelector(
			'[data-testid="language-menu-trigger"]'
		) as HTMLButtonElement;
		trigger.click();
		flushSync();
		for (const loc of ['en', 'zh', 'id', 'es']) {
			expect(h.target.querySelector('[data-testid="locale-option-' + loc + '"]')).not.toBeNull();
		}
		// catalog-sourced names, not literals
		const id = h.target.querySelector('[data-testid="locale-option-id"]');
		expect(id?.textContent).toContain('Bahasa Indonesia');
		cleanup(h.instance, h.target);
	});

	it('choosing a locale switches, persists (cookie), and CLOSES the popup', async () => {
		const h = render();
		const trigger = h.target.querySelector(
			'[data-testid="language-menu-trigger"]'
		) as HTMLButtonElement;
		trigger.click();
		flushSync();
		const zh = h.target.querySelector('[data-testid="locale-option-zh"]') as HTMLButtonElement;
		zh.click();
		flushSync();
		await new Promise((r) => setTimeout(r, 20));
		expect(document.cookie).toContain('dsi.locale=zh');
		expect(h.target.querySelector('[data-testid="language-menu-list"]')).toBeNull();
		cleanup(h.instance, h.target);
	});

	it('an outside click closes the popup without choosing', async () => {
		const h = render();
		const trigger = h.target.querySelector(
			'[data-testid="language-menu-trigger"]'
		) as HTMLButtonElement;
		trigger.click();
		flushSync();
		expect(h.target.querySelector('[data-testid="language-menu-list"]')).not.toBeNull();
		document.body.click();
		flushSync();
		expect(h.target.querySelector('[data-testid="language-menu-list"]')).toBeNull();
		cleanup(h.instance, h.target);
	});

	it('dropUp mount positions the list above the trigger', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(LanguageMenu, { target, props: { dropUp: true } });
		const trigger = target.querySelector(
			'[data-testid="language-menu-trigger"]'
		) as HTMLButtonElement;
		trigger.click();
		flushSync();
		const list = target.querySelector(
			'[data-testid="language-menu-list"]'
		) as HTMLElement;
		// ADR-0063 D3: the menu is the base component now — dropUp carries via
		// the base's cb-drop-up class (bottom positioning in its scoped style)
		expect(list.className).toContain('cb-drop-up');
		cleanup(instance, target);
	});
});
