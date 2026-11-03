/**
 * Runes helpers for plain .ts unit tests: the runes are only available
 * inside .svelte/.svelte.ts files, so tests that need an effect owner or a
 * reactive store shape borrow them from this compiled stub.
 */

/** $effect.root wrapper — returns the stop function. */
export function effectRoot(fn: () => () => void): () => void {
	return $effect.root(fn);
}

/** A minimal $state-backed store shape for class deps (isStreaming /
 *  renderEntries reads must be TRACKED for lifecycle effects to re-run). */
export class StreamStore {
	isStreaming = $state(false);
	renderEntries = $state<Array<{ kind: string; id: string }>>([]);
}
