import { beforeEach, describe, expect, it, vi } from 'vitest';

// mock the registry — the history route handlers only touch
// isClosed/navEntries (GET) and isClosed/historyTravel (POST)
class Refusal extends Error {
	readonly code: 'NO_SESSION' | 'CLOSED' | 'NO_TARGET' | 'BUSY';
	constructor(code: 'NO_SESSION' | 'CLOSED' | 'NO_TARGET' | 'BUSY') {
		super(code);
		this.name = 'BrowserRegistryRefusal';
		this.code = code;
	}
}

const isClosed = vi.fn();
const navEntries = vi.fn();
const historyTravel = vi.fn();

vi.mock('$lib/server/browser/registry.js', () => ({
	BrowserRegistryRefusal: Refusal,
	browserRegistry: {
		isClosed: (...a: unknown[]) => isClosed(...a),
		navEntries: (...a: unknown[]) => navEntries(...a),
		historyTravel: (...a: unknown[]) => historyTravel(...a),
	},
}));

const mod = await import('../../src/routes/api/browser/[id]/history/+server');
const GET = mod.GET;
const POST = mod.POST;

// GET reads ?targetId off ctx.url; POST reads the JSON body
const getCtx = (id: string, targetId?: string) => ({
	params: { id },
	url: new URL('http://localhost/api/browser/' + id + (targetId ? '?targetId=' + targetId : '')),
});
const postCtx = (id: string, body: unknown) => ({
	params: { id },
	request: { json: () => Promise.resolve(body) } as unknown as Request,
});

beforeEach(() => {
	isClosed.mockReset();
	navEntries.mockReset();
	historyTravel.mockReset();
});

describe('GET /api/browser/[id]/history', () => {
	it('409 CLOSED when the session is already closed (checked before navEntries)', async () => {
		isClosed.mockReturnValue(true);
		const res = await GET(getCtx('dead'));
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: 'CLOSED' });
		expect(navEntries).not.toHaveBeenCalled();
	});

	it('happy path: returns the focused tab\'s history JSON verbatim', async () => {
		isClosed.mockReturnValue(false);
		navEntries.mockResolvedValue({ currentIndex: 2, entries: [{ url: 'a' }, { url: 'b' }] });
		const res = await GET(getCtx('live', 'tgt-1'));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ currentIndex: 2, entries: [{ url: 'a' }, { url: 'b' }] });
		expect(navEntries).toHaveBeenCalledWith('live', 'tgt-1');
	});

	it('no ?targetId: navEntries receives undefined', async () => {
		isClosed.mockReturnValue(false);
		navEntries.mockResolvedValue({ currentIndex: 0, entries: [] });
		const res = await GET(getCtx('live'));
		expect(res.status).toBe(200);
		expect(navEntries).toHaveBeenCalledWith('live', undefined);
	});

	it('refusal mapping: NO_SESSION/NO_TARGET → 404, CLOSED/BUSY → 409', async () => {
		isClosed.mockReturnValue(false);
		navEntries.mockRejectedValue(new Refusal('NO_SESSION'));
		expect((await GET(getCtx('gone'))).status).toBe(404);
		navEntries.mockRejectedValue(new Refusal('NO_TARGET'));
		const b = await GET(getCtx('live'));
		expect(b.status).toBe(404);
		expect(await b.json()).toEqual({ error: 'NO_TARGET', reason: 'NO_TARGET' });
		navEntries.mockRejectedValue(new Refusal('CLOSED'));
		expect((await GET(getCtx('raced'))).status).toBe(409);
		navEntries.mockRejectedValue(new Refusal('BUSY'));
		expect((await GET(getCtx('live'))).status).toBe(409);
	});

	it('unexpected errors rethrow (not swallowed into a 4xx)', async () => {
		isClosed.mockReturnValue(false);
		navEntries.mockRejectedValue(new Error('cdp gone'));
		await expect(GET(getCtx('live'))).rejects.toThrow('cdp gone');
	});
});

describe('POST /api/browser/[id]/history', () => {
	it('409 CLOSED when the session is already closed (before body parse)', async () => {
		isClosed.mockReturnValue(true);
		const res = await POST(postCtx('dead', { index: 1 }));
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: 'CLOSED' });
	});

	it('400 BAD_REQUEST on an unparsable body', async () => {
		isClosed.mockReturnValue(false);
		const ctx = { params: { id: 'x' }, request: { json: () => Promise.reject(new Error('nope')) } as unknown as Request };
		const res = await POST(ctx);
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: 'BAD_REQUEST' });
	});

	it('400 BAD_REQUEST when index is not a number', async () => {
		isClosed.mockReturnValue(false);
		expect((await POST(postCtx('x', { index: '2' }))).status).toBe(400);
		expect((await POST(postCtx('x', {}))).status).toBe(400);
	});

	it('happy path: travels via historyTravel; empty targetId string becomes undefined', async () => {
		isClosed.mockReturnValue(false);
		historyTravel.mockResolvedValue({ ok: true, index: 3 });
		const res = await POST(postCtx('live', { targetId: '', index: 3 }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, index: 3 });
		expect(historyTravel).toHaveBeenCalledWith('live', 3, undefined);

		historyTravel.mockResolvedValue({ ok: true, index: 1 });
		await POST(postCtx('live', { targetId: 'tgt-9', index: 1 }));
		expect(historyTravel).toHaveBeenLastCalledWith('live', 1, 'tgt-9');
	});

	it('refusal mapping: NO_SESSION/NO_TARGET → 404, CLOSED/BUSY → 409', async () => {
		isClosed.mockReturnValue(false);
		historyTravel.mockRejectedValue(new Refusal('NO_SESSION'));
		expect((await POST(postCtx('gone', { index: 0 }))).status).toBe(404);
		historyTravel.mockRejectedValue(new Refusal('NO_TARGET'));
		const b = await POST(postCtx('live', { index: 0 }));
		expect(b.status).toBe(404);
		expect(await b.json()).toEqual({ error: 'NO_TARGET', reason: 'NO_TARGET' });
		historyTravel.mockRejectedValue(new Refusal('CLOSED'));
		expect((await POST(postCtx('live', { index: 0 }))).status).toBe(409);
		historyTravel.mockRejectedValue(new Refusal('BUSY'));
		const c = await POST(postCtx('live', { index: 0 }));
		expect(c.status).toBe(409);
		expect(await c.json()).toEqual({ error: 'BUSY', reason: 'BUSY' });
	});

	it('unexpected errors rethrow (not swallowed into a 4xx)', async () => {
		isClosed.mockReturnValue(false);
		historyTravel.mockRejectedValue(new Error('nav exploded'));
		await expect(POST(postCtx('live', { index: 0 }))).rejects.toThrow('nav exploded');
	});
});
