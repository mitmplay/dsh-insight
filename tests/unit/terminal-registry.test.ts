/**
 * Registry tests over the real engine (Wave 2, task 2.2-T) — mint/verify,
 * the FOREIGN_SESSION fence, re-attach eviction, and a dispose that closes
 * every session and awaits quiescence.
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { TerminalRegistry, TerminalRegistryRefusal } from '$lib/server/terminal/registry.js';
import type { TerminalSpec } from '$lib/server/terminal/types.js';

const dirs: string[] = [];
const registries: TerminalRegistry[] = [];

function makeRegistry(): TerminalRegistry {
	dirs.push(mkdtempSync(join(tmpdir(), 'dsi-reg-')));
	const r = new TerminalRegistry();
	registries.push(r);
	return r;
}

function spec(): TerminalSpec {
	return {
		argv: ['/bin/bash', '--norc', '--noprofile', '-i'],
		cwd: dirs[dirs.length - 1],
		env: { PS1: '$ ' },
		rows: 24,
		cols: 80,
		terminalType: 'xterm-256color',
		graceMs: 1_000,
		idleMs: 200,
		tailBytes: 262_144
	};
}

afterEach(() => {
	for (const r of registries) void r.dispose();
	registries.length = 0;
	for (const d of dirs) rmSync(d, { recursive: true, force: true });
	dirs.length = 0;
});

describe('TerminalRegistry', () => {
	it('create mints a token; the authorized send path works', async () => {
		const r = makeRegistry();
		const { session, token } = r.create(spec());
		await new Promise((res) => setTimeout(res, 300));
		const reason = await r.send(session.id, token, 'echo reg-ok\n', 5_000);
		expect(['stdin_read', 'inferred_idle']).toContain(reason);
		// the row carries the additive baton facet (ADR-0079 D2) — id/exited readers keep working
		expect(r.list()).toContainEqual(expect.objectContaining({ id: session.id, exited: false }));
	});

	it('a wrong token is refused FOREIGN_SESSION, an unknown id NO_SESSION', async () => {
		const r = makeRegistry();
		const { session, token } = r.create(spec());
		expect(() => r.send(session.id, 'forged-token', 'x\n', 1_000)).toThrow(TerminalRegistryRefusal);
		try {
			r.send(session.id, 'forged-token', 'x\n', 1_000);
		} catch (e) {
			expect((e as TerminalRegistryRefusal).code).toBe('FOREIGN_SESSION');
		}
		await expect(r.close('no-such-id', token)).rejects.toThrow(TerminalRegistryRefusal);
		try {
			await r.close('no-such-id', token);
		} catch (e) {
			expect((e as TerminalRegistryRefusal).code).toBe('NO_SESSION');
		}
	});

	it('reattach evicts the old token — many watchers, one writer', async () => {
		const r = makeRegistry();
		const { session, token } = r.create(spec());
		const second = r.reattach(session.id);
		expect(second.token).not.toBe(token);
		expect(() => r.send(session.id, token, 'x\n', 1_000)).toThrow(TerminalRegistryRefusal);
		await expect(r.send(session.id, second.token, 'echo after-reattach\n', 5_000)).resolves.toBeTruthy();
	});

	it('reads are the watcher path — no token needed', async () => {
		const r = makeRegistry();
		const { session } = r.create(spec());
		const read = r.readFrom(session.id, 0);
		expect(read.lossy).toBe(false);
		expect(() => r.send(session.id, 'no-token', 'x\n', 1_000)).toThrow(TerminalRegistryRefusal);
	});

	it('dispose closes every session and awaits quiescence', async () => {
		execSync('pkill -f "dsi-reg-dispose-marker" 2>/dev/null || true');
		const r = makeRegistry();
		const a = r.create(spec());
		const b = r.create(spec());
		await new Promise((res) => setTimeout(res, 300));
		await r.send(a.session.id, a.token, 'nohup sleep 2966601 > /dev/null 2>&1 &\n', 5_000);
		await r.dispose();
		expect(r.list()).toEqual([]);
		const left = execSync('pgrep -fl "sleep 2966601" || true', { encoding: 'utf8' });
		expect(left.trim()).toBe(''); // the backgrounded child did not survive the sweep
	});
});
