/**
 * settings-home file routes (Settings Tree ADR 2026-09-18, D2) — the
 * DSI-LOCAL data plane behind the session-less settings explorer:
 *   - GET /api/settings-home/file: bad home / bad path reject 400 BEFORE
 *     the fs seam; ENOENT maps 404; a containment refusal maps 400.
 *   - POST /api/settings-home/file-write: non-JSON body rejects 400; the
 *     same refusal discipline; anything else is a 500 with the reason.
 * The fs-backed module is mocked at the seam (the established
 * workspace-file-route.test.ts pattern) so the handlers are pinned
 * without touching host bytes; \$lib/server/settings-home has its own
 * unit tests (settings-home.test.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { readSpy, writeSpy } = vi.hoisted(() => ({ readSpy: vi.fn(), writeSpy: vi.fn() }));

vi.mock('$lib/server/settings-home.js', () => ({
	// A REAL class (not a stub) so 'instanceof SettingsHomeRefusal' in the
	// handler is exercised honestly against the mocked module's export.
	SettingsHomeRefusal: class SettingsHomeRefusal extends Error {
		constructor(
			public readonly code: string,
			message: string
		) {
			super(message);
		}
	},
	isSettingsHome: (v: unknown) => v === 'dsi' || v === 'dsh',
	readSettingsHomeFile: readSpy,
	writeSettingsHomeFile: writeSpy
}));

import { GET } from '../../src/routes/api/settings-home/file/+server';
import { POST } from '../../src/routes/api/settings-home/file-write/+server';

function get(query: string): Promise<Response> {
	return GET({ url: new URL('http://localhost/api/settings-home/file' + query) } as never) as Promise<Response>;
}

function post(body: unknown | string): Promise<Response> {
	const raw = typeof body === 'string' ? body : JSON.stringify(body);
	return POST({ request: new Request('http://localhost/api/settings-home/file-write', { method: 'POST', body: raw }) } as never) as Promise<Response>;
}

beforeEach(() => {
	readSpy.mockReset();
	writeSpy.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('GET /api/settings-home/file (Settings Tree ADR D2)', () => {
	it('forwards {home, path} to readSettingsHomeFile and resolves {ok:true, file}', async () => {
		const FILE = { content: '# dsi', size: 5 };
		readSpy.mockResolvedValueOnce(FILE);
		const res = await get('?home=dsi&path=AGENTS.md');
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, file: FILE });
		expect(readSpy).toHaveBeenCalledExactlyOnceWith('dsi', 'AGENTS.md');
	});

	it('rejects an unknown home with 400 before any read', async () => {
		const res = await get('?home=x&path=a');
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe('bad-home');
		expect(readSpy).not.toHaveBeenCalled();
	});

	it.each([
		['missing path', '?home=dsi'],
		['empty path', '?home=dsi&path=']
	])('rejects %s with 400 before any read', async (_name, query) => {
		const res = await get(query);
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe('bad-path');
		expect(readSpy).not.toHaveBeenCalled();
	});

	it('maps a containment refusal to 400 with its code verbatim', async () => {
		readSpy.mockRejectedValueOnce(new (await import('$lib/server/settings-home.js')).SettingsHomeRefusal('bad-path', 'escapes'));
		const res = await get('?home=dsi&path=../x');
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe('bad-path');
		expect(body.error.message).toBe('escapes');
	});

	it('maps ENOENT to 404 not-found', async () => {
		readSpy.mockRejectedValueOnce(Object.assign(new Error('nope'), { code: 'ENOENT' }));
		const res = await get('?home=dsi&path=gone.md');
		expect(res.status).toBe(404);
		expect((await res.json()).error.code).toBe('not-found');
	});

	it('maps any other failure to 500 io-error with the reason', async () => {
		readSpy.mockRejectedValueOnce(new Error('EACCES: bad perms'));
		const res = await get('?home=dsh&path=x');
		expect(res.status).toBe(500);
		expect((await res.json()).error.code).toBe('io-error');
	});
});

describe('POST /api/settings-home/file-write (Settings Tree ADR D2)', () => {
	it('forwards {home, path, content} and resolves {ok:true}', async () => {
		const res = await post({ home: 'dsh', path: 'AGENTS.md', content: 'hi' });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		expect(writeSpy).toHaveBeenCalledExactlyOnceWith('dsh', 'AGENTS.md', 'hi');
	});

	it('rejects a non-JSON body with 400 before any write', async () => {
		const res = await post('{not json');
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe('bad-json');
		expect(writeSpy).not.toHaveBeenCalled();
	});

	it('rejects an unknown home with 400 before any write', async () => {
		const res = await post({ home: 'nope', path: 'a', content: 'x' });
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe('bad-home');
	});

	it.each([
		['missing path', { home: 'dsi', content: 'x' }],
		['empty path', { home: 'dsi', path: '', content: 'x' }]
	])('rejects %s with 400 before any write', async (_name, body) => {
		const res = await post(body);
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe('bad-path');
		expect(writeSpy).not.toHaveBeenCalled();
	});

	it('maps a containment refusal to 400 with its code verbatim', async () => {
		writeSpy.mockRejectedValueOnce(new (await import('$lib/server/settings-home.js')).SettingsHomeRefusal('bad-content', 'not a string'));
		const res = await post({ home: 'dsi', path: 'a', content: 7 });
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(body.error.code).toBe('bad-content');
		expect(body.error.message).toBe('not a string');
	});

	it('maps any other failure to 500 io-error with the reason', async () => {
		writeSpy.mockRejectedValueOnce(new Error('disk full'));
		const res = await post({ home: 'dsi', path: 'a', content: 'x' });
		expect(res.status).toBe(500);
		expect((await res.json()).error.code).toBe('io-error');
	});

	it('a NON-Error rejection still stringifies into the io-error message (err ?? err arm)', async () => {
		writeSpy.mockRejectedValueOnce('plain string failure');
		const res = await post({ home: 'dsi', path: 'a', content: 'x' });
		expect(res.status).toBe(500);
		const body = await res.json();
		expect(body.error.code).toBe('io-error');
		expect(body.error.message).toBe('plain string failure');
	});
});
