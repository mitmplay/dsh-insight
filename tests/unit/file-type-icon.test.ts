/**
 * FileTypeIcon branch coverage: every render arm of the shared-glyph
 * component — the codeType arm that delegates to CodeFileIcon, each
 * category mark's {:else if} arm, the 'other' no-mark arm, and the
 * large-mark transform split (excel/markdown/pdf/ppt/word at 1.22 vs
 * everything else at 1.12).
 */

import { mount, unmount, flushSync } from 'svelte';
import { describe, expect, it } from 'vitest';
import FileTypeIcon from '$lib/components/common/file-icons/FileTypeIcon.svelte';

function mountInto(name: string, size = 14) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const comp = mount(FileTypeIcon as any, { target, props: { name, size } });
	flushSync();
	return {
		target,
		cleanup: () => { unmount(comp); target.remove(); }
	};
}

/** Shared-glyph names grouped by the arm they must take. */
const MARK_ARMS: Record<string, string> = {
	'sheet.xlsx': 'excel',
	'notes.md': 'markdown',
	'report.pdf': 'pdf',
	'deck.pptx': 'ppt',
	'letter.docx': 'word'
};
const SMALL_ARMS: Record<string, string> = {
	'page.html': 'html',
	'photo.png': 'image',
	'clip.mp4': 'video',
	'style.scss': 'code'
};

describe('FileTypeIcon — render arms', () => {
	it('a code category delegates to CodeFileIcon: no .fti svg, its own square glyph', () => {
		const { target, cleanup } = mountInto('app.ts');
		expect(target.querySelector('svg.fti')).toBeNull();
		expect(target.querySelector('svg')).not.toBeNull();
		cleanup();
	});

	it('a full miss is the other arm: shared glyph, class fti other, NO mark', () => {
		const { target, cleanup } = mountInto('x.weird');
		const svg = target.querySelector('svg.fti.other');
		expect(svg).not.toBeNull();
		expect(svg?.querySelector('g.mark')).toBeNull();
		expect(svg?.getAttribute('width')).toBe('14');
		cleanup();
	});

	for (const [name, type] of Object.entries(MARK_ARMS)) {
		it(`${type} arm: mark renders with the LARGE (1.22) transform`, () => {
			const { target, cleanup } = mountInto(name);
			const svg = target.querySelector('svg.fti.' + type);
			expect(svg).not.toBeNull();
			const mark = svg?.querySelector('g.mark');
			expect(mark).not.toBeNull();
			expect(mark?.getAttribute('transform')).toBe('translate(14 16) scale(1.22) translate(-14 -16)');
			cleanup();
		});
	}

	for (const [name, type] of Object.entries(SMALL_ARMS)) {
		it(`${type} arm: mark renders with the small (1.12) transform`, () => {
			const { target, cleanup } = mountInto(name);
			const svg = target.querySelector('svg.fti.' + type);
			expect(svg).not.toBeNull();
			const mark = svg?.querySelector('g.mark');
			expect(mark).not.toBeNull();
			expect(mark?.getAttribute('transform')).toBe('translate(14 16) scale(1.12) translate(-14 -16)');
			cleanup();
		});
	}

	it('the size prop drives the glyph dimensions', () => {
		const { target, cleanup } = mountInto('photo.png', 28);
		const svg = target.querySelector('svg.fti.image') as SVGElement;
		expect(svg.getAttribute('width')).toBe('28');
		expect(svg.getAttribute('height')).toBe('28');
		cleanup();
	});

	it('upper-case extensions classify the same (fold path always present)', () => {
		const { target, cleanup } = mountInto('REPORT.PDF');
		const svg = target.querySelector('svg.fti.pdf');
		expect(svg).not.toBeNull();
		expect(svg?.querySelectorAll('path').length).toBeGreaterThanOrEqual(2);
		cleanup();
	});
});
