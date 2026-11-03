import { describe, it, expect, beforeEach } from 'vitest';
import { flushSync } from 'svelte';
// $effect.root is a compiler rune, not a runtime export — tests reach the
// compiled internal directly (the service's runes are compiled upstream).
import { effect_root } from 'svelte/internal/client';
import { pagePrefs } from '$lib/services/workspace/page-prefs.svelte';

describe('page-prefs singleton (ADR-0018 W2 task 2.1)', () => {
	beforeEach(() => {
		globalThis.localStorage.clear();
	});

	it('init seeds clamped defaults from an empty localStorage', () => {
		pagePrefs.init(null);
		expect(pagePrefs.panelWidth).toBeGreaterThan(0);
		expect(pagePrefs.zoom).toBeGreaterThan(0);
		expect(pagePrefs.treePct).toBeGreaterThanOrEqual(0);
		expect(pagePrefs.treePct).toBeLessThanOrEqual(100);
		expect(pagePrefs.sidebarWidth).toBeGreaterThan(0);
		expect(pagePrefs.sidebarCollapsed).toBe(false);
	});

	it('explorerHidden: $state-declared, seeded false, assignable (toggle RCA 2026-10-31)', () => {
		pagePrefs.init(null);
		expect(pagePrefs.explorerHidden).toBe(false);
		pagePrefs.explorerHidden = true;
		expect(pagePrefs.explorerHidden).toBe(true);
	});

	it('init seeds explorerHidden from the persisted blob', () => {
		globalThis.localStorage.setItem('dsi-panels', JSON.stringify({ panels: [], selectedPanelId: null, panelWidth: 600, zoom: 1, treePct: 30, explorerHidden: true }));
		pagePrefs.init(null);
		expect(pagePrefs.explorerHidden).toBe(true);
	});

	it('init re-seeds on every mount (old route semantics: one mount = one desk)', () => {
		pagePrefs.init(null);
		pagePrefs.panelWidth = 700;
		globalThis.localStorage.clear();
		pagePrefs.init(null);
		expect(pagePrefs.panelWidth).not.toBe(700);
	});

	it('installSidebarAutoSave persists collapsed+width through $effect.root', () => {
		pagePrefs.init(null);
		const dispose = effect_root(() => {
			pagePrefs.installSidebarAutoSave();
		});
		pagePrefs.sidebarCollapsed = true;
		pagePrefs.sidebarWidth = 420;
		flushSync();
		const raw = globalThis.localStorage.getItem('dsi-sidebar');
		expect(raw).not.toBeNull();
		const saved = JSON.parse(raw!);
		expect(saved.collapsed).toBe(true);
		expect(saved.width).toBe(420);
		dispose();
	});
});
