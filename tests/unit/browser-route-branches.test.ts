
/**
 * Branch-floor suite for the browser per-session route handlers
 * (navigate / stream / input). Mocks the registry + relay seams so every
 * validation and refusal branch is pinned deterministically — no headed
 * Chromium. Real-session wiring lives in browser-routes.test.ts and
 * browser-navigate.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { navigateMock, pageInfoMock, navInfoMock, peekMock, relayMock, dispatchMock, noteStreamOpenMock, noteStreamCloseMock } = vi.hoisted(() => ({
	navigateMock: vi.fn(),
	pageInfoMock: vi.fn(),
	navInfoMock: vi.fn(),
	peekMock: vi.fn(),
	relayMock: vi.fn(),
	dispatchMock: vi.fn(),
	noteStreamOpenMock: vi.fn(),
	noteStreamCloseMock: vi.fn()
}));

vi.mock('$lib/server/browser/registry.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/browser/registry.js')>();
	return {
		...actual,
		browserRegistry: {
			navigate: navigateMock,
			navInfo: navInfoMock,
			pageInfo: pageInfoMock,
			peek: peekMock,
			relay: relayMock,
			dispatch: dispatchMock,
			noteStreamOpen: noteStreamOpenMock,
			noteStreamClose: noteStreamCloseMock
		}
	};
});

import { BrowserRegistryRefusal } from '$lib/server/browser/registry.js';
import { POST as navigate } from '../../src/routes/api/browser/[id]/navigate/+server';
import { GET as stream } from '../../src/routes/api/browser/[id]/stream/+server';
import { POST as input } from '../../src/routes/api/browser/[id]/input/+server';

const refusal = (code: 'NO_SESSION' | 'CLOSED') => new BrowserRegistryRefusal(code, code); // (code, message) — codes are a closed union
const post = (body: unknown) =>
	body === undefined
		? new Request('http://x', { method: 'POST', body: 'not-json{' })
		: new Request('http://x', { method: 'POST', body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: { id } });
const streamCtx = (id: string, search = '') => ({ params: { id }, url: new URL('http://x/stream' + search) });

const realTextEncoder = globalThis.TextEncoder;

beforeEach(() => {
	vi.clearAllMocks();
});
afterEach(() => {
	vi.stubGlobal('TextEncoder', realTextEncoder);
});

describe('POST /api/browser/[id]/navigate', () => {
	it('returns 400 BAD_REQUEST for an unparseable body', async () => {
		const res = await navigate({ ...ctx('b1'), request: post(undefined) });
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'BAD_REQUEST' });
		expect(navigateMock).not.toHaveBeenCalled();
	});

	it('returns 400 BAD_URL for a non-string url', async () => {
		const res = await navigate({ ...ctx('b1'), request: post({ url: 42 }) });
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'BAD_URL' });
	});

	it('returns 400 BAD_URL for a disallowed scheme', async () => {
		const res = await navigate({ ...ctx('b1'), request: post({ url: 'javascript:alert(1)' }) });
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'BAD_URL' });
		expect(navigateMock).not.toHaveBeenCalled();
	});

	// VERDICT: source is authoritative — ADR-0031 amendments 5/6 (07ecce4,
	// ec20ad4) added the history witness navInfo() merged into the navigate
	// answer, so the route now spreads pageInfo + navInfo. Test updated to
	// the merged contract, not the old pageInfo-only shape.
	it('accepts https / data:text/html urls and lands pageInfo', async () => {
		navigateMock.mockResolvedValue(undefined);
		pageInfoMock.mockResolvedValue({ url: 'https://x.test/', title: 'X' });
		navInfoMock.mockResolvedValue({ currentIndex: 0, entryCount: 1 });
		const res = await navigate({ ...ctx('b1'), request: post({ url: 'https://x.test/' }) });
		expect(navigateMock).toHaveBeenCalledWith('b1', 'https://x.test/', { waitLoad: true });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ url: 'https://x.test/', title: 'X', currentIndex: 0, entryCount: 1 });

		navigateMock.mockClear();
		pageInfoMock.mockResolvedValue({ url: 'data:text/html,<b>x</b>', title: '' });
		navInfoMock.mockResolvedValue({ currentIndex: 0, entryCount: 1 });
		const res2 = await navigate({ ...ctx('b1'), request: post({ url: 'data:text/html,<b>x</b>' }) });
		expect(res2.status).toBe(200);
		expect(navigateMock).toHaveBeenCalledWith('b1', 'data:text/html,<b>x</b>', { waitLoad: true });
	});

	// VERDICT: source is authoritative — the refusal body now carries
	// reason: err.message alongside error: err.code (status mapping 404/409
	// unchanged), so the pinned body gains the reason field.
	it('maps NO_SESSION refusal to 404 and other refusals to 409', async () => {
		navigateMock.mockRejectedValueOnce(refusal('NO_SESSION'));
		const r404 = await navigate({ ...ctx('gone'), request: post({ url: 'https://x.test' }) });
		expect(r404.status).toBe(404);
		expect(await r404.json()).toEqual({ error: 'NO_SESSION', reason: 'NO_SESSION' });

		navigateMock.mockRejectedValueOnce(refusal('CLOSED'));
		const r409 = await navigate({ ...ctx('b1'), request: post({ url: 'https://x.test' }) });
		expect(r409.status).toBe(409);
		expect(await r409.json()).toEqual({ error: 'CLOSED', reason: 'CLOSED' });
	});

	it('rethrows non-refusal errors', async () => {
		navigateMock.mockRejectedValueOnce(new Error('boom'));
		await expect(navigate({ ...ctx('b1'), request: post({ url: 'https://x.test' }) })).rejects.toThrow('boom');
	});
});

describe('GET /api/browser/[id]/stream', () => {
	const makeRelay = (latest: { seq: number; jpeg?: string } | null, onSubscribe?: (cb: (f: unknown) => void) => void) => ({
		latestFrame: vi.fn(() => latest),
		subscribe: vi.fn((cb: (f: unknown) => void) => {
			onSubscribe?.(cb);
			return vi.fn();
		})
	});

	it('peek NO_SESSION refusal maps to 404', async () => {
		peekMock.mockImplementationOnce(() => {
			throw refusal('NO_SESSION');
		});
		const res = stream({ ...streamCtx('gone') });
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: 'NO_SESSION' });
	});

	it('other peek refusal maps to 403', async () => {
		peekMock.mockImplementationOnce(() => {
			throw refusal('CLOSED'); // the union's second member — maps to 403 on peek
		});
		const res = stream({ ...streamCtx('b1') });
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: 'CLOSED' });
	});

	it('rethrows non-refusal peek errors', () => {
		peekMock.mockImplementationOnce(() => {
			throw new Error('boom');
		});
		expect(() => stream({ ...streamCtx('b1') })).toThrow('boom');
	});

	it('speaks SSE headers and resumes a late attacher from the latest frame when fromSeq is behind', async () => {
		const relay = makeRelay({ seq: 7, jpeg: 'QQ==' });
		relayMock.mockReturnValue(relay);
		const res = stream({ ...streamCtx('b1', '?fromSeq=3') });
		expect(res.headers.get('content-type')).toBe('text/event-stream');
		expect(res.headers.get('content-encoding')).toBe('identity');
		const reader = res.body!.getReader();
		const chunk = new TextDecoder().decode((await reader.read()).value);
		expect(chunk).toContain('event: frame');
		const data = JSON.parse(chunk.split('data: ')[1]);
		expect(data).toEqual({ seq: 7, jpeg: 'QQ==' });
		expect(relay.latestFrame).toHaveBeenCalled();
		expect(relay.subscribe).toHaveBeenCalledOnce();
		await reader.cancel();
	});

	it('does NOT replay the latest frame when fromSeq already has it or is unparseable', async () => {
		relayMock.mockReturnValue(makeRelay({ seq: 7 }));
		const res = stream({ ...streamCtx('b1', '?fromSeq=7') });
		const reader = res.body!.getReader();
		expect((await Promise.race([reader.read(), 'pending']))).toBe('pending');
		await reader.cancel();

		relayMock.mockReturnValue(makeRelay({ seq: 7 }));
		const nan = stream({ ...streamCtx('b1', '?fromSeq=potato') });
		const nanReader = nan.body!.getReader();
		expect((await Promise.race([nanReader.read(), 'pending']))).toBe('pending');
		await nanReader.cancel();
	});

	it('does NOT replay anything when the relay has no latest frame', async () => {
		relayMock.mockReturnValue(makeRelay(null));
		const res = stream({ ...streamCtx('b1') });
		const reader = res.body!.getReader();
		expect((await Promise.race([reader.read(), 'pending']))).toBe('pending');
		await reader.cancel();
	});

	it('pushes live subscribed frames downstream', async () => {
		let fire: (f: unknown) => void = () => {};
		const unsub = vi.fn();
		relayMock.mockReturnValue({
			latestFrame: vi.fn(() => null),
			subscribe: vi.fn((cb: (f: unknown) => void) => {
				fire = cb;
				return unsub;
			})
		});
		const res = stream({ ...streamCtx('b1') });
		const reader = res.body!.getReader();
		fire({ seq: 8, jpeg: 'gg==' });
		const chunk = await reader.read();
		expect(new TextDecoder().decode(chunk.value)).toContain('"seq":8');
		expect(chunk.done).toBe(false);
		await reader.cancel();
		expect(unsub).toHaveBeenCalledOnce();
	});

	it('drops the subscriber when the client goes away (cancel arm)', async () => {
		const unsub = vi.fn();
		relayMock.mockReturnValue({
			latestFrame: vi.fn(() => null),
			subscribe: vi.fn(() => unsub)
		});
		const res = stream({ ...streamCtx('b1') });
		await res.body!.cancel();
		expect(unsub).toHaveBeenCalledOnce();
	});

	it('marks the stream closed and unsubscribes when encoding/enqueue fails', async () => {
		const unsub = vi.fn();
		let fire: (f: unknown) => void = () => {};
		relayMock.mockReturnValue({
			latestFrame: vi.fn(() => null),
			subscribe: vi.fn((cb: (f: unknown) => void) => {
				fire = cb;
				return unsub;
			})
		});
		let calls = 0;
		vi.stubGlobal(
			'TextEncoder',
			class {
				encode(): Uint8Array {
					calls += 1;
					if (calls > 1) throw new Error('controller gone');
					return new Uint8Array(0);
				}
			}
		);
		const res = stream({ ...streamCtx('b1') });
		const reader = res.body!.getReader();
		fire({ seq: 9 }); // first encode OK
		await reader.read();
		fire({ seq: 10 }); // second encode throws → off() + closed flag
		expect(unsub).toHaveBeenCalledOnce();
		fire({ seq: 11 }); // closed guard swallows it
		await reader.cancel();
	});
});

describe('POST /api/browser/[id]/input', () => {
	it('returns 400 BAD_REQUEST for an unparseable body', async () => {
		const res = await input({ ...ctx('b1'), request: post(undefined) });
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'BAD_REQUEST' });
		expect(dispatchMock).not.toHaveBeenCalled();
	});

	const badBodies: unknown[] = [
		[null, 'null body'],
		['string', 'non-object body'],
		[{ kind: 'mouse', type: 'mousePressed' }, 'mouse missing x/y'],
		[{ kind: 'mouse', type: 'mouseMoved', x: NaN, y: 1 }, 'mouse non-finite x'],
		[{ kind: 'mouse', type: 'mouseTeleport', x: 1, y: 2 }, 'mouse unknown type'],
		[{ kind: 'key', type: 'keyDown', key: 'a' }, 'key missing code'],
		[{ kind: 'key', type: 'keyHold', key: 'a', code: 'KeyA' }, 'key unknown type'],
		[{ kind: 'text' }, 'text missing payload'],
		[{ kind: 'text', text: 'x'.repeat(4096) }, 'text at the 4096 cap'],
		[{ kind: 'wat' }, 'unknown kind']
	];
	it.each(badBodies)('rejects %j (%s) with 400 BAD_INPUT', async (body) => {
		const res = await input({ ...ctx('b1'), request: post(body) });
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'BAD_INPUT' });
		expect(dispatchMock).not.toHaveBeenCalled();
	});

	it('normalizes a full mouse dispatch', async () => {
		dispatchMock.mockResolvedValue(undefined);
		const res = await input({
			...ctx('b1'),
			request: post({ kind: 'mouse', type: 'mouseWheel', x: 3, y: 4, button: 'middle', clickCount: 2, deltaX: 0.5, deltaY: -1 })
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		expect(dispatchMock).toHaveBeenCalledWith('b1', {
			kind: 'mouse',
			type: 'mouseWheel',
			x: 3,
			y: 4,
			button: 'middle',
			clickCount: 2,
			deltaX: 0.5,
			deltaY: -1
		}, undefined); // ADR-0040 D3: absent targetId = active tab (explicit undefined)
	});

	it('leaves mouse optionals undefined; string coords are NOT coerced (rejected)', async () => {
		dispatchMock.mockResolvedValue(undefined);
		const res = await input({ ...ctx('b1'), request: post({ kind: 'mouse', type: 'mouseMoved', x: 5, y: 6 }) });
		expect(res.status).toBe(200);
		expect(dispatchMock).toHaveBeenCalledWith('b1', {
			kind: 'mouse',
			type: 'mouseMoved',
			x: 5,
			y: 6,
			button: undefined,
			clickCount: undefined,
			deltaX: undefined,
			deltaY: undefined
		}, undefined);

		const strCoords = await input({ ...ctx('b1'), request: post({ kind: 'mouse', type: 'mouseMoved', x: '5', y: '6' }) });
		expect(strCoords.status).toBe(400);
		expect(await strCoords.json()).toEqual({ error: 'BAD_INPUT' });
	});

	it('normalizes a key dispatch; missing/NaN windowsVirtualKeyCode defaults to 0', async () => {
		dispatchMock.mockResolvedValue(undefined);
		await input({ ...ctx('b1'), request: post({ kind: 'key', type: 'keyDown', key: 'a', code: 'KeyA' }) });
		expect(dispatchMock).toHaveBeenLastCalledWith('b1', {
			kind: 'key',
			type: 'keyDown',
			key: 'a',
			code: 'KeyA',
			windowsVirtualKeyCode: 0,
			text: undefined
		}, undefined);
		await input({ ...ctx('b1'), request: post({ kind: 'key', type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, text: 'a' }) });
		expect(dispatchMock).toHaveBeenLastCalledWith('b1', {
			kind: 'key',
			type: 'keyUp',
			key: 'a',
			code: 'KeyA',
			windowsVirtualKeyCode: 65,
			text: 'a'
		}, undefined);
	});

	it('accepts a short text dispatch verbatim', async () => {
		dispatchMock.mockResolvedValue(undefined);
		const res = await input({ ...ctx('b1'), request: post({ kind: 'text', text: 'hello' }) });
		expect(res.status).toBe(200);
		expect(dispatchMock).toHaveBeenCalledWith('b1', { kind: 'text', text: 'hello' }, undefined);
	});

	it('maps NO_SESSION refusal to 404 and other refusals to 409', async () => {
		dispatchMock.mockRejectedValueOnce(refusal('NO_SESSION'));
		expect((await input({ ...ctx('gone'), request: post({ kind: 'text', text: 'hi' }) })).status).toBe(404);

		dispatchMock.mockRejectedValueOnce(refusal('CLOSED'));
		const r409 = await input({ ...ctx('b1'), request: post({ kind: 'text', text: 'hi' }) });
		expect(r409.status).toBe(409);
		expect(await r409.json()).toEqual({ error: 'CLOSED' });
	});

	it('maps a RelayClosedError to 409 CLOSED', async () => {
		const err = new Error('relay shut');
		err.name = 'RelayClosedError';
		dispatchMock.mockRejectedValueOnce(err);
		const res = await input({ ...ctx('b1'), request: post({ kind: 'text', text: 'hi' }) });
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: 'CLOSED' });
	});

	it('rethrows non-refusal, non-relay errors', async () => {
		dispatchMock.mockRejectedValueOnce(new Error('boom'));
		await expect(input({ ...ctx('b1'), request: post({ kind: 'text', text: 'hi' }) })).rejects.toThrow('boom');
	});
});