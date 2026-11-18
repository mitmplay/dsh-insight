import { describe, expect, it } from 'vitest';
import { panelsBootScript } from '../../src/index';

/**
 * panelsBootScript (ADR-0067) generates the pre-paint inline SCRIPT SOURCE
 * STRING. These tests run the generated source with new Function — the same
 * house pattern as the themeApplierScript block in theming.test.ts — so the
 * real branches (profile match/absence, sanitization, raw guard, catch
 * guard) execute, not just string shape.
 */
describe('panelsBootScript — the pre-paint prefs hand-off (ADR-0067)', () => {
	it('embeds the base key and mirrors the namespace.ts key grammar', () => {
		const script = panelsBootScript('cb-panels');
		expect(script).toContain("'cb-panels'");
		expect(script).toContain("[?&]profile=([^&]*)");
		// suffix rule: base + '_' + sanitized profile, else bare base key
		expect(script).toContain("'_' + prof");
		expect(script).toContain("replace(/[^A-Za-z0-9_-]/g, '')");
		expect(script).toContain("slice(0, 40)");
		// keyed register publish, raw string only — parsing stays in the app
		expect(script).toContain("__BOOT_PREFS = window.__BOOT_PREFS || {}");
		expect(script).toContain("= { profile: prof, raw: raw }");
	});

	it('with a ?profile= and stored raw blob, publishes __BOOT_PREFS[baseKey]', () => {
		history.replaceState(null, '', '/?profile=widi');
		localStorage.clear();
		delete (window as any).__BOOT_PREFS;
		localStorage.setItem('cb-panels_widi', 'RAW-BLOB');
		const fn = new Function(panelsBootScript('cb-panels'));
		fn();
		expect((window as any).__BOOT_PREFS['cb-panels']).toEqual({
			profile: 'widi',
			raw: 'RAW-BLOB',
		});
	});

	it('without ?profile=, reads the bare base key', () => {
		history.replaceState(null, '', '/');
		localStorage.clear();
		delete (window as any).__BOOT_PREFS;
		localStorage.setItem('cb-panels', 'BARE');
		const fn = new Function(panelsBootScript('cb-panels'));
		fn();
		expect((window as any).__BOOT_PREFS['cb-panels']).toEqual({
			profile: '',
			raw: 'BARE',
		});
	});

	it('sanitizes junk profile chars and caps the profile at 40 chars', () => {
		// URL-safe junk: ! . * ( ) ~ survive replaceState unencoded but are
		// stripped by the [A-Za-z0-9_-] sanitizer; 50 a's prove the 40 cap.
		const junk = 'W!1.(2)*~d' + 'a'.repeat(50);
		history.replaceState(null, '', `/?profile=${junk}`);
		const expected = 'W12d' + 'a'.repeat(36);
		localStorage.clear();
		delete (window as any).__BOOT_PREFS;
		localStorage.setItem(`cb-panels_${expected}`, 'SAN');
		const fn = new Function(panelsBootScript('cb-panels'));
		fn();
		expect((window as any).__BOOT_PREFS['cb-panels']).toEqual({
			profile: expected,
			raw: 'SAN',
		});
	});

	it('empty or missing raw blob publishes nothing', () => {
		localStorage.clear();
		delete (window as any).__BOOT_PREFS;
		// empty string blob — typeof raw === 'string' but length 0
		localStorage.setItem('cb-panels', '');
		let fn = new Function(panelsBootScript('cb-panels'));
		fn();
		expect((window as any).__BOOT_PREFS).toBeUndefined();
		// key with no stored value at all
		localStorage.removeItem('cb-panels');
		fn = new Function(panelsBootScript('cb-panels'));
		fn();
		expect((window as any).__BOOT_PREFS).toBeUndefined();
	});

	it('the catch guard swallows a dead localStorage (file:// privacy mode)', () => {
		const real = globalThis.localStorage;
		// simulate storage access throwing (blocked/broken storage)
		Object.defineProperty(globalThis, 'localStorage', {
			configurable: true,
			get() {
				throw new Error('storage blocked');
			},
		});
		try {
			const fn = new Function(panelsBootScript('cb-panels'));
			expect(() => fn()).not.toThrow();
		} finally {
			Object.defineProperty(globalThis, 'localStorage', {
				configurable: true,
				value: real,
			});
		}
		expect((window as any).__BOOT_PREFS).toBeUndefined();
	});
});
