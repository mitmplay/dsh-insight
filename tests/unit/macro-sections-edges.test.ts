/**
 * macro-sections edge tests — the compileRow/isTypedRun arms the grammar
 * table (macro-sections.test.ts) does not hit: isTypedRun's table, the
 * slashBoundaries divergence (Typed Run D2), query sections, blank-only
 * rows, and the parser's passthrough rule per line (D12). Pure, no DOM.
 */
import { describe, expect, it } from 'vitest';
import { compileRow, isTypedRun } from '$lib/services/chat/macro-sections';

describe('isTypedRun — the Typed Run D1 table', () => {
	it('single lines and prose fail, whatever they start with', () => {
		expect(isTypedRun('')).toBe(false);
		expect(isTypedRun('/new')).toBe(false);
		expect(isTypedRun('@session-abc')).toBe(false);
		expect(isTypedRun('?lookup')).toBe(false);
		expect(isTypedRun('just prose')).toBe(false);
	});

	it('blank lines never count and never break the match; CRLF trims', () => {
		expect(isTypedRun('/new\r\n\r\n@session-abc hi\r\n')).toBe(true);
		expect(isTypedRun('\n\n  \n')).toBe(false);
	});

	it('mixed prose+directive and whitespace-prefixed lines fail', () => {
		expect(isTypedRun('hello there\n/new')).toBe(false);
		expect(isTypedRun(' /new\n?q')).toBe(true); // per-line trim absorbs CRLF/space prefixes
	});

	it('every directive prefix passes', () => {
		expect(isTypedRun('/new\n/permission')).toBe(true);
		expect(isTypedRun('@session-a hi\n?shelf q')).toBe(true);
		expect(isTypedRun('  /cmd\n\t@session-a hi\n?q')).toBe(true);
	});
});

describe('compileRow — the uncovered arms', () => {
	it('a blank-only row compiles to an empty list', () => {
		expect(compileRow('')).toEqual([]);
		expect(compileRow('\n\n   \n')).toEqual([]);
	});

	it('? lines are one-line query sections', () => {
		const sections = compileRow('?shelf lookup\nplain after');
		expect(sections).toHaveLength(2);
		expect(sections[0]).toMatchObject({ kind: 'query', display: '?shelf lookup', sendText: '?shelf lookup', lineCount: 1 });
		expect(sections[1].kind).toBe('send-block');
	});

	it('an unrecognized /token line stays literal text without the flag (D12)', () => {
		const sections = compileRow('/usr/bin/python --help\nplain tail');
		expect(sections).toHaveLength(1);
		expect(sections[0].kind).toBe('send-block');
		expect(sections[0].sendText).toBe('/usr/bin/python --help\nplain tail');
	});

	it('slashBoundaries: an unknown /token line becomes its own one-line send (D2)', () => {
		const sections = compileRow('/unknown-token\nplain tail', { slashBoundaries: true });
		expect(sections.map((s) => [s.kind, s.sendText])).toEqual([
			['send-block', '/unknown-token'],
			['send-block', 'plain tail']
		]);
	});

	it('slashBoundaries: an unknown /token line closes a mention message early', () => {
		const sections = compileRow('@session-482e6f9b-aec3-4d63-b841-98f80eab33fb hello\n/unknown\nmore', { slashBoundaries: true });
		expect(sections).toHaveLength(3);
		expect(sections[0]).toMatchObject({ kind: 'mention-block', sendText: 'hello', lineCount: 1 });
		expect(sections[1].sendText).toBe('/unknown');
		expect(sections[2].sendText).toBe('more');
	});

	it('slashBoundaries closes an open send-block at an unknown /token line', () => {
		const sections = compileRow('para one\n/unknown\npara two', { slashBoundaries: true });
		expect(sections.map((s) => s.sendText)).toEqual(['para one', '/unknown', 'para two']);
	});

	it('a mention line with no inline message takes only the tail lines', () => {
		const sections = compileRow('@session-482e6f9b-aec3-4d63-b841-98f80eab33fb\none\ntwo\n\nafter');
		expect(sections).toHaveLength(2);
		expect(sections[0]).toMatchObject({ kind: 'mention-block', sendText: 'one\ntwo', lineCount: 3 });
		expect(sections[1].kind).toBe('send-block');
	});

	it('a mention closes at the next instruction line and the rest recompiles', () => {
		const sections = compileRow('@session-482e6f9b-aec3-4d63-b841-98f80eab33fb hi\n/new @dev\nplain');
		expect(sections.map((s) => s.kind)).toEqual(['mention-block', 'command', 'send-block']);
		expect(sections[0].sendText).toBe('hi');
	});

	it('an a2a signature on the mention line rides a2aId, never sendText', () => {
		const sections = compileRow('@session-482e6f9b-aec3-4d63-b841-98f80eab33fb _a2a_:a2a-c9; hello there');
		expect(sections[0]).toMatchObject({ kind: 'mention-block', a2aId: 'a2a-c9' });
		expect(sections[0].sendText).toBe('hello there');
	});

	it('an invalid command shape is still a one-line command section (D12)', () => {
		const sections = compileRow('/new foo bar');
		expect(sections).toHaveLength(1);
		expect(sections[0]).toMatchObject({ kind: 'command', sendText: '/new foo bar', lineCount: 1 });
	});

	it('interior blanks inside a send-block are paragraph breaks; edge blanks are padding', () => {
		const sections = compileRow('\n  pad  \npara one\n\npara two\n\n/new @dev');
		expect(sections).toHaveLength(2);
		expect(sections[0]).toMatchObject({ kind: 'send-block', display: 'pad', sendText: 'pad\npara one\n\npara two', lineCount: 4 });
	});
});
