/**
 * prettify-code — the D5 display path (ADR-0077 Amendment 1): formats a
 * tool-call `code:` argument through Prettier's standalone browser build
 * for the card's DISPLAY copy. DISPLAY-DERIVED, never stored — the wire
 * keeps every byte (ADR-0008 verbatim law).
 *
 * Lazy by contract: the prettier standalone + typescript plugin load on
 * the first code-arg card, not on every page. NEVER THROWS: any failure
 * (module unavailable, unparseable JS) returns the input unchanged —
 * the D2 verbatim fallback. The parser-scanner fallback does NOT exist
 * here unless the operator approves it (Amendment 1 fallback rule).
 */

let loader: Promise<{ format: (src: string, opts: Record<string, unknown>) => Promise<string> }> | undefined;

async function loadPrettier() {
	loader ??= (async () => {
		const prettier = await import('prettier/standalone.mjs');
		const tsPlugin = await import('prettier/plugins/typescript.mjs');
		const estree = await import('prettier/plugins/estree.mjs');
		return {
			format: (src: string, opts: Record<string, unknown>) =>
				// eslint-disable-next-line @typescript-eslint/no-explicit-any -- standalone's plugin typing is array-of-any
				(prettier as any).format(src, { ...opts, plugins: [tsPlugin, estree] })
		};
	})();
	return loader;
}

/**
 * D6 (ADR-0077 Amendment 2): format the WHOLE program — params one per
 * line, punctuation per the formatter. Display-only, never stored; any
 * failure returns the input unchanged (the D2 verbatim fallback).
 */
export async function prettifyProgram(code: string): Promise<string> {
	if (code.trim() === '') return code;
	try {
		const prettier = await loadPrettier();
		return await prettier.format(code, {
			parser: 'typescript',
			singleQuote: true,
			printWidth: 100
		});
	} catch {
		return code;
	}
}

/**
 * Format a `code:` argument value for display (D5). Empty/garbage input and
 * any internal failure return the input unchanged; already-formatted code
 * is idempotent (Prettier is a fixed point on its own output).
 */
export const prettifyCode = prettifyProgram;
