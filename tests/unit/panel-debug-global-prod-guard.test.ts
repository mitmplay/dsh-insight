/**
 * panel-debug-global-prod-guard.test.ts — the PROD/DEV guard branch of
 * installPanelDebugGlobal (ADR-0065 D10) in isolation: under DEV=false the
 * install MUST return early and never touch window.__DSI_PANELS, not even
 * across repeated fresh-module imports; under DEV=true the surface lands.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

const globalOf = () =>
	(window as unknown as { __DSI_PANELS?: unknown }).__DSI_PANELS;

async function importFresh(): Promise<{ installPanelDebugGlobal: () => void }> {
	vi.resetModules();
	return await import('../../src/lib/dev/panel-debug-global');
}

describe('installPanelDebugGlobal — PROD/DEV guard', () => {
	beforeEach(() => {
		delete (window as unknown as { __DSI_PANELS?: unknown }).__DSI_PANELS;
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
		delete (window as unknown as { __DSI_PANELS?: unknown }).__DSI_PANELS;
	});

	it('DEV=false: returns early WITHOUT setting window.__DSI_PANELS', async () => {
		vi.stubEnv('DEV', false);
		const { installPanelDebugGlobal } = await importFresh();
		expect(() => installPanelDebugGlobal()).not.toThrow();
		expect(globalOf()).toBeUndefined();
		// a second fresh-module install under the same prod env is still a no-op
		const again = await importFresh();
		again.installPanelDebugGlobal();
		expect(globalOf()).toBeUndefined();
	});

	it('DEV=true: the guard passes and window.__DSI_PANELS is set', async () => {
		vi.stubEnv('DEV', true);
		const { installPanelDebugGlobal } = await importFresh();
		installPanelDebugGlobal();
		expect(globalOf()).toBeDefined();
	});
});
