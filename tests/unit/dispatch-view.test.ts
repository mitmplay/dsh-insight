/**
 * Wave 2 (task 2.1-T): dispatch-view rebuild (ADR D3/D4, 2026-09-05).
 * Content fixtures pinned from session 7ec16d54's settled read dispatches
 * (the `<path>/<type>/<content>` envelope around `N: text` lines).
 */
import { describe, expect, it } from 'vitest';
import { buildDispatchReadView, buildEditWriteView, dispatchRendererKey } from '$lib/utils/dispatch-view';

const MD_CONTENT =
	'<path>/Users/wharsojo/openclaw-insight/PREREQUISITES.md</path>\n' +
	'<type>file</type>\n' +
	'<content>\n' +
	'1: # PREREQUISITES.md — Setup Checklist\n' +
	'2: \n' +
	'3: > Check here first.\n' +
	'4: \n' +
	'5: ---\n' +
	'6: \n' +
	'7: ## Browser Automation\n' +
	'8: \n' +
	'9: ```json\n' +
	"10: { \"browser\": { \"enabled\": true } }\n" +
	'11: ```';

const args = (path: string): string => JSON.stringify({ file_path: path, limit: 60 });

describe('buildDispatchReadView', () => {
	it('rebuilds a markdown view from the real envelope projection', () => {
		const view = buildDispatchReadView(args('/Users/wharsojo/openclaw-insight/PREREQUISITES.md'), MD_CONTENT);
		expect(view).toBeDefined();
		expect(view!.path).toBe('/Users/wharsojo/openclaw-insight/PREREQUISITES.md');
		expect(view!.lang).toBe('md');
		expect(view!.offset).toBe(1);
		expect(view!.totalLines).toBe(11);
		expect(view!.lines).toHaveLength(11);
		expect(view!.lines[0]).toEqual({ number: 1, text: '# PREREQUISITES.md — Setup Checklist' });
		// The file's own `---` rule (line 5) survives verbatim — no separator
		// convention could have told it apart from anything.
		expect(view!.lines[4]).toEqual({ number: 5, text: '---' });
	});

	it('derives a code lang for .ts and keeps gutter-free text', () => {
		const view = buildDispatchReadView(
			args('/x/code-programs.ts'),
			'<path>/x/code-programs.ts</path>\n<type>file</type>\n<content>\n41: export function parse(): void {\n42: \treturn;\n43: }'
		);
		expect(view!.lang).toBe('ts');
		expect(view!.lines[1]).toEqual({ number: 42, text: '\treturn;' });
		expect(view!.totalLines).toBe(43);
	});

	it('uses the LAST dotted segment — multi-dot filenames stay code (regression: session 7ec16d54, message-images.test.ts rendered plain)', () => {
		const view = buildDispatchReadView(
			args('/Users/wharsojo/agentic-ai/deepseek-insight/tests/unit/message-images.test.ts'),
			'<path>/Users/wharsojo/agentic-ai/deepseek-insight/tests/unit/message-images.test.ts</path>\n<type>file</type>\n<content>\n1: /**\n2:  * MessageImages (task 3.4-T): the gallery.'
		);
		expect(view!.lang).toBe('ts'); // not "test.ts" — the first-dot capture bug
	});

	it('spec/config suffixes also resolve to their real language', () => {
		expect(buildDispatchReadView(args('/x/a.spec.js'), '<path>/x/a.spec.js</path>\n<content>\n1: x')!.lang).toBe('js');
		expect(buildDispatchReadView(args('/x/vite.config.mjs'), '<path>/x/vite.config.mjs</path>\n<content>\n1: x')!.lang).toBe('mjs'); // hljs knows mjs directly
		expect(buildDispatchReadView(args('/x/notes.d.md'), '<path>/x/notes.d.md</path>\n<content>\n1: x')!.lang).toBe('md');
	});

	it('carries the window offset from the first line number', () => {
		const view = buildDispatchReadView(
			args('/x/big.md'),
			'<path>/x/big.md</path>\n<type>file</type>\n<content>\n61: mid file\n62: more'
		);
		expect(view!.offset).toBe(61);
		expect(view!.totalLines).toBe(62);
	});

	it('passes unnumbered lines through with sequential fallback numbers', () => {
		const view = buildDispatchReadView(args('/x/plain.txt'), 'alpha\nbeta');
		expect(view!.lang).toBeUndefined(); // txt maps to no known language
		expect(view!.lines).toEqual([
			{ number: 1, text: 'alpha' },
			{ number: 2, text: 'beta' }
		]);
	});

	it('declines on missing file_path, junk args, or empty content', () => {
		expect(buildDispatchReadView(undefined, MD_CONTENT)).toBeUndefined();
		expect(buildDispatchReadView(args('/x/a.md'), undefined)).toBeUndefined();
		expect(buildDispatchReadView('{not json', 'x')).toBeUndefined();
		expect(buildDispatchReadView(JSON.stringify({ limit: 10 }), 'x')).toBeUndefined();
	});

	it('declines on content that is only the envelope header', () => {
		expect(buildDispatchReadView(args('/x/a.md'), '<path>/x/a.md</path>\n<type>file</type>')).toBeUndefined();
	});
});

