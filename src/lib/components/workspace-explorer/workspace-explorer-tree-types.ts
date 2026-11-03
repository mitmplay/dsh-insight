/** Presentation contracts for WorkspaceExplorerTree, shared with its
 *  tests; live in a .ts module so raw tsc — which resolves *.svelte
 *  imports to a default-only wildcard — can import the named types. */

/** One listing row (workspaceFiles/list WorkspaceDirectoryEntry). */
export interface DirEntry {
	name: string;
	type: 'file' | 'directory' | 'other';
}
/** Viewing state for one fetched level (owner-held, never persisted). */
export type Level =
	| { kind: 'loading' }
	| { kind: 'failed'; reason: string }
	| { kind: 'ready'; entries: DirEntry[]; truncated: boolean };
