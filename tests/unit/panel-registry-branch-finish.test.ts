/**
 * panel-registry — branch-coverage finisher (coverage pass).
 *
 * The base suite (panel-registry.test.ts) pins add/replace/select/resize/
 * move; the page suites exercise the mounted-floor arms of the newer seams.
 * This file pins the remaining arms of those newer seams in isolation:
 *  - summonGlassFromRegistry with NO handler → false (the unmounted floor);
 *  - summonGlassFromRegistry WITH a handler → true + exact (glass, opts)
 *    pass-through for both keepSelection arms; registerSummonGlass(null)
 *    clears the slot;
 *  - replacePanelBySession with NO handler → false;
 *  - replacePanelBySession WITH a handler → the handler's boolean verdict
 *    passes through verbatim (true AND false arms);
 *  - panelRegistryActive(): false with both slots null, true with only
 *    addPanel registered, true with only replaceSelected registered.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	addPanelFromSidebar,
	panelRegistryActive,
	registerAddPanel,
	registerReplacePanelBySession,
	registerReplaceSelected,
	registerSummonGlass,
	replacePanelBySession,
	resetPanelRegistryForTests,
	summonGlassFromRegistry,
	type GlassSummon
} from '$lib/services/panels/panel-registry';

afterEach(() => {
	resetPanelRegistryForTests();
});

describe('panel-registry — newer seams, remaining arms', () => {
	it('summonGlassFromRegistry without a handler returns false (no floor)', () => {
		expect(panelRegistryActive()).toBe(false);
		expect(summonGlassFromRegistry({ index: 0 }, { replace: true })).toBe(false);
	});

	it('summonGlassFromRegistry with a handler returns true and passes (glass, opts) through', () => {
		const handler = vi.fn();
		registerSummonGlass(handler);
		const glass: GlassSummon = { index: 2, width: 640, openedBy: 's-a', sessionId: 'b-1' };
		expect(summonGlassFromRegistry(glass, { replace: true })).toBe(true);
		expect(handler).toHaveBeenCalledExactlyOnceWith(glass, { replace: true });
		expect(summonGlassFromRegistry({ index: 3 }, { replace: false, keepSelection: true })).toBe(true);
		expect(handler).toHaveBeenLastCalledWith({ index: 3 }, { replace: false, keepSelection: true });
	});

	it('registerSummonGlass(null) clears the slot — invoke returns false afterwards', () => {
		registerSummonGlass(vi.fn());
		registerSummonGlass(null);
		expect(summonGlassFromRegistry({}, { replace: true })).toBe(false);
	});

	it('replacePanelBySession without a handler returns false; with one, the verdict passes through', () => {
		expect(replacePanelBySession('s-1', { sessionId: 's-2', agentPreset: null })).toBe(false);
		const req = { sessionId: 's-2', agentPreset: null };
		registerReplacePanelBySession(() => true);
		expect(replacePanelBySession('s-1', req)).toBe(true);
		registerReplacePanelBySession(() => false);
		expect(replacePanelBySession('s-1', req)).toBe(false);
	});

	it('panelRegistryActive reflects either action slot (both arms)', () => {
		expect(panelRegistryActive()).toBe(false);
		registerAddPanel(vi.fn());
		expect(panelRegistryActive()).toBe(true);
		resetPanelRegistryForTests();
		registerReplaceSelected(vi.fn());
		expect(panelRegistryActive()).toBe(true);
		// sanity: the other slots stayed cleared
		expect(addPanelFromSidebar({ sessionId: 's', agentPreset: null })).toBe(false);
	});
});
