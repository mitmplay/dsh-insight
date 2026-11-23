/**
 * Baton facet pins (ADR-0079, task 1.2-T) — the registry as the facet
 * authority: mint records holder + since (default operator), a labeled
 * reattach flips them, an accepted write stamps lastWriteAt, release
 * discards the token and says `unassigned` (the stale token pays exactly
 * one refused write before healing), the D5 derivation matrix holds
 * exactly, every mint/release pushes one baton frame, and destroy prunes
 * the facet with the entry.
 *
 * Harness: TerminalSession is faked (an EventEmitter with the registry's
 * surface) so no PTY is spawned — the same seam terminal-registry-
 * branches.test.ts uses, driven through create() here so the DEFAULT mint
 * is exercised, not seeded by hand.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock is hoisted above every import, so the factory must fetch its own
// dependencies — a top-level `import { EventEmitter }` would be read before
// initialization (TDZ) inside the hoisted factory.
vi.mock('$lib/server/terminal/session.js', async (importOriginal) => {
	const { EventEmitter } = await import('node:events');
	const actual = await importOriginal<typeof import('$lib/server/terminal/session.js')>();
	class FakeSession extends EventEmitter {
		static nextId = 0;
		readonly id = 'fake-' + ++FakeSession.nextId;
		exited = false;
		bytes = 42;
		/** Every event this session pushed — the registry's baton frames land here. */
		readonly emitted: unknown[] = [];
		constructor(public readonly spec: unknown) {
			super();
		}
		emit(name: string, event?: unknown): boolean {
			this.emitted.push(event);
			return super.emit(name, event);
		}
		isExited(): boolean {
			return this.exited;
		}
		streamBytes(): number {
			return this.bytes;
		}
		readFrom() {
			return { text: '', nextOffset: this.bytes, lossy: false };
		}
		exitOutcome() {
			return this.exited ? { exitCode: 0, signal: null } : null;
		}
		async send() {
			return 'stdin_read' as const;
		}
		write = vi.fn();
		resize() {}
		signalForeground(): number {
			return 4242;
		}
		async close() {
			return { quiescent: true };
		}
	}
	return { ...actual, TerminalSession: FakeSession };
});

import { TerminalRegistry, TerminalRegistryRefusal } from '$lib/server/terminal/registry.js';
import type { BatonFacet, TerminalSessionEvent, TerminalSpec } from '$lib/server/terminal/types.js';

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

/** The fake's test-facing surface. Structural on purpose — the real
 *  TerminalSession keeps `exited` private, so intersecting with it would
 *  collapse to `never`. */
interface FakeSession {
	emitted: unknown[];
	exited: boolean;
	write: ReturnType<typeof vi.fn>;
}
const fake = (session: { id: string }): FakeSession => session as unknown as FakeSession;

interface Entry {
	pinned: boolean;
}

/** Reach the registry's private entry — the only way `pinned` flips in v1
 *  (ADR-0079 D6: wire-only, no verb yet). */
function entryOf(r: TerminalRegistry, id: string): Entry {
	const entries = (r as unknown as { entries: Map<string, Entry> }).entries;
	const entry = entries.get(id);
	if (!entry) throw new Error('no entry for ' + id);
	return entry;
}

const batonFrames = (session: FakeSession): Array<Extract<TerminalSessionEvent, { type: 'baton' }>> =>
	session.emitted.filter((e): e is Extract<TerminalSessionEvent, { type: 'baton' }> => (e as { type?: string }).type === 'baton');

/** The facet without its two clock fields — those get range assertions. */
function steady(baton: BatonFacet): Omit<BatonFacet, 'since' | 'lastWriteAt'> {
	const { since: _since, lastWriteAt: _last, ...rest } = baton;
	void _since;
	void _last;
	return rest;
}

const refusalCode = (fn: () => unknown): string => {
	try {
		fn();
	} catch (e) {
		return e instanceof TerminalRegistryRefusal ? e.code : 'NOT_A_REFUSAL';
	}
	return 'NO_THROW';
};

