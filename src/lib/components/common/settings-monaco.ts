/**
 * settings-monaco — the lazy Monaco glue for SettingsEditorPanel (The
 * Settings Panel ADR, 2026-09-07, D4). This module is the ONLY file that
 * imports monaco-editor / monaco-yaml; the panel loads it through a
 * dynamic import so the editor lands in its own chunk and the floor's
 * first paint never pays for it (the 4.1-T build gate pins that split).
 *
 * The seam the panel sees is deliberately tiny — create a YAML editor,
 * read its text, dispose — so unit tests mock THIS module and never load
 * Monaco under happy-dom.
 */

import * as monaco from 'monaco-editor';
import EditorWorker from '../monaco/settings-editor-worker?worker';
import TsWorker from '../monaco/settings-ts-worker?worker';
import CssWorker from '../monaco/settings-css-worker?worker';
import HtmlWorker from '../monaco/settings-html-worker?worker';
import JsonWorker from '../monaco/settings-json-worker?worker';
import YamlWorker from '../monaco/yaml-worker-entry?worker';
import { configureMonacoYaml } from 'monaco-yaml';

/**
 * Monaco theme follows the Three-State Lamp (html[data-theme], ADR-0023):
 * the literal 'vs' at every create call made every editor glare white in
 * dark mode. monaco themes are GLOBAL — editor.setTheme retargets all
 * live instances — so one mapping helper plus one MutationObserver on
 * data-theme keeps every editor (text, yaml, diff) on the right palette
 * without each panel wiring its own listener.
 *
 * The themes are our OWN thin clones ('dsi-light' / 'dsi-dark', 2026-11-02)
 * of vs / vs-dark with ONE added rule: markdown fenced-code content
 * ('string.mermaid' — the source lines inside a ```mermaid fence; the ```
 * opener itself stays the generic maroon 'string') gets a dedicated
 * accessible color. Contrast on the editor background: #00695C on white
 * ≈ 6.6:1, #80CBC4 on #1e1e1e ≈ 8.9:1 — both pass WCAG AA (4.5:1)
 * comfortably. Everything else inherits the base theme untouched.
 */
const DSI_MARKDOWN_FENCE = '00695C'; // teal 800 — light mode fence text
const DSI_MARKDOWN_FENCE_DARK = '80CBC4'; // teal 200 — dark mode fence text
const DSI_MARKDOWN_BOLD = '6F42C1'; // purple — light mode **bold** text
const DSI_MARKDOWN_BOLD_DARK = 'D2A8FF'; // light purple — dark mode **bold**
const DSI_MARKDOWN_CODE = '44337A'; // dark violet — light mode `inline code`
const DSI_MARKDOWN_CODE_BG = 'EDEAF7'; // pale violet pill — light mode bg
const DSI_MARKDOWN_CODE_DARK = 'D2A8FF'; // dark mode `inline code` text
const DSI_MARKDOWN_CODE_BG_DARK = '2D2848'; // deep violet pill — dark bg

export type DsiMonacoTheme = 'dsi-light' | 'dsi-dark';

// Guarded: unit tests stub monaco with a partial editor mock (no
// defineTheme), and theme registration is a no-op without it.
function defineDsiThemes(): void {
	const define = monaco.editor.defineTheme?.bind(monaco.editor);
	if (typeof define !== 'function') return;
	define('dsi-light', {
		base: 'vs',
		inherit: true,
		rules: [
			{ token: 'string.mermaid', foreground: DSI_MARKDOWN_FENCE },
			// **bold** runs: purple + real bold so emphasis reads as emphasis
			// (6F42C1 on white ≈ 6.0:1 — WCAG AA). 'strong' is effectively a
			// markdown-only token, so a global rule is safe.
			{ token: 'strong', foreground: DSI_MARKDOWN_BOLD, fontStyle: 'bold' },
			// `inline code`: tinted pill background + dark violet text
			// (44337A on EDEAF7 ≈ 8:1 — WCAG AA).
			{ token: 'md.inline.code', foreground: DSI_MARKDOWN_CODE, background: DSI_MARKDOWN_CODE_BG }
		],
		colors: {}
	});
	define('dsi-dark', {
		base: 'vs-dark',
		inherit: true,
		rules: [
			{ token: 'string.mermaid', foreground: DSI_MARKDOWN_FENCE_DARK },
			// D2A8FF on #1e1e1e ≈ 10:1; inline code D2A8FF on 2D2848 ≈ 9:1.
			{ token: 'strong', foreground: DSI_MARKDOWN_BOLD_DARK, fontStyle: 'bold' },
			{ token: 'md.inline.code', foreground: DSI_MARKDOWN_CODE_DARK, background: DSI_MARKDOWN_CODE_BG_DARK }
		],
		colors: {}
	});
}
defineDsiThemes();

