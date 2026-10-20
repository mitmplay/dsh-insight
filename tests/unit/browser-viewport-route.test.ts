/**
 * /api/browser/[id]/viewport route tests — the sizing seam (ADR-0031
 * amendment 2): shape-validate the JSON body, forward to the registry,
 * map BrowserRegistryRefusal codes to 404 (NO_SESSION) / 409 (CLOSED),
 * and rethrow anything else.
 *
 * Handler invoked directly with node-env Request objects; the registry
 * is mocked (the established goal-route.test.ts pattern). Run under the
 * 'node' environment per vitest.config.ts environmentMatchGlobs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above the imports — the spy must be too,
// because importing the route module runs the factory at import time. The
// real refusal class is re-created inside the factory (same wire shape:
// name/code/message) and re-exported so the test's instanceof-style check
// and the route's both see the SAME constructor.
const setViewportSpy = vi.hoisted(() => vi.fn());

vi.mock('$lib/server/browser/registry.js', () => {
	class BrowserRegistryRefusal extends Error {
		readonly code: string;
		constructor(code: string, message: string) {
			super(message);
			this.name = 'BrowserRegistryRefusal';
			this.code = code;
		}
	}
	return { browserRegistry: { setViewport: setViewportSpy }, BrowserRegistryRefusal };
});

import { BrowserRegistryRefusal } from '$lib/server/browser/registry.js';

import { POST } from '../../src/routes/api/browser/[id]/viewport/+server';

const ID = 'browser-1';

function post(rawBody: string): Promise<Response> {
	return POST({
		params: { id: ID },
		request: new Request('http://localhost/api/browser/' + ID + '/viewport', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: rawBody
		})
	} as never) as Promise<Response>;
}

function postJson(body: unknown): Promise<Response> {
	return post(JSON.stringify(body));
}

beforeEach(() => {
	setViewportSpy.mockReset();
	setViewportSpy.mockResolvedValue(undefined);
});

describe('POST /api/browser/[id]/viewport — validation', () => {
	it('a malformed JSON body is a 400 BAD_REQUEST before any registry call', async () => {
		const res = await post('{not json');
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'BAD_REQUEST' });
		expect(setViewportSpy).not.toHaveBeenCalled();
	});

	it.each([
		['missing width', { height: 600 }],
		['missing height', { width: 800 }],
		['string width', { width: '800', height: 600 }],
		['string height', { width: 800, height: '600' }],
		['null width', { width: null, height: 600 }],
		['NaN height', { width: 800, height: Number.NaN }],
		['Infinity width', { width: Number.POSITIVE_INFINITY, height: 600 }],
		['-Infinity height', { width: 800, height: Number.NEGATIVE_INFINITY }]
	])('%s is a 400 BAD_REQUEST', async (_label, body) => {
		const res = await postJson(body);
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'BAD_REQUEST' });
		expect(setViewportSpy).not.toHaveBeenCalled();
	});
});

describe('POST /api/browser/[id]/viewport — happy path', () => {
	it('forwards (id, width, height) to the registry and answers {ok:true}', async () => {
		const res = await postJson({ width: 800, height: 600 });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		expect(setViewportSpy).toHaveBeenCalledWith(ID, 800, 600);
	});

	it('zero and negative numbers are shapes-valid and still forwarded (registry clamps)', async () => {
		const res = await postJson({ width: 0, height: -5 });
		expect(res.status).toBe(200);
		expect(setViewportSpy).toHaveBeenCalledWith(ID, 0, -5);
	});
});

describe('POST /api/browser/[id]/viewport — refusal mapping', () => {
	it('NO_SESSION refusal maps to 404 with the verbatim code', async () => {
		setViewportSpy.mockRejectedValueOnce(
			new BrowserRegistryRefusal('NO_SESSION', 'no session browser-1')
		);
		const res = await postJson({ width: 800, height: 600 });
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: 'NO_SESSION' });
	});

	it('CLOSED refusal maps to 409 with the verbatim code', async () => {
		setViewportSpy.mockRejectedValueOnce(new BrowserRegistryRefusal('CLOSED', 'session closed'));
		const res = await postJson({ width: 800, height: 600 });
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: 'CLOSED' });
	});

	it('an unknown error is rethrown (not swallowed into a 4xx)', async () => {
		setViewportSpy.mockRejectedValueOnce(new Error('boom'));
		await expect(postJson({ width: 800, height: 600 })).rejects.toThrow('boom');
	});
});
