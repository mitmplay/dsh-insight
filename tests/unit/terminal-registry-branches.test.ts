/**
 * Registry fence + lifecycle branch tests — the happy paths live in
 * terminal-registry.test.ts over a real PTY; here the NO_SESSION /
 * FOREIGN_SESSION arms are covered on every tokened and tokenless entry
 * point, and dispose / close outcomes are driven with injected fake sessions
 * so the quiescent-false and rejecting-close arms are deterministic.
 */
import { describe, expect, it, vi } from 'vitest';

import { TerminalRegistry, TerminalRegistryRefusal } from '$lib/server/terminal/registry.js';
import type { TerminalSession } from '$lib/server/terminal/session.js';
import type { TerminalSpec } from '$lib/server/terminal/types.js';

function fakeSession(overrides: Partial<TerminalSession> = {}): TerminalSession {
	return {
		id: 'fake-1',
		isExited: () => false,
		streamBytes: () => 42,
		readFrom: () => ({ text: '', nextOffset: 42, lossy: false }),
		exitOutcome: () => null,
		send: vi.fn(async () => 'stdin_read' as const),
		write: vi.fn(),
		signalForeground: () => 4242,
		close: vi.fn(async () => ({ quiescent: true })),
		// the registry pushes its baton frame on the session's own channel
		// (ADR-0079 D7) — the fake carries the emitter surface it needs
		emit: vi.fn(() => true),
		...overrides
	} as unknown as TerminalSession;
}

const spec: TerminalSpec = {
	argv: ['/bin/true'],
	cwd: '/tmp',
	rows: 24,
	cols: 80,
	terminalType: 'xterm-256color',
	graceMs: 100,
	idleMs: 200,
	tailBytes: 1024
};

/** A hand-seeded entry carries the default baton facet (ADR-0079): the
 *  registry writes these fields only through create()/reattach()/release(). */
const OPERATOR_FACET = { holder: 'operator', holderId: null, since: 0, lastWriteAt: null, pinned: false } as const;
const OPERATOR_BATON = { ...OPERATOR_FACET, readyForAutomation: false };

function seeded(session: TerminalSession, token = 'tok') {
	const r = new TerminalRegistry();
	(r as unknown as { entries: Map<string, unknown> }).entries.set(session.id, { session, token, spec, ...OPERATOR_FACET });
	return { r, session, token };
}

