/**
 * Reattach route tests (The Surviving Shell task 1.1-T; extended by the
 * Baton Facet 2.1-T, ADR-0079 D3): the thin POST over
 * terminalRegistry.reattach — fresh token + byte tail on success, old
 * token evicted (the fence refuses it), NO_SESSION as 404. The body is
 * OPTIONAL mint labels: a labeled reattach records the automation holder;
 * no body, a non-JSON body, or junk fields all mean the operator default —
 * the route never answers 400 for a label.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reattachSpy, registry } = vi.hoisted(() => {
	const reattachSpy = vi.fn();
	const registry = {
		reattach: reattachSpy,
		send: vi.fn(() => { throw new Error('unused in these tests'); })
	};
	return { reattachSpy, registry };
});

vi.mock('$lib/server/terminal/registry.js', () => ({
	terminalRegistry: registry,
	TerminalRegistryRefusal: class TerminalRegistryRefusal extends Error {
		constructor(public code: 'NO_SESSION' | 'FOREIGN_SESSION') {
			super(code);
		}
	}
}));

import { POST } from '../../src/routes/api/terminal/[id]/reattach/+server';

/** The desk's own posts: a JSON body (possibly `{}`) on a real Request. */
function request(body: unknown): Request {
	return new Request('http://localhost/api/terminal/s1/reattach', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
}

function post(id: string, req: Request = request({})): Promise<Response> {
	return POST({ params: { id }, request: req }) as Promise<Response>;
}

beforeEach(() => {
	reattachSpy.mockReset();
	reattachSpy.mockReturnValue({ token: 't2', fromByte: 4096 });
});

describe('POST /api/terminal/[id]/reattach', () => {
	it('returns a fresh token and the byte tail on success', async () => {
		const res = await post('s1');
		expect(res.status).toBe(200);
		const body = (await res.json()) as { token: string; fromByte: number };
		expect(body).toEqual({ token: 't2', fromByte: 4096 });
		expect(reattachSpy).toHaveBeenCalledWith('s1', 'operator', null);
	});

	it('re-mints on every call — each reattach delegates with the session id', async () => {
		reattachSpy.mockReturnValueOnce({ token: 't2', fromByte: 0 });
		reattachSpy.mockReturnValueOnce({ token: 't3', fromByte: 512 });
		const first = (await (await post('s1')).json()) as { token: string };
		const second = (await (await post('s1')).json()) as { token: string };
		expect(first.token).toBe('t2');
		expect(second.token).toBe('t3');
		expect(reattachSpy).toHaveBeenNthCalledWith(2, 's1', 'operator', null);
	});

	it('refuses a foreign token with 403 FOREIGN_SESSION', async () => {
		const { TerminalRegistryRefusal } = await import('$lib/server/terminal/registry.js');
		reattachSpy.mockImplementationOnce(() => {
			throw new TerminalRegistryRefusal('FOREIGN_SESSION', 'FOREIGN_SESSION');
		});
		const res = await post('s1');
		expect(res.status).toBe(403);
		expect((await res.json()).error).toBe('FOREIGN_SESSION');
	});

	it('rethrows a non-refusal registry failure (line 19 branch)', async () => {
		reattachSpy.mockImplementationOnce(() => {
			throw new TypeError('registry exploded');
		});
		await expect(post('s1')).rejects.toThrow('registry exploded');
	});

	it('refuses an unknown session with 404 NO_SESSION', async () => {
		const { TerminalRegistryRefusal } = await import('$lib/server/terminal/registry.js');
		reattachSpy.mockImplementationOnce(() => {
			throw new TerminalRegistryRefusal('NO_SESSION', 'NO_SESSION');
		});
		const res = await post('ghost');
		expect(res.status).toBe(404);
		expect((await res.json()).error).toBe('NO_SESSION');
	});
});

describe('POST /api/terminal/[id]/reattach — the optional mint labels (ADR-0079 D3)', () => {
	it('a labeled body records the automation holder: reattach(id, automation, holderId)', async () => {
		const res = await post('s1', request({ holder: 'automation', holderId: 'lead' }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ token: 't2', fromByte: 4096 }); // the body shape is unchanged
		expect(reattachSpy).toHaveBeenCalledExactlyOnceWith('s1', 'automation', 'lead');
	});

	it.each<[string, Request]>([
		['no body at all', new Request('http://localhost/x', { method: 'POST' })],
		['a non-JSON body', new Request('http://localhost/x', { method: 'POST', body: 'not json' })],
		['a JSON array', request(['automation'])],
		['a JSON scalar', request(42)]
	])('%s means the operator default — 200, never 400', async (_name, req) => {
		const res = await post('s1', req);
		expect(res.status).toBe(200);
		expect(reattachSpy).toHaveBeenCalledExactlyOnceWith('s1', 'operator', null);
	});

	// defaults apply FIELD BY FIELD: a bad holder lands as operator, a bad
	// holderId lands as null — one malformed field never discards a good one
	it.each<[string, unknown, string, string | null]>([
		['unassigned is not a claimable label', { holder: 'unassigned', holderId: 'x' }, 'operator', 'x'],
		['an unknown holder', { holder: 'robot', holderId: 'x' }, 'operator', 'x'],
		['a non-string holder', { holder: 7 }, 'operator', null],
		['a non-string holderId', { holder: 'automation', holderId: 42 }, 'automation', null],
		['an empty holderId', { holder: 'automation', holderId: '' }, 'automation', null],
		['holderId alone', { holderId: 'lead' }, 'operator', 'lead']
	])('%s degrades to defaults, field by field', async (_name, body, holder, holderId) => {
		const res = await post('s1', request(body));
		expect(res.status).toBe(200);
		expect(reattachSpy).toHaveBeenCalledExactlyOnceWith('s1', holder, holderId);
	});

	it('an explicit operator holder with a label keeps the label and the holder', async () => {
		await post('s1', request({ holder: 'operator', holderId: 'desk-tab-2' }));
		expect(reattachSpy).toHaveBeenCalledExactlyOnceWith('s1', 'operator', 'desk-tab-2');
	});
});
