import { describe, expect, it } from 'vitest';
// imports go through the package's ONLY public surface (index.ts).
import {
	type PanelKindDeclaration,
	clampKindWidth,
	definePanelKind,
	revivePanels,
	resizeAllByRegistry
} from '../../src/index';

interface DemoPanel extends Record<string, unknown> {
	id: string;
	kind: string;
	width?: number;
}

function demoDecl(kind: string, over: Partial<PanelKindDeclaration<DemoPanel>> = {}): PanelKindDeclaration<DemoPanel> {
	return {
		kind,
		requiredKeys: (e) => typeof e['id'] === 'string',
		revive: (e) => ({ id: e['id'] as string, kind }),
		laneDefaultWidth: 480,
		band: () => ({ min: 280, max: 1400 }),
		...over
	};
}

describe('definePanelKind — registration door validation', () => {
	it('accepts a well-formed declaration and freezes the copy', () => {
		const d = definePanelKind(demoDecl('conversation'));
		expect(Object.isFrozen(d)).toBe(true);
		expect(d.kind).toBe('conversation');
		expect(typeof d.revive).toBe('function');
	});

	it('rejects an empty-string kind', () => {
		expect(() => definePanelKind(demoDecl(''))).toThrowError('definePanelKind: kind must be a non-empty string');
	});

	it('rejects a non-string kind', () => {
		expect(() => definePanelKind(demoDecl(42 as unknown as string))).toThrowError(
			'definePanelKind: kind must be a non-empty string'
		);
	});

	it('rejects a missing revive', () => {
		const d = demoDecl('conversation', { revive: undefined as unknown as PanelKindDeclaration<DemoPanel>['revive'] });
		expect(() => definePanelKind(d)).toThrowError('definePanelKind: revive and requiredKeys are required functions');
	});

	it('rejects a missing requiredKeys', () => {
		const d = demoDecl('conversation', { requiredKeys: undefined as unknown as PanelKindDeclaration<DemoPanel>['requiredKeys'] });
		expect(() => definePanelKind(d)).toThrowError('definePanelKind: revive and requiredKeys are required functions');
	});

	it('rejects a non-function band (D5)', () => {
		const d = demoDecl('conversation', { band: { min: 1, max: 2 } as unknown as PanelKindDeclaration<DemoPanel>['band'] });
		expect(() => definePanelKind(d)).toThrowError('definePanelKind: band must be a lazy () => ({ min, max }) resolver (D5)');
	});
});

describe('revivePanels — raw-shape and revive-failure edges', () => {
	it('accepts a bare array as raw', () => {
		const r = revivePanels<DemoPanel>([{ kind: 'conversation', id: 'a' }], [demoDecl('conversation')]);
		expect(r.panels.map((p) => p.id)).toEqual(['a']);
		expect(r.dropped).toBe(0);
	});

	it('junk raw (null / number / object without panels) revives nothing', () => {
		const decls = [demoDecl('conversation')];
		for (const raw of [null, 42, 'x', { nope: true }]) {
			const r = revivePanels<DemoPanel>(raw, decls);
			expect(r.panels).toEqual([]);
			expect(r.dropped).toBe(0);
			expect(r.selected).toBeUndefined();
		}
	});

	it('a revive that THROWS drops the entry without propagating', () => {
		const decls = [
			demoDecl('conversation', { revive: () => { throw new Error('boom'); } })
		];
		const r = revivePanels<DemoPanel>([{ kind: 'conversation', id: 'a' }], decls);
		expect(r.panels).toEqual([]);
		expect(r.dropped).toBe(1);
	});

	it('a revive returning undefined drops the entry', () => {
		const decls = [demoDecl('conversation', { revive: () => undefined as unknown as DemoPanel })];
		const r = revivePanels<DemoPanel>([{ kind: 'conversation', id: 'a' }], decls);
		expect(r.panels).toEqual([]);
		expect(r.dropped).toBe(1);
	});

	it('a revive returning null drops the entry', () => {
		const decls = [demoDecl('conversation', { revive: () => null })];
		const r = revivePanels<DemoPanel>([{ kind: 'conversation', id: 'a' }], decls);
		expect(r.dropped).toBe(1);
	});

	it('default knob validation rejects non-finite numbers (NaN / Infinity)', () => {
		const knobs = [{ key: 'width', default: 480 }];
		const r = revivePanels<DemoPanel>(
			[
				{ kind: 'conversation', id: 'a', width: Number.NaN },
				{ kind: 'conversation', id: 'b', width: Number.POSITIVE_INFINITY }
			],
			[demoDecl('conversation')],
			knobs
		);
		expect(r.panels.map((p) => p.width)).toEqual([480, 480]);
	});

	it('hooks without crossCheckSelected leave selected undefined', () => {
		const r = revivePanels<DemoPanel>([{ kind: 'conversation', id: 'a' }], [demoDecl('conversation')], [], {
			rawSelectedId: 'a'
		});
		expect(r.selected).toBeUndefined();
	});

	it('hooks without rawSelectedId skip the cross-check entirely', () => {
		const r = revivePanels<DemoPanel>([{ kind: 'conversation', id: 'a' }], [demoDecl('conversation')], [], {
			crossCheckSelected: () => 'should-not-run'
		});
		expect(r.selected).toBeUndefined();
	});
});

describe('clampKindWidth — boundary passthrough', () => {
	it('width exactly at either band edge passes through', () => {
		const decl = demoDecl('conversation', { band: () => ({ min: 280, max: 1400 }) });
		expect(clampKindWidth(280, decl)).toBe(280);
		expect(clampKindWidth(1400, decl)).toBe(1400);
	});
});

describe('resizeAllByRegistry — unknown kinds', () => {
	it('a panel whose kind has no declaration keeps identity', () => {
		const decls = [demoDecl('conversation', { resizableByPreset: true })];
		const before: { id: string; kind: string; width: number } = { id: 'x', kind: 'mystery', width: 500 };
		const out = resizeAllByRegistry([before], 900, decls);
		expect(out[0]).toBe(before);
	});
});
