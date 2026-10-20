/**
 * record-guard tests (task 3.3-T): ConversationPanel.onsubmit records ONE
 * /api/prompts/use per admitted ordinary send; command/mention/?/. lines
 * record nothing; a failed submit (admitted false) records nothing; a
 * network failure on /use is swallowed (never blocks, never retries).
 *
 * Drives the REAL composer path (type → Enter → settle) with a fetch stub
 * at the global seam — the same harness idiom as conversation-panel.test.ts.
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConversationPanel from '../../src/lib/components/conversation/panel/ConversationPanel.svelte';

function coldProps(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		sessionId: 's-record',
		agent: null,
		entries: [],
		lastSeq: -1,
		running: false,
		...overrides
	};
}

function userEntry(id: string, seq: number, text: string) {
	return { kind: 'user-message', id, seq, time: 1000 + seq, text };
}

async function settle(): Promise<void> {
	for (let i = 0; i < 6; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}

/** Controllable prompt receipt: ok=true admits, ok=false rejects. */
let promptOk: boolean;
let useCalls: { url: string; body: unknown }[];
let failUseNet: boolean;

async function mountPanel(props: Record<string, unknown> = coldProps()) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(ConversationPanel, { target, props: props as never });
	await settle();
	return { target, instance };
}

/** Type into the composer and submit with Enter (the real path). */
async function submitComposer(target: HTMLElement, text: string): Promise<void> {
	const ta = target.querySelector('[data-testid="prompt-textarea"]') as HTMLTextAreaElement;
	ta.value = text;
	ta.dispatchEvent(new Event('input', { bubbles: true }));
	flushSync();
	ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
	await settle();
	await settle();
}

const useBodies = () => useCalls.map((c) => c.body);

beforeEach(() => {
	promptOk = true;
	useCalls = [];
	failUseNet = false;
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			if (url === '/api/prompts/use') {
				if (failUseNet) return Promise.reject(new Error('offline'));
				useCalls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
				return new Response(JSON.stringify({ record: { id: 1 } }), { status: 200 });
			}
			if (url.includes('/api/dsh/session/') && url.includes('/prompt')) {
				return new Response(
					JSON.stringify(
						promptOk
							? { ok: true }
							: { ok: false, error: { code: 'rejected', message: 'nope' } }
					),
					{ status: promptOk ? 200 : 500 }
				);
			}
			// everything else (poll, config, sessions spine…) — inert ok
			return new Response(JSON.stringify({ ok: true, entries: [], lastSeq: -1, running: false }), {
				status: 200
			});
		})
	);
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('record guard — ordinary sends record once (task 3.3-T)', () => {
	it('one admitted ordinary send POSTs /use exactly once with the sent text', async () => {
		const h = await mountPanel();
		await submitComposer(h.target, 'load project AIP, OCI');
		expect(useCalls).toHaveLength(1);
		expect(useBodies()).toEqual([{ text: 'load project AIP, OCI' }]);
		unmount(h.instance);
		h.target.remove();
	});

	it('multiline ordinary text records verbatim', async () => {
		const h = await mountPanel();
		await submitComposer(h.target, 'first line\nsecond line');
		expect(useBodies()).toEqual([{ text: 'first line\nsecond line' }]);
		unmount(h.instance);
		h.target.remove();
	});
});

describe('record guard — control traffic records nothing (task 3.3-T)', () => {
	for (const line of ['/permission local', '@session-abc hello there', '?load', '.pr']) {
		it(`"${line.slice(0, 12)}${line.length > 12 ? '…' : ''}" records nothing`, async () => {
			const h = await mountPanel();
			await submitComposer(h.target, line);
			expect(useCalls).toHaveLength(0);
			unmount(h.instance);
			h.target.remove();
		});
	}

	it('a failed submit (admitted false) records nothing', async () => {
		promptOk = false; // the DSH prompt POST rejects
		const h = await mountPanel();
		await submitComposer(h.target, 'this send will be rejected');
		expect(useCalls).toHaveLength(0);
		unmount(h.instance);
		h.target.remove();
	});
});

describe('record guard — failure isolation (task 3.3-T)', () => {
	it('/use network failure never blocks the send (fire-and-forget, no retry)', async () => {
		failUseNet = true;
		const h = await mountPanel();
		await submitComposer(h.target, 'recorded nowhere but sent fine');
		// the /use fetch REJECTED — swallowed by .catch(() => {}): no error
		// surface, no retry storm, exactly one attempt
		expect(useCalls).toHaveLength(0);
		const errorBanner = h.target.querySelector('[data-testid="conversation-error"]');
		expect(errorBanner).toBeNull();
		unmount(h.instance);
		h.target.remove();
	});
});
