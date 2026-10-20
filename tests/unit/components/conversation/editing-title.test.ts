/**
 * EditingTitle unit tests (2026-08-26 extraction coverage lane): the
 * header title cluster's BOTH states — the display trigger (fallback
 * text, edit seeding) and the inline rename form (draft guards, the
 * POST + normalized adoption, reject/catch error surfaces, Esc/Cancel,
 * blur submit, and the in-flight lock).
 *
 * Pattern: direct mount (chat-components.test.ts) with a per-test
 * global fetch stub (current-model.test.ts Response stubbing).
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import EditingTitle from '$lib/components/conversation/header/EditingTitle.svelte';

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

async function settle(): Promise<void> {
	for (let i = 0; i < 6; i++) {
		flushSync();
		await Promise.resolve();
	}
	// One macrotask hop: every pending promise chain (fetch stub →
	// Response.json → state write) resolves before the next flush.
	await new Promise((r) => setTimeout(r, 0));
	for (let i = 0; i < 3; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}

const json = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface RenamePost {
	url: string;
	body: string;
}

/** Route-aware stub: records rename POSTs, handler answers everything. */
function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): { posts: RenamePost[] } {
	const posts: RenamePost[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
			if (init?.method === 'POST') posts.push({ url, body: String(init.body ?? '') });
			return handler(url, init);
		})
	);
	return { posts };
}

function mountTitle(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const ontitlechange = vi.fn();
	const comp = mount(EditingTitle, {
		target,
		props: { sessionId: 's-edit', title: null, ontitlechange, ...props } as never
	});
	flushSync();
	return { target, ontitlechange, cleanup: () => { unmount(comp); target.remove(); } };
}

/** Open the inline form (click the display button). */
function openForm(target: HTMLElement): HTMLInputElement {
	(target.querySelector('[data-testid="session-title"]') as HTMLButtonElement).click();
	flushSync();
	return target.querySelector('[data-testid="rename-input"]') as HTMLInputElement;
}

/** Set the draft and flush the bind. */
function setDraft(input: HTMLInputElement, value: string): void {
	input.value = value;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
}

