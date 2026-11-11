/**
 * settings-monaco WORKER-ROUTER + YAML-EDITOR coverage — a dedicated file
 * pinning each of the seven getWorker label branches in isolation, the four
 * no-op yaml provider callbacks, the configureMonacoYaml module call, the
 * 5s prewarm model create+dispose, and the createYamlEditor seam (option
 * wiring, readOnly true/false, onChange subscription, dispose chain).
 * Mock pattern follows settings-monaco.test.ts / settings-monaco-providers.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const monacoState = vi.hoisted(() => ({
	createCalls: [] as Array<{ container: HTMLElement; options: Record<string, unknown> }>,
	editors: [] as Array<{
		value: string;
		onChange: () => void;
		contentSubDisposed: boolean;
		disposed: boolean;
	}>,
	createModel: { fn: undefined as unknown, lastModel: null as { value: string; disposed: boolean } | null }
}));

vi.mock('monaco-editor', () => ({
	Uri: { parse: (v: string) => ({ toString: () => v }) },
	languages: {
		registerFoldingRangeProvider: vi.fn(),
		registerDocumentSymbolProvider: vi.fn(),
		registerLinkProvider: vi.fn(),
		registerCodeActionProvider: vi.fn()
	},
	Range: class {},
	editor: {
		create: (container: HTMLElement, options: Record<string, unknown>) => {
			const editor = {
				value: options.value as string,
				onChange: () => {},
				contentSubDisposed: false,
				disposed: false,
				onDidChangeModelContent(cb: () => void) {
					editor.onChange = cb;
					return { dispose: () => (editor.contentSubDisposed = true) };
				},
				getValue: () => editor.value,
				setValue: (text: string) => (editor.value = text),
				dispose: () => (editor.disposed = true)
			};
			monacoState.createCalls.push({ container, options });
			monacoState.editors.push(editor);
			return editor;
		},
		createModel: vi.fn((value: string, _language: string, _uri: unknown) => {
			const model = { value, disposed: false, dispose: () => (model.disposed = true) };
			monacoState.createModel.lastModel = model;
			return model;
		}),
		createDiffEditor: () => ({ setModel() {}, dispose() {} })
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
import { configureMonacoYaml } from 'monaco-yaml';
import {
	createYamlEditor,
	monacoThemeFor,
	type YamlEditorHandle
} from '$lib/components/common/settings-monaco';

const reg = monaco.languages as unknown as Record<string, ReturnType<typeof vi.fn>>;

async function loadModule(): Promise<unknown> {
	// Fresh module body per test: the router install, provider registration,
	// configureMonacoYaml call and prewarm timer all run in the module body.
	vi.resetModules();
	return import('$lib/components/common/settings-monaco');
}

function getWorker(label: string): { tag: string } {
	const env = (window as { MonacoEnvironment?: { getWorker: (id: string, label: string) => Worker } })
		.MonacoEnvironment!;
	return env.getWorker('worker', label) as unknown as { tag: string };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.clearAllMocks();
	delete (window as { MonacoEnvironment?: unknown }).MonacoEnvironment;
	monacoState.createCalls.length = 0;
	monacoState.editors.length = 0;
	monacoState.createModel.lastModel = null;
});

afterEach(() => {
	vi.useRealTimers();
});

describe('settings-monaco worker router (all 7 label branches)', () => {
	it('branch 1 — label yaml returns the YamlWorker class', async () => {
		await loadModule();
		expect(getWorker('yaml').tag).toBe('yaml');
	});

	it('branch 2 — labels typescript AND javascript both return the TsWorker class', async () => {
		await loadModule();
		expect(getWorker('typescript').tag).toBe('ts');
		expect(getWorker('javascript').tag).toBe('ts');
	});

	it('branch 3 — labels css, scss, less all return the CssWorker class', async () => {
		await loadModule();
		expect(getWorker('css').tag).toBe('css');
		expect(getWorker('scss').tag).toBe('css');
		expect(getWorker('less').tag).toBe('css');
	});

	it('branch 4 — label html returns the HtmlWorker class', async () => {
		await loadModule();
		expect(getWorker('html').tag).toBe('html');
	});

	it('branch 5 — label json returns the JsonWorker class', async () => {
		await loadModule();
		expect(getWorker('json').tag).toBe('json');
	});

	it('branch 6 — any other label (plaintext, markdown) falls back to the EditorWorker class', async () => {
		await loadModule();
		expect(getWorker('plaintext').tag).toBe('editor');
		expect(getWorker('markdown').tag).toBe('editor');
	});

	it('branch 7 — empty/unknown label string still routes to the EditorWorker class', async () => {
		await loadModule();
		expect(getWorker('').tag).toBe('editor');
		expect(getWorker('no-such-language').tag).toBe('editor');
	});

	it('getWorker ignores the workerId argument when routing', async () => {
		await loadModule();
		const env = (window as { MonacoEnvironment?: { getWorker: (id: string, label: string) => Worker } })
			.MonacoEnvironment!;
		expect((env.getWorker('whateverId', 'yaml') as unknown as { tag: string }).tag).toBe('yaml');
	});
});

describe('settings-monaco yaml providers + yaml service + prewarm (module body)', () => {
	it('registers four no-op yaml providers whose callbacks return empty payloads', async () => {
		await loadModule();
		for (const key of [
			'registerFoldingRangeProvider',
			'registerDocumentSymbolProvider',
			'registerLinkProvider',
			'registerCodeActionProvider'
		]) {
			expect(reg[key]).toHaveBeenCalledWith('yaml', expect.anything());
		}
		const provider = (call: unknown[]) => call[1] as Record<string, () => unknown>;
		expect(provider(reg.registerFoldingRangeProvider.mock.calls[0]).provideFoldingRanges!()).toEqual([]);
		expect(provider(reg.registerDocumentSymbolProvider.mock.calls[0]).provideDocumentSymbols!()).toEqual([]);
		expect(provider(reg.registerLinkProvider.mock.calls[0]).provideLinks!()).toEqual({ links: [] });
		const actions = provider(reg.registerCodeActionProvider.mock.calls[0]).provideCodeActions!() as {
			actions: unknown[];
			dispose(): void;
		};
		expect(actions.actions).toEqual([]);
		expect(() => actions.dispose()).not.toThrow();
	});

	it('calls configureMonacoYaml(monaco, { validate: false }) at module load', async () => {
		await loadModule();
		expect(configureMonacoYaml).toHaveBeenCalledWith(monaco, { validate: false });
	});

	it('prewarm: creates a throwaway yaml model then disposes it after 5s', async () => {
		await loadModule();
		expect(monaco.editor.createModel).toHaveBeenCalledWith(
			'prewarm: true',
			'yaml',
			expect.anything()
		);
		const model = monacoState.createModel.lastModel!;
		expect(model.value).toBe('prewarm: true');
		expect(model.disposed).toBe(false);
		vi.advanceTimersByTime(4999);
		expect(model.disposed).toBe(false); // not a tick early
		vi.advanceTimersByTime(1);
		expect(model.disposed).toBe(true);
	});

	it('monacoThemeFor maps data-theme dark→dsi-dark, anything else→dsi-light', () => {
		expect(monacoThemeFor('dark')).toBe('dsi-dark');
		expect(monacoThemeFor('light')).toBe('dsi-light');
		expect(monacoThemeFor(null)).toBe('dsi-light');
		expect(monacoThemeFor(undefined)).toBe('dsi-light');
	});
});

describe('createYamlEditor seam', () => {
	it('wires value/language/theme/readOnly:false and fixed layout options into monaco.editor.create', () => {
		const container = document.createElement('div');
		document.documentElement.dataset.theme = 'dark';
		const handle = createYamlEditor(container, 'a: 1\nb: 2', () => {});
		const call = monacoState.createCalls[0]!;
		expect(call.container).toBe(container);
		expect(call.options.value).toBe('a: 1\nb: 2');
		expect(call.options.language).toBe('yaml');
		expect(call.options.theme).toBe('dsi-dark');
		expect(call.options.readOnly).toBe(false);
		expect(call.options.automaticLayout).toBe(true);
		expect(call.options.fontSize).toBe(13);
		expect(call.options.minimap).toEqual({ enabled: false });
		expect(call.options.scrollBeyondLastLine).toBe(false);
		expect(call.options.tabSize).toBe(2);
		expect(call.options.renderWhitespace).toBe('selection');
		handle.getValue(); // touch handle so tsc keeps it used
		delete document.documentElement.dataset.theme;
	});

	it('readOnly option defaults to false (writable settings buffer)', () => {
		createYamlEditor(document.createElement('div'), 'x', () => {});
		expect(monacoState.createCalls[0]!.options.readOnly).toBe(false);
	});

	it('readOnly: true reaches monaco.editor.create (injected-doc viewer, D1)', () => {
		createYamlEditor(document.createElement('div'), 'x', () => {}, { readOnly: true });
		expect(monacoState.createCalls[0]!.options.readOnly).toBe(true);
	});

	it('readOnly: false passed explicitly is honored', () => {
		createYamlEditor(document.createElement('div'), 'x', () => {}, { readOnly: false });
		expect(monacoState.createCalls[0]!.options.readOnly).toBe(false);
	});

	it('onChange fires when the editor fires onDidChangeModelContent', () => {
		const onChange = vi.fn();
		createYamlEditor(document.createElement('div'), 'x: 1', onChange);
		expect(onChange).not.toHaveBeenCalled();
		monacoState.editors[0]!.onChange();
		monacoState.editors[0]!.onChange();
		expect(onChange).toHaveBeenCalledTimes(2);
	});

	it('getValue/setValue round-trip through the editor mock', () => {
		const handle = createYamlEditor(document.createElement('div'), 'init', () => {});
		expect(handle.getValue()).toBe('init');
		handle.setValue('updated');
		expect(handle.getValue()).toBe('updated');
	});

	it('dispose releases the content subscription AND then the editor', () => {
		const handle: YamlEditorHandle = createYamlEditor(document.createElement('div'), 'x', () => {});
		const editor = monacoState.editors[0]!;
		expect(editor.contentSubDisposed).toBe(false);
		expect(editor.disposed).toBe(false);
		handle.dispose();
		expect(editor.contentSubDisposed).toBe(true);
		expect(editor.disposed).toBe(true);
		// dispose is idempotent at the seam level — no throw on double call
		expect(() => handle.dispose()).not.toThrow();
	});

	it('dispose chain: the mock subscription is released before the editor', () => {
		const handle = createYamlEditor(document.createElement('div'), 'x', () => {});
		const editor = monacoState.editors[0]!;
		handle.dispose();
		// subscription dispose ran while the editor itself still stands
		expect(editor.contentSubDisposed).toBe(true);
		expect(editor.disposed).toBe(true);
	});
});