describe('dispatchRendererKey', () => {
	it('maps tool names to the native chip families', () => {
		expect(dispatchRendererKey('read')).toBe('file');
		expect(dispatchRendererKey('bash')).toBe('terminal');
		expect(dispatchRendererKey('pwsh')).toBe('terminal');
	});

	it('falls back to generic for unknown tools — never guesses', () => {
		expect(dispatchRendererKey('grep')).toBe('generic');
		expect(dispatchRendererKey('brand_new_tool')).toBe('generic');
	});
});

/* ─── D7 (ADR-0077 Amendment 3): the structured edit/write view ─── */

describe('buildEditWriteView — the structured edit/write view (D7)', () => {
	it('edit args: path + small params + new_string with real newlines preserved', () => {
		const argsRaw = JSON.stringify({
			file_path: '/a/b/code-programs.ts',
			old_string: 'const old = 1;',
			new_string: 'const new = 2;\nconst newer = 3;'
		});
		const v = buildEditWriteView(argsRaw, 'edit');
		expect(v?.tool).toBe('edit');
		expect(v?.valueKey).toBe('new_string');
		expect(v?.value).toBe('const new = 2;\nconst newer = 3;');
		expect(v?.params.map((p) => p.label)).toEqual(['file_path', 'old_string']);
		expect(v?.params[0]?.value).toBe('/a/b/code-programs.ts'); // full path — the card basenames it for display
	});

	it('write args: content value; description rides as a small param', () => {
		const v = buildEditWriteView(JSON.stringify({ file_path: '/f.md', description: 'note', content: '# Title\n\nBody' }), 'write');
		expect(v?.valueKey).toBe('content');
		expect(v?.value).toBe('# Title\n\nBody');
		expect(v?.params.map((p) => p.label)).toEqual(['file_path', 'description']);
	});

	it('old_string over 80 chars is truncated for a glance', () => {
		const v = buildEditWriteView(JSON.stringify({ file_path: '/f', old_string: 'x'.repeat(120), new_string: 'y' }), 'edit');
		expect(v?.params.find((p) => p.label === 'old_string')?.value.endsWith('…')).toBe(true);
	});

	it('junk, non-family, and missing-value args return undefined, no throw', () => {
		expect(buildEditWriteView('{not json', 'edit')).toBeUndefined();
		expect(buildEditWriteView('[]', 'write')).toBeUndefined();
		expect(buildEditWriteView(undefined, 'edit')).toBeUndefined();
		expect(buildEditWriteView(JSON.stringify({ file_path: '/f' }), 'edit')).toBeUndefined(); // no value key
		expect(buildEditWriteView(JSON.stringify({ file_path: '/f', content: 'x' }), 'read')).toBeUndefined(); // non-family tool
		expect(() => buildEditWriteView(JSON.stringify({ new_string: 5 }), 'edit')).not.toThrow(); // non-string value
	});
});
