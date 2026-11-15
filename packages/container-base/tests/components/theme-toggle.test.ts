import { flushSync, mount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Component } from 'svelte';
import ThemeToggle from '../../src/theming/ThemeToggle.svelte';
import { createThemePrefs, storageKey } from '../../src/index';
import type { ThemeChoice } from '../../src/index';

/**
 * ThemeToggle mount tests (ADR-0063 D2) — the generic three-state lamp:
 * open/close, system/light/dark selection through the real ThemePrefs
 * store, the check on the active choice, outside-click close, dropUp,
 * and localStorage persistence of the choice.
 */

const stubIcon = (() => {}) as unknown as Component<{ size?: number; 'aria-hidden'?: boolean | 'true' | 'false' }>;

const q = <T extends HTMLElement>(root: ParentNode, testid: string) =>
	root.querySelector<T>(`[data-testid="${testid}"]`)!;

const ICONS: Record<ThemeChoice, Component<{ size?: number }>> = {
	system: stubIcon,
	light: stubIcon,
	dark: stubIcon
};

const LABELS: Record<ThemeChoice, string> = {
	system: 'System',
	light: 'Light',
	dark: 'Dark'
};

function mountToggle(prefs: ReturnType<typeof createThemePrefs>, props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(ThemeToggle, {
		target,
		props: { prefs, triggerLabel: 'Theme', optionLabels: LABELS, icons: ICONS, ...props }
	});
	flushSync();
	return { instance, target };
}

describe('ThemeToggle', () => {
	beforeEach(() => {
		localStorage.clear();
		delete document.documentElement.dataset.theme;
	});
	afterEach(() => {
		localStorage.clear();
		delete document.documentElement.dataset.theme;
		for (const el of document.body.querySelectorAll('.cb-theme-toggle')) el.remove();
	});

	it('renders the trigger with the current choice icon and no list while closed', () => {
		const prefs = createThemePrefs({ baseKey: 't-theme' });
		prefs.adopt();
		const { target } = mountToggle(prefs);
		const trigger = q(target, 'cb-theme-toggle-trigger');
		expect(trigger.getAttribute('aria-label')).toBe('Theme');
		expect(trigger.getAttribute('title')).toBe('Theme');
		expect(trigger.getAttribute('aria-expanded')).toBe('false');
		expect(target.querySelector('[data-testid="cb-theme-toggle-list"]')).toBeNull();
	});

	it('opens and lists all three choices with a check on the active one', () => {
		const prefs = createThemePrefs({ baseKey: 't-theme' });
		prefs.adopt();
		const { target } = mountToggle(prefs);
		q(target, 'cb-theme-toggle-trigger').click();
		flushSync();
		const list = target.querySelector('[data-testid="cb-theme-toggle-list"]');
		expect(list).not.toBeNull();
		expect(list!.getAttribute('role')).toBe('menu');
		expect(q(target, 'cb-theme-option-system').getAttribute('data-active')).toBe('true');
		expect(q(target, 'cb-theme-option-light').getAttribute('data-active')).toBe('false');
		expect(q(target, 'cb-theme-option-dark').getAttribute('data-active')).toBe('false');
		expect(q(target, 'cb-theme-option-system').textContent).toContain('System');
		expect(q(target, 'cb-theme-option-system').textContent).toContain('✓');
	});

	it('toggles closed on a second trigger click', () => {
		const prefs = createThemePrefs({ baseKey: 't-theme' });
		prefs.adopt();
		const { target } = mountToggle(prefs);
		const trigger = q(target, 'cb-theme-toggle-trigger');
		trigger.click();
		flushSync();
		trigger.click();
		flushSync();
		expect(target.querySelector('[data-testid="cb-theme-toggle-list"]')).toBeNull();
	});

	it('selecting dark closes, flips the attribute and persists the choice to localStorage', () => {
		const prefs = createThemePrefs({ baseKey: 't-theme' });
		prefs.adopt();
		const { target } = mountToggle(prefs);
		q(target, 'cb-theme-toggle-trigger').click();
		flushSync();
		q(target, 'cb-theme-option-dark').click();
		flushSync();
		expect(target.querySelector('[data-testid="cb-theme-toggle-list"]')).toBeNull();
		expect(prefs.choice).toBe('dark');
		expect(document.documentElement.dataset.theme).toBe('dark');
		expect(localStorage.getItem(storageKey('t-theme', null))).toBe('dark');
		// reopen: dark is now the checked choice
		q(target, 'cb-theme-toggle-trigger').click();
		flushSync();
		expect(q(target, 'cb-theme-option-dark').getAttribute('data-active')).toBe('true');
		expect(q(target, 'cb-theme-option-dark').textContent).toContain('✓');
	});

	it('selecting light persists light and selecting system keeps storage as system', () => {
		const prefs = createThemePrefs({ baseKey: 't-theme' });
		prefs.adopt();
		const { target } = mountToggle(prefs);
		q(target, 'cb-theme-toggle-trigger').click();
		flushSync();
		q(target, 'cb-theme-option-light').click();
		flushSync();
		expect(prefs.choice).toBe('light');
		expect(localStorage.getItem(storageKey('t-theme', null))).toBe('light');
		q(target, 'cb-theme-toggle-trigger').click();
		flushSync();
		q(target, 'cb-theme-option-system').click();
		flushSync();
		expect(prefs.choice).toBe('system');
		expect(localStorage.getItem(storageKey('t-theme', null))).toBe('system');
	});

	it('junk stored choice falls back to system with resolved light', () => {
		localStorage.setItem(storageKey('t-theme', null), 'not-a-theme');
		const prefs = createThemePrefs({ baseKey: 't-theme' });
		prefs.adopt();
		const { target } = mountToggle(prefs);
		expect(prefs.choice).toBe('system');
		expect(prefs.resolved).toBe('light');
		q(target, 'cb-theme-toggle-trigger').click();
		flushSync();
		expect(q(target, 'cb-theme-option-system').getAttribute('data-active')).toBe('true');
	});

	it('outside click closes an open menu', () => {
		const prefs = createThemePrefs({ baseKey: 't-theme' });
		prefs.adopt();
		const { target } = mountToggle(prefs);
		q(target, 'cb-theme-toggle-trigger').click();
		flushSync();
		expect(target.querySelector('[data-testid="cb-theme-toggle-list"]')).not.toBeNull();
		const outside = document.createElement('div');
		document.body.appendChild(outside);
		outside.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		flushSync();
		expect(target.querySelector('[data-testid="cb-theme-toggle-list"]')).toBeNull();
	});

	it('dropUp adds the cb-drop-up class to the list', () => {
		const prefs = createThemePrefs({ baseKey: 't-theme' });
		prefs.adopt();
		const { target } = mountToggle(prefs, { dropUp: true });
		q(target, 'cb-theme-toggle-trigger').click();
		flushSync();
		expect(target.querySelector('.cb-theme-toggle-list')!.classList.contains('cb-drop-up')).toBe(true);
	});
});
