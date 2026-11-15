import { flushSync, mount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Component } from 'svelte';
import LanguageMenu from '../../src/i18n/LanguageMenu.svelte';
import { createLocalePrefs } from '../../src/index';

/**
 * LanguageMenu mount tests (ADR-0063 D3) — the generic mount over a
 * LocalePrefs store: open/close, selection, the active check, outside
 * click close, dropUp, and persistence through the real store's
 * localStorage dual-write.
 */

// A do-nothing function component stands in for the consumer's icon.
const stubIcon = (() => {}) as unknown as Component<{ size?: number }>;

const LOCALES = ['en', 'zh', 'id'] as const;
const LABELS = { en: 'English', zh: '中文', id: 'Bahasa Indonesia' };

const q = <T extends HTMLElement>(root: ParentNode, testid: string) =>
	root.querySelector<T>(`[data-testid="${testid}"]`)!;

function mountMenu(prefs: ReturnType<typeof createLocalePrefs>, props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(LanguageMenu, {
		target,
		props: {
			prefs,
			locales: LOCALES,
			labels: LABELS,
			triggerLabel: 'Language',
			icon: stubIcon,
			...props
		}
	});
	flushSync();
	return { instance, target };
}

describe('LanguageMenu', () => {
	beforeEach(() => {
		localStorage.clear();
		document.cookie = 't.locale=; path=/; max-age=0';
	});
	afterEach(() => {
		localStorage.clear();
		document.cookie = 't.locale=; path=/; max-age=0';
		for (const el of document.body.querySelectorAll('.cb-language-menu')) el.remove();
	});

	it('renders the trigger with the current locale code and no list while closed', () => {
		const prefs = createLocalePrefs({ baseKey: 't.locale', cookieName: 't.locale', locales: LOCALES, defaultLocale: 'en' });
		prefs.adopt();
		const { target } = mountMenu(prefs);
		const trigger = q(target, 'language-menu-trigger');
		expect(trigger.getAttribute('aria-label')).toBe('Language');
		expect(trigger.getAttribute('title')).toBe('Language');
		expect(trigger.getAttribute('aria-expanded')).toBe('false');
		expect(trigger.textContent).toContain('EN');
		expect(q(target, 'language-menu-list')).toBeDefined();
		// the closed menu renders no option list
		expect(target.querySelector('[data-testid="language-menu-list"]')).toBeNull();
	});

	it('opens on trigger click and lists every locale with a check on the active one', () => {
		const prefs = createLocalePrefs({ baseKey: 't.locale', cookieName: 't.locale', locales: LOCALES, defaultLocale: 'en' });
		prefs.adopt();
		const { target } = mountMenu(prefs);
		q(target, 'language-menu-trigger').click();
		flushSync();
		const list = target.querySelector('[data-testid="language-menu-list"]');
		expect(list).not.toBeNull();
		expect(list!.getAttribute('role')).toBe('menu');
		expect(q(target, 'language-menu-trigger').getAttribute('aria-expanded')).toBe('true');
		expect(q(target, 'locale-option-zh').textContent).toContain('中文');
		expect(q(target, 'locale-option-en').getAttribute('data-active')).toBe('true');
		expect(q(target, 'locale-option-zh').getAttribute('data-active')).toBe('false');
	});

	it('toggles closed on a second trigger click', () => {
		const prefs = createLocalePrefs({ baseKey: 't.locale', cookieName: 't.locale', locales: LOCALES, defaultLocale: 'en' });
		prefs.adopt();
		const { target } = mountMenu(prefs);
		const trigger = q(target, 'language-menu-trigger');
		trigger.click();
		flushSync();
		trigger.click();
		flushSync();
		expect(target.querySelector('[data-testid="language-menu-list"]')).toBeNull();
	});

	it('choosing an option closes the menu, calls prefs.set and persists to localStorage', () => {
		const prefs = createLocalePrefs({ baseKey: 't.locale', cookieName: 't.locale', locales: LOCALES, defaultLocale: 'en' });
		prefs.adopt();
		const { target } = mountMenu(prefs);
		q(target, 'language-menu-trigger').click();
		flushSync();
		q(target, 'locale-option-id').click();
		flushSync();
		expect(target.querySelector('[data-testid="language-menu-list"]')).toBeNull();
		expect(prefs.locale).toBe('id');
		expect(localStorage.getItem('t.locale')).toBe('id');
		// trigger now shows the new code and the re-opened list checks id
		expect(q(target, 'language-menu-trigger').textContent).toContain('ID');
		q(target, 'language-menu-trigger').click();
		flushSync();
		expect(q(target, 'locale-option-id').getAttribute('data-active')).toBe('true');
		expect(q(target, 'locale-option-id').textContent).toContain('✓');
	});

	it('an unknown stored locale keeps the default and falls back to the locale id as label', () => {
		localStorage.setItem('t.locale', 'xx');
		const prefs = createLocalePrefs({ baseKey: 't.locale', cookieName: 't.locale', locales: LOCALES, defaultLocale: 'en' });
		prefs.adopt();
		const { target } = mountMenu(prefs, { labels: {} });
		expect(prefs.locale).toBe('en');
		q(target, 'language-menu-trigger').click();
		flushSync();
		expect(q(target, 'locale-option-zh').textContent).toContain('zh');
	});

	it('outside click closes an open menu', () => {
		const prefs = createLocalePrefs({ baseKey: 't.locale', cookieName: 't.locale', locales: LOCALES, defaultLocale: 'en' });
		prefs.adopt();
		const { target } = mountMenu(prefs);
		q(target, 'language-menu-trigger').click();
		flushSync();
		expect(target.querySelector('[data-testid="language-menu-list"]')).not.toBeNull();
		// click on the body, outside the root element
		const outside = document.createElement('div');
		document.body.appendChild(outside);
		outside.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		expect(target.querySelector('[data-testid="language-menu-list"]')).toBeNull();
	});

	it('dropUp adds the cb-drop-up class to the list', () => {
		const prefs = createLocalePrefs({ baseKey: 't.locale', cookieName: 't.locale', locales: LOCALES, defaultLocale: 'en' });
		prefs.adopt();
		const { target } = mountMenu(prefs, { dropUp: true });
		q(target, 'language-menu-trigger').click();
		flushSync();
		expect(target.querySelector('.cb-language-list')!.classList.contains('cb-drop-up')).toBe(true);
	});
});
