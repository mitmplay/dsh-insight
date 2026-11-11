/**
 * settings-monaco MARKDOWN PATCH coverage — every branch of
 * modifyMarkdownLanguage (success flip, no language export, no tokenizer,
 * no linecontent array, no matching rule, dynamic-import rejection) plus
 * the import-time patchMarkdownInlineCode chain that installs the patched
 * provider or warns. Same double style as the edges/branches suites, with
 * vi.doMock on the deep markdown.js module swapped per test.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const monacoState = vi.hoisted(() => ({
	setMonarchTokensProvider: vi.fn(),
	setTheme: vi.fn()
}));

vi.mock('monaco-editor', () => ({
	Uri: { parse: (v: string) => ({ toString: () => v }) },
	Range: class {},
	languages: {
		register: vi.fn(),
		getLanguages: () => [],
		setMonarchTokensProvider: monacoState.setMonarchTokensProvider,
		registerFoldingRangeProvider: vi.fn(),
		registerDocumentSymbolProvider: vi.fn(),
		registerLinkProvider: vi.fn(),
		registerCodeActionProvider: vi.fn()
	},
	editor: {
		setModelLanguage: vi.fn(),
		create: vi.fn(),
		createModel: vi.fn(),
		createDiffEditor: vi.fn()
	}
}));

vi.mock('monaco-yaml', () => ({ configureMonacoYaml: vi.fn() }));

vi.mock('$lib/components/monaco/settings-editor-worker?worker', () => ({ default: class {} }));
vi.mock('$lib/components/monaco/settings-ts-worker?worker', () => ({ default: class {} }));
vi.mock('$lib/components/monaco/settings-css-worker?worker', () => ({ default: class {} }));
vi.mock('$lib/components/monaco/settings-html-worker?worker', () => ({ default: class {} }));
vi.mock('$lib/components/monaco/settings-json-worker?worker', () => ({ default: class {} }));
vi.mock('$lib/components/monaco/yaml-worker-entry?worker', () => ({ default: class {} }));

const MARKDOWN_MOD = 'monaco-editor/esm/vs/languages/definitions/markdown/markdown.js';

const MODULE_PATH = '$lib/components/common/settings-monaco';

/** calls to setMonarchTokensProvider for the 'markdown' language only (the mermaid registration also lands here) */
function markdownCalls() {
	return monacoState.setMonarchTokensProvider.mock.calls.filter((c) => c[0] === 'markdown');
}

/** make a stock-looking markdown language export */
function markdownModule(linecontent: unknown[] | undefined, token: string) {
	return {
		language: {
			tokenizer: linecontent ? { linecontent } : undefined
		},
		__token: token
	};
}

const okRule = () => [/`[^`]+`/, 'variable'];

async function loadModule() {
	vi.resetModules();
	const mod = await import(MODULE_PATH);
	// patchMarkdownInlineCode fired at import: flush its async chain
	await new Promise((r) => setTimeout(r, 0));
	await new Promise((r) => setTimeout(r, 0));
	return mod;
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	vi.clearAllMocks();
	warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('modifyMarkdownLanguage branches (via import-time patch)', () => {
	it('a: flips the backtick variable rule and installs the patched provider', async () => {
		vi.doMock(MARKDOWN_MOD, () => markdownModule([okRule()], 'variable'));
		await loadModule();
		expect(markdownCalls()).toHaveLength(1);
		expect(monacoState.setMonarchTokensProvider).toHaveBeenCalledWith(
			'markdown',
			expect.objectContaining({
				tokenizer: { linecontent: [[expect.any(RegExp), 'md.inline.code']] }
			})
		);
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it('b: no language export -> warns no language export', async () => {
		// explicit undefined key: vitest throws on reading a missing mock export
		vi.doMock(MARKDOWN_MOD, () => ({ language: undefined }));
		await loadModule();
		expect(markdownCalls()).toHaveLength(0);
		expect(warnSpy).toHaveBeenCalledWith(
			'[dsi-monaco] markdown inline-code patch skipped:',
			'no language export'
		);
	});

	it('c: no tokenizer -> warns no language export', async () => {
		vi.doMock(MARKDOWN_MOD, () => ({ language: {} }));
		await loadModule();
		expect(markdownCalls()).toHaveLength(0);
		expect(warnSpy).toHaveBeenCalledWith(
			'[dsi-monaco] markdown inline-code patch skipped:',
			'no language export'
		);
	});

	it('d: linecontent not an array -> warns no linecontent', async () => {
		vi.doMock(MARKDOWN_MOD, () => ({
			language: { tokenizer: { linecontent: 'nope' } }
		}));
		await loadModule();
		expect(markdownCalls()).toHaveLength(0);
		expect(warnSpy).toHaveBeenCalledWith(
			'[dsi-monaco] markdown inline-code patch skipped:',
			'no linecontent'
		);
	});

	it('e: no matching backtick/variable rule -> warns rule not found', async () => {
		vi.doMock(MARKDOWN_MOD, () =>
			markdownModule([[/emph/, 'italic'], ['not-an-array', 'variable']], 'variable')
		);
		await loadModule();
		expect(markdownCalls()).toHaveLength(0);
		expect(warnSpy).toHaveBeenCalledWith(
			'[dsi-monaco] markdown inline-code patch skipped:',
			'rule not found'
		);
	});

	it('f: dynamic import rejecting -> caught by modifyMarkdownLanguage, warns skipped (never unhandled)', async () => {
		// a rejecting factory makes the dynamic import itself reject
		vi.doMock(MARKDOWN_MOD, () => Promise.reject(new Error('boom')));
		await loadModule();
		expect(markdownCalls()).toHaveLength(0);
		expect(warnSpy).toHaveBeenCalledWith(
			'[dsi-monaco] markdown inline-code patch skipped:',
			expect.stringMatching(/^Error:/)
		);
	});

	it('g: patched provider install throwing -> the .catch arm warns patch failed (never unhandled)', async () => {
		monacoState.setMonarchTokensProvider.mockImplementation((lang: string) => {
			if (lang === 'markdown') throw new Error('install exploded');
		});
		vi.doMock(MARKDOWN_MOD, () => markdownModule([okRule()], 'variable'));
		await loadModule();
		expect(warnSpy).toHaveBeenCalledWith(
			'[dsi-monaco] markdown inline-code patch failed:',
			expect.objectContaining({ message: 'install exploded' })
		);
	});

	it('f2: a re-export path can be exercised directly — modifyMarkdownLanguage is not exported, so success also reachable via direct import mock', async () => {
		// modifyMarkdownLanguage is module-private; branch (a) already covers
		// its only public surface. This pin keeps the deep-path mock wired.
		vi.doMock(MARKDOWN_MOD, () => markdownModule([okRule(), [/emphasis/, 'emphasis']], 'variable'));
		await loadModule();
		const patched = monacoState.setMonarchTokensProvider.mock.calls.at(-1)?.[1] as {
			tokenizer: { linecontent: unknown[][] };
		};
		expect(patched.tokenizer.linecontent[0]![1]).toBe('md.inline.code');
		expect(patched.tokenizer.linecontent[1]![1]).toBe('emphasis');
	});
});