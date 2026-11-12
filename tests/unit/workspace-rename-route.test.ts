/**
 * workspace rename route tests (Chip Menu ADR D3) — POST
 * /api/dsh/workspaces/[workspaceId]/rename:
 *   - missing/blank workspaceId → 400 bad-workspace-id BEFORE any wire call;
 *   - invalid JSON body → 400 bad-json;
 *   - missing/blank title → 400 bad-title (the route trims and refuses
 *     without spending the wire call);
 *   - happy path forwards the TRIMMED title to renameWorkspace and serves
 *     {ok:true, workspace};
 *   - rpc failure maps through mapRpcFailure/statusFor (502 / 503).
 *
 * Handlers invoked directly; the connection is mocked (the established
 * goal-route.test.ts pattern).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DshRpcError } from '$lib/server/dsh-rpc';

const renameWorkspaceSpy = vi.fn();
vi.mock('$lib/server/dsh-connection', () => ({
	getDshConnection: () => ({ renameWorkspace: renameWorkspaceSpy })
}));

import { POST } from '../../src/routes/api/dsh/workspaces/[workspaceId]/rename/+server';

function post(workspaceId: unknown, body: BodyInit | null | undefined): Promise<Response> {
	return POST({
		params: { workspaceId } as Record<string, string>,
		request: new Request('http://localhost/api/dsh/workspaces/w1/rename', {
			method: 'POST',
			body
		})
	} as never) as Promise<Response>;
}

beforeEach(() => {
	renameWorkspaceSpy.mockReset();
	renameWorkspaceSpy.mockResolvedValueOnce({ workspace: { id: 'w1', title: 'Renamed' } });
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('POST /api/dsh/workspaces/[workspaceId]/rename (Chip Menu D3)', () => {
	it('renames through the host with the trimmed title and serves the workspace', async () => {
		const res = await post('w1', JSON.stringify({ title: '  Renamed  ' }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, workspace: { id: 'w1', title: 'Renamed' } });
		expect(renameWorkspaceSpy).toHaveBeenCalledExactlyOnceWith('w1', 'Renamed');
	});

	it.each([
		['undefined workspaceId', undefined, JSON.stringify({ title: 'x' })],
		['blank workspaceId', '   ', JSON.stringify({ title: 'x' })]
	])('rejects %s with 400 bad-workspace-id before any wire call', async (_name, wsId, body) => {
		const res = await post(wsId, body);
		expect(res.status).toBe(400);
		expect(((await res.json()) as { error: { code: string } }).error.code).toBe('bad-workspace-id');
		expect(renameWorkspaceSpy).not.toHaveBeenCalled();
	});

	it('rejects an invalid JSON body with 400 bad-json', async () => {
		const res = await post('w1', '{not json');
		expect(res.status).toBe(400);
		expect(((await res.json()) as { error: { code: string } }).error.code).toBe('bad-json');
		expect(renameWorkspaceSpy).not.toHaveBeenCalled();
	});

	it.each([
		['title missing', '{}'],
		['title not a string', '{"title":7}'],
		['title trimmed-empty', '{"title":"   "}']
	])('rejects %s with 400 bad-title before any wire call', async (_name, body) => {
		const res = await post('w1', body);
		expect(res.status).toBe(400);
		expect(((await res.json()) as { error: { code: string } }).error.code).toBe('bad-title');
		expect(renameWorkspaceSpy).not.toHaveBeenCalled();
	});

	it('maps an rpc refusal to 502 and a transport failure to 503', async () => {
		renameWorkspaceSpy.mockReset();
		renameWorkspaceSpy.mockRejectedValueOnce(new DshRpcError('workspace/name-conflict', 'taken'));
		expect((await post('w1', JSON.stringify({ title: 'x' }))).status).toBe(502);

		renameWorkspaceSpy.mockReset();
		renameWorkspaceSpy.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
		expect((await post('w1', JSON.stringify({ title: 'x' }))).status).toBe(503);
	});
});
