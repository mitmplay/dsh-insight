/**
 * /api/browser/[id]/closetab, /opentab, /element route tests — the glass
 * context-menu data pass seams (BUGFIX 2026-10-25). Same pattern as
 * browser-viewport-route.test.ts: handler invoked directly with node-env
 * Request objects, registry mocked, refusal codes mapped to 404 (NO_SESSION
 * / NO_TARGET) or 409 (CLOSED), unknown errors rethrown. Runs under the
 * 'node' project via serverOnlyTestFiles.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const spies = vi.hoisted(() => ({
	isClosed: vi.fn(),
	closeTab: vi.fn(),
	openTab: vi.fn(),
	elementAt: vi.fn()
}));

vi.mock('$lib/server/browser/registry.js', () => {
	class BrowserRegistryRefusal extends Error {
		readonly code: string;
		constructor(code: string, message: string) {
			super(message);
			this.name = 'BrowserRegistryRefusal';
			this.code = code;
		}
	}
	return {
		browserRegistry: {
			isClosed: spies.isClosed,
			closeTab: spies.closeTab,
			openTab: spies.openTab,
			elementAt: spies.elementAt
		},
		BrowserRegistryRefusal
	};
});

import { BrowserRegistryRefusal } from '$lib/server/browser/registry.js';

import { POST as closeTabPOST } from '../../src/routes/api/browser/[id]/closetab/+server';
import { POST as openTabPOST } from '../../src/routes/api/browser/[id]/opentab/+server';
import { POST as elementPOST } from '../../src/routes/api/browser/[id]/element/+server';

const ID = 'browser-1';

function call(handler: (ctx: never) => Promise<Response>, rawBody: string): Promise<Response> {
	return handler({
		params: { id: ID },
		request: new Request('http://localhost/api/browser/' + ID, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: rawBody
		})
	} as never) as Promise<Response>;
}

const postClose = (raw: string) => call(closeTabPOST as never, raw);
const postOpen = (raw: string) => call(openTabPOST as never, raw);
const postElement = (raw: string) => call(elementPOST as never, raw);
const postJson = (post: (raw: string) => Promise<Response>, body: unknown) => post(JSON.stringify(body));

beforeEach(() => {
	for (const spy of Object.values(spies)) spy.mockReset();
	spies.isClosed.mockReturnValue(false);
	spies.closeTab.mockResolvedValue({ ok: true });
	spies.openTab.mockResolvedValue({ ok: true, targetId: 't2' });
	spies.elementAt.mockResolvedValue({ href: 'https://x', text: 'hi' });
});

describe('all three routes — closed-session gate', () => {
	it.each([
		['closetab', postClose],
		['opentab', postOpen],
		['element', postElement]
	])('%s answers 409 CLOSED and never touches the registry when isClosed', async (_label, post) => {
		spies.isClosed.mockReturnValue(true);
		const res = await post(JSON.stringify({}));
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: 'CLOSED' });
		expect(spies.closeTab).not.toHaveBeenCalled();
		expect(spies.openTab).not.toHaveBeenCalled();
		expect(spies.elementAt).not.toHaveBeenCalled();
	});
});

describe('POST closetab', () => {
	it('malformed JSON is a 400 BAD_REQUEST before the registry', async () => {
		const res = await postClose('{nope');
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'BAD_REQUEST' });
		expect(spies.closeTab).not.toHaveBeenCalled();
	});

	it.each([
		['missing targetId', {}],
		['non-string targetId', { targetId: 42 }],
		['empty targetId', { targetId: '' }]
	])('%s is a 400 BAD_REQUEST', async (_label, body) => {
		const res = await postJson(postClose, body);
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'BAD_REQUEST' });
		expect(spies.closeTab).not.toHaveBeenCalled();
	});

	it('forwards (id, targetId) on the happy path', async () => {
		const res = await postJson(postClose, { targetId: 't1' });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		expect(spies.closeTab).toHaveBeenCalledWith(ID, 't1');
	});

	it('NO_TARGET refusal maps to 404, other refusals to 409', async () => {
		spies.closeTab.mockRejectedValueOnce(new BrowserRegistryRefusal('NO_TARGET', 'gone'));
		expect((await postJson(postClose, { targetId: 't1' })).status).toBe(404);

		spies.closeTab.mockRejectedValueOnce(new BrowserRegistryRefusal('CLOSED', 'closed'));
		const res = await postJson(postClose, { targetId: 't1' });
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: 'CLOSED', reason: 'closed' });
	});

	it('an unknown error is rethrown', async () => {
		spies.closeTab.mockRejectedValueOnce(new Error('boom'));
		await expect(postJson(postClose, { targetId: 't1' })).rejects.toThrow('boom');
	});
});

describe('POST opentab', () => {
	it('malformed JSON is a 400 BAD_REQUEST', async () => {
		const res = await postOpen('{nope');
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'BAD_REQUEST' });
		expect(spies.openTab).not.toHaveBeenCalled();
	});

	it.each([
		['non-string url', { url: 42 }],
		['ftp scheme', { url: 'ftp://x' }],
		['javascript scheme', { url: 'javascript:alert(1)' }],
		['non-html data url', { url: 'data:image/png;base64,AAAA' }]
	])('%s is a 400 BAD_URL', async (_label, body) => {
		const res = await postJson(postOpen, body);
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'BAD_URL' });
		expect(spies.openTab).not.toHaveBeenCalled();
	});

	it('an absent or empty url opens a BLANK tab (ADR-0042 D1) — forwarded as undefined', async () => {
		const res = await postJson(postOpen, {});
		expect(res.status).toBe(200);
		expect(spies.openTab).toHaveBeenCalledWith(ID, undefined);

		spies.openTab.mockClear();
		const empty = await postJson(postOpen, { url: '' });
		expect(empty.status).toBe(200);
		expect(spies.openTab).toHaveBeenCalledWith(ID, undefined);
	});

	it.each([
		['http url', { url: 'http://a.b' }],
		['https url', { url: 'https://a.b' }],
		['data:text/html url', { url: 'data:text/html,<h1>hi</h1>' }]
	])('%s is forwarded to openTab', async (_label, body) => {
		const res = await postJson(postOpen, body);
		expect(res.status).toBe(200);
		expect(spies.openTab).toHaveBeenCalledWith(ID, (body as { url: string }).url);
	});

	it('NO_SESSION refusal maps to 404, others to 409, unknown errors rethrow', async () => {
		spies.openTab.mockRejectedValueOnce(new BrowserRegistryRefusal('NO_SESSION', 'no session'));
		expect((await postJson(postOpen, { url: 'http://a.b' })).status).toBe(404);

		spies.openTab.mockRejectedValueOnce(new BrowserRegistryRefusal('NO_TARGET', 'no target'));
		expect((await postJson(postOpen, { url: 'http://a.b' })).status).toBe(404);

		spies.openTab.mockRejectedValueOnce(new BrowserRegistryRefusal('BUSY', 'busy'));
		expect((await postJson(postOpen, { url: 'http://a.b' })).status).toBe(409);

		spies.openTab.mockRejectedValueOnce(new Error('boom'));
		await expect(postJson(postOpen, { url: 'http://a.b' })).rejects.toThrow('boom');
	});
});

describe('POST element', () => {
	it('malformed JSON is a 400 BAD_REQUEST', async () => {
		const res = await postElement('{nope');
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'BAD_REQUEST' });
		expect(spies.elementAt).not.toHaveBeenCalled();
	});

	it.each([
		['missing x', { y: 5 }],
		['missing y', { x: 5 }],
		['string x', { x: '5', y: 5 }],
		['string y', { x: 5, y: '5' }],
		['NaN x', { x: Number.NaN, y: 5 }],
		['Infinity y', { x: 5, y: Number.POSITIVE_INFINITY }]
	])('%s is a 400 BAD_REQUEST', async (_label, body) => {
		const res = await postJson(postElement, body);
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'BAD_REQUEST' });
		expect(spies.elementAt).not.toHaveBeenCalled();
	});

	it('forwards (id, x, y) with targetId undefined when absent/empty/non-string', async () => {
		await postJson(postElement, { x: 1, y: 2 });
		expect(spies.elementAt).toHaveBeenCalledWith(ID, 1, 2, undefined);

		await postJson(postElement, { x: 1, y: 2, targetId: '' });
		expect(spies.elementAt).toHaveBeenLastCalledWith(ID, 1, 2, undefined);

		await postJson(postElement, { x: 1, y: 2, targetId: 7 });
		expect(spies.elementAt).toHaveBeenLastCalledWith(ID, 1, 2, undefined);
	});

	it('forwards a non-empty string targetId', async () => {
		await postJson(postElement, { x: 1, y: 2, targetId: 't9' });
		expect(spies.elementAt).toHaveBeenCalledWith(ID, 1, 2, 't9');
	});

	it('NO_SESSION / NO_TARGET refusals map to 404, others to 409, unknown rethrow', async () => {
		spies.elementAt.mockRejectedValueOnce(new BrowserRegistryRefusal('NO_SESSION', 'no session'));
		expect((await postJson(postElement, { x: 1, y: 2 })).status).toBe(404);

		spies.elementAt.mockRejectedValueOnce(new BrowserRegistryRefusal('NO_TARGET', 'no target'));
		expect((await postJson(postElement, { x: 1, y: 2 })).status).toBe(404);

		spies.elementAt.mockRejectedValueOnce(new BrowserRegistryRefusal('CLOSED', 'closed'));
		const res = await postJson(postElement, { x: 1, y: 2 });
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: 'CLOSED' });

		spies.elementAt.mockRejectedValueOnce(new Error('boom'));
		await expect(postJson(postElement, { x: 1, y: 2 })).rejects.toThrow('boom');
	});
});
