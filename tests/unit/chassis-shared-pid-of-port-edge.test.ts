/**
 * pidOfPort edge/output-parsing tests (chassis-shared.ts): the lsof probe
 * is fully stubbed via vi.mock('node:child_process') — no real lsof runs.
 * Covers: multi-line stdout (first line wins), whitespace-padded stdout
 * (trim before parse), empty stdout (Number('') is +0 per ToNumber, so the
 * status-0 empty-stdout result is 0 — pinned actual behavior, not NaN or
 * null), nonzero status (null),
 * spawn failure with status null (contract status!==0 → null), and the
 * exact spawnSync args/stdio contract.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// The dom project's interop for externalized node builtins reads named
// exports off `mod.default` (observed: spreading `...actual` alone leaked the
// REAL spawnSync into chassis-shared and silently ran real lsof). The factory
// must therefore override BOTH the named export and `default.spawnSync`.
const spawnSyncMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:child_process')>();
	const mod = { ...actual, spawnSync: spawnSyncMock } as typeof actual & {
		default?: Record<string, unknown>
	};
	// node:child_process carries a CJS `default` namespace at runtime that TS
	// does not declare — cast through unknown to override it too.
	mod.default = { ...((actual as unknown as { default?: Record<string, unknown> }).default ?? {}), spawnSync: spawnSyncMock };
	return mod;
});

import { spawnSync } from 'node:child_process';
import { pidOfPort } from '$lib/server/browser/chassis-shared';

function res(partial: Partial<ReturnType<typeof spawnSync>>): ReturnType<typeof spawnSync> {
	return {
		pid: 0,
		output: [],
		stdout: Buffer.from(''),
		stderr: Buffer.from(''),
		status: 0,
		signal: null,
		error: undefined,
		...partial
	} as ReturnType<typeof spawnSync>;
}

beforeEach(() => {
	spawnSyncMock.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('pidOfPort edge / output parsing', () => {
	it('returns the Number of the FIRST stdout line when lsof reports multiple pids', () => {
		spawnSyncMock.mockReturnValue(
			res({ status: 0, stdout: Buffer.from('4242\n5151\n6060\n') })
		);
		expect(pidOfPort(9222)).toBe(4242);
	});

	it('trims whitespace/newline-padded stdout before parsing', () => {
		spawnSyncMock.mockReturnValue(
			res({ status: 0, stdout: Buffer.from('\n  4242  \n\n') })
		);
		expect(pidOfPort(9222)).toBe(4242);
	});

	it('returns 0 for status 0 with empty stdout — Number("") is +0, NOT NaN or null (pinned actual behavior)', () => {
		// The implementation does Number(stdout.trim().split('\n')[0]) with no
		// empty guard. ECMAScript ToNumber('') is +0 (NaN is parseInt('')), so
		// an empty-stdout status-0 result is 0 — a caller must treat 0 as
		// pid-less by truthiness, not null. Pinned as-is; if this ever
		// becomes null, this pin must be updated deliberately.
		spawnSyncMock.mockReturnValue(res({ status: 0, stdout: Buffer.from('') }));
		expect(pidOfPort(9222)).toBe(0);
	});

	it('returns null on nonzero lsof status (port unlistened → status 1)', () => {
		spawnSyncMock.mockReturnValue(res({ status: 1, stdout: Buffer.from('') }));
		expect(pidOfPort(9222)).toBeNull();
	});

	it('returns null when spawn itself failed (status null, ENOENT-shaped error)', () => {
		spawnSyncMock.mockReturnValue(
			res({
				status: null,
				error: Object.assign(new Error('spawn lsof ENOENT'), { code: 'ENOENT' })
			})
		);
		expect(pidOfPort(9222)).toBeNull();
	});

	it('calls lsof with args [-ti, tcp:<port>, -sTCP:LISTEN] and stdio pipe', () => {
		spawnSyncMock.mockReturnValue(res({ status: 0, stdout: Buffer.from('77\n') }));
		pidOfPort(9333);
		expect(spawnSyncMock).toHaveBeenCalledTimes(1);
		expect(spawnSyncMock).toHaveBeenCalledWith(
			'lsof',
			['-ti', 'tcp:9333', '-sTCP:LISTEN'],
			{ stdio: 'pipe' }
		);
	});
});
