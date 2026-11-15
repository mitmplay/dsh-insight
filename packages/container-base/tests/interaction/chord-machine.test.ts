import { describe, expect, it } from 'vitest';
import {
	CHORD_WINDOW_MS,
	IDLE_CHORD,
	chordKey,
	decideChordKeydown,
	hasAnyPreset,
	isEditableTarget,
	type ChordState,
	type ChordKey as CKey,
	type ChordTables
} from '../../src/index';

function key(k: string, o: Partial<CKey> = {}): CKey {
	return { key: k, altKey: false, ctrlKey: false, metaKey: false, type: 'keydown', ...o };
}
function armed(prefix: 's' | 't', since = 1000): ChordState {
	return { armed: true, since, prefix };
}
const T: ChordTables = {
	verbs: 'abcgknpstw',
	terminalPrefix: 't',
	terminal: { t: 'term-new-tab', s: 'term-split-down', c: 'term-clear-tab' }
};

describe('chord-machine — arm / decay / dispatch (W5 5.1-T)', () => {
	it('arms on Alt+S keydown; keyup passes; cannot-arm is a no-op', () => {
		const r1 = chordKey(IDLE_CHORD, key('s', { altKey: true, type: 'keydown' }), true, 1000, T);
		expect(r1.state).toEqual({ armed: true, since: 1000, prefix: 's' });
		const r0 = chordKey(IDLE_CHORD, key('s', { altKey: true, type: 'keyup' }), true, 1000, T);
		expect(r0.action).toEqual({ type: 'none' });
		const r2 = chordKey(IDLE_CHORD, key('s', { altKey: true, type: 'keydown' }), false, 1000, T);
		expect(r2.action).toEqual({ type: 'none' });
	});

	it('macOS Alt remap: code wins over key', () => {
		const r = chordKey(IDLE_CHORD, key('ß', { code: 'KeyS', altKey: true, type: 'keydown' }), true, 1000, T);
		expect(r.state.armed).toBe(true);
		expect(r.state.prefix).toBe('s');
	});

	it('decay window expiry disarms mid-chord; inside the window still fires', () => {
		const a = armed('s');
		const late = chordKey(a, key('1'), true, 1000 + CHORD_WINDOW_MS + 1, T);
		expect(late.action).toEqual({ type: 'disarm' });
		const early = chordKey(a, key('1'), true, 1000 + CHORD_WINDOW_MS - 1, T);
		expect(early.action).toEqual({ type: 'apply', n: 1 });
	});

	it('editable pass-through lives in the WIRING contract: un-armed digit passes (preventDefault false)', () => {
		const res = decideChordKeydown(IDLE_CHORD, key('1'), true, 1000, T);
		expect(res.preventDefault).toBe(false);
		expect(isEditableTarget({ closest: () => null })).toBe(false);
		expect(isEditableTarget({ closest: (sel: string) => (sel.includes('input') ? {} : null) })).toBe(true);
	});

	it('last prefix wins: Alt+S then Alt+T inside the window re-arms as t', () => {
		const r = chordKey(armed('s'), key('t', { altKey: true, type: 'keydown' }), true, 1100, T);
		expect(r.state).toEqual({ armed: true, since: 1100, prefix: 't' });
		expect(r.action).toEqual({ type: 'none' });
	});

	it('re-arm refreshes the window clock', () => {
		const r = chordKey(armed('s', 1000), key('s', { altKey: true, type: 'keydown' }), true, 2500, T);
		expect(r.state.since).toBe(2500);
	});

	it('verb letters dispatch through the CONSUMER TABLE — empty table disarms (D5)', () => {
		const withT = chordKey(armed('s'), key('b'), true, 1200, T);
		expect(withT.action).toEqual({ type: 'verb', verb: 'b', prefix: 's' });
		const bare = chordKey(armed('s'), key('b'), true, 1200);
		expect(bare.action).toEqual({ type: 'disarm' }); // no table, no verbs
		expect(chordKey(armed('s'), key('q'), true, 1200, T).action).toEqual({ type: 'disarm' });
	});

	it('terminal prefix maps letters through the terminal table; unmapped disarms', () => {
		const t = chordKey(armed('t'), key('t'), true, 1200, T);
		expect(t.action).toEqual({ type: 'verb', verb: 'term-new-tab', prefix: 't' });
		const s = chordKey(armed('t'), key('s'), true, 1200, T);
		expect(s.action).toEqual({ type: 'verb', verb: 'term-split-down', prefix: 't' });
		const c = chordKey(armed('t'), key('c'), true, 1200, T);
		expect(c.action).toEqual({ type: 'verb', verb: 'term-clear-tab', prefix: 't' });
		const x = chordKey(armed('t'), key('a'), true, 1200, T);
		expect(x.action).toEqual({ type: 'disarm' });
	});

	it('capture-first: armed chord swallows the next keydown; keyups pass', () => {
		const res = decideChordKeydown(armed('s'), key('1'), true, 1500, T);
		expect(res.preventDefault).toBe(true);
		expect(res.action).toEqual({ type: 'apply', n: 1 });
		const ku = decideChordKeydown(armed('s'), key('1', { type: 'keyup' }), true, 1500, T);
		expect(ku.preventDefault).toBe(false);
	});

	it('hasAnyPreset gates arming facts', () => {
		expect(hasAnyPreset({ agent: { 1: 1 }, glass: {}, sidebar: {} })).toBe(true);
		expect(hasAnyPreset({ agent: {}, glass: {}, sidebar: {}, zoom: { 2: 2 } })).toBe(true);
		expect(hasAnyPreset({ agent: {}, glass: {}, sidebar: {} })).toBe(false);
	});
});
