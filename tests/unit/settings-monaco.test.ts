/**
 * settings-monaco glue tests (The Settings Panel ADR, 2026-09-07, D4) —
 * the module is the ONLY file importing monaco-editor/monaco-yaml and it
 * cannot run under happy-dom, so the tests replace those two deps (and
 * the ?worker shim) with recording doubles and exercise the real glue
 * logic: one-time MonacoEnvironment worker wiring, worker routing by
 * language label, readOnly defaulting, the change subscription, dispose
 * ordering, the text-editor seam, and the diff-editor lifecycle.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const monacoState = vi.hoisted(() => ({
	createCalls: [] as Array<{ container: HTMLElement; options: Record<string, unknown> }>,
	editors: [] as Array<{
		value: string;
		onChange: () => void;
		contentSubDisposed: boolean;
		disposed: boolean;
	}>,
	models: [] as Array<{ value: string; disposed: boolean }>,
	ranges: [] as Array<{ start: number; end: number }>,
	diffs: [] as Array<{ model: { original: unknown; modified: unknown } | null; disposed: boolean }>,
	diffCalls: [] as Array<{ container: HTMLElement; options: Record<string, unknown> }>,
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
		create: (container: HTMLElement, options: Record<string, unknown>) => {
			// Explicit interface breaks the self-referential inference inside the
			// literal below (editor.* used in its own methods).
			interface MockEditor {
				value: string;
				onChange: () => void;
				contentSubDisposed: boolean;
				disposed: boolean;
				model: { getLineCount: () => number } | null;
				decorations: { init: unknown[]; setCalls: unknown[][] } | null;
				revealed: Array<[number, number]>;
				onDidChangeModelContent(cb: () => void): { dispose(): void };
				getValue(): string;
				setValue(text: string): void;
				getModel(): MockEditor['model'];
				createDecorationsCollection(init: unknown[]): { init: unknown[]; setCalls: unknown[][] };
				revealLinesInCenter(start: number, end: number): void;
				dispose(): void;
			}
			const editor: MockEditor = {
				value: options.value as string,
				onChange: () => {},
				contentSubDisposed: false,
				disposed: false,
				model: null,
				decorations: null,
				revealed: [],
				onDidChangeModelContent(cb: () => void) {
					editor.onChange = cb;
					return { dispose: () => (editor.contentSubDisposed = true) };
				},
				getValue: () => editor.value,
				setValue: (text: string) => (editor.value = text),
				getModel: () => editor.model,
				createDecorationsCollection: (init: unknown[]) => {
					const collection = { init, setCalls: [] as unknown[][], set: (x: unknown[]) => void collection.setCalls.push(x) };
					editor.decorations = collection;
					return collection;
				},
				revealLinesInCenter: (s: number, e: number) => editor.revealed.push([s, e]),
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
		createDiffEditor: (container: HTMLElement, _options: Record<string, unknown>) => {
			const diff = { model: null as { original: unknown; modified: unknown } | null, disposed: false };
			monacoState.diffs.push(diff);
			monacoState.diffCalls.push({ container, options: _options });
			return {
				setModel(m: { original: unknown; modified: unknown } | null) {
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

import { createYamlEditor, createTextEditor, createDiffEditor } from '$lib/components/common/settings-monaco';
import { configureMonacoYaml } from 'monaco-yaml';

function getWorker(label: string): { tag: string } {
	const env = (window as { MonacoEnvironment?: { getWorker: (id: string, label: string) => Worker } })
		.MonacoEnvironment!;
	return env.getWorker('worker', label) as unknown as { tag: string };
}

beforeEach(() => {
	monacoState.createCalls.length = 0;
	monacoState.editors.length = 0;
	monacoState.models.length = 0;
	monacoState.diffs.length = 0;
	monacoState.diffCalls.length = 0;
	workerTags.length = 0;
	monacoState.ranges.length = 0;
});

describe('settings-monaco glue', () => {
	it('wires the shared editor worker into MonacoEnvironment once per app', async () => {
		delete (window as { MonacoEnvironment?: unknown }).MonacoEnvironment;
		vi.resetModules();
		await import('$lib/components/common/settings-monaco');
		const env = (window as { MonacoEnvironment?: { getWorker: () => Worker } }).MonacoEnvironment!;
		expect(typeof env.getWorker).toBe('function');
		expect(env.getWorker()).toBeTruthy(); // default label -> editor worker
		expect(workerTags).toContain('editor');
		// An environment already present is OVERWRITTEN (RCA 2026-09-26: the
		// old "=== undefined" guard let an empty/broken environment win, so no
		// worker router was ever installed). The glue always installs its own
		// deterministic router.
		(window as { MonacoEnvironment?: unknown }).MonacoEnvironment = { getWorker: () => ({} as Worker) };
		vi.resetModules(); // force the glue's module body to re-run
		await import('$lib/components/common/settings-monaco');
		expect(typeof ((window as { MonacoEnvironment?: { getWorker: unknown } }).MonacoEnvironment!).getWorker).toBe('function');
		expect(getWorker('yaml').tag).toBe('yaml');
	});

	it('routes workers by language label (yaml / ts+js / css+scss+less / html / json / fallback)', async () => {
		delete (window as { MonacoEnvironment?: unknown }).MonacoEnvironment;
		vi.resetModules();
		await import('$lib/components/common/settings-monaco');
		getWorker('typescript');
		getWorker('javascript');
		getWorker('css');
		getWorker('scss');
		getWorker('less');
		getWorker('html');
		getWorker('json');
		getWorker('plaintext');
		getWorker('yaml');
		// 9 spawns routed by label, every route exercised
		expect(workerTags).toHaveLength(9);
	});

	it('configures the YAML language service on the shared monaco instance', () => {
		expect(configureMonacoYaml).toHaveBeenCalled();
	});

	it('creates the editor with the yaml buffer and a default writable buffer', () => {
		const container = document.createElement('div');
		const onChange = vi.fn();
		const handle = createYamlEditor(container, 'a: 1', onChange);
		const call = monacoState.createCalls[0]!;
		expect(call.container).toBe(container);
		expect(call.options.value).toBe('a: 1');
		expect(call.options.language).toBe('yaml');
		expect(call.options.readOnly).toBe(false);
		handle.setValue('a: 2');
		expect(handle.getValue()).toBe('a: 2');
		monacoState.editors[0]!.onChange(); // the editor's content event reaches the seam
		expect(onChange).toHaveBeenCalledTimes(1);
	});

	it('readOnly: true blocks user edits at the editor (Loadinjected D1)', () => {
		createYamlEditor(document.createElement('div'), 'k: v', () => {}, { readOnly: true });
		expect(monacoState.createCalls[0]!.options.readOnly).toBe(true);
	});

	it('dispose releases the change subscription before the editor', () => {
		const handle = createYamlEditor(document.createElement('div'), 'x', () => {});
		const editor = monacoState.editors[0]!;
		expect(editor.contentSubDisposed).toBe(false);
		handle.dispose();
		expect(editor.contentSubDisposed).toBe(true);
		expect(editor.disposed).toBe(true);
	});

	it('the change callback fires through the handle seam', () => {
		const onChange = vi.fn();
		createYamlEditor(document.createElement('div'), 'x', onChange);
		monacoState.editors[0]!.onChange();
		expect(onChange).toHaveBeenCalledTimes(1);
	});

	it('createTextEditor defaults to plaintext + writable and honors language/readOnly options', () => {
		createTextEditor(document.createElement('div'), 'hello', () => {});
		let call = monacoState.createCalls[0]!;
		expect(call.options.language).toBe('plaintext');
		expect(call.options.readOnly).toBe(false);

		const onChange = vi.fn();
		createTextEditor(document.createElement('div'), 'x = 1', onChange, {
			language: 'typescript',
			readOnly: true
		});
		call = monacoState.createCalls[1]!;
		expect(call.options.language).toBe('typescript');
		expect(call.options.readOnly).toBe(true);

		const handleRef = monacoState.editors[1]!;
		handleRef.onChange();
		expect(onChange).toHaveBeenCalledTimes(1);
		const handle = createTextEditor(document.createElement('div'), 'x = 2', () => {});
		handle.setValue('x = 2');
		expect(handle.getValue()).toBe('x = 2');
		handle.dispose();
		expect(monacoState.editors[2]!.contentSubDisposed).toBe(true);
		expect(monacoState.editors[2]!.disposed).toBe(true);
	});

	it('createTextEditor.highlightLines creates the decoration collection once, then replaces it', () => {
		const container = document.createElement('div');
		const handle = createTextEditor(container, 'l1\nl2\nl3', () => {});
		const editor = monacoState.editors[0] as unknown as {
			model: { getLineCount: () => number } | null;
			decorations: { init: unknown[]; setCalls: unknown[][] } | null;
			revealed: Array<[number, number]>;
		};
		editor.model = { getLineCount: () => 3 };
		handle.highlightLines!({ start: 2, end: 2 });
		// first call CREATES the collection with the clamped range
		expect(monacoState.ranges[0]).toEqual({ start: 2, end: 2 });
		expect(editor.decorations!.init).toHaveLength(1);
		expect(editor.revealed[0]).toEqual([2, 2]);
		// second call REPLACES via set — highlighting twice never stacks
		handle.highlightLines!({ start: 1, end: 3 });
		expect(editor.decorations!.setCalls).toHaveLength(1);
		expect(monacoState.ranges[1]).toEqual({ start: 1, end: 3 });
		expect(editor.revealed[1]).toEqual([1, 3]);
	});

	it('createTextEditor.highlightLines clamps out-of-range targets onto the model', () => {
		const handle = createTextEditor(document.createElement('div'), 'x', () => {});
		const editor = monacoState.editors[0] as unknown as {
			model: { getLineCount: () => number } | null;
			revealed: Array<[number, number]>;
		};
		editor.model = { getLineCount: () => 2 };
		// start below 1 floors at 1; end beyond EOF collapses onto the last line
		handle.highlightLines!({ start: -5, end: 99 });
		expect(monacoState.ranges[0]).toEqual({ start: 1, end: 2 });
		// end above start collapses onto start
		handle.highlightLines!({ start: 2, end: 0.5 });
		expect(monacoState.ranges[1]).toEqual({ start: 2, end: 2 });
	});

	it('createTextEditor.highlightLines is a no-op without a model or lines', () => {
		const handle = createTextEditor(document.createElement('div'), 'x', () => {});
		const editor = monacoState.editors[0] as unknown as {
			model: { getLineCount: () => number } | null;
			decorations: unknown;
			revealed: unknown[];
		};
		// model null → early return, no decoration work
		handle.highlightLines!({ start: 1, end: 1 });
		expect(editor.decorations).toBeNull();
		// empty model (0 lines) → early return too
		editor.model = { getLineCount: () => 0 };
		handle.highlightLines!({ start: 1, end: 1 });
		expect(editor.revealed).toHaveLength(0);
	});

	it('createDiffEditor mounts two owned models, read-only by default (D2)', () => {
		const container = document.createElement('div');
		const handle = createDiffEditor(container, 'base', 'changed', { language: 'yaml' });
		expect(monacoState.models.map((m) => m.value)).toEqual(['base', 'changed']);
		expect(monacoState.diffCalls[0]!.container).toBe(container);
		expect(monacoState.diffCalls[0]!.options.readOnly).toBe(true); // read-only BY DEFAULT (D2)
		expect(monacoState.diffCalls[0]!.options.useInlineViewWhenSpaceIsLimited).toBe(false);
		expect(monacoState.diffCalls[0]!.options.renderSideBySide).toBe(true);
		expect(monacoState.diffs[0]!.model).toEqual({ original: monacoState.models[0], modified: monacoState.models[1] });

		handle.dispose();
		expect(monacoState.models[0]!.disposed).toBe(true);
		expect(monacoState.models[1]!.disposed).toBe(true);
	});

	it('createDiffEditor defaults to plaintext and honors readOnly: false', () => {
		createDiffEditor(document.createElement('div'), 'a', 'b', { readOnly: false });
		expect(monacoState.diffCalls[0]!.options.readOnly).toBe(false);
	});
});