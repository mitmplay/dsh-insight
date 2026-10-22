/** File Link Intent W1.1-T — pins for the shared predicates (PRD Task 1.1). */
import { describe, expect, it } from 'vitest';
import { isFileLinkHref, normalizeFileLinkPath, parseFileLinkHref, resolveFileLinkPath } from '../../src/lib/utils/file-link';

describe('isFileLinkHref', () => {
	it('accepts scheme-free relative paths', () => {
		expect(isFileLinkHref('deepseek-insight/src/lib/utils/file-link.ts')).toBe(true);
		expect(isFileLinkHref('src/a.ts#L153')).toBe(true);
		expect(isFileLinkHref('./src/a.ts')).toBe(true);
		expect(isFileLinkHref('/workspace/src/a.ts')).toBe(true);
	});
	it('refuses external and scheme-carrying hrefs', () => {
		expect(isFileLinkHref('https://example.com/x')).toBe(false);
		expect(isFileLinkHref('http://example.com')).toBe(false);
		expect(isFileLinkHref('javascript:alert(1)')).toBe(false);
		expect(isFileLinkHref('data:text/html,x')).toBe(false);
		expect(isFileLinkHref('mailto:a@b.c')).toBe(false);
		expect(isFileLinkHref('//evil.example/x')).toBe(false);
	});
	it('refuses DSI own capability surface', () => {
		expect(isFileLinkHref('/api/dsh/sessions')).toBe(false);
	});
	it('refuses empty', () => {
		expect(isFileLinkHref('')).toBe(false);
		expect(isFileLinkHref('   ')).toBe(false);
	});
});

describe('normalizeFileLinkPath', () => {
	it('strips ./ prefix, leading slash, collapses duplicate slashes', () => {
		expect(normalizeFileLinkPath('./src/a.ts')).toBe('src/a.ts');
		expect(normalizeFileLinkPath('/workspace/src/a.ts')).toBe('workspace/src/a.ts');
		expect(normalizeFileLinkPath('src//a.ts')).toBe('src/a.ts');
		expect(normalizeFileLinkPath('deepseek-insight/src/a.ts#L153')).toBe('deepseek-insight/src/a.ts');
		// ADR-0028: the colon anchor never reaches the host read either.
		expect(normalizeFileLinkPath('deepseek-insight/src/a.ts:153')).toBe('deepseek-insight/src/a.ts');
		expect(normalizeFileLinkPath('deepseek-insight/src/a.ts:10-20')).toBe('deepseek-insight/src/a.ts');
	});
	it('refuses workspace escapes with null', () => {
		expect(normalizeFileLinkPath('../secrets')).toBeNull();
		expect(normalizeFileLinkPath('src/../../../etc/passwd')).toBeNull();
	});
	it('refuses empty results', () => {
		expect(normalizeFileLinkPath('./')).toBeNull();
		expect(normalizeFileLinkPath('')).toBeNull();
	});
	describe('parseFileLinkHref', () => {
		it('splits a single #L anchor into path + line', () => {
			const r = parseFileLinkHref('src/lib/components/terminal/TerminalDesk.svelte#L139');
			expect(r.path).toBe('src/lib/components/terminal/TerminalDesk.svelte');
			expect(r.lines).toEqual({ start: 139, end: 139 });
		});
		it('parses a #L range anchor', () => {
			const r = parseFileLinkHref('src/a.ts#L10-L20');
			expect(r.lines).toEqual({ start: 10, end: 20 });
		});
		it('returns null lines without an anchor or on a malformed one', () => {
			expect(parseFileLinkHref('src/a.ts').lines).toBeNull();
			expect(parseFileLinkHref('src/a.ts#fragment').lines).toBeNull();
			expect(parseFileLinkHref('src/a.ts#L0').lines).toBeNull();
			expect(parseFileLinkHref('src/a.ts#L20-L10').lines).toBeNull();
		});
		it('normalizes the path part', () => {
			expect(parseFileLinkHref('./src//a.ts#L3').path).toBe('src/a.ts');
		});
		// ADR-0028 The Colon Anchor: IDE-style :line suffixes split the same
		// way as hash anchors — digits-only tail after the LAST colon.
		it('splits a single :line suffix into path + line', () => {
			const r = parseFileLinkHref('deepseek-insight/src/lib/utils/turn-grouping.ts:334');
			expect(r.path).toBe('deepseek-insight/src/lib/utils/turn-grouping.ts');
			expect(r.lines).toEqual({ start: 334, end: 334 });
		});
		it('parses a :line-line suffix', () => {
			const r = parseFileLinkHref('src/a.ts:10-20');
			expect(r.path).toBe('src/a.ts');
			expect(r.lines).toEqual({ start: 10, end: 20 });
		});
		it('keeps the colon on malformed or non-digit tails (never guesses)', () => {
			expect(parseFileLinkHref('src/a.ts:0').lines).toBeNull();
			expect(parseFileLinkHref('src/a.ts:0').path).toBe('src/a.ts:0');
			expect(parseFileLinkHref('src/a.ts:20-10').lines).toBeNull();
			expect(parseFileLinkHref('src/a.ts:20-10').path).toBe('src/a.ts:20-10');
			expect(parseFileLinkHref('a:b/c.ts').lines).toBeNull();
			expect(parseFileLinkHref('a:b/c.ts').path).toBe('a:b/c.ts');
			expect(parseFileLinkHref('c.ts:x1').path).toBe('c.ts:x1');
		});
	});
});

