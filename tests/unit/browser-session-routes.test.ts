/**
 * /api/browser route-family tests — the session table (GET/POST), the
 * tab switcher (activate), and the tab strip feed (tabs). Handlers are
 * invoked directly with node-env Request objects; the registry is
 * mocked (the browser-viewport-route.test.ts pattern). Run under the
 * 'node' environment via serverOnlyTestFiles in vitest.config.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { listSpy, openSpy, isClosedSpy, activateSpy, listTabsSpy } = vi.hoisted(() => ({
	listSpy: vi.fn(),
	openSpy: vi.fn(),
	isClosedSpy: vi.fn(),
	activateSpy: vi.fn(),
	listTabsSpy: vi.fn()
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
			list: listSpy,
			open: openSpy,
			isClosed: isClosedSpy,
			activate: activateSpy,
			listTabs: listTabsSpy
		},
		BrowserRegistryRefusal
	};
});

import { BrowserRegistryRefusal } from '$lib/server/browser/registry.js';

import { GET, POST } from '../../src/routes/api/browser/+server';
import { POST as POST_ACTIVATE } from '../../src/routes/api/browser/[id]/activate/+server';
import { GET as GET_TABS } from '../../src/routes/api/browser/[id]/tabs/+server';

const ID = 'browser-1';

function postRequest(rawBody: unknown): Request {
	const init: RequestInit = { method: 'POST' };
	if (rawBody !== undefined) {
		init.body = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody);
		init.headers = { 'content-type': 'application/json' };
	}
	return new Request('http://localhost/api/browser', init);
}

beforeEach(() => {
	for (const spy of [listSpy, openSpy, isClosedSpy, activateSpy, listTabsSpy]) spy.mockReset();
	isClosedSpy.mockReturnValue(false);
});

describe('GET /api/browser — session table', () => {
	it('answers {sessions: registry.list()}', async () => {
		listSpy.mockReturnValueOnce([{ id: ID }]);
		const res = await GET();
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ sessions: [{ id: ID }] });
		expect(listSpy).toHaveBeenCalledTimes(1);
	});
});

describe('POST /api/browser — body shaping', () => {
	it('without an event the opener runs with undefined width/height', async () => {
		openSpy.mockResolvedValueOnce({ id: ID, port: 9222 });
		const res = await POST();
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ id: ID, port: 9222 });
		expect(openSpy).toHaveBeenCalledWith({ width: undefined, height: undefined });
	});

	it('an event with no request also gets the defaults', async () => {
		openSpy.mockResolvedValueOnce({ id: ID, port: 9222 });
		const res = await POST({} as never);
		expect(res.status).toBe(200);
		expect(openSpy).toHaveBeenCalledWith({ width: undefined, height: undefined });
	});

	it('a malformed JSON body falls through to the defaults (empty-body arm)', async () => {
		openSpy.mockResolvedValueOnce({ id: ID, port: 9222 });
		const res = await POST({ request: postRequest('{not json') } as never);
		expect(res.status).toBe(200);
		expect(openSpy).toHaveBeenCalledWith({ width: undefined, height: undefined });
	});

	it('valid width/height are rounded and forwarded', async () => {
		openSpy.mockResolvedValueOnce({ id: ID, port: 9222 });
		await POST({ request: postRequest({ width: 800.6, height: 600.4 }) } as never);
		expect(openSpy).toHaveBeenCalledWith({ width: 801, height: 600 });
	});

	it.each([
		['width below the 200 floor', { width: 199, height: 600 }],
		['height below the 120 floor', { width: 800, height: 119 }]
	])('%s is dropped (defaults apply), the other field survives', async (_label, body) => {
		openSpy.mockResolvedValueOnce({ id: ID, port: 9222 });
		await POST({ request: postRequest(body as { width: number; height: number }) } as never);
		const arg = openSpy.mock.calls[0][0] as { width?: number; height?: number };
		if ('width' in body && (body as { width: number }).width === 199) {
			expect(arg.width).toBeUndefined();
			expect(arg.height).toBe(600);
		} else {
			expect(arg.width).toBe(800);
			expect(arg.height).toBeUndefined();
		}
	});

	it('a registry open failure is a 500 OPEN_FAILED with the message', async () => {
		openSpy.mockRejectedValueOnce(new Error('chrome not found'));
		const res = await POST({ request: postRequest({ width: 800, height: 600 }) } as never);
		expect(res.status).toBe(500);
		expect(await res.json()).toEqual({ error: 'OPEN_FAILED', message: 'chrome not found' });
	});
});

describe('POST /api/browser/[id]/activate', () => {
	function activate(rawBody: unknown): Promise<Response> {
		const init: RequestInit = { method: 'POST' };
		if (rawBody !== undefined) {
			init.body = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody);
			init.headers = { 'content-type': 'application/json' };
		}
		return POST_ACTIVATE({
			params: { id: ID },
			request: new Request('http://localhost/activate', init)
		} as never) as Promise<Response>;
	}

	it('a closed session is a 409 before the body is even read', async () => {
		isClosedSpy.mockReturnValueOnce(true);
		const res = await activate('{not json');
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: 'CLOSED' });
		expect(activateSpy).not.toHaveBeenCalled();
	});

	it('a malformed JSON body is a 400 BAD_REQUEST', async () => {
		const res = await activate('{not json');
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'BAD_REQUEST' });
	});

	it.each([
		['missing targetId', {}],
		['null targetId', { targetId: null }],
		['non-string targetId', { targetId: 42 }],
		['empty targetId', { targetId: '' }]
	])('%s is a 400 BAD_REQUEST', async (_label, body) => {
		const res = await activate(body);
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'BAD_REQUEST' });
		expect(activateSpy).not.toHaveBeenCalled();
	});

	it('a valid targetId is forwarded to the registry', async () => {
		activateSpy.mockResolvedValueOnce({ seq: 7 });
		const res = await activate({ targetId: 'page-2' });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ seq: 7 });
		expect(activateSpy).toHaveBeenCalledWith(ID, 'page-2');
	});

	it('NO_SESSION and NO_TARGET refusals both map to 404', async () => {
		activateSpy.mockRejectedValueOnce(new BrowserRegistryRefusal('NO_SESSION', 'gone'));
		let res = await activate({ targetId: 'page-2' });
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: 'NO_SESSION', reason: 'gone' });

		activateSpy.mockRejectedValueOnce(new BrowserRegistryRefusal('NO_TARGET', 'no tab'));
		res = await activate({ targetId: 'page-9' });
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: 'NO_TARGET', reason: 'no tab' });
	});

	it('any other refusal code maps to 409', async () => {
		activateSpy.mockRejectedValueOnce(new BrowserRegistryRefusal('CLOSED', 'session closed'));
		const res = await activate({ targetId: 'page-2' });
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: 'CLOSED', reason: 'session closed' });
	});

	it('an unknown error is rethrown', async () => {
		activateSpy.mockRejectedValueOnce(new Error('boom'));
		await expect(activate({ targetId: 'page-2' })).rejects.toThrow('boom');
	});
});

describe('GET /api/browser/[id]/tabs', () => {
	function tabs(): Promise<Response> {
		return GET_TABS({ params: { id: ID } } as never) as Promise<Response>;
	}

	it('a closed session is a 409', async () => {
		isClosedSpy.mockReturnValueOnce(true);
		const res = await tabs();
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: 'CLOSED' });
		expect(listTabsSpy).not.toHaveBeenCalled();
	});

	it('the happy path answers {tabs: registry.listTabs(id)}', async () => {
		listTabsSpy.mockResolvedValueOnce([{ type: 'page', targetId: 'page-1' }]);
		const res = await tabs();
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ tabs: [{ type: 'page', targetId: 'page-1' }] });
		expect(listTabsSpy).toHaveBeenCalledWith(ID);
	});

	it('a NO_SESSION refusal maps to 404', async () => {
		listTabsSpy.mockRejectedValueOnce(new BrowserRegistryRefusal('NO_SESSION', 'gone'));
		const res = await tabs();
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: 'NO_SESSION' });
	});

	it('any other refusal maps to 409', async () => {
		listTabsSpy.mockRejectedValueOnce(new BrowserRegistryRefusal('CLOSED', 'session closed'));
		const res = await tabs();
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: 'CLOSED' });
	});

	it('an unknown error is rethrown', async () => {
		listTabsSpy.mockRejectedValueOnce(new Error('boom'));
		await expect(tabs()).rejects.toThrow('boom');
	});
});
