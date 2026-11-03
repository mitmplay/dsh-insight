/**
 * skills/engine — EDGE arms (coverage gap sweep, 2026-10-30).
 * engine.test.ts owns the wire contracts; this file pins the remaining
 * arms: the REAL existsSync miss -> EngineMissingError thrown by run()
 * (previously only asserted as a constructed class), cancelRefresh()
 * with nothing in flight -> false, and the cancel ladder:
 * registerCancel -> cancelRefresh() kills the in-flight run and every
 * rider rejects with EngineCancelledError (Reload Rememberer, 2026-09-23).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	defaultEnginePath,
	getEngine,
	setEngineRunner
} from '../../../../src/lib/server/skills/engine';
import {
	EngineCancelledError,
	EngineMissingError
} from '../../../../src/lib/server/skills/types';

beforeEach(() => setEngineRunner(null));
afterEach(() => delete process.env.SHELF_ENGINE_PATH);

describe('engine wrapper — edge arms', () => {
	it('a REAL missing engine file throws EngineMissingError out of run()', async () => {
		process.env.SHELF_ENGINE_PATH = '/nonexistent-dsi-probe/shelf.mjs';
		expect(defaultEnginePath()).toBe('/nonexistent-dsi-probe/shelf.mjs');
		await expect(getEngine().snapshotStatus()).rejects.toBeInstanceOf(EngineMissingError);
		await expect(getEngine().snapshotStatus()).rejects.toThrow(/nonexistent-dsi-probe/);
	});

	it('cancelRefresh() with nothing in flight returns false', async () => {
		expect(getEngine().cancelRefresh()).toBe(false);
	});

	it('cancelRefresh() kills the in-flight run — the rider rejects EngineCancelledError', async () => {
		type Register = (cancel: () => void) => void;
		let registered: Register | null = null;
		let rejectRun!: (e: unknown) => void;
		setEngineRunner(async (_p: string, _args: string[], _t?: number, registerCancel?: Register) => {
			registered = registerCancel ?? null;
			// The real defaultRunner exposes the child handle via registerCancel
			// and SIGTERM surfaces as a child error — mirror both halves.
			registerCancel?.(() => rejectRun(new Error('SIGTERM')));
			return new Promise<string>((_res, rej) => (rejectRun = rej)); // "harvesting"
		});
		const rider = getEngine().refresh(false);
		await vi.waitFor(() => expect(registered).not.toBeNull());
		expect(getEngine().cancelRefresh()).toBe(true); // the kill actually lands
		await expect(rider).rejects.toBeInstanceOf(EngineCancelledError);
		// The in-flight handle is cleared: a second cancel has nothing to kill.
		expect(getEngine().cancelRefresh()).toBe(false);
	});
});
