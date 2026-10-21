/**
 * job-tail-lines unit tests (ADR-0035 D6): line assembly, eviction seam,
 * bounded tail, settle freeze.
 */
import { describe, expect, it } from 'vitest';
import { EVICTION_SEAM, applyFollowEvent, emptyTail, formatCommandLines, explainFollowError } from '../../src/lib/components/terminal/job-tail-lines';

describe('applyFollowEvent', () => {
	it('splits output into lines without duplicating the carried partial', () => {
		let s = emptyTail();
		s = applyFollowEvent(s, { type: 'output', text: 'one', next: 3 });
		s = applyFollowEvent(s, { type: 'output', text: 'two\nthree', next: 9 });
		expect(s.lines).toEqual(['onetwo', 'three']);
	});

	it('inserts one eviction seam on lossy, not two in a row', () => {
		let s = emptyTail();
		s = applyFollowEvent(s, { type: 'output', text: 'a', next: 1 });
		s = applyFollowEvent(s, { type: 'output', text: 'b', next: 2, lossy: true });
		expect(s.lines).toEqual(['a', EVICTION_SEAM, 'b']);
		s = applyFollowEvent(s, { type: 'output', text: 'c', next: 3, lossy: true });
		expect(s.lines).toEqual(['a', EVICTION_SEAM, 'b', EVICTION_SEAM, 'c']); // one seam per lossy frame, never adjacent
	});

	it('freezes at settle with the status word', () => {
		let s = emptyTail();
		s = applyFollowEvent(s, { type: 'output', text: 'x', next: 1 });
		s = applyFollowEvent(s, { type: 'status', job: { id: 'j', kind: 'k', label: 'l', status: 'completed', startedAt: 0, output: { total: 1, earliest: 0 } } });
		expect(s.settled).toBe(true);
		expect(s.status).toBe('completed');
	});

	it('records errors honestly', () => {
		const s = applyFollowEvent(emptyTail(), { type: 'error', code: 'x', message: 'gone' });
		expect(s.error).toBe('x: gone');
	});

	it('bounds the tail', () => {
		let s = emptyTail();
		for (let i = 0; i < 30; i++) s = applyFollowEvent(s, { type: 'output', text: 'L' + i + '\n', next: i }, 10);
		expect(s.lines.length).toBeLessThanOrEqual(10);
		expect(s.lines.filter(Boolean).pop()).toBe('L29');
	});
});

/**
 * formatCommandLines tests (2026-10-21 operator DX): ';'-split one command
 * per line; loop/if blocks read begin / indented body / dedented end.
 */

describe('formatCommandLines', () => {
	it('splits ; separated commands onto their own lines', () => {
		expect(formatCommandLines('npm run build; pnpm test; node scripts/gen.ts')).toEqual([
			'npm run build',
			'pnpm test',
			'node scripts/gen.ts'
		]);
	});

	it('renders a loop as header, indented body, dedented done', () => {
		const lines = formatCommandLines('for f in a b c; do echo $f; wc -l $f; done');
		expect(lines).toEqual([
			'for f in a b c; do',
			'  echo $f',
			'  wc -l $f',
			'done'
		]);
	});

	it('handles if then else fi nesting', () => {
		const lines = formatCommandLines('if test -f x; then cat x; else echo no; fi');
		expect(lines).toEqual([
			'if test -f x; then',
			'  cat x',
			'else',
			'  echo no',
			'fi'
		]);
	});

	it('never returns a negative indent', () => {
		expect(formatCommandLines('done; echo ok')).toEqual(['done', 'echo ok']);
	});
});

describe('formatCommandLines — literal backslash-n escapes', () => {
	it('treats literal backslash-n escapes as line separators (job labels are JSON-escaped)', () => {
		const label = 'for i in 1 2 3 4 5; do\\n echo \"hello\"\\ndone && sleep 5 && echo \"done waiting\"';
		const lines = formatCommandLines(label);
		expect(lines[0]).toBe('for i in 1 2 3 4 5; do');
		expect(lines[1]).toBe('  echo "hello"');
		expect(lines[2]).toBe('done && \\');
		expect(lines[3]).toBe('sleep 5 && \\');
		expect(lines[4]).toBe('echo "done waiting"');
	});
});

describe('formatCommandLines — && chains', () => {
	it('breaks an && chain after a block end into continuation lines with backslashes', () => {
		const lines = formatCommandLines('done && sleep 15 && echo "done waiting"');
		expect(lines).toEqual([
			'done && \\',
			'sleep 15 && \\',
			'echo "done waiting"'
		]);
	});

	it('leaves single commands untouched', () => {
		expect(formatCommandLines('echo hi')).toEqual(['echo hi']);
	});
});

describe('explainFollowError', () => {
	it('maps the host unknown-job error to the honest end state', () => {
		expect(explainFollowError('gateway/internal: unknown job bash-1')).toBe(
			'job record dropped by the host (owner scope disposed) — output unrecoverable'
		);
	});

	it('passes other errors through and keeps null quiet', () => {
		expect(explainFollowError('x: boom')).toBe('follow failed — x: boom');
		expect(explainFollowError(null)).toBeNull();
	});
});
