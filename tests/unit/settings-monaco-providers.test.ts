/**
 * settings-monaco provider + warmup coverage — the base suite
 * (settings-monaco.test.ts) exercises the editor seams; this file drives
 * the remaining module-body logic: the four no-op yaml provider callbacks
 * (RCA 2026-09-26: they exist so monaco never issues doomed worker RPCs)
 * and the 5s prewarm-model dispose timer (Fullpath Bow RCA follow-up).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
		create: () => ({ onDidChangeModelContent: () => ({ dispose() {} }), getValue: () => '', setValue() {}, dispose() {} }),
		createModel: vi.fn((value: string) => ({ value, disposed: false, dispose() {} })),
		createDiffEditor: () => ({ setModel() {}, dispose() {} })
	}
}));
vi.mock('monaco-yaml', () => ({ configureMonacoYaml: vi.fn() }));
vi.mock('$lib/components/monaco/settings-editor-worker?worker', () => ({ default: class {} }));
vi.mock('$lib/components/monaco/settings-ts-worker?worker', () => ({ default: class {} }));
vi.mock('$lib/components/monaco/settings-css-worker?worker', () => ({ default: class {} }));
vi.mock('$lib/components/monaco/settings-html-worker?worker', () => ({ default: class {} }));
vi.mock('$lib/components/monaco/settings-json-worker?worker', () => ({ default: class {} }));
vi.mock('$lib/components/monaco/yaml-worker-entry?worker', () => ({ default: class {} }));

import * as monaco from 'monaco-editor';

const reg = monaco.languages as unknown as Record<
	string,
	ReturnType<typeof vi.fn> & { mock: { calls: unknown[][] } }
>;

describe('settings-monaco module-body providers + warmup', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		delete (window as { MonacoEnvironment?: unknown }).MonacoEnvironment;
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('registers four no-op yaml providers whose callbacks return empty payloads', async () => {
		await import('$lib/components/common/settings-monaco');
		for (const key of ['registerFoldingRangeProvider', 'registerDocumentSymbolProvider', 'registerLinkProvider', 'registerCodeActionProvider']) {
			expect(reg[key]).toHaveBeenCalledWith('yaml', expect.anything());
		}
		const second = (call: unknown[][]) => call[0]![1] as { provideFoldingRanges?: () => unknown; provideDocumentSymbols?: () => unknown; provideLinks?: () => unknown; provideCodeActions?: () => unknown };
		const folding = second(reg.registerFoldingRangeProvider.mock.calls);
		const symbols = second(reg.registerDocumentSymbolProvider.mock.calls);
		const links = second(reg.registerLinkProvider.mock.calls);
		const actions = second(reg.registerCodeActionProvider.mock.calls);
		// every no-op callback resolves to an empty payload (never a worker RPC)
		expect(folding.provideFoldingRanges!()).toEqual([]);
		expect(symbols.provideDocumentSymbols!()).toEqual([]);
		expect(links.provideLinks!()).toEqual({ links: [] });
		const codeActions = actions.provideCodeActions!() as { actions: unknown[]; dispose(): void };
		expect(codeActions.actions).toEqual([]);
		expect(() => codeActions.dispose()).not.toThrow();
	});

	it('prewarms the yaml model and disposes it after 5s', async () => {
		const createModel = monaco.editor.createModel as unknown as ReturnType<typeof vi.fn>;
		const fakeModel = { disposed: false, dispose() { this.disposed = true; } };
		createModel.mockReturnValueOnce(fakeModel);
		vi.resetModules(); // a fresh module body schedules a fresh warmup timer
		await import('$lib/components/common/settings-monaco');
		expect(createModel).toHaveBeenCalledWith('prewarm: true', 'yaml', expect.anything());
		expect(fakeModel.disposed).toBe(false);
		vi.advanceTimersByTime(5000);
		expect(fakeModel.disposed).toBe(true);
	});
});