describe('TerminalRegistry branches', () => {
	it('peek: NO_SESSION on unknown id, live facts on a known one', () => {
		const { r, session } = seeded(fakeSession());
		expect(() => r.peek('ghost')).toThrowError(TerminalRegistryRefusal);
		try {
			r.peek('ghost');
		} catch (e) {
			expect((e as TerminalRegistryRefusal).code).toBe('NO_SESSION');
		}
		// {id, exited} grew the token-free baton facet (ADR-0079 D2) — additive
		expect(r.peek(session.id)).toEqual({ id: session.id, exited: false, baton: OPERATOR_BATON });
	});

	it('reattach: NO_SESSION on unknown id, re-mint evicts the old token', () => {
		const { r, session, token } = seeded(fakeSession());
		expect(() => r.reattach('ghost')).toThrow(TerminalRegistryRefusal);
		const second = r.reattach(session.id);
		expect(second.token).not.toBe(token);
		expect(second.fromByte).toBe(42);
		expect(() => r.send(session.id, token, 'x', 10)).toThrow(TerminalRegistryRefusal);
	});

	it('readFrom: NO_SESSION on unknown id, delegated on a known one', () => {
		const { r, session } = seeded(fakeSession());
		expect(() => r.readFrom('ghost', 0)).toThrow(TerminalRegistryRefusal);
		expect(r.readFrom(session.id, 0).nextOffset).toBe(42);
	});

	it('events: undefined for unknown ids, the session for known ones', () => {
		const { r, session } = seeded(fakeSession());
		expect(r.events('ghost')).toBeUndefined();
		expect(r.events(session.id)).toBe(session);
	});

	it('exitOutcome: null for unknown ids and live sessions, facts once exited', () => {
		const { r, session } = seeded(fakeSession());
		expect(r.exitOutcome('ghost')).toBeNull();
		expect(r.exitOutcome(session.id)).toBeNull();
		const outcome = { exitCode: 0, signal: null } as const;
		const exited = seeded(fakeSession({ exitOutcome: () => outcome })).session;
		const r2 = new TerminalRegistry();
		(r2 as unknown as { entries: Map<string, unknown> }).entries.set(exited.id, { session: exited, token: 't', spec });
		expect(r2.exitOutcome(exited.id)).toEqual(outcome);
	});

	it('tokened ops delegate through the fence: send, write, signal, close', async () => {
		const { r, session, token } = seeded(fakeSession());
		await expect(r.send(session.id, token, 'ls\n', 100)).resolves.toBe('stdin_read');
		r.write(session.id, token, 'q');
		expect(r.signal(session.id, token, 'SIGINT')).toBe(4242);
		await expect(r.close(session.id, token)).resolves.toEqual({ quiescent: true });
	});

	it('every tokened op refuses FOREIGN_SESSION on a wrong token', async () => {
		const { r, session } = seeded(fakeSession(), 'good');
		expect(() => r.send(session.id, 'bad', 'x', 10)).toThrow(TerminalRegistryRefusal);
		expect(() => r.write(session.id, 'bad', 'x')).toThrow(TerminalRegistryRefusal);
		expect(() => r.signal(session.id, 'bad', 'SIGTERM')).toThrow(TerminalRegistryRefusal);
		await expect(r.close(session.id, 'bad')).rejects.toThrow(TerminalRegistryRefusal);
		try {
			r.write(session.id, 'bad', 'x');
		} catch (e) {
			expect((e as TerminalRegistryRefusal).code).toBe('FOREIGN_SESSION');
		}
	});

it('close surfaces a non-quiescent ladder with lingering pids', async () => {
		const { r, session, token } = seeded(fakeSession({
			close: vi.fn(async () => ({ quiescent: false, lingeringPids: [7, 8] }))
		}));
		await expect(r.close(session.id, token)).resolves.toEqual({ quiescent: false, lingeringPids: [7, 8] });
	});

	it('list reports every session with its exit state', () => {
		const { r, session } = seeded(fakeSession());
		const exited = fakeSession({ id: 'fake-2', isExited: () => true });
		(r as unknown as { entries: Map<string, unknown> }).entries.set(exited.id, { session: exited, token: 't2', spec, ...OPERATOR_FACET });
		expect(r.list()).toEqual([
			{ id: 'fake-1', exited: false, baton: OPERATOR_BATON },
			{ id: 'fake-2', exited: true, baton: OPERATOR_BATON }
		]);
	});

	it('dispose closes every session, tolerates a rejecting close, and clears', async () => {
		const ok = fakeSession({ id: 'fake-1' });
		const bad = fakeSession({ id: 'fake-2', close: vi.fn(async () => { throw new Error('ladder broke'); }) });
		const r = new TerminalRegistry();
		const entries = (r as unknown as { entries: Map<string, unknown> }).entries;
		entries.set(ok.id, { session: ok, token: 'a', spec });
		entries.set(bad.id, { session: bad, token: 'b', spec });
		await expect(r.dispose()).resolves.toBeUndefined();
		expect(ok.close).toHaveBeenCalled();
		expect(bad.close).toHaveBeenCalled();
		expect(r.list()).toEqual([]);
	});

	it('create stores the session and mints a usable token (with promptDetect option)', () => {
		const r = new TerminalRegistry();
		const { session, token } = r.create(spec, { promptDetect: () => true });
		expect(token).toBeTruthy();
		expect(r.peek(session.id).id).toBe(session.id);
	});
});
