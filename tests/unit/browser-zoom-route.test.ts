/**
 * /api/browser/[id]/zoom route tests — the live zoom slider's wire door
 * (2026-10-28). POST shape-validates via the REAL clampZoom (0.5..1.25,
 * finite numbers only), forwards to registry.setZoom, and maps
 * BrowserRegistryRefusal to 404 (NO_SESSION) / 409 (everything else).
 * GET answers the session zoom (or the config fallback) plus knobEnabled.
 *
 * Handler invoked directly with node-env Request objects; browserRegistry
 * is mocked (browser-viewport-route.test.ts pattern) while clampZoom and
 * BrowserRegistryRefusal are re-exported from the real module so the route
 * and the test see identical shapes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const setZoomSpy = vi.hoisted(() => vi.fn());
const peekSpy = vi.hoisted(() => vi.fn());
const readBrowserConfigSpy = vi.hoisted(() =>
	vi.fn(() => ({ contentZoom: 1.1 }))
);

vi.mock('$lib/server/browser/registry.js', async (importOriginal) => {
	const real = await importOriginal<typeof import('$lib/server/browser/registry.js')>();
	return {
		...real,
		browserRegistry: { setZoom: setZoomSpy, peek: peekSpy }
	};
});

vi.mock('$lib/server/insight-config.js', () => ({
	readBrowserConfig: readBrowserConfigSpy
}));

import { BrowserRegistryRefusal } from '$lib/server/browser/registry.js';

import { GET, POST } from '../../src/routes/api/browser/[id]/zoom/+server';

const ID = 'browser-zoom-1';

function post(rawBody: string): Promise<Response> {
	return POST({
		params: { id: ID },
		request: new Request('http://localhost/api/browser/' + ID + '/zoom', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: rawBody
		})
	} as never) as Promise<Response>;
}

function postJson(body: unknown): Promise<Response> {
	return post(JSON.stringify(body));
}

function get(): Promise<Response> {
	return GET({ params: { id: ID } } as never) as Promise<Response>;
}

beforeEach(() => {
	setZoomSpy.mockReset();
	setZoomSpy.mockResolvedValue(undefined);
	peekSpy.mockReset();
	readBrowserConfigSpy.mockClear();
	readBrowserConfigSpy.mockImplementation(() => ({ contentZoom: 1.1 }));
});

describe('POST /api/browser/[id]/zoom — validation', () => {
	it('a malformed JSON body is a 400 BAD_REQUEST before any registry call', async () => {
		const res = await post('{not json');
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'BAD_REQUEST' });
		expect(setZoomSpy).not.toHaveBeenCalled();
	});

	it.each([
		['missing zoom', {}],
		['string zoom', { zoom: '1.2' }],
		['null zoom', { zoom: null }],
		['NaN zoom', { zoom: Number.NaN }],
		['Infinity zoom', { zoom: Number.POSITIVE_INFINITY }],
		['below the floor (0.49)', { zoom: 0.49 }],
		['above the ceiling (1.26)', { zoom: 1.26 }],
		['zero', { zoom: 0 }],
		['negative', { zoom: -1 }]
	])('%s is a 400 BAD_REQUEST', async (_label, body) => {
		const res = await postJson(body);
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'BAD_REQUEST' });
		expect(setZoomSpy).not.toHaveBeenCalled();
	});
});

describe('POST /api/browser/[id]/zoom — happy path', () => {
	it.each([
		['the floor 0.5', 0.5],
		['a mid value', 0.8],
		['the ceiling 1.25', 1.25]
	])('%s is forwarded to the registry and answers {ok:true, zoom}', async (_label, zoom) => {
		const res = await postJson({ zoom });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, zoom });
		expect(setZoomSpy).toHaveBeenCalledWith(ID, zoom);
	});
});

describe('POST /api/browser/[id]/zoom — refusal mapping', () => {
	it('NO_SESSION refusal maps to 404 with the verbatim code', async () => {
		setZoomSpy.mockRejectedValueOnce(
			new BrowserRegistryRefusal('NO_SESSION', 'no such browser session')
		);
		const res = await postJson({ zoom: 0.8 });
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: 'NO_SESSION' });
	});

	it('CLOSED refusal maps to 409 with the verbatim code', async () => {
		setZoomSpy.mockRejectedValueOnce(new BrowserRegistryRefusal('CLOSED', 'session is closing'));
		const res = await postJson({ zoom: 0.8 });
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: 'CLOSED' });
	});

	it('an unknown error is rethrown (not swallowed into a 4xx)', async () => {
		setZoomSpy.mockRejectedValueOnce(new Error('boom'));
		await expect(postJson({ zoom: 0.8 })).rejects.toThrow('boom');
	});
});

describe('GET /api/browser/[id]/zoom', () => {
	it('a live session answers its own zoom and knobEnabled from the config knob', async () => {
		peekSpy.mockReturnValue({ zoom: 0.75 });
		const res = await get();
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ zoom: 0.75, knobEnabled: true });
		expect(peekSpy).toHaveBeenCalledWith(ID);
	});

	it('knobEnabled follows the CONFIG knob, not the session zoom', async () => {
		readBrowserConfigSpy.mockImplementation(() => ({ contentZoom: 1 }));
		peekSpy.mockReturnValue({ zoom: 0.75 });
		const res = await get();
		expect(await res.json()).toEqual({ zoom: 0.75, knobEnabled: false });
	});

	it('a live session with no stored zoom falls back to the config contentZoom', async () => {
		peekSpy.mockReturnValue({ zoom: undefined });
		const res = await get();
		expect(await res.json()).toEqual({ zoom: 1.1, knobEnabled: true });
	});

	it('no live session (peek refuses) answers the config zoom alone', async () => {
		peekSpy.mockImplementation(() => {
			throw new BrowserRegistryRefusal('NO_SESSION', 'no such browser session');
		});
		const res = await get();
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ zoom: 1.1, knobEnabled: true });
	});
});