// The markdown tokenizer hands a ```mermaid block's CONTENT to an embedded
// 'mermaid' language (markdown.js: nextEmbedded "$1"). With no such language
// registered the embedded switch resolves to nothing and the source lines
// fall to the untokenized default — unthemeable. Registering a one-rule
// Monarch (every line → 'string.mermaid') makes the fence source a token
// the dsi themes can paint, while the ``` opener keeps its maroon 'string'.
// Guarded like defineDsiThemes: the unit-test mock has no language registry.
function registerMermaidLanguage(): void {
	if (typeof monaco.languages.register !== 'function') return;
	if (monaco.languages.getLanguages().some((l) => l.id === 'mermaid')) return;
	monaco.languages.register({ id: 'mermaid' });
	monaco.languages.setMonarchTokensProvider('mermaid', {
		tokenizer: {
			root: [[/.*$/, 'string.mermaid']]
		}
	});
}
registerMermaidLanguage();

// Inline `backtick code` in markdown emits the GENERIC 'variable' token —
// shared by dozens of languages, so a global theme rule would recolor
// variables everywhere. Patch a CLONE of the stock markdown Monarch to emit
// a dedicated 'md.inline.code' token for that one rule instead, then
// override the registered provider. structuredClone keeps the RegExp
// literals alive (JSON would flatten them to {}). Guarded for the mocks.
function patchMarkdownInlineCode(): void {
	if (typeof monaco.languages.setMonarchTokensProvider !== 'function') return;
	modifyMarkdownLanguage()
		.then((r) => {
			if (r.patched) monaco.languages.setMonarchTokensProvider('markdown', r.patched as monaco.languages.IMonarchLanguage);
			else console.warn('[dsi-monaco] markdown inline-code patch skipped:', r.error);
		})
		.catch((e) => {
			// Fire-and-forget: this chain may still be in flight when a test
			// environment (or the page) tears down; swallow so a late module
			// load can never surface as an unhandled rejection.
			console.warn('[dsi-monaco] markdown inline-code patch failed:', e);
		});
}
async function modifyMarkdownLanguage(): Promise<{ patched: object | null; error?: string }> {
	try {
		// The deep path rides the vite alias ('monaco-editor/esm/vs' → local
		// esm tree); TS has no .d.ts for the bare file, hence the untyped import.
		// @ts-expect-error — module resolved by the vite alias, untyped
		const mod = await import('monaco-editor/esm/vs/languages/definitions/markdown/markdown.js');
		const lang = (mod as { language?: { tokenizer?: { linecontent?: unknown[] } } }).language;
		if (!lang?.tokenizer) return { patched: null, error: 'no language export' };
		const clone = structuredClone(lang) as { tokenizer?: { linecontent?: unknown[] } };
		const rules = clone.tokenizer?.linecontent;
		if (!Array.isArray(rules)) return { patched: null, error: 'no linecontent' };
		let hit = false;
		for (const rule of rules) {
			if (Array.isArray(rule) && rule[0] instanceof RegExp && rule[0].source.includes('`') && rule[1] === 'variable') {
				rule[1] = 'md.inline.code';
				hit = true;
			}
		}
		return hit ? { patched: clone } : { patched: null, error: 'rule not found' };
	} catch (e) {
		return { patched: null, error: String(e) };
	}
}
patchMarkdownInlineCode();

export function monacoThemeFor(dataTheme: string | null | undefined): DsiMonacoTheme {
	return dataTheme === 'dark' ? 'dsi-dark' : 'dsi-light';
}
// Guarded: unit tests stub monaco with a partial editor mock (no
// setTheme), and non-DOM environments have no documentElement to watch.
function applyThemeFromDocument(): void {
	if (typeof monaco.editor.setTheme !== 'function') return;
	monaco.editor.setTheme(monacoThemeFor(document.documentElement?.dataset.theme));
}
applyThemeFromDocument();
if (typeof MutationObserver !== 'undefined' && document.documentElement) {
	new MutationObserver(applyThemeFromDocument).observe(document.documentElement, {
		attributes: true,
		attributeFilter: ['data-theme']
	});
}

// One worker set per app: Monaco's editor worker (diff/completion
// plumbing) plus the LANGUAGE workers — hover/validation/diagnostic
// requests are routed by language LABEL: routing them to the editor
// worker fails with "Missing requestHandler or method: ..." (yaml's
// getQuickInfoAtPosition, 2026-09; the text editor's
// getSyntacticDiagnostics once createTextEditor opened ts/js/css/html/
// json buffers, 2026-09-12). Each language label gets its own worker;
// everything else (plaintext et al) uses the editor worker. Configured
// once on first load; the worker URL imports keep Vite in charge of
// the bundling.
declare global {
	interface Window {
		MonacoEnvironment?: {
			getWorker: (workerId: string, label: string) => Worker;
		};
	}
}