describe('resolveFileLinkPath (Fullpath Bow ADR 2026-09-26 D1)', () => {
	it('strips the absolute workspace-root prefix', () => {
		expect(
			resolveFileLinkPath('/Users/op/agentic-ai/deepseek-insight/src/lib/app.ts', '/Users/op/agentic-ai/deepseek-insight')
		).toBe('src/lib/app.ts');
	});
	it('strips the root basename folder prefix', () => {
		expect(resolveFileLinkPath('deepseek-insight/src/lib/app.ts', '/Users/op/agentic-ai/deepseek-insight')).toBe(
			'src/lib/app.ts'
		);
	});
	it('keeps an already workspace-relative path as-is', () => {
		expect(resolveFileLinkPath('src/lib/app.ts', '/Users/op/agentic-ai/deepseek-insight')).toBe('src/lib/app.ts');
	});
	it('resolves as-is on a blank root', () => {
		expect(resolveFileLinkPath('deepseek-insight/src/a.ts', null)).toBe('deepseek-insight/src/a.ts');
		expect(resolveFileLinkPath('deepseek-insight/src/a.ts', '')).toBe('deepseek-insight/src/a.ts');
	});
	it('tolerates a trailing slash on the root', () => {
		expect(resolveFileLinkPath('/ws/deepseek-insight/src/a.ts', '/ws/deepseek-insight/')).toBe('src/a.ts');
	});
	it('never returns an empty string — equal to root falls back to the input', () => {
		expect(resolveFileLinkPath('/ws/dsi', '/ws/dsi')).toBe('/ws/dsi');
	});
	it('does not let a basename prefix eat a dot-segment lookalike', () => {
		// a folder literally named 'deepseek-insight.something' is NOT the root basename
		expect(resolveFileLinkPath('deepseek-insight.old/src/a.ts', '/ws/deepseek-insight')).toBe(
			'deepseek-insight.old/src/a.ts'
		);
	});
});

describe('resolveFileLinkPath — the operator regression (2026-09-26 RCA)', () => {
	it('an expanded absolute link resolves against an UNEXPANDED tilde root', () => {
		expect(
			resolveFileLinkPath(
				'/Users/wharsojo/agentic-ai/deepseek-insight/dev/rename-audit-2026-09-26.md',
				'~/agentic-ai'
			)
		).toBe('deepseek-insight/dev/rename-audit-2026-09-26.md');
	});
	it('an absolute link resolves against the expanded root', () => {
		expect(
			resolveFileLinkPath('/Users/wharsojo/agentic-ai/dev/notes.md', '/Users/wharsojo/agentic-ai')
		).toBe('dev/notes.md');
	});
	it('segment boundary holds — agentic-ai-notes never matches root basename', () => {
		expect(
			resolveFileLinkPath('/Users/x/agentic-ai-notes/a.md', '~/agentic-ai')
		).toBe('Users/x/agentic-ai-notes/a.md');
	});
});
