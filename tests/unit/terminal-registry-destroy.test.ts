/**
 * Registry destroy tests (spec 2026-11-07 Terminal Prune Verb, task 1.1-T):
 * destroy = the close ladder + a registry prune — list() shrinks in the
 * same call; an exited session prunes without re-killing; the fence
 * applies (wrong token refused, entry survives).
 */
import { describe, expect, it } from 'vitest';

import { TerminalRegistry, TerminalRegistryRefusal } from '../../src/lib/server/terminal/registry.js';

const SPEC = { argv: ['/bin/echo', 'hi'], cwd: '/tmp', rows: 24, cols: 80, terminalType: 'xterm-256color', graceMs: 1000, idleMs: 1000, tailBytes: 4096, env: undefined } as const;

describe('TerminalRegistry.destroy', () => {
	it('kills a live session AND prunes the entry — list() shrinks in the same call', async () => {
		const reg = new TerminalRegistry();
		const { session, token } = reg.create({ ...SPEC });
		expect(reg.list()).toHaveLength(1);
		const result = await reg.destroy(session.id, token);
		expect(result.pruned).toBe(true);
		expect(reg.list()).toHaveLength(0);
	});

	it('prunes an already-exited session without hanging', async () => {
		const reg = new TerminalRegistry();
		const { session, token } = reg.create({ ...SPEC });
		// echo's pty settles fast; poll the session's own exited flag
		for (let i = 0; i < 100 && !session.isExited(); i++) await new Promise((r2) => setTimeout(r2, 30));
		expect(session.isExited()).toBe(true);
		const result = await reg.destroy(session.id, token);
		expect(result.pruned).toBe(true);
		expect(reg.list()).toHaveLength(0);
	}, 10000);

	it('refuses a foreign token with FOREIGN_SESSION — the entry survives', async () => {
		const reg = new TerminalRegistry();
		const { session } = reg.create({ ...SPEC });
		await expect(reg.destroy(session.id, 'wrong-token')).rejects.toMatchObject({ code: 'FOREIGN_SESSION' });
		expect(reg.list()).toHaveLength(1);
	});

	it('refuses an unknown id with NO_SESSION', async () => {
		const reg = new TerminalRegistry();
		await expect(reg.destroy('t-none', 'any')).rejects.toBeInstanceOf(TerminalRegistryRefusal);
	});
});
