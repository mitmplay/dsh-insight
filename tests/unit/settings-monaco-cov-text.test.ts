/**
 * Coverage supplement for createTextEditor (settings-monaco.ts 302-357):
 * every highlightLines branch, one test per branch, plus the language /
 * readOnly option defaults. Same recording-double mock pattern as
 * tests/unit/settings-monaco.test.ts.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const monacoState = vi.hoisted(() => ({
	createCalls: [] as Array<{ container: HTMLElement; options: Record<string, unknown> }>,
	editors: [] as Array<MockEditor>,
	ranges: [] as Array<{ start: number; end: number }>
}));

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
		createModel: () => ({}),
		createDiffEditor: () => ({ setModel: () => {}, dispose: () => {} })
	}
}));

vi.mock('monaco-yaml', () => ({ configureMonacoYaml: vi.fn() }));
vi.mock('$lib/components/monaco/settings-editor-worker?worker', () => ({ default: class {} }));
vi.mock('$lib/components/monaco/settings-ts-worker?worker', () => ({ default: class {} }));
vi.mock('$lib/components/monaco/settings-css-worker?worker', () => ({ default: class {} }));
vi.mock('$lib/components/monaco/settings-html-worker?worker', () => ({ default: class {} }));
vi.mock('$lib/components/monaco/settings-json-worker?worker', () => ({ default: class {} }));
vi.mock('$lib/components/monaco/yaml-worker-entry?worker', () => ({ default: class {} }));

import { createTextEditor } from '$lib/components/monaco/settings-monaco';

beforeEach(() => {
	monacoState.createCalls.length = 0;
	monacoState.editors.length = 0;
	monacoState.ranges.length = 0;
});

function makeEditor(lineCount: number | null): {
	handle: ReturnType<typeof createTextEditor>;
	editor: MockEditor;
} {
	const handle = createTextEditor(document.createElement('div'), 'x', () => {});
	const editor = monacoState.editors[0]!;
	editor.model = lineCount === null ? null : { getLineCount: () => lineCount };
	return { handle, editor };
}

describe('createTextEditor.highlightLines branches', () => {
	it('returns early when the model is null — no decorations, no reveal', () => {
		const { handle, editor } = makeEditor(null);
		handle.highlightLines!({ start: 1, end: 1 });
		expect(editor.decorations).toBeNull();
		expect(editor.revealed).toHaveLength(0);
	});

	it('returns early when lineCount < 1 — no decorations, no reveal', () => {
		const { handle, editor } = makeEditor(0);
		handle.highlightLines!({ start: 1, end: 1 });
		expect(editor.decorations).toBeNull();
		expect(editor.revealed).toHaveLength(0);
	});

	it('clamps a fractional/negative start: floored, raised to >= 1, capped at last line', () => {
		const { handle, editor } = makeEditor(3);
		handle.highlightLines!({ start: -2.9, end: 2 });
		expect(monacoState.ranges[0]).toEqual({ start: 1, end: 2 });
		// fractional start floors (1.9 -> 1)
		handle.highlightLines!({ start: 2.9, end: 3 });
		expect(monacoState.ranges[1]).toEqual({ start: 2, end: 3 });
		// start past EOF caps at the last line
		handle.highlightLines!({ start: 99, end: 99 });
		expect(monacoState.ranges[2]).toEqual({ start: 3, end: 3 });
	});

	it('clamps end: floored, raised to >= start, and capped at the last line', () => {
		const { handle, editor } = makeEditor(2);
		// end below start collapses onto start; end past EOF collapses onto last
		handle.highlightLines!({ start: 2, end: -1.5 });
		expect(monacoState.ranges[0]).toEqual({ start: 2, end: 2 });
		handle.highlightLines!({ start: 1, end: 999 });
		expect(monacoState.ranges[1]).toEqual({ start: 1, end: 2 });
	});

	it('FIRST call creates a decorations collection (dsi-line-anchor-highlight), SECOND replaces via set — never stacks', () => {
		const { handle, editor } = makeEditor(3);
		handle.highlightLines!({ start: 1, end: 2 });
		expect(editor.decorations).not.toBeNull();
		expect(editor.decorations!.init).toHaveLength(1);
		expect((editor.decorations!.init[0] as { options: unknown }).options).toEqual({
			isWholeLine: true,
			className: 'dsi-line-anchor-highlight'
		});
		expect(monacoState.ranges[0]).toEqual({ start: 1, end: 2 });
		expect(editor.decorations!.setCalls).toHaveLength(0);
		expect(editor.revealed[0]).toEqual([1, 2]);
		// second call REPLACES via set — createDecorationsCollection is not called again
		handle.highlightLines!({ start: 3, end: 3 });
		expect(editor.decorations!.setCalls).toHaveLength(1);
		expect(monacoState.ranges[1]).toEqual({ start: 3, end: 3 });
		expect(editor.revealed[1]).toEqual([3, 3]);
	});

	it('revealLinesInCenter receives the clamped range', () => {
		const { handle, editor } = makeEditor(5);
		handle.highlightLines!({ start: 0.2, end: 50 });
		expect(editor.revealed[0]).toEqual([1, 5]);
	});

	it('language defaults to plaintext; provided language wins; readOnly defaults to false', () => {
		createTextEditor(document.createElement('div'), 'a', () => {});
		let call = monacoState.createCalls[0]!;
		expect(call.options.language).toBe('plaintext');
		expect(call.options.readOnly).toBe(false);
		createTextEditor(document.createElement('div'), 'b', () => {}, { language: 'python', readOnly: true });
		call = monacoState.createCalls[1]!;
		expect(call.options.language).toBe('python');
		expect(call.options.readOnly).toBe(true);
	});
});
