import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * 5.1-T (ADR-0065 D10) — the prod strip + the dev surface of
 * window.__DSI_PANELS. The strip is asserted STATICALLY (the DEV guard
 * in the module and in the route wiring — a prod bundle tree-shakes the
 * guarded dynamic import); the dev behavior runs in this happy-dom env.
 */

const modSrc = readFileSync('src/lib/dev/panel-debug-global.ts', 'utf8');
const routeSrc = readFileSync('src/routes/+page.svelte', 'utf8');

describe('panel debug global — prod strip (5.1-T, D10)', () => {
	it('the module itself is guarded by import.meta.env.DEV', () => {
		expect(modSrc).toMatch(/if \(!import\.meta\.env\.DEV\) return;/);
	});

	it('the route wiring is DEV-guarded and DYNAMICALLY imported', () => {
		// the guard + the dynamic import keep the module out of the prod graph
		expect(routeSrc).toMatch(/if \(import\.meta\.env\.DEV\) \{[\s\S]*?import\('\$lib\/dev\/panel-debug-global'\)/);
	});
});

describe('panel debug global — dev behavior', () => {
	beforeEach(() => {
		localStorage.clear();
		delete (window as unknown as { __DSI_PANELS?: unknown }).__DSI_PANELS;
	});

	it('installs ten kinds; blob getter parses the live blob; clamp runs the kind band', async () => {
		const { installPanelDebugGlobal } = await import('../../src/lib/dev/panel-debug-global');
		localStorage.setItem('dsi-panels', JSON.stringify({ panels: [{ id: 'p', kind: 'conversation', sessionId: 's' }], selectedPanelId: 'p' }));
		installPanelDebugGlobal();
		const g = (window as unknown as { __DSI_PANELS: { kinds: { kind: string; persisted: boolean; resizableByPreset: boolean }[]; blob: () => unknown; clamp: (w: number, k: string) => number } }).__DSI_PANELS;
		expect(g.kinds).toHaveLength(10);
		expect(g.kinds.filter((k) => k.kind === 'browser' && !k.persisted)).toHaveLength(1);
		expect(g.kinds.filter((k) => k.resizableByPreset)).toEqual([{ kind: 'conversation', persisted: true, resizableByPreset: true }]);
		expect((g.blob() as { selectedPanelId: string }).selectedPanelId).toBe('p');
		// the band probe: conversation's default ceiling clamps 9999 → 860
		expect(g.clamp(9999, 'conversation')).toBe(860);
		expect(g.clamp(50, 'workspace-explorer')).toBe(520);
	});
});
