/**
 * /api/browser (+server) body-parse arms (branch mop, 2026-11-10): the
 * registry-own-refusal contract is pinned elsewhere (browser-routes /
 * browser-route-branches); THIS file drives every request-body arm of the
 * opener with a MOCKED registry so the headed-Chromium path never starts:
 *  - GET list passthrough;
 *  - POST with NO event at all (event?.request false arm) — pure defaults;
 *  - POST with a full valid body (width/height/ownerSessionId/headedOpen);
 *  - POST with sub-minimum width/height (the >= 200 / >= 120 guard skips);
 *  - POST boundary width/height are rounded through Math.round;
 *  - POST with an UNPARSEABLE body (the inner catch — defaults apply);
 *  - POST where open() rejects (the outer catch — 500 OPEN_FAILED).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { openMock, listMock } = vi.hoisted(() => ({
	openMock: vi.fn(),
	listMock: vi.fn()
}));

vi.mock('$lib/server/browser/registry.js', () => ({
	browserRegistry: { open: openMock, list: listMock },
	BrowserRegistryRefusal: class BrowserRegistryRefusal extends Error {
		code: string;
		constructor(code: string, message: string) {
			super(message);
			this.code = code;
		}
	}
}));

import { GET as list, POST as open } from '../../src/routes/api/browser/+server';

const post = (body: unknown) =>
	new Request('http://x', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });

beforeEach(() => {
	openMock.mockReset();
	listMock.mockReset();
});

describe('GET /api/browser', () => {
	it('returns the registry list verbatim', async () => {
		listMock.mockReturnValue([{ id: 'b1', port: 9222 }]);
		const res = list();
		expect(await res.json()).toEqual({ sessions: [{ id: 'b1', port: 9222 }] });
	});
});

describe('POST /api/browser — request-body arms', () => {
	it('NO event at all: the opener runs with pure defaults (event?.request false arm)', async () => {
		openMock.mockResolvedValue({ id: 'b1', port: 9222 });
		const res = await open(); // route handler called with NO event object
		expect(res.status).toBe(200);
		expect(openMock).toHaveBeenCalledWith({ width: undefined, height: undefined, ownerSessionId: undefined, headedOpen: undefined });
	});

	it('a full valid body forwards every accepted field', async () => {
		openMock.mockResolvedValue({ id: 'b2', port: 9223 });
		const res = await open({ request: post({ width: 1280, height: 800, ownerSessionId: 'sess-9', headedOpen: true }) });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ id: 'b2', port: 9223 });
		expect(openMock).toHaveBeenCalledWith({ width: 1280, height: 800, ownerSessionId: 'sess-9', headedOpen: true });
	});

	it('sub-minimum width/height are skipped (guards >= 200 / >= 120)', async () => {
		openMock.mockResolvedValue({ id: 'b3', port: 9224 });
		await open({ request: post({ width: 199, height: 119 }) });
		expect(openMock).toHaveBeenCalledWith({ width: undefined, height: undefined, ownerSessionId: undefined, headedOpen: undefined });
	});

	it('boundary width/height pass and are rounded (Math.round arm)', async () => {
		openMock.mockResolvedValue({ id: 'b4', port: 9225 });
		await open({ request: post({ width: 200.4, height: 120.6 }) });
		expect(openMock).toHaveBeenCalledWith({ width: 200, height: 121, ownerSessionId: undefined, headedOpen: undefined });
	});

	it('an unparseable body hits the inner catch — defaults still open a session', async () => {
		openMock.mockResolvedValue({ id: 'b5', port: 9226 });
		const res = await open({ request: post('not-json{') });
		expect(res.status).toBe(200);
		expect(openMock).toHaveBeenCalledWith({ width: undefined, height: undefined, ownerSessionId: undefined, headedOpen: undefined });
	});

	it('headedOpen is only true on an EXPLICIT true (ADR-0046 D0 — !== true skips)', async () => {
		openMock.mockResolvedValue({ id: 'b6', port: 9227 });
		await open({ request: post({ headedOpen: 'yes' }) });
		expect(openMock).toHaveBeenCalledWith({ width: undefined, height: undefined, ownerSessionId: undefined, headedOpen: undefined });
	});

	it('an empty-string ownerSessionId is skipped (truthy guard)', async () => {
		openMock.mockResolvedValue({ id: 'b7', port: 9228 });
		await open({ request: post({ ownerSessionId: '' }) });
		expect(openMock).toHaveBeenCalledWith({ width: undefined, height: undefined, ownerSessionId: undefined, headedOpen: undefined });
	});

	it('an open() rejection maps to 500 OPEN_FAILED with the error message', async () => {
		openMock.mockRejectedValue(new Error('chromium gone'));
		const res = await open({ request: post({}) });
		expect(res.status).toBe(500);
		expect(await res.json()).toEqual({ error: 'OPEN_FAILED', message: 'chromium gone' });
	});
});
