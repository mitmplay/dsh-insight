/**
 * DELETE route tests (spec 2026-11-07 Terminal Prune Verb, task 1.2-T):
 * thin DELETE over terminalRegistry.destroy — happy path answers the
 * close result, refusals map like the reattach sibling, a missing or
 * malformed token never reaches the registry.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { destroySpy, registry } = vi.hoisted(() => {
	const destroySpy = vi.fn();
	const registry = { destroy: destroySpy };
	return { destroySpy, registry };
});

vi.mock('$lib/server/terminal/registry.js', () => ({
	terminalRegistry: registry,
	TerminalRegistryRefusal: class TerminalRegistryRefusal extends Error {
		constructor(public code: 'NO_SESSION' | 'FOREIGN_SESSION') {
			super(code);
		}
	}
}));

import { DELETE } from '../../src/routes/api/terminal/[id]/delete/+server';

async function del(id: string, body: unknown): Promise<Response> {
	return DELETE({ params: { id }, request: new Request('http://x', { method: 'DELETE', body: JSON.stringify(body) }) } as never) as Promise<Response>;
}

beforeEach(() => {
	destroySpy.mockReset();
});

describe('DELETE /api/terminal/[id]/delete', () => {
	it('destroys with the presented token and answers the close result', async () => {
		destroySpy.mockResolvedValueOnce({ quiescent: true, pruned: true });
		const res = await del('t-9', { token: 'tok' });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ quiescent: true, pruned: true });
		expect(destroySpy).toHaveBeenCalledWith('t-9', 'tok');
	});

	it('refuses a missing token before touching the registry', async () => {
		const res = await del('t-9', {});
		expect(res.status).toBe(403);
		expect((await res.json()).error).toBe('FOREIGN_SESSION');
		expect(destroySpy).not.toHaveBeenCalled();
	});

	it('maps NO_SESSION to 404', async () => {
		const { TerminalRegistryRefusal } = await import('$lib/server/terminal/registry.js');
		destroySpy.mockImplementationOnce(() => {
			throw new TerminalRegistryRefusal('NO_SESSION', 'no such terminal session');
		});
		const res = await del('t-none', { token: 'tok' });
		expect(res.status).toBe(404);
		expect((await res.json()).error).toBe('NO_SESSION');
	});

	it('maps FOREIGN_SESSION to 403', async () => {
		const { TerminalRegistryRefusal } = await import('$lib/server/terminal/registry.js');
		destroySpy.mockImplementationOnce(() => {
			throw new TerminalRegistryRefusal('FOREIGN_SESSION', 'foreign');
		});
		const res = await del('t-9', { token: 'stale' });
		expect(res.status).toBe(403);
		expect((await res.json()).error).toBe('FOREIGN_SESSION');
	});

	it('rethrows a non-refusal failure (chain integrity)', async () => {
		destroySpy.mockImplementationOnce(() => {
			throw new TypeError('registry exploded');
		});
		await expect(del('t-9', { token: 'tok' })).rejects.toThrow('registry exploded');
	});
});
