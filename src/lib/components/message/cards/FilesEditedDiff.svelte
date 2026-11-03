<script lang="ts">
	import { DiffView, DiffFile, DiffModeEnum } from '@git-diff-view/svelte';
	import '@git-diff-view/svelte/styles/diff-view.css';
	import type { DiffHunk, TextFileDiff } from './files-edited-diff-types';

	/**
	 * FilesEditedDiff — the @git-diff-view/svelte renderer for one text
	 * file's hunk window, extracted from FilesEditedCard (2026-09-25).
	 * The wire serves PRE-COMPUTED HUNK WINDOWS, not whole files (the
	 * turn-start/end snapshots stay Host-side), so the two sides are
	 * reconstructed from the hunk lines: "-" rows feed the old text,
	 * "+" rows the new text, context rows both — the documented ADR D4
	 * give-up is that only the changed regions exist.
	 */
	let { diff }: { diff: TextFileDiff } = $props();

	interface HunkView {
		hunk: DiffHunk;
		diffFile: ReturnType<typeof DiffFile.createInstance>;
	}

	// Build ONE DiffFile PER HUNK (2026-09-25 blank-diff RCA): the wire
	// serves only each hunk's lines, so the reconstructed content is a tiny
	// window — but the vendor's git-patch parser aligns the @@ start against
	// that content, and an absolute start beyond the window length rendered
	// ZERO rows. Padding the window with empty lines up to the hunk's real
	// start keeps the REAL line numbers in the gutter (padding rows never
	// render). One DiffFile per hunk, because each hunk's window needs its
	// own padding origin — a shared content array cannot serve hunks at
	// different offsets.
	const hunkViews = $derived.by(() => {
		if (!diff.hunks) return [] as HunkView[];
		return diff.hunks.map((hunk) => {
			const oldLines: string[] = [];
			const newLines: string[] = [];
			for (const line of hunk.lines) {
				const tag = line[0];
				const body = line.slice(1);
				if (tag === '-') oldLines.push(body);
				else if (tag === '+') newLines.push(body);
				else {
					oldLines.push(body);
					newLines.push(body);
				}
			}
			const pad = (n: number) => Array(Math.max(0, n - 1)).fill('');
			const f = DiffFile.createInstance({
				oldFile: { fileName: diff.path ?? '', fileLang: null, content: [...pad(hunk.oldStart), ...oldLines].join('\n') },
				newFile: { fileName: diff.path ?? '', fileLang: null, content: [...pad(hunk.newStart), ...newLines].join('\n') },
				// the vendor parser is a git-patch parser: each hunk string needs
				// the ---/+++ file headers before the @@ window, or it parses empty.
				hunks: [`--- a/${diff.path}\n+++ b/${diff.path}\n@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n${hunk.lines.join('\n')}`]
			});
			f.initRaw();
			f.buildSplitDiffLines();
			f.buildUnifiedDiffLines();
			return { hunk, diffFile: f };
		});
	});
</script>

<!-- @git-diff-view/svelte (operator choice, 2026-09-25):
     GitHub-style unified view, light theme, wrapped lines. -->
<div class="mt-1.5 max-h-[500px] overflow-auto rounded ring-1 ring-surface-border" style="zoom: 0.7" data-testid="files-edited-diff" data-path={diff.path ?? ''}>
	<!-- {#key diff}: the vendor DiffView builds its rows ONCE at mount —
	     a new diffFile prop while mounted never rebuilds (observed live
	     2026-09-25: second hovered row rendered empty). Re-mounting on
	     every new diff object identity forces the rebuild. -->
	{#key diff}
		{#each hunkViews as view (view.hunk)}
			<DiffView
				diffFile={view.diffFile}
				diffViewMode={DiffModeEnum.Unified}
				diffViewTheme="light"
				diffViewWrap={true}
				diffViewHighlight={false}
			/>
		{/each}
	{/key}
</div>
