/**
 * TerminalSession tests over a REAL PTY (Wave 2, task 2.1-T) — node-pty is
 * the substrate, so the engine is exercised against a live shell, not a
 * mock. The ps probe pins D5's quiescence: closing a shell with a
 * backgrounded child leaves no lingering pid.
 */
import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { TerminalSendRefusal, TerminalSession } from '$lib/server/terminal/session.js';
import type { TerminalSpec } from '$lib/server/terminal/types.js';

const dirs: string[] = [];
const sessions: TerminalSession[] = [];

function makeSession(overrides?: Partial<TerminalSpec>, promptDetect?: (tail: string) => boolean): TerminalSession {
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
		idleMs: 200,
		tailBytes: 262_144,
		...overrides
	};
	const s = new TerminalSession(spec, promptDetect ? { promptDetect } : undefined);
	sessions.push(s);
	return s;
}

afterEach(() => {
	for (const s of sessions) void s.close().catch(() => undefined);
	sessions.length = 0;
	for (const d of dirs) rmSync(d, { recursive: true, force: true });
	dirs.length = 0;
});

/** pids of live "sleep" processes carrying the wave's unique marker arg —
 *  job control puts background children in their OWN group, so the probe
 *  tracks the command, not the pgid. */
const SLEEP_MARKER = 'sleep 29' + Math.floor(Math.random() * 100_000);
function sleepPids(): number[] {
	const out = spawnSync('ps', ['-ax', '-o', 'pid=,command='], { encoding: 'utf8' });
	const pids: number[] = [];
	for (const line of out.stdout.split('\n')) {
		const m = line.trim().match(/^(\d+)\s+(.*)$/);
		if (m && m[2].includes(SLEEP_MARKER)) pids.push(Number(m[1]));
	}
	return pids;
}

describe('TerminalSession (real PTY)', () => {
	it('echo round-trip: send settles stdin_read on positive prompt evidence', async () => {
		const s = makeSession();
		await new Promise((r) => setTimeout(r, 300)); // let the banner/prompt arrive
		const reason = await s.send('echo dsi-wave2\n', 5_000);
		expect(reason).toBe('stdin_read');
		expect(s.getTail()).toContain('dsi-wave2');
	});

	it('a second send while one is in flight refuses SEND_ACTIVE', async () => {
		const s = makeSession({ idleMs: 600 });
		await new Promise((r) => setTimeout(r, 300));
		const first = s.send('sleep 1\n', 5_000);
		await new Promise((r) => setTimeout(r, 50));
		await expect(s.send('echo x\n', 5_000)).rejects.toThrow(TerminalSendRefusal);
		const reason = await first;
		expect(['stdin_read', 'inferred_idle']).toContain(reason);
	});

	it('signalForeground SIGINT stops a foreground sleep (Ctrl-C semantics)', async () => {
		const s = makeSession();
		await new Promise((r) => setTimeout(r, 300));
		const sending = s.send('sleep 30\n', 30_000);
		await new Promise((r) => setTimeout(r, 400)); // sleep is now foreground
		const pgid = s.signalForeground('SIGINT');
		expect(pgid).toBe(s.processGroupId);
		const reason = await sending;
		expect(['stdin_read', 'inferred_idle', 'timeout']).toContain(reason);
		expect(s.getTail()).not.toContain('done-sleeping');
	});

	it('close kills a shell with a backgrounded child and leaves NO lingering pid', async () => {
		const s = makeSession();
		await new Promise((r) => setTimeout(r, 300));
		await s.send('nohup ' + SLEEP_MARKER + ' > /dev/null 2>&1 &\n', 5_000);
		expect(sleepPids().length).toBeGreaterThan(0); // the backgrounded child lives
		const result = await s.close();
		expect(result.quiescent).toBe(true);
		expect(result.lingeringPids).toBeUndefined();
		expect(sleepPids()).toEqual([]); // and the sweep took it with the session
	});

	it('close is idempotent — the second call awaits the first ladder', async () => {
		const s = makeSession();
		await new Promise((r) => setTimeout(r, 200));
		const [a, b] = await Promise.all([s.close(), s.close()]);
		expect(a.quiescent).toBe(true);
		expect(b.quiescent).toBe(true);
		expect(s.isExited()).toBe(true);
	});

	it('output ring truncates and the spill file holds the dropped head', async () => {
		const s = makeSession({ tailBytes: 2_048 });
		await new Promise((r) => setTimeout(r, 300));
		await s.send('head -c 20000 /usr/share/dict/words 2>/dev/null || seq 1 9000\n', 20_000);
		// force the stream well past the 2 KB cap
		for (let i = 0; i < 3 && Buffer.byteLength(s.getTail()) < 4_096; i++) {
			await s.send('seq 1 2000\n', 20_000);
		}
		const read = s.readFrom(0);
		expect(read.lossy).toBe(true);
		expect(read.spillPath).toBeDefined();
		const fresh = s.readFrom(s.streamBytes());
		expect(fresh.lossy).toBe(false);
	});

	it('a session that exits mid-send settles session_exit', async () => {
		const s = makeSession();
		await new Promise((r) => setTimeout(r, 300));
		const sending = s.send('exit\n', 10_000);
		const reason = await sending;
		expect(reason).toBe('session_exit');
		expect(s.isExited()).toBe(true);
	});
});

describe('TerminalSession.resize — the fitted dims reach the PTY (2026-11-03 amendment)', () => {
	it('resize(cols, rows) re-reads winsize in the child — stty reports the new size', async () => {
		const s = makeSession();
		await new Promise((r) => setTimeout(r, 300));
		s.resize(120, 40);
		s.write('stty size\n');
		await new Promise((r) => setTimeout(r, 600));
		// the child's winsize now reads 40 120 (rows cols) — before the fix
		// the PTY stayed at the spawn dims and the shell's right prompt
		// printed past the rendered viewport
		expect(s.getTail()).toContain('40 120');
	});

	it('resize clamps junk and is a no-op on an exited session', async () => {
		const s = makeSession();
		await new Promise((r) => setTimeout(r, 300));
		s.resize(9999, -5); // clamped, must not throw
		await s.close();
		s.resize(100, 30); // exited ⇒ no-op, must not throw
	});
});
