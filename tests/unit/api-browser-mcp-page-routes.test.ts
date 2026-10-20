import { beforeEach, describe, expect, it, vi } from 'vitest';

// mock the registry — the route handlers only need list/isClosed/pageInfo
class Refusal extends Error {
	readonly code: 'NO_SESSION' | 'CLOSED';
	constructor(code: 'NO_SESSION' | 'CLOSED') {
		super(code);
		this.name = 'BrowserRegistryRefusal';
		this.code = code;
	}
}

const list = vi.fn();
const isClosed = vi.fn();
const pageInfo = vi.fn();
const mcpBrainUrl = vi.fn();

vi.mock('$lib/server/browser/registry.js', () => ({
	BrowserRegistryRefusal: Refusal,
	browserRegistry: {
		list: (...a: unknown[]) => list(...a),
		isClosed: (...a: unknown[]) => isClosed(...a),
		pageInfo: (...a: unknown[]) => pageInfo(...a),
		mcpBrainUrl: (...a: unknown[]) => mcpBrainUrl(...a),
	},
}));

const mcp = (await import('../../src/routes/api/browser/[id]/mcp/+server')).GET;
const page = (await import('../../src/routes/api/browser/[id]/page/+server')).GET;

const ctx = (id: string) => ({ params: { id } });

beforeEach(() => {
	list.mockReset();
	isClosed.mockReset();
	pageInfo.mockReset();
	mcpBrainUrl.mockReset();
});

describe('GET /api/browser/[id]/mcp', () => {
	it('404 NO_SESSION for an unknown id', async () => {
		list.mockReturnValue([]);
		const res = mcp(ctx('ghost'));
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({ error: 'NO_SESSION' });
	});

	it('in-process mode: url is the brain\'s ACTUAL bound /sse (route delegates to mcpBrainUrl, F4)', async () => {
		list.mockReturnValue([{ id: 's1', mcp: 'in-process', port: 9223, mcpHealth: 'up' }]);
		mcpBrainUrl.mockReturnValue('http://127.0.0.1:9323/sse');
		const res = mcp(ctx('s1'));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			mode: 'in-process',
			url: 'http://127.0.0.1:9323/sse',
			health: 'up',
		});
		expect(mcpBrainUrl).toHaveBeenCalledWith('s1');
	});

	it('child mode: stdio descriptor with cdp-endpoint and pid', async () => {
		list.mockReturnValue([{ id: 's2', mcp: 'child', port: 9300, pid: 4242, mcpHealth: 'up' }]);
		const body = (await (await mcp(ctx('s2'))).json()) as Record<string, unknown>;
		expect(body.mode).toBe('stdio');
		expect(body.pid).toBe(4242);
		expect(String(body.command)).toContain('--cdp-endpoint http://127.0.0.1:9300');
		expect(body.health).toBe('up');
	});

	it('unknown mcp kind: mode none, health still reported', async () => {
		list.mockReturnValue([{ id: 's3', mcp: 'off', mcpHealth: 'down' }]);
		const res = mcp(ctx('s3'));
		expect(await res.json()).toEqual({ mode: 'none', health: 'down' });
	});

	it('registry refusal maps to 404 with its code; other errors rethrow', async () => {
		list.mockImplementation(() => {
			throw new Refusal('NO_SESSION');
		});
		const refused = mcp(ctx('x'));
		expect(refused.status).toBe(404);
		expect(await refused.json()).toEqual({ error: 'NO_SESSION' });
		list.mockImplementation(() => {
			throw new Error('boom');
		});
		expect(() => mcp(ctx('x'))).toThrow('boom');
	});
});

describe('GET /api/browser/[id]/page', () => {
	it('409 CLOSED when the session is already closed (checked before pageInfo)', async () => {
		isClosed.mockReturnValue(true);
		const res = await page(ctx('dead'));
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: 'CLOSED' });
		expect(pageInfo).not.toHaveBeenCalled();
	});

	it('live session: returns pageInfo payload verbatim', async () => {
		isClosed.mockReturnValue(false);
		pageInfo.mockResolvedValue({ url: 'https://example.test/x', title: 'Example' });
		const res = await page(ctx('live'));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ url: 'https://example.test/x', title: 'Example' });
		expect(pageInfo).toHaveBeenCalledWith('live');
	});

	it('NO_SESSION refusal → 404; CLOSED refusal → 409', async () => {
		isClosed.mockReturnValue(false);
		pageInfo.mockRejectedValue(new Refusal('NO_SESSION'));
		const a = await page(ctx('gone'));
		expect(a.status).toBe(404);
		expect(await a.json()).toEqual({ error: 'NO_SESSION' });

		pageInfo.mockRejectedValue(new Refusal('CLOSED'));
		const b = await page(ctx('raced'));
		expect(b.status).toBe(409);
		expect(await b.json()).toEqual({ error: 'CLOSED' });
	});

	it('unexpected errors rethrow (not swallowed into a 4xx)', async () => {
		isClosed.mockReturnValue(false);
		pageInfo.mockRejectedValue(new Error('cdp gone'));
		await expect(page(ctx('live'))).rejects.toThrow('cdp gone');
	});
});