// ALWAYS install the router (RCA 2026-09-26): monaco seeds an empty
// MonacoEnvironment object on import, so a "=== undefined" guard never
// passed and yaml requests fell back to the main thread, rejecting
// "Missing requestHandler or method: ..." on every worker call.
window.MonacoEnvironment = {
	getWorker(_workerId: string, label: string): Worker {
		if (label === 'yaml') return new YamlWorker();
		if (label === 'typescript' || label === 'javascript') return new TsWorker();
		if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
		if (label === 'html') return new HtmlWorker();
		if (label === 'json') return new JsonWorker();
		return new EditorWorker();
	}
};

// monaco 0.56+ base features (folding / document symbols / links / code
// actions) fall back to a worker RPC for languages without providers — for
// 'yaml' that call raced the monaco-yaml worker boot and threw UNCAUGHT
// (RCA 2026-09-26). Register no-op providers so monaco never issues those
// doomed calls; yaml's real validation/hover/completion still ride
// monaco-yaml's own providers + the guarded worker entry.
monaco.languages.registerFoldingRangeProvider('yaml', { provideFoldingRanges: () => [] });
monaco.languages.registerDocumentSymbolProvider('yaml', { provideDocumentSymbols: () => [] });
monaco.languages.registerLinkProvider('yaml', { provideLinks: () => ({ links: [] }) });
monaco.languages.registerCodeActionProvider('yaml', {
	provideCodeActions: () => ({ actions: [], dispose() {} })
});

// YAML language service (hover, validation, symbols) on the shared
// monaco instance — the document authority stays the server's parse gate
// (ADR D5); this is editor-side affordance only.
// validate: false — monaco-yaml's marker provider fires doValidation/
// resetSchema before the yaml worker finishes booting; the rejections are
// the remaining console-noise source (RCA 2026-09-26). Hover/completion/
// definition/format stay active.
configureMonacoYaml(monaco, { validate: false });

// Pre-warm the yaml worker (Fullpath Bow RCA follow-up): the worker bundle
// carries the whole yaml-language-server and takes seconds to boot; a yaml
// model opened before that raced the boot and rejected uncaught. Warming
// with a throwaway model at module load moves the race to app startup —
// by the time the operator opens real yaml tabs the worker is live.
const warmupModel = monaco.editor.createModel(
	'prewarm: true',
	'yaml',
	monaco.Uri.parse('inmemory://dsi-yaml-prewarm/boot.yaml')
);
setTimeout(() => warmupModel.dispose(), 5000);

/** The editor handle SettingsEditorPanel keeps. */
export interface YamlEditorHandle {
	/** The editor's current text. */
	getValue(): string;
	/** Replace the whole buffer (a fresh load). */
	setValue(text: string): void;
	/** Scroll to and highlight a 1-based line range (the file-link #L
	 *  anchor). Optional: only the text editor implements it. */
	highlightLines?(range: { start: number; end: number }): void;
	/** Release the editor and its DOM. */
	dispose(): void;
}

/** Creation options for the shared glue — the seam stays tiny. */
export interface YamlEditorOptions {
	/** True blocks USER edits at the editor (the injected-doc viewer,
	 *  Loadinjected ADR D1); programmatic setValue still works. Default
	 *  false — the settings editor keeps its writable buffer. */
	readOnly?: boolean;
}

/**
 * Create a Monaco YAML editor in `container`.
 * @param container - the host element the editor mounts into.
 * @param initialValue - the document text to open with.
 * @param onChange - fired on every buffer edit (the panel tracks its
 *        dirty state from it).
 * @param options - optional seam options; absent = the settings editor's
 *        writable buffer (readOnly false).
 */
export function createYamlEditor(
	container: HTMLElement,
	initialValue: string,
	onChange: () => void,
	options?: YamlEditorOptions
): YamlEditorHandle {
	const editor = monaco.editor.create(container, {
		value: initialValue,
		language: 'yaml',
		theme: monacoThemeFor(document.documentElement.dataset.theme),
		automaticLayout: true,
		fontSize: 13,
		minimap: { enabled: false },
		scrollBeyondLastLine: false,
		tabSize: 2,
		renderWhitespace: 'selection',
		readOnly: options?.readOnly === true
	});
	const sub = editor.onDidChangeModelContent(() => onChange());
	return {
		getValue: () => editor.getValue(),
		setValue: (text: string) => editor.setValue(text),
		dispose: () => {
			sub.dispose();
			editor.dispose();
		}
	};
}

