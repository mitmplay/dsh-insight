/**
 * panel-debug-global-kinds-clamp.test.ts — the kinds MAPPING and the clamp
 * DELEGATION arms the sibling suites only spot-check:
 *
 * 1. kinds[] mirrors PANEL_KIND_DECLARATIONS exactly, field-for-field
 *    (kind / persisted / resizableByPreset, in floor-truth order) — the
 *    other suites assert counts and single flags, not the full mapping.
 * 2. clamp(width, kind) is a passthrough to clampPanelWidth: each probe
 *    (below-min, in-band, above-max) equals clampPanelWidth's own answer,
 *    proving the console adds NO bound logic of its own.
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

describe('__DSI_PANELS.kinds — the declarations mapping', () => {
	beforeEach(() => {
		localStorage.clear();
		delete (window as unknown as { __DSI_PANELS?: unknown }).__DSI_PANELS;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	it('kinds[] equals PANEL_KIND_DECLARATIONS projected to the three public flags, in order', async () => {
		const { PANEL_KIND_DECLARATIONS } = await import('../../src/lib/utils/panel-prefs');
		await freshInstall();
		const expected = PANEL_KIND_DECLARATIONS.map((d) => ({
			kind: d.kind,
			persisted: d.persisted,
			resizableByPreset: d.resizableByPreset
		}));
		expect(globalOf()!.kinds).toEqual(expected);
	});

	it('every declaration kind appears exactly once (no dropped / duplicated kind)', async () => {
		await freshInstall();
		const kinds = globalOf()!.kinds.map((k) => k.kind);
		expect(new Set(kinds).size).toBe(kinds.length);
	});

	it('the flags split matches the registry: browser alone unpersisted, conversation alone resizable', async () => {
		await freshInstall();
		expect(globalOf()!.kinds.filter((k) => !k.persisted).map((k) => k.kind)).toEqual(['browser']);
		expect(globalOf()!.kinds.filter((k) => k.resizableByPreset).map((k) => k.kind)).toEqual([
			'conversation'
		]);
	});
});

describe('__DSI_PANELS.clamp — passthrough to clampPanelWidth (conversation band)', () => {
	beforeEach(() => {
		localStorage.clear();
		delete (window as unknown as { __DSI_PANELS?: unknown }).__DSI_PANELS;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	// conversation is the RESIZABLE kind (resizableByPreset: true) — its
	// band is the config default [minWidth, maxWidth] = [480, 860] with no
	// settings loaded in tests.
	it('below-min clamps UP to the band floor (50 → 480)', async () => {
		const { clampPanelWidth } = await import('../../src/lib/utils/panel-prefs');
		await freshInstall();
		expect(globalOf()!.clamp(50, 'conversation')).toBe(clampPanelWidth(50, 'conversation'));
		expect(globalOf()!.clamp(50, 'conversation')).toBe(480);
	});

	it('in-band passes through untouched (730 → 730)', async () => {
		const { clampPanelWidth } = await import('../../src/lib/utils/panel-prefs');
		await freshInstall();
		expect(globalOf()!.clamp(730, 'conversation')).toBe(clampPanelWidth(730, 'conversation'));
		expect(globalOf()!.clamp(730, 'conversation')).toBe(730);
	});

	it('above-max clamps DOWN to the band ceiling (9999 → 860)', async () => {
		const { clampPanelWidth } = await import('../../src/lib/utils/panel-prefs');
		await freshInstall();
		expect(globalOf()!.clamp(9999, 'conversation')).toBe(clampPanelWidth(9999, 'conversation'));
		expect(globalOf()!.clamp(9999, 'conversation')).toBe(860);
	});
});