function keydown(input: HTMLInputElement, key: string): void {
	input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

describe('EditingTitle — display state', () => {
	it('renders the title; null falls back to the id prefix', () => {
		const a = mountTitle({ title: 'Named session' });
		expect(a.target.querySelector('[data-testid="session-title"]')?.textContent).toContain('Named session');
		a.cleanup();

		const b = mountTitle({ title: null });
		const btn = b.target.querySelector('[data-testid="session-title"]') as HTMLElement;
		expect(btn.textContent).toContain('s-edit'.slice(0, 12) + '…');
		expect(btn.getAttribute('title')).toBe('Rename this session');
		b.cleanup();
	});

	it('opening the edit form seeds the draft from the title, or the FULL id without one', () => {
		const a = mountTitle({ title: 'Existing' });
		expect(openForm(a.target).value).toBe('Existing');
		a.cleanup();

		// 2026-09-04 fix: the seed is the FULL session id — never the display's
		// truncated `slice(0, 12) + …` prefix (that seed once fed the blur
		// auto-submit, permanently saving the truncation over a null title).
		const b = mountTitle({ title: null, sessionId: 'session-abcdef123456' });
		expect(openForm(b.target).value).toBe('session-abcdef123456');
		b.cleanup();
	});

	it('an untouched id-fallback form closes quietly on blur — the truncation never becomes the title', async () => {
		const { posts } = stubFetch(() => json({ ok: true, title: 'x' }));
		const h = mountTitle({ title: null, sessionId: 'session-d5c93f8e-7877-4d1c-b5e9-7596d87236ae' });
		const input = openForm(h.target);
		expect(input.value).toBe('session-d5c93f8e-7877-4d1c-b5e9-7596d87236ae'); // full id, not `session-d5c9…`
		input.dispatchEvent(new FocusEvent('blur'));
		await settle();
		expect(posts).toHaveLength(0); // baseline seed → no wire write
		expect(h.ontitlechange).not.toHaveBeenCalled();
		expect(h.target.querySelector('[data-testid="rename-input"]')).toBeNull(); // closed
		h.cleanup();
	});

	it('an id-fallback session renames from the full-id seed to a real title', async () => {
		const { posts } = stubFetch(() => json({ ok: true, title: 'My session' }));
		const h = mountTitle({ title: null, sessionId: 'session-d5c93f8e-7877-4d1c-b5e9-7596d87236ae' });
		const input = openForm(h.target);
		setDraft(input, 'My session');
		keydown(input, 'Enter');
		await settle();
		expect(posts).toHaveLength(1);
		expect(JSON.parse(posts[0].body)).toEqual({ title: 'My session' });
		expect(h.ontitlechange).toHaveBeenCalledWith('My session');
		h.cleanup();
	});
});

describe('EditingTitle — save (Enter, Save button, blur)', () => {
	it('Save POSTs the draft and adopts the host-normalized title', async () => {
		const { posts } = stubFetch(() => json({ ok: true, title: 'Normalized  title' }));
		const h = mountTitle({ title: 'Old' });
		const input = openForm(h.target);
		setDraft(input, 'New name');
		(h.target.querySelector('[data-testid="rename-save"]') as HTMLButtonElement).click();
		await settle();
		expect(posts).toHaveLength(1);
		expect(posts[0].url).toBe('/api/dsh/session/s-edit/rename');
		expect(JSON.parse(posts[0].body)).toEqual({ title: 'New name' });
		expect(h.ontitlechange).toHaveBeenCalledWith('Normalized  title');
		expect(h.target.querySelector('[data-testid="rename-input"]')).toBeNull(); // form closed
		// The display still reads the prop — the parent owns title truth and
		// feeds the accepted value back through it.
		expect(h.target.querySelector('[data-testid="session-title"]')?.textContent).toContain('Old');
		h.cleanup();
	});

	it('Enter key submits from the input', async () => {
		const { posts } = stubFetch(() => json({ ok: true, title: 'Via enter' }));
		const h = mountTitle({ title: 'Old' });
		const input = openForm(h.target);
		setDraft(input, 'Via enter');
		keydown(input, 'Enter');
		await settle();
		expect(posts).toHaveLength(1);
		expect(h.ontitlechange).toHaveBeenCalledWith('Via enter');
		h.cleanup();
	});

	it('blur submits the draft (the form is the only honest commit path)', async () => {
		const { posts } = stubFetch(() => json({ ok: true, title: 'Via blur' }));
		const h = mountTitle({ title: 'Old' });
		const input = openForm(h.target);
		setDraft(input, 'Via blur');
		input.dispatchEvent(new FocusEvent('blur'));
		await settle();
		expect(posts).toHaveLength(1);
		expect(h.ontitlechange).toHaveBeenCalledWith('Via blur');
		h.cleanup();
	});

	it('a host reply without a title field adopts the draft verbatim', async () => {
		stubFetch(() => json({ ok: true }));
		const h = mountTitle({ title: 'Old' });
		const input = openForm(h.target);
		setDraft(input, 'Draft is truth');
		keydown(input, 'Enter');
		await settle();
		expect(h.ontitlechange).toHaveBeenCalledWith('Draft is truth');
		h.cleanup();
	});

	it('an unchanged draft closes quietly — no wire round-trip for nothing', async () => {
		const { posts } = stubFetch(() => json({ ok: true, title: 'Same' }));
		const h = mountTitle({ title: 'Same' });
		const input = openForm(h.target);
		keydown(input, 'Enter');
		await settle();
		expect(posts).toHaveLength(0);
		expect(h.target.querySelector('[data-testid="rename-input"]')).toBeNull(); // closed
		expect(h.ontitlechange).not.toHaveBeenCalled();
		h.cleanup();
	});

	it('an empty (whitespace-only) draft never submits — the form stays', async () => {
		const { posts } = stubFetch(() => json({ ok: true, title: 'x' }));
		const h = mountTitle({ title: 'Old' });
		const input = openForm(h.target);
		setDraft(input, '   ');
		keydown(input, 'Enter');
		await settle();
		expect(posts).toHaveLength(0);
		expect(h.target.querySelector('[data-testid="rename-input"]')).not.toBeNull();
		// The Save button is disabled for an empty draft.
		expect((h.target.querySelector('[data-testid="rename-save"]') as HTMLButtonElement).disabled).toBe(true);
		h.cleanup();
	});

	it('a second submit while the first is in flight is dropped (in-flight lock)', async () => {
		let release!: (value: Response) => void;
		const { posts } = stubFetch(
			() =>
				new Promise<Response>((resolve) => {
					release = resolve;
				})
		);
		const h = mountTitle({ title: 'Old' });
		const input = openForm(h.target);
		setDraft(input, 'Slow rename');
		(h.target.querySelector('[data-testid="rename-save"]') as HTMLButtonElement).click();
		await settle();
		expect(posts).toHaveLength(1);
		// Enter + blur while the POST is pending: both hit the renaming guard.
		keydown(input, 'Enter');
		input.dispatchEvent(new FocusEvent('blur'));
		await settle();
		expect(posts).toHaveLength(1); // still exactly one POST
		release(json({ ok: true, title: 'Slow rename' }));
		await settle();
		expect(h.ontitlechange).toHaveBeenCalledWith('Slow rename');
		h.cleanup();
	});
});

describe('EditingTitle — failures keep the old title', () => {
	it('an RPC reject shows the host message and keeps the form open', async () => {
		stubFetch(() => json({ ok: false, error: { code: 'too-long', message: 'title exceeds 200 chars' } }, 400));
		const h = mountTitle({ title: 'Old' });
		const input = openForm(h.target);
		setDraft(input, 'Way too long title');
		keydown(input, 'Enter');
		await settle();
		expect(h.target.querySelector('[data-testid="rename-error"]')?.textContent).toContain(
			'title exceeds 200 chars'
		);
		expect(h.target.querySelector('[data-testid="rename-input"]')).not.toBeNull(); // still editing
		expect(h.ontitlechange).not.toHaveBeenCalled();
		// Cancel closes the form and clears the error.
		(h.target.querySelector('[data-testid="rename-cancel"]') as HTMLButtonElement).click();
		await settle();
		expect(h.target.querySelector('[data-testid="rename-error"]')).toBeNull();
		expect(h.target.querySelector('[data-testid="session-title"]')?.textContent).toContain('Old');
		h.cleanup();
	});

	it('a reject without a message falls back to rename failed (HTTP status)', async () => {
		stubFetch(() => json({ ok: false }, 502));
		const h = mountTitle({ title: 'Old' });
		const input = openForm(h.target);
		setDraft(input, 'Whatever');
		keydown(input, 'Enter');
		await settle();
		expect(h.target.querySelector('[data-testid="rename-error"]')?.textContent).toContain(
			'rename failed (502)'
		);
		h.cleanup();
	});

	it('a garbage JSON response degrades to the status message (never throws)', async () => {
		stubFetch(() => new Response('not json', { status: 200 }));
		const h = mountTitle({ title: 'Old' });
		const input = openForm(h.target);
		setDraft(input, 'Garbage reply');
		keydown(input, 'Enter');
		await settle();
		expect(h.target.querySelector('[data-testid="rename-error"]')?.textContent).toContain(
			'rename failed (200)'
		);
		h.cleanup();
	});

	it('a transport failure shows the error message; a non-Error throw shows its string', async () => {
		stubFetch(() => Promise.reject(new Error('wire dead')));
		const a = mountTitle({ title: 'Old' });
		const inputA = openForm(a.target);
		setDraft(inputA, 'A');
		keydown(inputA, 'Enter');
		await settle();
		expect(a.target.querySelector('[data-testid="rename-error"]')?.textContent).toContain('wire dead');
		a.cleanup();

		stubFetch(() => Promise.reject('boom-string'));
		const b = mountTitle({ title: 'Old', sessionId: 's-edit-2' });
		const inputB = openForm(b.target);
		setDraft(inputB, 'B');
		keydown(inputB, 'Enter');
		await settle();
		expect(b.target.querySelector('[data-testid="rename-error"]')?.textContent).toContain('boom-string');
		b.cleanup();
	});
});

describe('EditingTitle — cancel paths', () => {
	it('Escape discards the draft without a wire call', async () => {
		const { posts } = stubFetch(() => json({ ok: true, title: 'x' }));
		const h = mountTitle({ title: 'Old' });
		const input = openForm(h.target);
		setDraft(input, 'Do not keep');
		keydown(input, 'Escape');
		await settle();
		expect(posts).toHaveLength(0);
		expect(h.target.querySelector('[data-testid="rename-input"]')).toBeNull();
		expect(h.target.querySelector('[data-testid="session-title"]')?.textContent).toContain('Old');
		expect(h.ontitlechange).not.toHaveBeenCalled();
		h.cleanup();
	});

	it('Escape while a rename is in flight is refused — the pending edit may still land', async () => {
		let release!: (value: Response) => void;
		const { posts } = stubFetch(
			() =>
				new Promise<Response>((resolve) => {
					release = resolve;
				})
		);
		const h = mountTitle({ title: 'Old' });
		const input = openForm(h.target);
		setDraft(input, 'In flight');
		(h.target.querySelector('[data-testid="rename-save"]') as HTMLButtonElement).click();
		await settle();
		keydown(input, 'Escape'); // refused by the renaming guard
		await settle();
		expect(h.target.querySelector('[data-testid="rename-input"]')).not.toBeNull();
		release(json({ ok: true, title: 'In flight' }));
		await settle();
		expect(posts).toHaveLength(1);
		expect(h.ontitlechange).toHaveBeenCalledWith('In flight');
		expect(h.target.querySelector('[data-testid="rename-input"]')).toBeNull();
		h.cleanup();
	});
});

describe('EditingTitle — sub-agent read-only state (host rename fence)', () => {
	it('renders the title as plain text: a span, not the rename trigger button', () => {
		const h = mountTitle({ title: 'Child run', subagent: true });
		const el = h.target.querySelector('[data-testid="session-title"]');
		expect(el).not.toBeNull();
		expect(el!.tagName).toBe('SPAN');
		expect(el!.textContent).toContain('Child run');
		h.cleanup();
	});

	it('never opens the inline form — clicking does nothing, no fetch crosses the wire', () => {
		const { posts } = stubFetch(() => json({ ok: true, title: 'x' }));
		const h = mountTitle({ title: 'Child run', subagent: true });
		(h.target.querySelector('[data-testid="session-title"]') as HTMLElement).click();
		flushSync();
		expect(h.target.querySelector('[data-testid="rename-input"]')).toBeNull();
		expect(posts).toHaveLength(0);
		h.cleanup();
	});

	it('falls back to the id prefix like the editable state when no title exists', () => {
		const h = mountTitle({ subagent: true });
		expect(h.target.querySelector('[data-testid="session-title"]')?.textContent).toContain('s-edit');
		h.cleanup();
	});
});

describe('EditingTitle — open focus/select-all + clear icon', () => {
	it('opening the form focuses the input and selects the whole seed', () => {
		const h = mountTitle({ title: 'Long standing title' });
		const input = openForm(h.target);
		expect(document.activeElement).toBe(input);
		expect(input.selectionStart).toBe(0);
		expect(input.selectionEnd).toBe(input.value.length);
		h.cleanup();
	});

	it('the clear icon empties the draft, keeps the form open, and never POSTs the pre-clear draft', async () => {
		const { posts } = stubFetch(() => json({ ok: true, title: 'x' }));
		const h = mountTitle({ title: 'Old' });
		const input = openForm(h.target);
		setDraft(input, 'Typed over the seed');
		const clear = h.target.querySelector('[data-testid="rename-clear"]') as HTMLButtonElement;
		expect(clear).not.toBeNull();
		// The real pointer sequence: mousedown (its preventDefault keeps
		// focus in the input, so the blur auto-submit never sees the
		// pre-clear draft), then the click that empties it.
		clear.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
		clear.click();
		await settle();
		expect(input.value).toBe('');
		expect(posts).toHaveLength(0);
		expect(h.ontitlechange).not.toHaveBeenCalled();
		expect(h.target.querySelector('[data-testid="rename-input"]')).not.toBeNull(); // still editing
		// An empty draft cannot save.
		expect((h.target.querySelector('[data-testid="rename-save"]') as HTMLButtonElement).disabled).toBe(true);
		h.cleanup();
	});

	it('the clear icon only shows for a non-empty draft and hides once cleared', () => {
		const h = mountTitle({ title: 'Old' });
		openForm(h.target); // seeded draft is non-empty → icon shows
		expect(h.target.querySelector('[data-testid="rename-clear"]')).not.toBeNull();
		(h.target.querySelector('[data-testid="rename-clear"]') as HTMLButtonElement).click();
		flushSync();
		expect(h.target.querySelector('[data-testid="rename-clear"]')).toBeNull();
		h.cleanup();
	});
});