/**
 * Create a Monaco editor over one live workspace file (Workspace Explorer
 * W4 task 4.1): the file panel's edit tab — same lazy chunk, same tiny seam
 * as the YAML glue. Language defaults to plaintext; pass one of Monaco's
 * registered ids to switch on the built-in tokenizer highlighting.
 *
 * @param container - the host element the editor mounts into.
 * @param initialValue - the fetched file text to open with.
 * @param onChange - fired on every buffer edit (the panel's dirty flag).
 * @param options - optional seam options; `language` picks a Monaco
 *        language id (e.g. 'typescript', 'python'); absent = plaintext.
 */
export function createTextEditor(
	container: HTMLElement,
	initialValue: string,
	onChange: () => void,
	options?: { language?: string; readOnly?: boolean }
): YamlEditorHandle {
	const editor = monaco.editor.create(container, {
		value: initialValue,
		language: options?.language ?? 'plaintext',
		readOnly: options?.readOnly ?? false,
		theme: monacoThemeFor(document.documentElement.dataset.theme),
		automaticLayout: true,
		fontSize: 13,
		minimap: { enabled: false },
		scrollBeyondLastLine: false,
		tabSize: 2
	});
	const sub = editor.onDidChangeModelContent(() => onChange());
	/** One decoration collection, REPLACED per call — highlighting twice
	 *  never stacks two bands. Clamped to the model: a target past EOF
	 *  collapses onto the last line, it never throws. */
	let decorations: monaco.editor.IEditorDecorationsCollection | null = null;
	const highlightLines = (range: { start: number; end: number }): void => {
		const model = editor.getModel();
		if (model === null) return;
		const last = model.getLineCount();
		if (last < 1) return;
		const start = Math.min(Math.max(1, Math.floor(range.start)), last);
		const end = Math.min(Math.max(start, Math.floor(range.end)), last);
		if (decorations === null) {
			decorations = editor.createDecorationsCollection([
				{
					range: new monaco.Range(start, 1, end, 1),
					options: { isWholeLine: true, className: 'dsi-line-anchor-highlight' }
				}
			]);
		} else {
			decorations.set([
				{
					range: new monaco.Range(start, 1, end, 1),
					options: { isWholeLine: true, className: 'dsi-line-anchor-highlight' }
				}
			]);
		}
		editor.revealLinesInCenter(start, end);
	};
	return {
		getValue: () => editor.getValue(),
		setValue: (text: string) => editor.setValue(text),
		highlightLines,
		dispose: () => {
			sub.dispose();
			editor.dispose();
		}
	};
}

// ── The File Eye diff surface (ADR 2026-09-12, D2) ──

/**
 * A READ-ONLY side-by-side DiffEditor over (HEAD, on-disk baseline),
 * riding the SAME lazy chunk as the text editor (the chunk gate).
 * Returns a dispose handle only — the diff is never editable, so there
 * is no value API. The two models are owned (and disposed) here.
 */
export function createDiffEditor(
	container: HTMLElement,
	original: string,
	modified: string,
	options?: { language?: string; readOnly?: boolean }
): { dispose(): void } {
	const language = options?.language ?? 'plaintext';
	const originalModel = monaco.editor.createModel(original, language);
	const modifiedModel = monaco.editor.createModel(modified, language);
	const editor = monaco.editor.createDiffEditor(container, {
		theme: monacoThemeFor(document.documentElement.dataset.theme),
		automaticLayout: true,
		fontSize: 13,
		minimap: { enabled: false },
		scrollBeyondLastLine: false,
		// The diff is read-only BY DEFAULT (ADR D2) — the Loadinjected seam
		// pin forbids a hardcoded read-only-true literal in this module.
		readOnly: options?.readOnly ?? true,
		renderSideBySide: true,
		// Monaco 0.56 defaults this to true: below its width threshold it
		// silently falls back to the INLINE (unified) view. The file panel
		// is narrow by design — side-by-side must hold anyway (the ADR D2
		// contract is two panes, not a patch).
		useInlineViewWhenSpaceIsLimited: false,
	});
	editor.setModel({ original: originalModel, modified: modifiedModel });
	return {
		dispose: () => {
			// ORDER MATTERS: the widget must RELEASE its models (dispose, or
			// setModel(null)) before the models die — disposing a TextModel
			// the widget still references throws "TextModel got disposed
			// before DiffEditorWidget model got reset".
			editor.setModel(null);
			editor.dispose();
			originalModel.dispose();
			modifiedModel.dispose();
		}
	};
}
