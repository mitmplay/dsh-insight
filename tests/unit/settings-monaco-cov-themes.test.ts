/**
 * settings-monaco THEME + LANGUAGE-REGISTRATION coverage (2026-11-02) —
 * pins the region the main glue tests load only in its guarded arms:
 *  - defineDsiThemes: both dsi-light/dsi-dark defined with the mermaid-fence,
 *    bold, and inline-code token rules when defineTheme exists; no-throw
 *    when the mock has no defineTheme.
 *  - registerMermaidLanguage: registers 'mermaid' once with the one-rule
 *    Monarch ('string.mermaid'); skipped when already registered; skipped
 *    when languages.register is missing.
 * Runs with the same recording-double pattern as settings-monaco.test.ts:
 * the vi.mock factories are installed before the module import, and the
 * module's top-level side effects see exactly the mock we stage per test.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const monacoState = vi.hoisted(() => ({
	themeCalls: [] as Array<{ name: string; data: Record<string, unknown> }>,
	langRegisters: [] as Array<{ id: string }>,
	monarchCalls: [] as Array<{ language: string; provider: Record<string, unknown> }>,
	languages: [] as Array<{ id: string }>,
	createCalls: [] as Array<{ container: HTMLElement; options: Record<string, unknown> }>
}));

vi.mock('monaco-editor', () => ({
	Uri: { parse: (v: string) => ({ toString: () => v }) },
	languages: {
		// NOTE: deliberately NO register/getLanguages/setMonarchTokensProvider —
		// tests that need the registry attach one before the import.
		registerFoldingRangeProvider: vi.fn(),
		registerDocumentSymbolProvider: vi.fn(),
		registerLinkProvider: vi.fn(),
		registerCodeActionProvider: vi.fn()
	},
	editor: {
		// NOTE: deliberately NO defineTheme / setTheme — tests stage them.
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
			return editor;
		},
		createModel: (value: string) => ({ value, dispose: () => {} }),
		createDiffEditor: () => ({ setModel: () => {}, dispose: () => {} })
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
import { monacoThemeFor } from '$lib/components/common/settings-monaco';

type EditorStub = {
	defineTheme?: (name: string, data: Record<string, unknown>) => void;
	setTheme?: (name: string) => void;
};

/** Re-runs the module body so its top-level side effects see the staged mock. */
function freshImport() {
	return import('$lib/components/common/settings-monaco');
}

beforeEach(() => {
	monacoState.themeCalls.length = 0;
	monacoState.langRegisters.length = 0;
	monacoState.monarchCalls.length = 0;
	monacoState.languages.length = 0;
	monacoState.createCalls.length = 0;
	workerTags.length = 0;
	delete (monaco.editor as unknown as EditorStub).defineTheme;
	delete (monaco.editor as unknown as EditorStub).setTheme;
	delete (monaco.languages as { register?: unknown }).register;
	delete (monaco.languages as { getLanguages?: unknown }).getLanguages;
	delete (monaco.languages as { setMonarchTokensProvider?: unknown }).setMonarchTokensProvider;
	document.documentElement.removeAttribute('data-theme');
});

afterEach(async () => {
	vi.unstubAllGlobals();
	vi.resetModules();
	// Drain the macrotask queue BEFORE the worker tears down: the module's
	// import-time console.warn ([dsi-monaco] patch arms) can otherwise race the
	// RPC close as a pending onUserConsoleLog → EnvironmentTeardownError,
	// which vitest reports as a run failure even with every test green
	// (observed 2026-11-12 on the full test:coverage run).
	await new Promise((r) => setTimeout(r, 0));
});

