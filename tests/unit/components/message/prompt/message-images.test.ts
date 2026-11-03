/**
 * MessageImages (task 3.4-T): the gallery render contract — ref list,
 * cache-miss → fetch → render, and the honest failure card.
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MessageImages from '$lib/components/message/prompt/MessageImages.svelte';
import type { DsiImageRef } from '$lib/types';
import {
	invalidateSessionAttachmentUrls,
	resolveAttachmentUrl
} from '$lib/services/conversation/attachment-urls.svelte';

const createSpy = vi.fn(() => 'blob:mock-' + Math.random().toString(36).slice(2));
const revokeSpy = vi.fn();
vi.stubGlobal('URL', { ...URL, createObjectURL: createSpy, revokeObjectURL: revokeSpy });

let script: () => { status: number; body: unknown } = () => ({ status: 200, body: { ok: true } });
const fetchSpy = vi.fn(async () => {
	const r = await script();
	return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
});
vi.stubGlobal('fetch', fetchSpy);

const okBody = { ok: true, attachment: { mediaType: 'image/png' }, data: btoa('png') };
const ref = (id: string, name?: string): DsiImageRef => ({
	attachmentId: id,
	mediaType: 'image/png',
	bytes: 3,
	width: 1,
	height: 1,
	...(name !== undefined ? { name } : {})
});

function mountGallery(refs: DsiImageRef[], sessionId = 's1') {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(MessageImages, { target, props: { refs, sessionId } });
	flushSync();
	return { target, cleanup: () => { unmount(comp); target.remove(); } };
}

async function settle(ms = 20): Promise<void> {
	for (let i = 0; i < 4; i++) { flushSync(); await Promise.resolve(); }
	await new Promise((r) => setTimeout(r, ms));
	flushSync();
}

beforeEach(() => {
	script = () => ({ status: 200, body: okBody });
	fetchSpy.mockClear();
});

afterEach(() => {
	invalidateSessionAttachmentUrls('s1');
	invalidateSessionAttachmentUrls('s2');
});

describe('MessageImages', () => {
	describe('duplicate attachmentId crash guard (each_key_duplicate, 2026-10-31)', () => {
		it('the same image attached twice renders ONE slot, not a keyed-each crash', async () => {
			const dup = 'sha256:2130bdc719b1c65246beca186f21d1f316391aaf9f73ef9a73995d06684af4e1';
			const { target, cleanup } = mountGallery([ref(dup, 'a.png'), ref(dup, 'a.png')]);
			await settle();
			expect(target.querySelectorAll('[data-testid=message-image]')).toHaveLength(1);
			cleanup();
		});

		it('distinct ids still render each slot', async () => {
			const { target, cleanup } = mountGallery([ref('sha256:aaa'), ref('sha256:bbb')]);
			await settle();
			expect(target.querySelectorAll('[data-testid=message-image]')).toHaveLength(2);
			cleanup();
		});
	});

	it('renders one slot per ref; empty refs render nothing', async () => {
		const empty = mountGallery([]);
		expect(empty.target.querySelector('[data-testid="message-images"]')).toBeNull();
		empty.cleanup();

		const h = mountGallery([ref('sha256:a', 'a.png'), ref('sha256:b')]);
		await settle();
		const imgs = h.target.querySelectorAll('[data-testid="message-image"]');
		expect(imgs).toHaveLength(2);
		expect((imgs[0] as HTMLImageElement).alt).toBe('a.png');
		expect((imgs[1] as HTMLImageElement).alt).toBe('attached image');
		h.cleanup();
	});

	it('cache miss → fetch → render: loading slot resolves to a cached img, same URL reused', async () => {
		const h = mountGallery([ref('sha256:miss')]);
		expect(h.target.querySelector('[data-testid="message-image-loading"]')).not.toBeNull();
		await settle();
		const img = h.target.querySelector('[data-testid="message-image"]') as HTMLImageElement;
		expect(img).not.toBeNull();
		expect(img.src.startsWith('blob:mock-')).toBe(true);
		// Second gallery on the SAME session reuses the cache (one fetch total)
		const h2 = mountGallery([ref('sha256:miss')]);
		await settle();
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		h.cleanup();
		h2.cleanup();
	});

	it('a refused read renders the honest failure card, never a broken img', async () => {
		script = () => ({ status: 502, body: { ok: false, error: { message: 'attachment-not-found' } } });
		const h = mountGallery([ref('sha256:gone', 'lost.png')]);
		await settle();
		expect(h.target.querySelector('[data-testid="message-image"]')).toBeNull();
		const card = h.target.querySelector('[data-testid="message-image-failed"]') as HTMLElement;
		expect(card).not.toBeNull();
		expect(card.textContent).toContain('lost.png');
		h.cleanup();
	});
});
