// @vitest-environment node
/**
 * GET /api/config — the operator-config endpoint: one shape, always ok,
 * every browser-tunable section present (the read* helpers own the
 * defaults; insight-config.test.ts pins them — this pins the route).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET } from '../../src/routes/api/config/+server';

async function fetchBody(): Promise<Record<string, unknown>> {
	// `await` — a RequestHandler may answer sync or async (MaybePromise).
	const res = await GET(new Request('http://dsi/api/config') as unknown as Parameters<typeof GET>[0]);
	return res.json() as Promise<Record<string, unknown>>;
}

afterEach(() => {
	delete process.env.DSI_CONFIG_PATH;
});

describe('GET /api/config', () => {
	it('answers ok with every browser-tunable section', async () => {
		const res = await GET(new Request('http://dsi/api/config') as unknown as Parameters<typeof GET>[0]);
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.ok).toBe(true);
		for (const section of ['chat', 'conversation', 'home', 'a2a', 'panel', 'sidebar']) {
			expect(body[section]).toBeDefined();
		}
		// The server-only section is intentionally absent — dsh-connection
		// reads it directly server-side.
		expect(body.server).toBeUndefined();
		// `jobs` rides the same route — every job-tunable key the browser
		// store mirrors is present (The Job Bridge, ADR-0081 D2).
		expect(body.jobs).toBeDefined();
		expect(typeof (body.jobs as Record<string, unknown>).autoAttach).toBe('boolean');
	});

	/** The Job Bridge (ADR-0081 D2), Task 1.2-T: the route carries
	 *  `jobs.autoAttach` beside `autoClose` — the browser store's ONLY source
	 *  for the consent setting (BC-2: the store never imports the server
	 *  reader). Pinned through the DSI_CONFIG_PATH seam, so the operator's
	 *  real ~/.dsi/settings.yaml never decides the outcome: default true,
	 *  explicit false lands, junk falls back to true. */
	it('carries jobs.autoAttach: default true · explicit false · junk back to true', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'dsi-config-route-'));
		try {
			const jobsFor = async (yaml: string): Promise<unknown> => {
				const path = join(dir, 'settings.yaml');
				writeFileSync(path, yaml, 'utf-8');
				process.env.DSI_CONFIG_PATH = path;
				return (await fetchBody()).jobs;
			};
			expect(await jobsFor('jobs:\n  autoClose: true\n')).toEqual({ autoClose: true, autoAttach: true });
			expect(await jobsFor('jobs:\n  autoAttach: false\n')).toEqual({ autoClose: false, autoAttach: false });
			expect(await jobsFor('jobs:\n  autoAttach: "yes"\n')).toEqual({ autoClose: false, autoAttach: true });
		} finally {
			rmSync(dir, { recursive: true, force: true });
			delete process.env.DSI_CONFIG_PATH;
		}
	});
});
