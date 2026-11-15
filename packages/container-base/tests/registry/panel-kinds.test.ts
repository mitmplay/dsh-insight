import { describe, expect, it, vi } from 'vitest';
// imports go through the package's ONLY public surface (index.ts).
import {
	type PanelKindDeclaration,
	clampKindWidth,
	revivePanels,
	resizeAllByRegistry
} from '../../src/index';

interface DemoPanel extends Record<string, unknown> {
	id: string;
	kind: string;
	width?: number;
}

/** A spy-backed lazy band — 2.1-T's laziness proof lives on this. */
function spyBand(min = 280, max = 1400) {
	const band = vi.fn(() => ({ min, max }));
	return band;
}

function demoDecl(kind: string, over: Partial<PanelKindDeclaration<DemoPanel>> = {}): PanelKindDeclaration<DemoPanel> {
	return {
		kind,
		requiredKeys: (e) => typeof e['id'] === 'string',
		revive: (e) => ({ id: e['id'] as string, kind, width: e['width'] as number | undefined, zoom: e['zoom'] as number | undefined }),
		laneDefaultWidth: 480,
		band: () => ({ min: 280, max: 1400 }),
		...over
	};
}

describe('revivePanels (R4 W2, ADR-0065)', () => {
	it('unknown kind string drops', () => {
		const decls = [demoDecl('conversation')];
		const r = revivePanels<DemoPanel>([{ kind: 'conversation', id: 'a' }, { kind: 'mystery', id: 'b' }], decls);
		expect(r.panels.map((p) => p.id)).toEqual(['a']);
		expect(r.dropped).toBe(1);
	});

	it('failed requiredKeys drops', () => {
		const decls = [demoDecl('conversation')];
		const r = revivePanels<DemoPanel>([{ kind: 'conversation', id: 'a' }, { kind: 'conversation' }], decls);
		expect(r.panels.map((p) => p.id)).toEqual(['a']);
		expect(r.dropped).toBe(1);
	});

	it('persisted:false drops — a hand-crafted entry never survives (D6)', () => {
		const decls = [demoDecl('conversation'), demoDecl('browser', { persisted: false })];
		const r = revivePanels<DemoPanel>(
			[{ kind: 'conversation', id: 'a' }, { kind: 'browser', id: 'glass' }],
			decls
		);
		expect(r.panels.map((p) => p.id)).toEqual(['a']);
	});

	it('junk knob falls back to default; valid knob clamps', () => {
		const decls = [demoDecl('conversation')];
		const knobs = [
			{ key: 'width', default: 480, clamp: (v: number) => Math.min(1400, Math.max(280, v)) },
			{ key: 'zoom', default: 1, validate: (v: unknown) => typeof v === 'number' && v > 0 }
		];
		const r = revivePanels<DemoPanel>(
			[
				{ kind: 'conversation', id: 'a', width: 'garbage', zoom: 1.5 },
				{ kind: 'conversation', id: 'b', width: 9999, zoom: -3 }
			],
			decls,
			knobs
		);
		expect(r.panels[0]).toMatchObject({ width: 480, zoom: 1.5 });
		expect(r.panels[1]).toMatchObject({ width: 1400, zoom: 1 });
	});

	it('non-object entries and non-string kinds drop without throwing', () => {
		const decls = [demoDecl('conversation')];
		const r = revivePanels<DemoPanel>([null, 42, 'x', { id: 'no-kind' }, []], decls);
		expect(r.panels).toEqual([]);
		expect(r.dropped).toBe(5);
	});

	it('non-array raw falls back to empty, not a throw', () => {
		const r = revivePanels<DemoPanel>({ panels: [{ kind: 'conversation', id: 'a' }] }, [demoDecl('conversation')]);
		expect(r.panels.map((p) => p.id)).toEqual(['a']);
	});

	it('cross-check hook resolves the selection (D3 shape)', () => {
		const decls = [demoDecl('conversation')];
		// 'dead' is NOT a stored entry — the raw selection dangles (D3).
		const raw = [{ kind: 'conversation', id: 'a' }];
		const r = revivePanels<DemoPanel>(raw, decls, [], {
			rawSelectedId: 'dead',
			crossCheckSelected: (rawId, panels) => (panels.some((p) => p.id === rawId) ? rawId : (panels[0]?.id ?? null))
		});
		expect(r.selected).toBe('a');
	});
});

describe('clampKindWidth (R4 W2 — lazy band, D5)', () => {
	it('band resolver is NOT evaluated at declaration time', () => {
		const band = spyBand();
		const decl = demoDecl('conversation', { band });
		expect(band).not.toHaveBeenCalled();
		expect(clampKindWidth(800, decl)).toBe(800);
		expect(band).toHaveBeenCalledTimes(1);
	});

	it('clamps through the resolved band, per call', () => {
		const band = spyBand(300, 900);
		const decl = demoDecl('conversation', { band });
		expect(clampKindWidth(200, decl)).toBe(300);
		expect(clampKindWidth(9999, decl)).toBe(900);
	});
});

describe('resizeAllByRegistry (R4 W2 — flagged kinds only)', () => {
	it('resizableByPreset defaults OFF', () => {
		const decls = [demoDecl('conversation')];
		const out = resizeAllByRegistry([{ id: 'a', kind: 'conversation', width: 500 }], 900, decls);
		expect(out[0].width).toBe(500); // untouched — flag omitted = false
	});

	it('flagged kind sweeps through its OWN band; others keep identity', () => {
		const conv = demoDecl('conversation', { resizableByPreset: true, band: spyBand(280, 1400) });
		const explorer = demoDecl('workspace-explorer', { band: spyBand(220, 600) });
		const before = [
			{ id: 'a', kind: 'conversation', width: 500 },
			{ id: 'e', kind: 'workspace-explorer', width: 300 }
		];
		const out = resizeAllByRegistry(before, 900, [conv, explorer]);
		expect(out[0]).toEqual({ id: 'a', kind: 'conversation', width: 900 });
		expect(out[1]).toBe(before[1]); // identity kept — untouched panel
	});

	it('flagged kind clamps at its own band edge, not a shared band', () => {
		const narrow = demoDecl('skill-shelf', { resizableByPreset: true, band: spyBand(200, 400) });
		const wide = demoDecl('conversation', { resizableByPreset: true, band: spyBand(280, 1400) });
		const out = resizeAllByRegistry(
			[
				{ id: 's', kind: 'skill-shelf', width: 250 },
				{ id: 'c', kind: 'conversation', width: 250 }
			],
			9999,
			[narrow, wide]
		);
		expect(out[0].width).toBe(400);
		expect(out[1].width).toBe(1400);
	});
});
