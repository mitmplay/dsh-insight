/** Wire shape for one text file's pre-computed hunk window (shared by
 *  FilesEditedDiff and its tests; lives in a .ts module so raw tsc —
 *  which resolves *.svelte imports to a default-only wildcard — can
 *  import the named type). */
export interface DiffHunk {
	oldStart: number;
	oldLines: number;
	newStart: number;
	newLines: number;
	lines: string[];
}
export interface TextFileDiff {
	kind: 'text';
	path?: string;
	display?: string;
	hunks?: DiffHunk[];
}