describe('TerminalRegistry baton facet — mint (D1/D3/D7)', () => {
	let r: TerminalRegistry;
	beforeEach(() => {
		r = new TerminalRegistry();
	});

	it('create() mints the OPERATOR default: operator, no label, never ready, one baton frame', () => {
		const before = Date.now();
		const { session, token } = r.create(spec);
		const facet = r.peek(session.id).baton;
		expect(steady(facet)).toEqual({ holder: 'operator', holderId: null, pinned: false, readyForAutomation: false });
		expect(facet.since).toBeGreaterThanOrEqual(before);
		expect(facet.lastWriteAt).toBeNull();
		expect(token).toBeTruthy();
		expect(batonFrames(fake(session))).toEqual([{ type: 'baton', holder: 'operator', holderId: null, since: facet.since }]);
		expect(r.list()[0]?.baton).toEqual(facet); // list carries the same facet
	});

	it('create() honors explicit labels: automation + holderId, and an empty label is no label', () => {
		const a = r.create(spec, { holder: 'automation', holderId: 'curl-driver' });
		expect(steady(r.peek(a.session.id).baton)).toEqual({ holder: 'automation', holderId: 'curl-driver', pinned: false, readyForAutomation: true });
		const b = r.create(spec, { holder: 'automation', holderId: '' });
		expect(r.peek(b.session.id).baton.holderId).toBeNull();
		// an unknown label can never corrupt the facet — it lands as the operator default
		const c = r.create(spec, { holder: 'unassigned' as never, holderId: 42 as never });
		expect(steady(r.peek(c.session.id).baton)).toEqual({ holder: 'operator', holderId: null, pinned: false, readyForAutomation: false });
	});
});

describe('TerminalRegistry baton facet — reattach, write, release (D1/D3/D4/D7)', () => {
	let r: TerminalRegistry;
	beforeEach(() => {
		r = new TerminalRegistry();
	});

	it('a labeled reattach flips holder + holderId + since, evicts the old token, pushes one frame', () => {
		const { session, token } = r.create(spec);
		const minted = r.peek(session.id).baton.since;
		const re = r.reattach(session.id, 'automation', 'lead');
		const facet = r.peek(session.id).baton;
		expect(steady(facet)).toEqual({ holder: 'automation', holderId: 'lead', pinned: false, readyForAutomation: true });
		expect(facet.since).toBeGreaterThanOrEqual(minted);
		expect(re.token).not.toBe(token);
		expect(refusalCode(() => r.write(session.id, token, 'x'))).toBe('FOREIGN_SESSION');
		expect(batonFrames(fake(session)).at(-1)).toEqual({ type: 'baton', holder: 'automation', holderId: 'lead', since: facet.since });
		// the desk's own {} post is the operator takeover it always was
		r.reattach(session.id);
		expect(steady(r.peek(session.id).baton)).toEqual({ holder: 'operator', holderId: null, pinned: false, readyForAutomation: false });
		expect(batonFrames(fake(session)).at(-1)).toMatchObject({ type: 'baton', holder: 'operator' });
	});

	it('an accepted write stamps lastWriteAt; a refused write leaves it alone', () => {
		const { session, token } = r.create(spec);
		const since = r.peek(session.id).baton.since;
		expect(refusalCode(() => r.write(session.id, 'forged', 'x'))).toBe('FOREIGN_SESSION');
		expect(r.peek(session.id).baton.lastWriteAt).toBeNull();
		r.write(session.id, token, 'ls\n');
		const last = r.peek(session.id).baton.lastWriteAt;
		expect(last).toBeGreaterThanOrEqual(since);
		expect(last).toBeLessThanOrEqual(Date.now());
		// no frame for a write — the facet's clock moves, the holder does not
		expect(batonFrames(fake(session))).toHaveLength(1);
	});

	it('release discards the token, says unassigned, pushes one frame — the stale token pays exactly ONE refusal, then heals', () => {
		const { session, token } = r.create(spec, { holder: 'automation', holderId: 'lead' });
		const held = r.peek(session.id).baton.since;
		const released = r.release(session.id, token);
		expect(steady(released)).toEqual({ holder: 'unassigned', holderId: null, pinned: false, readyForAutomation: true });
		expect(released.since).toBeGreaterThanOrEqual(held);
		expect(batonFrames(fake(session)).at(-1)).toEqual({ type: 'baton', holder: 'unassigned', holderId: null, since: released.since });
		// the released token is dead: one refusal …
		expect(refusalCode(() => r.write(session.id, token, 'x'))).toBe('FOREIGN_SESSION');
		expect(() => r.write(session.id, token, 'x')).toThrow(TerminalRegistryRefusal);
		// … then the universal takeover cost: heal (reattach) and the SAME write lands
		const healed = r.reattach(session.id);
		r.write(session.id, healed.token, 'x');
		expect(fake(session).write).toHaveBeenCalledExactlyOnceWith('x');
		expect(r.peek(session.id).baton.holder).toBe('operator');
	});

	it('release is fence-checked: a foreign token changes nothing', () => {
		const { session, token } = r.create(spec, { holder: 'automation', holderId: 'lead' });
		const before = r.peek(session.id).baton;
		expect(refusalCode(() => r.release(session.id, 'forged'))).toBe('FOREIGN_SESSION');
		expect(r.peek(session.id).baton).toEqual(before);
		expect(refusalCode(() => r.release('ghost', token))).toBe('NO_SESSION');
		expect(batonFrames(fake(session))).toHaveLength(1);
	});
});

