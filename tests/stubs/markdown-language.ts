/**
 * Test double for the deep markdown Monarch grammar
 * (monaco-editor/esm/vs/languages/definitions/markdown/markdown.js).
 *
 * Why a stub and not the real file: the module-level
 * patchMarkdownInlineCode() in settings-monaco.ts fire-and-forget-imports
 * this grammar; the vitest alias 'monaco-editor/esm/vs' resolves it into the
 * REAL esm tree, whose transitive statics (nls.js, coreCommands.js,
 * monaco-lsp-client) then land AFTER vitest tears down the happy-dom
 * environment — an EnvironmentTeardownError unhandled rejection. No unit
 * test asserts the real grammar, so give the patch the same shape it
 * expects: { language: { tokenizer: { linecontent: [...] } } } including
 * the one backtick rule the patch rewrites, so the patch path stays
 * exercised end-to-end.
 */
export const language = {
	tokenizer: {
		linecontent: [
			[/`[^`]*`/, 'variable']
		]
	}
};
