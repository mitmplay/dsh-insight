/**
 * Terminal readiness facet tests (spec 2026-11-24 ADR-0080, Wave 1 —
 * tasks 1.1-T / 1.2-T). Real PTY like terminal-session.test.ts: the
 * passive settle observer's facts drive the readiness() getter, and the
 * registry list() rows carry it additively beside the untouched ADR-0079
 * baton facet.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { TerminalRegistry } from '$lib/server/terminal/registry.js';
import { TerminalSession } from '$lib/server/terminal/session.js';
import type { TerminalSpec } from '$lib/server/terminal/types.js';

const dirs: string[] = [];
const sessions: TerminalSession[] = [];

function makeSession(overrides?: Partial<TerminalSpec>): TerminalSession {
	const cwd = mkdtempSync(join(tmpdir(), 'dsi-pty-'));
	dirs.push(cwd);
	const spec: TerminalSpec = {
		argv: ['/bin/bash', '--norc', '--noprofile', '-i'],
		cwd,
		env: { PS1: '$ ' },
		rows: 24,
		cols: 80,
		terminalType: 'xterm-256color',
		graceMs: 1_000,
		idleMs: 300,
		tailBytes: 262_144,
		...overrides
	};
	const s = new TerminalSession(spec);
	sessions.push(s);
	return s;
}

afterEach(() => {
	for (const s of sessions) void s.close().catch(() => undefined);
	sessions.length = 0;
	for (const d of dirs) rmSync(d, { recursive: true, force: true });
	dirs.length = 0;
});

/** Wait until the predicate holds, polling — never a fixed sleep. */
async function until(pred: () => boolean, timeoutMs = 5_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!pred()) {
		if (Date.now() >= deadline) throw new Error('condition not reached within timeout');
		await new Promise((r) => setTimeout(r, 25));
	}
}

describe('TerminalSession.readiness (ADR-0080 D2)', () => {
	it('fresh open answers the unsettled triple', () => {
		const s = makeSession();
		const r = s.readiness();
		expect(r.settled).toBe(false);
		expect(r.settledSince).toBe(null);
		expect(r.reason).toBe(null);
	});

	it('idle >= idleMs after output settles, with settledSince = lastOutputAt + idleMs', async () => {
		const s = makeSession();
		await until(() => s.getTail().length > 0); // the shell printed its prompt
		expect(s.readiness().settled).toBe(false); // output too fresh
		await until(() => s.readiness().settled, 8_000);
		const r = s.readiness();
		expect(r.settledSince).not.toBeNull();
		expect(r.settledSince! - Date.now()).toBeLessThanOrEqual(300);
	});

	it('a running command keeps readiness unsettled while output is mid-flight', async () => {
		const s = makeSession();
		await until(() => s.getTail().length > 0);
		// Ticks every 100ms — output gaps stay BELOW idleMs, so the
		// time-based gate (D2) must stay unsettled while the loop prints.
		s.write('for i in 1 2 3 4 5 6 7 8 9 10 11 12; do echo tick-$i; sleep 0.1; done; echo DONE-MARK\n');
		// Long past one idleMs from session open, the loop is still printing:
		await new Promise((r) => setTimeout(r, 700));
		expect(s.getTail()).toContain('tick-');
		expect(s.readiness().settled).toBe(false);
		// After the loop drains its final idle window, it settles again.
		await until(() => s.readiness().settled, 8_000);
	});

	it('an exited session never settles', async () => {
		const s = makeSession({ argv: ['/bin/sh', '-c', 'echo bye; exit 0'], idleMs: 100 });
		await until(() => s.isExited());
		const r = s.readiness();
		expect(r.settled).toBe(false);
		expect(r.settledSince).toBe(null);
	});

	it('the passive observer records the settle reason without an awaited send', async () => {
		const s = makeSession();
		await until(() => s.getTail().length > 0);
		s.write('echo pass-probe\n'); // interactive write — no send() anywhere
		const saw = await new Promise<string>((resolve) => {
			const onEvent = (e: { type?: string; reason?: string }) => {
				if (e.type === 'settled') {
					s.off('event', onEvent);
					resolve(e.reason ?? '');
				}
			};
			s.on('event', onEvent);
		});
		expect(['stdin_read', 'inferred_idle', 'timeout']).toContain(saw);
		// Once settled past idleMs, readiness exposes that same reason.
		await until(() => s.readiness().settled, 8_000);
		expect(s.readiness().reason).toBe(saw);
	});
});

describe('TerminalRegistry.list readiness projection (ADR-0080 D1)', () => {
	it('list rows carry readiness beside the UNCHANGED ADR-0079 baton facet', () => {
		const r = new TerminalRegistry();
		const { session } = r.create(
			{
				argv: ['/bin/sh', '-c', 'echo hi; sleep 30'],
				cwd: tmpdir(),
				rows: 24,
				cols: 80,
				terminalType: 'xterm-256color',
				graceMs: 500,
				idleMs: 200,
				tailBytes: 262_144
			},
			{ promptDetect: () => false }
		);
		const rows = r.list();
		expect(rows).toHaveLength(1);
		const row = rows[0];
		expect(row.id).toBe(session.id);
		expect(row.readiness.settled).toBe(false);
		expect(row.readiness.settledSince).toBe(null);
		// ADR-0079 contract untouched (D5): the facet keys are exactly these.
		expect(Object.keys(row.baton).sort()).toEqual(
			['holder', 'holderId', 'lastWriteAt', 'pinned', 'readyForAutomation', 'since'].sort()
		);
		expect(row.baton.readyForAutomation).toBe(false); // operator-held default
	});
});