describe('TerminalRegistry baton facet — the D5 derivation matrix, exactly', () => {
	it('readyForAutomation = !exited && !pinned && holder !== operator — nothing else', () => {
		const r = new TerminalRegistry();
		const op = r.create(spec);
		const auto = r.create(spec, { holder: 'automation', holderId: 'lead' });
		const free = r.create(spec, { holder: 'automation', holderId: 'lead' });
		r.release(free.session.id, free.token);
		const pinned = r.create(spec, { holder: 'automation', holderId: 'lead' });
		entryOf(r, pinned.session.id).pinned = true;
		const exited = r.create(spec, { holder: 'automation', holderId: 'lead' });
		fake(exited.session).exited = true;
		const exitedFree = r.create(spec);
		r.release(exitedFree.session.id, exitedFree.token);
		fake(exitedFree.session).exited = true;

		const ready = (id: string): boolean | undefined => r.list().find((s) => s.id === id)?.baton.readyForAutomation;
		// false: exited / pinned / operator-held
		expect(ready(op.session.id)).toBe(false);
		expect(ready(pinned.session.id)).toBe(false);
		expect(ready(exited.session.id)).toBe(false);
		expect(ready(exitedFree.session.id)).toBe(false);
		// true: automation-held / unassigned (alive, unpinned)
		expect(ready(auto.session.id)).toBe(true);
		expect(ready(free.session.id)).toBe(true);

		// derived, never stored: flip the inputs and the same entry re-derives
		entryOf(r, pinned.session.id).pinned = false;
		expect(ready(pinned.session.id)).toBe(true);
		fake(exited.session).exited = false;
		expect(ready(exited.session.id)).toBe(true);
		expect(r.peek(exited.session.id).exited).toBe(false); // {id, exited} readers keep working
	});
});

describe('TerminalRegistry baton facet — destroy prunes the facet with the entry', () => {
	it('destroy removes the entry: list() is empty and peek() is NO_SESSION', async () => {
		const r = new TerminalRegistry();
		const { session, token } = r.create(spec, { holder: 'automation', holderId: 'lead' });
		expect(r.list()).toHaveLength(1);
		await expect(r.destroy(session.id, token)).resolves.toEqual({ quiescent: true, pruned: true });
		expect(r.list()).toEqual([]);
		expect(refusalCode(() => r.peek(session.id))).toBe('NO_SESSION');
		expect(refusalCode(() => r.release(session.id, token))).toBe('NO_SESSION');
	});
});
