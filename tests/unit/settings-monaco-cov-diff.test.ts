/**
 * Coverage tests for the createDiffEditor region of settings-monaco
 * (src/lib/components/common/settings-monaco.ts:367-405) — model
 * creation, option wiring (language default, theme, readOnly default
 * TRUE, forced inline-view-off), setModel, and the dispose ORDER pin
 * (setModel(null) BEFORE editor.dispose() BEFORE model disposals).
 * Same recording-double mock pattern as tests/unit/settings-monaco.test.ts.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const monacoState = vi.hoisted(() => ({
	// ordered log of every mock invocation — the dispose ORDER pin reads this
	log: [] as string[],
	modelCalls: [] as Array<{ value: string; language: string }>,
	models: [] as Array<{ value: string; disposed: boolean; id: number }>,
	diffCalls: [] as Array<{ container: HTMLElement; options: Record<string, unknown> }>,
	diffs: [] as Array<{ setModelArg: { original: unknown; modified: unknown } | null; disposed: boolean }>
}));

vi.mock('monaco-editor', () => ({
	Uri: { parse: (v: string) => ({ toString: () => v }) },
	languages: {
		registerFoldingRangeProvider: vi.fn(),
		registerDocumentSymbolProvider: vi.fn(),
		registerLinkProvider: vi.fn(),
		registerCodeActionProvider: vi.fn()
	},
	editor: {
		createModel: (value: string, language: string) => {
			const model = {
				value,
				disposed: false,
				id: monacoState.models.length,
				dispose: () => {
					monacoState.log.push('originalModel.dispose:' + monacoState.models.indexOf(model));
					model.disposed = true;
				}
			};
			monacoState.modelCalls.push({ value, language });
			monacoState.models.push(model);
			return model;
		},
		createDiffEditor: (container: HTMLElement, options: Record<string, unknown>) => {
			const diff = { setModelArg: null as { original: unknown; modified: unknown } | null, disposed: false };
			monacoState.diffs.push(diff);
			monacoState.diffCalls.push({ container, options });
			return {
				setModel(m: { original: unknown; modified: unknown } | null) {
					monacoState.log.push('setModel:' + (m === null ? 'null' : 'pair'));
					diff.setModelArg = m;
				},
				dispose() {
					monacoState.log.push('editor.dispose');
					diff.disposed = true;
				}
			};
		}
	}
}));

vi.mock('monaco-yaml', () => ({ configureMonacoYaml: vi.fn() }));

function makeWorker(tag: string) {
	return class {
		tag: string;
		constructor() {
			this.tag = tag;
		}
	};
}

vi.mock('$lib/components/monaco/settings-editor-worker?worker', () => ({ default: makeWorker('editor') }));
vi.mock('$lib/components/monaco/settings-ts-worker?worker', () => ({ default: makeWorker('ts') }));
vi.mock('$lib/components/monaco/settings-css-worker?worker', () => ({ default: makeWorker('css') }));
vi.mock('$lib/components/monaco/settings-html-worker?worker', () => ({ default: makeWorker('html') }));
vi.mock('$lib/components/monaco/settings-json-worker?worker', () => ({ default: makeWorker('json') }));
vi.mock('$lib/components/monaco/yaml-worker-entry?worker', () => ({ default: makeWorker('yaml') }));

import { createDiffEditor } from '$lib/components/common/settings-monaco';

// skip the module-load prewarm model (uri-less calls only)
function diffModelCalls() {
	return monacoState.modelCalls.filter((c) => c.language !== 'yaml' || c.value !== 'prewarm: true');
}

beforeEach(() => {
	monacoState.log.length = 0;
	monacoState.modelCalls.length = 0;
	monacoState.models.length = 0;
	monacoState.diffCalls.length = 0;
	monacoState.diffs.length = 0;
});

describe('settings-monaco createDiffEditor coverage', () => {
	it('creates two models via monaco.editor.createModel with the given texts', () => {
		createDiffEditor(document.createElement('div'), 'HEAD text', 'disk text', { language: 'markdown' });
		const calls = diffModelCalls();
		expect(calls).toEqual([
			{ value: 'HEAD text', language: 'markdown' },
			{ value: 'disk text', language: 'markdown' }
		]);
	});

	it('defaults language to plaintext when options omit it', () => {
		createDiffEditor(document.createElement('div'), 'a', 'b');
		expect(diffModelCalls().map((c) => c.language)).toEqual(['plaintext', 'plaintext']);
	});

	it('wires the theme from the document data-theme into createDiffEditor options', () => {
		document.documentElement.dataset.theme = 'dark';
		createDiffEditor(document.createElement('div'), 'a', 'b');
		expect(monacoState.diffCalls[0]!.options.theme).toBe('dsi-dark');

		document.documentElement.dataset.theme = 'light';
		createDiffEditor(document.createElement('div'), 'a', 'b');
		expect(monacoState.diffCalls[1]!.options.theme).toBe('dsi-light');
	});

	it('pins readOnly DEFAULTS TO TRUE when called without options', () => {
		createDiffEditor(document.createElement('div'), 'a', 'b');
		expect(monacoState.diffCalls[0]!.options.readOnly).toBe(true);
	});

	it('passes readOnly: false through when explicitly given', () => {
		createDiffEditor(document.createElement('div'), 'a', 'b', { readOnly: false });
		expect(monacoState.diffCalls[0]!.options.readOnly).toBe(false);
	});

	it('forces useInlineViewWhenSpaceIsLimited to false (side-by-side holds)', () => {
		createDiffEditor(document.createElement('div'), 'a', 'b');
		expect(monacoState.diffCalls[0]!.options.useInlineViewWhenSpaceIsLimited).toBe(false);
		expect(monacoState.diffCalls[0]!.options.renderSideBySide).toBe(true);
	});

	it('setModel receives {original, modified} holding the two created models', () => {
		createDiffEditor(document.createElement('div'), 'o', 'm');
		const [orig, mod] = monacoState.models;
		expect(monacoState.diffs[0]!.setModelArg).toEqual({ original: orig, modified: mod });
	});

	it('dispose order: setModel(null) BEFORE editor.dispose() BEFORE both model disposals', () => {
		const handle = createDiffEditor(document.createElement('div'), 'o', 'm');
		// the pair was set first, before dispose
		expect(monacoState.log).toEqual(['setModel:pair']);
		handle.dispose();
		expect(monacoState.log).toEqual(['setModel:pair', 'setModel:null', 'editor.dispose', 'originalModel.dispose:0', 'originalModel.dispose:1']);
		// and the observable state backs the log
		expect(monacoState.diffs[0]!.setModelArg).toBeNull();
		expect(monacoState.diffs[0]!.disposed).toBe(true);
		expect(monacoState.models[0]!.disposed).toBe(true);
		expect(monacoState.models[1]!.disposed).toBe(true);
	});

	it('the returned handle exposes ONLY dispose', () => {
		const handle = createDiffEditor(document.createElement('div'), 'o', 'm');
		expect(Object.keys(handle).sort()).toEqual(['dispose']);
		expect(typeof handle.dispose).toBe('function');
	});
});
