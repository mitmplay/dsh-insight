/**
 * settings-monaco branch tests — drives the boolean arms the main glue
 * test never reaches:
 *  - monacoThemeFor: the 'dark' ternary arm (L31) and null/undefined inputs
 *  - applyThemeFromDocument: the setTheme-is-a-function arm (L36) with the
 *    document's data-theme read (L37, defined arm)
 *  - the module-load MutationObserver guard (L40): the observer-missing arm
 * Runs with the same recording doubles as tests/unit/settings-monaco.test.ts.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const monacoState = vi.hoisted(() => ({
	createCalls: [] as Array<{ container: HTMLElement; options: Record<string, unknown> }>,
	editors: [] as Array<{ value: string }>,
	models: [] as Array<{ value: string; disposed: boolean }>,
	modelLanguages: [] as string[],
	diffs: [] as Array<{ model: unknown; disposed: boolean }>,
	diffCalls: [] as Array<{ container: HTMLElement; options: Record<string, unknown> }>,
	ranges: [] as Array<{ start: number; end: number }>
}));

vi.mock('monaco-editor', () => ({
	Uri: { parse: (v: string) => ({ toString: () => v }) },
	languages: {
		registerFoldingRangeProvider: vi.fn(),
		registerDocumentSymbolProvider: vi.fn(),
		registerLinkProvider: vi.fn(),
		registerCodeActionProvider: vi.fn()
	},
	Range: class {
		constructor(start: number, _a: number, end: number, _b: number) {
			monacoState.ranges.push({ start, end });
		}
	},
	editor: {
		// NOTE: deliberately NO setTheme — tests that need it attach one.
		create: (container: HTMLElement, options: Record<string, unknown>) => {
			const editor = {
				value: options.value as string,
				onDidChangeModelContent: () => ({ dispose: () => {} }),
				getValue: () => editor.value,
				setValue: (t: string) => (editor.value = t),
				getModel: () => null,
				createDecorationsCollection: () => ({ set: () => {} }),
				revealLinesInCenter: () => {},
				dispose: () => {}
			};
			monacoState.createCalls.push({ container, options });
			monacoState.editors.push(editor);
			return editor;
		},
		createModel: (value: string, _language: string) => {
			const model = { value, disposed: false, dispose: () => (model.disposed = true) };
			monacoState.models.push(model);
			monacoState.modelLanguages.push(_language);
			return model;
		},
		createDiffEditor: (container: HTMLElement, options: Record<string, unknown>) => {
			const diff = { model: null as unknown, disposed: false };
			monacoState.diffs.push(diff);
			monacoState.diffCalls.push({ container, options });
			return {
				setModel(m: unknown) {
					diff.model = m;
				},
				dispose() {
					diff.disposed = true;
				}
			};
		}
	}
}));

vi.mock('monaco-yaml', () => ({ configureMonacoYaml: vi.fn() }));

const { workerTags } = vi.hoisted(() => ({ workerTags: [] as string[] }));
function makeWorker(tag: string) {
	return class {
		tag: string;
		constructor() {
			this.tag = tag;
			workerTags.push(tag);
		}
	};
}

vi.mock('$lib/components/monaco/settings-editor-worker?worker', () => ({ default: makeWorker('editor') }));
vi.mock('$lib/components/monaco/settings-ts-worker?worker', () => ({ default: makeWorker('ts') }));
vi.mock('$lib/components/monaco/settings-css-worker?worker', () => ({ default: makeWorker('css') }));
vi.mock('$lib/components/monaco/settings-html-worker?worker', () => ({ default: makeWorker('html') }));
vi.mock('$lib/components/monaco/settings-json-worker?worker', () => ({ default: makeWorker('json') }));
vi.mock('$lib/components/monaco/yaml-worker-entry?worker', () => ({ default: makeWorker('yaml') }));

import * as monaco from 'monaco-editor';
import { monacoThemeFor, createYamlEditor, createDiffEditor } from '$lib/components/monaco/settings-monaco';

beforeEach(() => {
	for (const arr of [monacoState.createCalls, monacoState.editors, monacoState.models, monacoState.modelLanguages, monacoState.diffs, monacoState.diffCalls, monacoState.ranges]) {
		arr.length = 0;
	}
	workerTags.length = 0;
	document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
});

describe('monacoThemeFor (the Three-State Lamp mapping, L30-32)', () => {
	it("maps 'dark' to vs-dark — the ternary's true arm", () => {
		expect(monacoThemeFor('dark')).toBe('vs-dark');
	});

	it('maps every non-dark value to vs (false arm)', () => {
		expect(monacoThemeFor('light')).toBe('vs');
		expect(monacoThemeFor('')).toBe('vs');
	});

	it('treats missing attribute (null / undefined) as light', () => {
		expect(monacoThemeFor(null)).toBe('vs');
		expect(monacoThemeFor(undefined)).toBe('vs');
	});
});

describe('applyThemeFromDocument module-load arms (L35-39)', () => {
	function freshImport() {
		return import('$lib/components/monaco/settings-monaco');
	}

	it('applies the dark theme when setTheme exists and data-theme is dark (true arms of L36 + L37)', async () => {
		const setTheme = vi.fn();
		(monaco.editor as unknown as { setTheme: unknown }).setTheme = setTheme;
		document.documentElement.dataset.theme = 'dark';
		vi.resetModules();
		await freshImport();
		expect(setTheme).toHaveBeenCalledWith('vs-dark');
	});

	it('applies the light theme when data-theme is absent', async () => {
		const setTheme = vi.fn();
		(monaco.editor as unknown as { setTheme: unknown }).setTheme = setTheme;
		vi.resetModules();
		await freshImport();
		expect(setTheme).toHaveBeenCalledWith('vs');
	});

	it('skips theme application when the monaco stub has no setTheme (guard true arm, L36)', async () => {
		delete (monaco.editor as unknown as { setTheme?: unknown }).setTheme;
		document.documentElement.dataset.theme = 'dark';
		vi.resetModules();
		await expect(freshImport()).resolves.toBeTruthy();
	});
});

describe('module-load MutationObserver guard (L40)', () => {
	it('survives the module load when MutationObserver is unavailable (false arm)', async () => {
		vi.stubGlobal('MutationObserver', undefined);
		vi.resetModules();
		await expect(import('$lib/components/monaco/settings-monaco')).resolves.toBeTruthy();
	});
});

describe('glue option fallbacks re-driven in isolation (L160 / L256 / L267)', () => {
	it('createYamlEditor with readOnly: false passes false through the === true arm (L160)', () => {
		createYamlEditor(document.createElement('div'), 'k: v', () => {}, { readOnly: false });
		expect(monacoState.createCalls[0]!.options.readOnly).toBe(false);
	});

	it('createDiffEditor honors an explicit language (?? taken-from arm, L256)', () => {
		createDiffEditor(document.createElement('div'), 'a', 'b', { language: 'typescript' });
		// language rides createModel, not the widget options (L256 ?? arm)
		expect(monacoState.modelLanguages[0]).toBe('typescript');
		expect(monacoState.diffs[0]!.model).toBeTruthy();
	});

	it('createDiffEditor dispose releases models after the widget (ordering)', () => {
		const handle = createDiffEditor(document.createElement('div'), 'a', 'b', { readOnly: true });
		handle.dispose();
		expect(monacoState.diffs[0]!.model).toBeNull();
		expect(monacoState.diffs[0]!.disposed).toBe(true);
		expect(monacoState.models.every((m) => m.disposed)).toBe(true);
	});
});
