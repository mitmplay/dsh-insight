/**
 * AttachmentChips — the lightbox preview arm: clicking a chip opens the
 * ORIGINAL image in the ImageLightbox (document-level portal) with the
 * draft's file name as alt (or the "image draft" fallback), and closing
 * it tears the lightbox down. Plus a multi-draft remove pass for the
 * keyed-each removal arm.
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AttachmentChips from '$lib/components/composer/attachment/AttachmentChips.svelte';
import type { AttachmentDraft } from '$lib/services/chat/attachment-service.svelte';

function draft(id: string, name: string): AttachmentDraft {
	return {
		kind: 'image',
		id,
		file: new File([new Uint8Array(64)], name, { type: 'image/png' }),
		mediaType: 'image/png',
		previewUrl: `blob:mock-${id}`
	};
}

function mountChips(drafts: AttachmentDraft[], onremove = vi.fn()) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(AttachmentChips, { target, props: { drafts, onremove } });
	flushSync();
	return {
		target,
		onremove,
		cleanup: () => {
			unmount(comp);
			target.remove();
		}
	};
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('AttachmentChips — lightbox preview arm', () => {
	it('clicking a chip opens the original in the lightbox with the file alt', () => {
		const h = mountChips([draft('a', 'shot.png')]);
		(h.target.querySelector('[data-testid="attachment-chip-open"]') as HTMLButtonElement).click();
		flushSync();
		const lightbox = document.querySelector('[data-testid="attachment-lightbox"]') as HTMLElement;
		expect(lightbox).not.toBeNull();
		const img = lightbox.querySelector('img') as HTMLImageElement;
		expect(img.getAttribute('src')).toBe('blob:mock-a');
		expect(img.getAttribute('alt')).toBe('shot.png');
		h.cleanup();
	});

	it('an empty file name falls back to "image draft" in the lightbox alt', () => {
		const h = mountChips([draft('anon', '')]);
		(h.target.querySelector('[data-testid="attachment-chip-open"]') as HTMLButtonElement).click();
		flushSync();
		const img = document.querySelector('[data-testid="attachment-lightbox"] img') as HTMLImageElement;
		expect(img.getAttribute('alt')).toBe('image draft');
		h.cleanup();
	});

	it('closing the lightbox (its close control) unmounts it and keeps the chips', () => {
		const h = mountChips([draft('a', 'a.png'), draft('b', 'b.png')]);
		(h.target.querySelector('[data-testid="attachment-chip-open"]') as HTMLButtonElement).click();
		flushSync();
		expect(document.querySelector('[data-testid="attachment-lightbox"]')).not.toBeNull();
		(document.querySelector('[data-testid="attachment-lightbox-close"]') as HTMLElement).click();
		flushSync();
		expect(document.querySelector('[data-testid="attachment-lightbox"]')).toBeNull();
		// The shelf survives the preview round-trip.
		expect(h.target.querySelectorAll('[data-testid="attachment-chip"]')).toHaveLength(2);
		h.cleanup();
	});
});
