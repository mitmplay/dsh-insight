import { describe, expect, it } from 'vitest';
import { clampKindWidth, definePanelKind, revivePanels } from '../../src/registry/panel-kinds';
import { createPrefsStore } from '../../src/storage/create-prefs-store';

/**
 * 2.1-T (Container Base R8, ADR-0070 D10) — the tray journey rides the
 * demoKind revive path: upstairs/resting/junk/absent all resolve honestly,
 * and a save roundtrip keeps the fact. No pg-tray_* key exists anywhere.
 */

type Journey = 'upstairs' | 'resting';

const demoKind = definePanelKind({
	kind: 'demo-pane',
	requiredKeys: (entry) => typeof entry['id'] === 'string',
	// mirrors the playground +page.svelte declaration verbatim
	revive: (entry) => ({
		id: entry['id'] as string,
		width: entry['width'] as number | undefined,
		journey: entry['journey'] === 'upstairs' ? ('upstairs' as const) : ('resting' as const)
	}),
	laneDefaultWidth: 730,
	band: () => ({ min: 280, max: 1400 }),
	persisted: true
});
const widthKnob = { key: 'width', default: 730, clamp: (w: number) => clampKindWidth(w, demoKind) };

function revive(panels: unknown): { id: string; journey: Journey }[] {
	const result = revivePanels<{ id: string; kind: string; width: number; journey: Journey }>(
		panels,
		[demoKind],
		[widthKnob],
		{ rawSelectedId: null, crossCheckSelected: () => null }
	);
	return result.panels.map((p) => ({ id: p.id, journey: p.journey }));
}

describe('journey revive through the demoKind declaration (2.1-T)', () => {
	it('reads journey: upstairs', () => {
		expect(revive([{ id: 'notes', kind: 'demo-pane', journey: 'upstairs' }])).toEqual([
			{ id: 'notes', journey: 'upstairs' }
		]);
	});

	it('reads journey: resting', () => {
		expect(revive([{ id: 'notes', kind: 'demo-pane', journey: 'resting' }])).toEqual([
			{ id: 'notes', journey: 'resting' }
		]);
	});

	it('JUNK journey value falls back to resting honestly', () => {
		expect(revive([{ id: 'notes', kind: 'demo-pane', journey: 'basement' }])).toEqual([
			{ id: 'notes', journey: 'resting' }
		]);
	});

	it('ABSENT journey value falls back to resting (pre-R8 blobs stay valid)', () => {
		expect(revive([{ id: 'notes', kind: 'demo-pane', width: 730 }])).toEqual([
			{ id: 'notes', journey: 'resting' }
		]);
	});

	it('save roundtrip keeps the fact through a prefs store', () => {
		const store = createPrefsStore<{ panels: { id: string; kind: string; journey: Journey }[] }>({
			key: 'pg-panels',
			defaults: () => ({ panels: [] }),
			revive: (raw) => {
				const rec = raw as { panels?: unknown };
				if (!Array.isArray(rec.panels)) return null;
				return { panels: revive(rec.panels) };
			}
		});
		store.save({ panels: [{ id: 'notes', kind: 'demo-pane', journey: 'upstairs' }] });
		const back = store.load();
		expect(back.panels).toEqual([{ id: 'notes', journey: 'upstairs' }]);
	});

	it('no pg-tray key exists in the declaration surface (D10 hard rule)', () => {
		const kinds = JSON.stringify([demoKind]);
		expect(kinds).not.toContain('pg-tray');
	});
});
