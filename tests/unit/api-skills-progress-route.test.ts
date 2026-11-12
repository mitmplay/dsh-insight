/**
 * GET /api/skills/progress (2026-09-23): mirrors the engine's
 * skr-progress.json — absent/torn file degrades to a quiet { running:
 * false }, a running read returns {done,total} verbatim. Path is the
 * SHELF_PROGRESS_PATH env seam; tests never touch the real ~/.dsi.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET, _PROGRESS_PATH } from '../../src/routes/api/skills/progress/+server';

const dir = mkdtempSync(join(tmpdir(), 'rr-progress-'));
const file = join(dir, 'skr-progress.json');

afterEach(() => {
	delete process.env.SHELF_PROGRESS_PATH;
	rmSync(file, { force: true });
});

const call = async () => (await GET({} as never)) as unknown as Response;

describe('progress route', () => {
	it('absent file degrades to a quiet not-running payload', async () => {
		process.env.SHELF_PROGRESS_PATH = file;
		const res = await call();
		expect(res.status).toBe(200);
		await expect(res.json()).resolves.toEqual({ ok: true, running: false, done: 0, total: 0, skillDone: 0, skillTotal: 0, sources: [] });
	});

	it('a running read returns done/total verbatim', async () => {
		process.env.SHELF_PROGRESS_PATH = file;
		writeFileSync(file, JSON.stringify({ v: 1, running: true, done: 4, total: 7, skillDone: 400, skillTotal: 903, updatedAt: 1 }));
		await expect((await call()).json()).resolves.toEqual({ ok: true, running: true, done: 4, total: 7, skillDone: 400, skillTotal: 903, sources: [] });
	});

	it('a torn read mid-write degrades quietly instead of 500ing the poll', async () => {
		process.env.SHELF_PROGRESS_PATH = file;
		writeFileSync(file, '{"v":1,"running":tru');
		await expect((await call()).json()).resolves.toEqual({ ok: true, running: false, done: 0, total: 0, skillDone: 0, skillTotal: 0, sources: [] });
	});

	it('running:false stays false even with numbers present', async () => {
		process.env.SHELF_PROGRESS_PATH = file;
		writeFileSync(file, JSON.stringify({ v: 1, running: false, done: 7, total: 7, skillDone: 903, skillTotal: 903 }));
		await expect((await call()).json()).resolves.toMatchObject({ running: false, done: 7, total: 7, skillDone: 903, skillTotal: 903 });
	});

	it('_PROGRESS_PATH honors the env seam, then falls back to the home default', () => {
		process.env.SHELF_PROGRESS_PATH = '/tmp/x.json';
		expect(_PROGRESS_PATH()).toBe('/tmp/x.json');
		delete process.env.SHELF_PROGRESS_PATH;
		expect(_PROGRESS_PATH()).toBe(join(process.env.HOME ?? '', '.dsi/resources/skr-progress.json'));
	});
});

it('skill counters default to 0 when the engine omits them (older engine)', async () => {
	process.env.SHELF_PROGRESS_PATH = file;
	writeFileSync(file, JSON.stringify({ v: 1, running: true, done: 2, total: 7 }));
	await expect((await call()).json()).resolves.toMatchObject({ done: 2, total: 7, skillDone: 0, skillTotal: 0 });
});
it('non-finite done/total values fall back to 0 (isFinite false arm)', async () => {
	process.env.SHELF_PROGRESS_PATH = file;
	writeFileSync(file, JSON.stringify({ v: 1, running: true, done: 'four', total: null }));
	await expect((await call()).json()).resolves.toMatchObject({ running: true, done: 0, total: 0 });
});

it('sources pass through sanitized — junk rows drop, states coerce to pending', async () => {
	process.env.SHELF_PROGRESS_PATH = file;
	writeFileSync(
		file,
		JSON.stringify({
			v: 1,
			running: true,
			done: 4,
			total: 7,
			sources: [
				{ name: 'ecc', state: 'working' },
				{ name: 'pstack', state: 'done' },
				{ state: 'done' }, // no name — dropped
				{ name: 'weird', state: 'bogus' } // bad state — coerced to pending
			]
		})
	);
	await expect((await call()).json()).resolves.toMatchObject({
		running: true,
		sources: [
			{ name: 'ecc', state: 'working' },
			{ name: 'pstack', state: 'done' },
			{ name: 'weird', state: 'pending' }
		]
	});
});
