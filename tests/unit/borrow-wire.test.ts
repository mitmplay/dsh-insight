import { describe, expect, it } from 'vitest';
import { resolveBrowserSession } from '../../src/lib/services/panels/browser-session-resolver.js';

function jsonRes(body: unknown): Response {
	return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('resolveBrowserSession borrowProfile wiring (task 2.1-T, ADR-0047 D0/D2)', () => {
	it('the open POST body carries borrowProfile only when the intent is set', async () => {
		const bodies: string[] = [];
		const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
			bodies.push(String(init?.body ?? ''));
			return jsonRes({ id: 's-new' });
		}) as typeof fetch;
		await resolveBrowserSession('', { fetchImpl, storage: null, borrowProfile: true });
		expect(bodies.length).toBe(1);
		const parsed = JSON.parse(bodies[0]) as { borrowProfile?: boolean };
		expect(parsed.borrowProfile).toBe(true);
	});

	it('plain open omits the flag (the default stays clean, D0)', async () => {
		const bodies: string[] = [];
		const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
			bodies.push(String(init?.body ?? ''));
			return jsonRes({ id: 's-new' });
		}) as typeof fetch;
		await resolveBrowserSession('', { fetchImpl, storage: null });
		const parsed = JSON.parse(bodies[0]) as { borrowProfile?: boolean };
		expect(parsed.borrowProfile).toBeUndefined();
	});

	it('the re-bind GET path never sends the flag (no body at all)', async () => {
		const inits: RequestInit[] = [];
		const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
			inits.push(init ?? {});
			return jsonRes({ sessions: [{ id: 's-live' }] });
		}) as typeof fetch;
		const storage = {
			getItem: () => 's-live',
			setItem: () => undefined,
			removeItem: () => undefined
		};
		const res = await resolveBrowserSession('', { fetchImpl, storage, borrowProfile: true });
		expect(res.reBound).toBe(true);
		expect(inits[0]?.body).toBeUndefined();
	});
});
