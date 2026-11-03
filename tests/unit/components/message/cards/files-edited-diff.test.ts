/**
 * FilesEditedDiff direct-mount tests (coverage extension 2026-09-26):
 * the two defensive arms of the hunk-window builder that the card-level
 * tests never hit — a diff with NO hunks (renders the box, zero views),
 * and a diff with NO path (the ?? '' fallback in fileName, the @@ header
 * AND the data-path attribute).
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';

import FilesEditedDiff from '$lib/components/message/cards/FilesEditedDiff.svelte';
import type { TextFileDiff } from '$lib/components/message/cards/files-edited-diff-types';

function mountDiff(diff: TextFileDiff): { box: () => HTMLElement; cleanup: () => void } {
	const target = document.body.appendChild(document.createElement('div'));
	const instance = mount(FilesEditedDiff, { target, props: { diff } });
	flushSync();
	return {
		box: () => target.querySelector('[data-testid="files-edited-diff"]')!,
		cleanup: () => {
			unmount(instance);
			target.remove();
		}
	};
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('FilesEditedDiff (direct mount, defensive arms)', () => {
	it('a diff WITHOUT hunks renders the box with zero vendor views (the [] early return)', () => {
		const h = mountDiff({ kind: 'text', path: 'src/a.ts' });
		expect(h.box()).not.toBeNull();
		expect(h.box().getAttribute('data-path')).toBe('src/a.ts');
		expect(h.box().textContent?.trim()).toBe('');
		h.cleanup();
	});

	it('a diff WITHOUT path falls back to empty strings in data-path and the patch headers', () => {
		const h = mountDiff({
			kind: 'text',
			hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['+x'] }]
		});
		expect(h.box().getAttribute('data-path')).toBe('');
		// the view still builds: the padded window renders the added line
		expect(h.box().textContent).toContain('x');
		h.cleanup();
	});
});
