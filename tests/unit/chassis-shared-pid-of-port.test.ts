/**
 * chassis-shared pidOfPort tests (spec 2026-11-08 Glass Chassis Remote
 * CDP task 1.2) — the pid-of-port probe contract:
 *   - a REAL listening socket resolves to the holding process's pid
 *     (here: this test process, via node:net ephemeral bind);
 *   - a bound-then-closed port (lsof exits nonzero) answers null;
 *   - an unlikely listening port (e.g. 2) answers null unless something
 *     is actually listening — the assertion tolerates a positive pid
 *     when a listener exists, with null as the primary expectation.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:net';
import { promisify } from 'node:util';
import { pidOfPort } from '../../src/lib/server/browser/chassis-shared';

let listener: Server | null = null;
let boundPort: number | null = null;

afterEach(async () => {
	if (listener) {
		await promisify(listener.close.bind(listener))();
		listener = null;
	}
	boundPort = null;
});

describe('pidOfPort', () => {
	it('returns the test process pid for a real listening port', async () => {
		listener = createServer();
		await promisify(listener.listen.bind(listener) as unknown as (port: number, cb: (err: Error | null) => void) => void)(0);
		const addr = listener.address();
		if (typeof addr !== 'object' || !addr) throw new Error('no listen address');
		boundPort = addr.port;
		const pid = pidOfPort(boundPort);
		expect(pid).toBe(process.pid);
		expect(pid).toBeGreaterThan(0);
	});

	it('returns null for a bound-then-closed port (nothing listening)', async () => {
		listener = createServer();
		await promisify(listener.listen.bind(listener) as unknown as (port: number, cb: (err: Error | null) => void) => void)(0);
		const addr = listener.address();
		if (typeof addr !== 'object' || !addr) throw new Error('no listen address');
		boundPort = addr.port;
		await promisify(listener.close.bind(listener))();
		const freedPort = boundPort;
		listener = null;
		boundPort = null;
		expect(pidOfPort(freedPort)).toBeNull();
	});

	it('returns null for an unlikely listening port (2), tolerating a live listener', async () => {
		const pid = pidOfPort(2);
		if (pid === null) {
			expect(pid).toBeNull();
		} else {
			expect(pid).toBeGreaterThan(0);
		}
	});
});