describe('defineDsiThemes (module-load theme registration, L51-81)', () => {
	it('defines both dsi themes with the correct base, token rules and colors when defineTheme exists', async () => {
		(monaco.editor as unknown as EditorStub).defineTheme = (name, data) => {
			monacoState.themeCalls.push({ name, data });
		};
		vi.resetModules();
		await freshImport();

		expect(monacoState.themeCalls.map((t) => t.name)).toEqual(['dsi-light', 'dsi-dark']);

		const light = monacoState.themeCalls[0]!.data;
		expect(light.base).toBe('vs');
		expect(light.inherit).toBe(true);
		expect(light.rules).toEqual([
			{ token: 'string.mermaid', foreground: '00695C' },
			{ token: 'strong', foreground: '6F42C1', fontStyle: 'bold' },
			{ token: 'md.inline.code', foreground: '44337A', background: 'EDEAF7' }
		]);
		expect(light.colors).toEqual({});

		const dark = monacoState.themeCalls[1]!.data;
		expect(dark.base).toBe('vs-dark');
		expect(dark.inherit).toBe(true);
		expect(dark.rules).toEqual([
			{ token: 'string.mermaid', foreground: '80CBC4' },
			{ token: 'strong', foreground: 'D2A8FF', fontStyle: 'bold' },
			{ token: 'md.inline.code', foreground: 'D2A8FF', background: '2D2848' }
		]);
		expect(dark.colors).toEqual({});
	});

	it('does not throw when the monaco stub has no defineTheme (guarded no-op arm)', async () => {
		document.documentElement.dataset.theme = 'dark'; // even with a theme to apply
		vi.resetModules();
		await expect(freshImport()).resolves.toBeTruthy();
		expect(monacoState.themeCalls).toHaveLength(0);
	});
});

describe('registerMermaidLanguage (module-load language registration, L90-100)', () => {
	function stageLanguageRegistry() {
		(monaco.languages as { register: unknown }).register = (l: { id: string }) => {
			monacoState.langRegisters.push(l);
		};
		(monaco.languages as { getLanguages: unknown }).getLanguages = () => monacoState.languages;
		(monaco.languages as { setMonarchTokensProvider: unknown }).setMonarchTokensProvider = (lang: string, provider: Record<string, unknown>) => {
			monacoState.monarchCalls.push({ language: lang, provider });
		};
	}

	it("registers 'mermaid' once with the one-rule Monarch mapping every line to 'string.mermaid'", async () => {
		stageLanguageRegistry();
		vi.resetModules();
		await freshImport();

		expect(monacoState.langRegisters).toEqual([{ id: 'mermaid' }]);
		expect(monacoState.monarchCalls).toHaveLength(1);
		expect(monacoState.monarchCalls[0]!.language).toBe('mermaid');
		expect(monacoState.monarchCalls[0]!.provider).toEqual({
			tokenizer: { root: [[/.*$/, 'string.mermaid']] }
		});
	});

	it("skips registration when 'mermaid' is already registered", async () => {
		stageLanguageRegistry();
		monacoState.languages.push({ id: 'mermaid' });
		vi.resetModules();
		await freshImport();

		expect(monacoState.langRegisters).toHaveLength(0);
		expect(monacoState.monarchCalls).toHaveLength(0);
	});

	it('skips registration entirely when languages.register is missing (guarded no-op arm)', async () => {
		vi.resetModules();
		await expect(freshImport()).resolves.toBeTruthy();
		expect(monacoState.monarchCalls).toHaveLength(0);
	});
});

describe('monacoThemeFor (the Three-State Lamp mapping, L147-149)', () => {
	it("maps 'dark' to dsi-dark", () => {
		expect(monacoThemeFor('dark')).toBe('dsi-dark');
	});

	it('maps anything else — light, empty, null, undefined — to dsi-light', () => {
		expect(monacoThemeFor('light')).toBe('dsi-light');
		expect(monacoThemeFor('')).toBe('dsi-light');
		expect(monacoThemeFor('DARK')).toBe('dsi-light'); // exact match only
		expect(monacoThemeFor(null)).toBe('dsi-light');
		expect(monacoThemeFor(undefined)).toBe('dsi-light');
	});
});
