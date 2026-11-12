/**
 * paste-chunks — the client-side split for oversized host→glass pastes
 * (ADR-0061 D3). The input wire caps text at 4096 chars per dispatch
 * (input/+server.ts); the paste path splits BEFORE posting so the cap
 * stands and nothing drops silently. Pure, no imports. Astral-plane
 * safety is a non-goal: JS slicing may split a surrogate pair — the
 * glass receives the same bytes either way via Input.insertText.
 */
export function pasteChunks(text: string, cap = 4096): string[] {
	if (!text) return [];
	const chunks: string[] = [];
	for (let i = 0; i < text.length; i += cap) chunks.push(text.slice(i, i + cap));
	return chunks;
}
