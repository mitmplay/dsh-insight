/**
 * settings-monaco EDGE tests — the branches tests/unit/settings-monaco.test.ts
 * does not reach: the theme seam (monacoThemeFor both sides, module-load
 * applyThemeFromDocument with a real setTheme, the MutationObserver
 * data-theme watcher) and the yaml prewarm model's delayed dispose.
 * Same double style as the main suite: mock monaco-editor/monaco-yaml and
 * the ?worker imports, exercise the real glue.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const monacoState = vi.hoisted(() => ({
	setTheme: vi.fn(),
	createCalls: [] as Array<{ container: HTMLElement; options: Record<string, unknown> }>,
	editors: [] as Array<{ onChange: () => void; disposed: boolean; subDisposed: boolean }>,
	models: [] as Array<{ value: string; disposed: boolean }>,
	diffCalls: [] as Array<{ options: Record<string, unknown> }>,
	diffs: [] as Array<{ model: unknown; disposed: boolean }>
}));

vi.mock('monaco-editor', () => ({
	Uri: { parse: (v: string) => ({ toString: () => v }) },
	Range: class {},
	languages: {
		registerFoldingRangeProvider: vi.fn(),
		registerDocumentSymbolProvider: vi.fn(),
		registerLinkProvider: vi.fn(),
		registerCodeActionProvider: vi.fn()
	},
	editor: {
		// setTheme PRESENT here: flips the guarded branch in
		// applyThemeFromDocument the main suite's mock (no setTheme) skips.
		setTheme: monacoState.setTheme,
		create: (container: HTMLElement, options: Record<string, unknown>) => {
			const editor = {
				onChange: () => {},
				disposed: false,
				subDisposed: false,
				onDidChangeModelContent(cb: () => void) {
					editor.onChange = cb;
					return { dispose: () => (editor.subDisposed = true) };
				},
				getValue: () => '',
				setValue: () => {},
				getModel: () => null,
				createDecorationsCollection: () => ({ set: () => {} }),
				revealLinesInCenter: () => {},
				dispose: () => (editor.disposed = true)
			};
			monacoState.createCalls.push({ container, options });
			monacoState.editors.push(editor);
			return editor;
		},
		createModel: (value: string, _language: string) => {
			const model = { value, disposed: false, dispose: () => (model.disposed = true) };
			monacoState.models.push(model);
			return model;
		},
		createDiffEditor: (_c: HTMLElement, options: Record<string, unknown>) => {
			const diff = { model: null as unknown, disposed: false };
			monacoState.diffCalls.push({ options });
			monacoState.diffs.push(diff);
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

vi.mock('$lib/components/monaco/settings-editor-worker?worker', () => ({ default: class {} }));
vi.mock('$lib/components/monaco/settings-ts-worker?worker', () => ({ default: class {} }));
vi.mock('$lib/components/monaco/settings-css-worker?worker', () => ({ default: class {} }));
vi.mock('$lib/components/monaco/settings-html-worker?worker', () => ({ default: class {} }));
vi.mock('$lib/components/monaco/settings-json-worker?worker', () => ({ default: class {} }));
vi.mock('$lib/components/monaco/yaml-worker-entry?worker', () => ({ default: class {} }));

import { monacoThemeFor, createYamlEditor, createTextEditor } from '$lib/components/monaco/settings-monaco';

const htmlEl = document.documentElement;

beforeEach(() => {
	monacoState.createCalls.length = 0;
	monacoState.editors.length = 0;
	monacoState.models.length = 0;
	monacoState.diffCalls.length = 0;
	monacoState.diffs.length = 0;
	monacoState.setTheme.mockClear();
	htmlEl.removeAttribute('data-theme');
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('monacoThemeFor mapping', () => {
	it('maps dark to vs-dark and everything else to vs', () => {
		expect(monacoThemeFor('dark')).toBe('vs-dark');
		expect(monacoThemeFor('light')).toBe('vs');
		expect(monacoThemeFor(null)).toBe('vs');
		expect(monacoThemeFor(undefined)).toBe('vs');
	});
});

describe('module-load theme application (setTheme present)', () => {
	it('applies the document theme through monaco.editor.setTheme on load', async () => {
		htmlEl.setAttribute('data-theme', 'dark');
		vi.resetModules();
		await import('$lib/components/monaco/settings-monaco');
		expect(monacoState.setTheme).toHaveBeenCalledWith('vs-dark');
	});

	it('falls back to vs when the document has no data-theme', async () => {
		vi.resetModules();
		await import('$lib/components/monaco/settings-monaco');
		expect(monacoState.setTheme).toHaveBeenCalledWith('vs');
	});
});

describe('MutationObserver data-theme watcher', () => {
	it('retargets every live editor when data-theme flips', async () => {
		vi.resetModules();
		await import('$lib/components/monaco/settings-monaco');
		expect(monacoState.setTheme).toHaveBeenCalledWith('vs');
		// flip the lamp: the observer on documentElement fires applyThemeFromDocument
		htmlEl.setAttribute('data-theme', 'dark');
		// MutationObserver callbacks are delivered as microtasks — real timers flush them
		vi.useRealTimers();
		await new Promise((r) => setTimeout(r, 0));
		expect(monacoState.setTheme).toHaveBeenLastCalledWith('vs-dark');
	});
});

describe('yaml prewarm model lifecycle', () => {
	it('the prewarm model is disposed 5s after module load', async () => {
		vi.resetModules();
		await import('$lib/components/monaco/settings-monaco');
		const prewarm = monacoState.models[0]!;
		expect(prewarm.value).toBe('prewarm: true');
		expect(prewarm.disposed).toBe(false);
		vi.advanceTimersByTime(4999);
		expect(prewarm.disposed).toBe(false);
		vi.advanceTimersByTime(1);
		expect(prewarm.disposed).toBe(true);
	});
});

describe('theme reaches create-call options', () => {
	it('createYamlEditor stamps the current document theme', async () => {
		vi.resetModules();
		await import('$lib/components/monaco/settings-monaco');
		htmlEl.setAttribute('data-theme', 'dark');
		createYamlEditor(document.createElement('div'), 'a: 1', () => {});
		expect(monacoState.createCalls[0]!.options.theme).toBe('vs-dark');
		htmlEl.setAttribute('data-theme', 'light');
		createTextEditor(document.createElement('div'), 'x', () => {});
		expect(monacoState.createCalls[1]!.options.theme).toBe('vs');
	});
});