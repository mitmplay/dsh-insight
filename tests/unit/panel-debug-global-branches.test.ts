/**
 * panel-debug-global-branches.test.ts — the branch arms the 5.1-T suite
 * does not reach: the PROD strip's runtime early-return (DEV=false
 * installs nothing), the blob getter's missing-blob fallback (?? 'null')
 * and its JSON.parse catch arm (a throwing localStorage.getItem still
 * answers null, never throws out of the console surface).
 */
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

type DebugGlobal = {
	kinds: { kind: string; persisted: boolean; resizableByPreset: boolean }[];
	blob: () => unknown;
	clamp: (width: number, kind: string) => number;
};

const globalOf = () =>
	(window as unknown as { __DSI_PANELS?: DebugGlobal | undefined }).__DSI_PANELS;

async function freshInstall(): Promise<void> {
	vi.resetModules();
	const { installPanelDebugGlobal } = await import('../../src/lib/dev/panel-debug-global');
	installPanelDebugGlobal();
}

describe('installPanelDebugGlobal — install / strip branches', () => {
	beforeEach(() => {
		localStorage.clear();
		delete (window as unknown as { __DSI_PANELS?: unknown }).__DSI_PANELS;
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	it('the prod strip arm: DEV=false installs NOTHING on window', async () => {
		vi.stubEnv('DEV', false);
		await freshInstall();
		expect(globalOf()).toBeUndefined();
	});

	it('the dev arm: DEV=true installs the console surface', async () => {
		vi.stubEnv('DEV', true);
		await freshInstall();
		const g = globalOf();
		expect(g).toBeDefined();
		expect(g!.kinds).toHaveLength(10);
		// re-install overwrites cleanly (the wiring may re-run under HMR);
		// vi.resetModules gives a fresh module scope, so compare shape, not identity
		await freshInstall();
		expect(globalOf()).toBeDefined();
		expect(globalOf()!.kinds).toEqual(g!.kinds);
	});
});

describe('__DSI_PANELS.blob() — fallback arms', () => {
	beforeEach(() => {
		localStorage.clear();
		delete (window as unknown as { __DSI_PANELS?: unknown }).__DSI_PANELS;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('no stored blob → the ?? "null" arm answers null', async () => {
		await freshInstall();
		expect(globalOf()!.blob()).toBeNull();
	});

	it('a stored blob parses through', async () => {
		localStorage.setItem('dsi-panels', JSON.stringify({ zoom: 1.25 }));
		await freshInstall();
		expect(globalOf()!.blob()).toEqual({ zoom: 1.25 });
	});

	it('a THROWING localStorage.getItem hits the catch arm and still answers null', async () => {
		await freshInstall();
		vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
			throw new Error('storage boom');
		});
		expect(() => globalOf()!.blob()).not.toThrow();
		expect(globalOf()!.blob()).toBeNull();
	});

	it('clamp still routes to the panel-prefs band after the fallback arms', async () => {
		await freshInstall();
		expect(globalOf()!.clamp(9999, 'conversation')).toBe(860);
		expect(globalOf()!.clamp(50, 'conversation')).toBe(480);
	});
});

describe('__DSI_PANELS.blob() — corrupt payload + default-DEV import', () => {
	beforeEach(() => {
		localStorage.clear();
		delete (window as unknown as { __DSI_PANELS?: unknown }).__DSI_PANELS;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	it('a stored but CORRUPT blob string hits the catch arm and answers null', async () => {
		// the ?? "null" string side feeds JSON.parse, which throws — same
		// catch arm as the throwing-getter test, reached from the other side.
		localStorage.setItem('dsi-panels', '{not valid json');
		await freshInstall();
		expect(() => globalOf()!.blob()).not.toThrow();
		expect(globalOf()!.blob()).toBeNull();
	});

	it('the hook is plain window state — deleting it cleans up', async () => {
		// no explicit uninstall exists; the route's cleanup is a plain delete
		await freshInstall();
		expect(globalOf()).toBeDefined();
		delete (window as unknown as { __DSI_PANELS?: unknown }).__DSI_PANELS;
		expect(globalOf()).toBeUndefined();
	});

	it('the DEV guard under the unstubbed test default (DEV=true) installs', async () => {
		// belt-and-braces: no stubEnv at all — vitest's own import.meta.env.DEV
		await freshInstall();
		expect(globalOf()).toBeDefined();
	});
});
