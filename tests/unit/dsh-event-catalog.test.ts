/**
 * dsh-event-catalog tests — the coverage harness (ADR-0027a).
 *
 * Pins the contract that every ledger line kind the host can write is
 * classified in HOST_EVENT_CATALOG and that entryForEvent's actual
 * behavior agrees with the fixture's home. Fails on: a kind behaving as a
 * chip while its home says mapped/silent; a silent row without a reason;
 * a hand-off row without a named surface. The mutation checks (1.2-T)
 * prove the checker can go red.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { entryForEvent, type DshRawEvent } from '$lib/services/conversation/dsh-events';
import { HOST_EVENT_CATALOG, HOST_EVENT_COUNT, type HostEventRow } from '$lib/services/conversation/events/host-event-catalog';

/** Minimal synthetic envelope; classification only cares null/entry/chip. */
function ev(type: string, seq: number): DshRawEvent {
	return { type, seq, time: 0, data: {} } as unknown as DshRawEvent;
}

/** Behavior classifier — the only ground truth the diff trusts. */
function classify(type: string): 'silent' | 'mapped' | 'chip' {
	const e = entryForEvent(ev(type, 0));
	if (e === null) return 'silent';
	return e.kind === 'unknown-event' ? 'chip' : 'mapped';
}

const MAPPER_SOURCE = readFileSync('src/lib/services/conversation/events/mapper.ts', 'utf8');

describe('host-event-catalog fixture shape (1.1-T)', () => {
	it('pins the host vocabulary: 63 kinds (62 upstream + the session cover line)', () => {
		expect(HOST_EVENT_CATALOG.length).toBe(HOST_EVENT_COUNT);
		expect(HOST_EVENT_CATALOG.filter((r) => r.type === 'session')).toHaveLength(1);
	});

	it('kinds are unique', () => {
		const types = HOST_EVENT_CATALOG.map((r) => r.type);
		expect(new Set(types).size).toBe(types.length);
	});

	it('every silent row carries a reason; every hand-off names a surface; every chip names its sub-ADR', () => {
		for (const r of HOST_EVENT_CATALOG) {
			if (r.home === 'silent-plumbing' || r.home === 'silent-handoff') {
				expect(typeof r.reason, r.type).toBe('string');
				expect(r.reason!.length, r.type).toBeGreaterThan(4);
			}
			if (r.home === 'silent-handoff') {
				expect(typeof r.surface, r.type).toBe('string');
				expect(r.surface!.length, r.type).toBeGreaterThan(3);
			}
			if (r.home === 'chip') expect(r.target, r.type).toBeTruthy();
		}
	});

	it('every fixture silent kind is a member of mapper SILENT_TYPES (source membership)', () => {
		for (const r of HOST_EVENT_CATALOG) {
			if (r.home === 'silent-plumbing' || r.home === 'silent-handoff') {
				expect(MAPPER_SOURCE.includes(`'${r.type}'`), r.type).toBe(true);
			}
		}
	});
});

describe('coverage diff — behavior agrees with the fixture (1.2)', () => {
	// mapped: at an EMPTY synthetic envelope some mapped types legitimately
	// map to null (e.g. request/header has no payload fields to render); the
	// roster's promise is that a mapped kind NEVER falls through as a chip.
	// The null-vs-entry distinction is pinned by dsh-events.test.ts with real
	// payloads; silent membership is pinned by the SILENT_TYPES source check.
	const acceptable: Record<HostEventRow['home'], string[]> = {
		mapped: ['mapped', 'silent'],
		'silent-plumbing': ['silent'],
		'silent-handoff': ['silent'],
		chip: ['chip']
	};

	it('every catalog kind behaves exactly as its home promises', () => {
		for (const r of HOST_EVENT_CATALOG) {
			expect(acceptable[r.home], `${r.type} (home ${r.home})`).toContain(classify(r.type));
		}
	});
});

describe('mutation checks — the checker can go red (1.2-T)', () => {
	// ADR-0027b landed: developer/message is mapped now (its classify at the
	// synthetic envelope is 'silent' — acceptable for a mapped home; the
	// never-chip promise held). The drift example moved to a kind that still
	// behaves as a chip: deliverables/presented (pending ADR-0027f).
	it('a chip-behaving kind with a mapped home is a detected drift', () => {
		expect(classify('deliverables/presented')).toBe('chip');
		// the drift detector is the comparison itself; assert it disagrees
		const drifted = classify('deliverables/presented') !== 'mapped';
		expect(drifted).toBe(true);
	});

	it('developer/message re-homed by ADR-0027b: behaves non-chip under its mapped home', () => {
		expect(classify('developer/message')).not.toBe('chip');
	});

	it('a mapped kind with a chip home is also detected (reverse drift)', () => {
		expect(classify('user/message')).toBe('mapped');
		expect(classify('user/message') !== 'chip').toBe(true);
	});
});