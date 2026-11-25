import { describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';

import { wireFloorTeardown } from '../../bin/lib/floor-teardown.mjs';

// Stub children: a plain node child that exits 3 (theTasks.md T5 shape),
// and a peer that announces SIGTERM receipt on stdout before dying.
const stubExit3 = () => spawn(process.execPath, ['-e', 'process.exit(3)'], { stdio: 'ignore' });
const stubSigtermEater = () => spawn(
	process.execPath,
	['-e', 'process.on("SIGTERM", () => { console.log("ui-got-sigterm"); process.exit(0); }); setTimeout(() => {}, 30000);'],
	{ stdio: ['ignore', 'pipe', 'ignore'] }
);

const waitExit = (child: ReturnType<typeof spawn>) =>
	new Promise<void>((resolve) => { child.on('exit', () => resolve()); });

describe('floor teardown speech (ADR-0082 D1)', () => {
	it('speaks the dying host role, pid, and exit code BEFORE the sibling dies; exit stays 1', async () => {
		const host = stubExit3();
		const ui = stubSigtermEater();
		let uiSigtermSeen = false;
		let spokenBeforeSiblingDeath = false;
		ui.stdout!.on('data', (chunk: Buffer) => {
			if (chunk.toString().includes('ui-got-sigterm')) {
				uiSigtermSeen = true;
				// the spoken line must already be on record at the moment the
				// sibling receives its kill — that is the whole point of D1
				spokenBeforeSiblingDeath = lines.some((l) => l.includes('host child'));
			}
		});
		const lines: string[] = [];
		const exitProcess = vi.fn();
		wireFloorTeardown({ host, ui, log: (l) => lines.push(l), exitProcess });
		await waitExit(host);
		await new Promise<void>((resolve) => {
			const t = setInterval(() => { if (uiSigtermSeen) { clearInterval(t); resolve(); } }, 20);
		});
		const spoken = lines.find((l) => l.includes('host child (pid '));
		expect(spoken).toBeTruthy();
		expect(spoken).toContain('host');
		expect(spoken).toContain(String(host.pid));
		expect(spoken).toContain('exited with code 3');
		expect(uiSigtermSeen).toBe(true);
		expect(spokenBeforeSiblingDeath).toBe(true);
		expect(exitProcess).toHaveBeenCalledWith(1);
		host.kill('SIGKILL'); ui.kill('SIGKILL');
	}, 15000);

	it('speaks the ui child signal cause and names the signal', async () => {
		const host = stubSigtermEater();
		const ui = stubExit3();
		ui.kill('SIGTERM'); // ui dies by signal, not code
		const lines: string[] = [];
		const exitProcess = vi.fn();
		wireFloorTeardown({ host, ui, log: (l) => lines.push(l), exitProcess });
		await waitExit(ui);
		await waitExit(host);
		const spoken = lines.find((l) => l.includes('ui child (pid '));
		expect(spoken).toBeTruthy();
		expect(spoken).toContain('signalled with SIGTERM');
		expect(exitProcess).toHaveBeenCalledWith(1);
		host.kill('SIGKILL');
	}, 15000);

	it('our own signal forward speaks before both children are killed', async () => {
		const host = stubSigtermEater();
		const ui = stubSigtermEater();
		const lines: string[] = [];
		const exitProcess = vi.fn();
		const registrations: string[] = [];
		const wired = wireFloorTeardown({ host, ui, log: (l) => lines.push(l), exitProcess, onSignal: (sig) => registrations.push(sig) });
		// registration was requested for each signal (tests never touch the real table)
		expect(registrations).toEqual(['SIGINT', 'SIGTERM']);
		wired.forward('SIGINT');
		const speech = lines.find((l) => l.includes('SIGINT received'));
		expect(speech).toBeTruthy();
		expect(speech).toContain('host pid');
		expect(speech).toContain('ui pid');
		await Promise.all([waitExit(host), waitExit(ui)]);
		// both stubs announced SIGTERM — the forward reached the pair; the
		// children's exits then speak and exit 1, exactly like any child death
		expect(exitProcess).toHaveBeenCalledWith(1);
		// the forward's speech landed BEFORE the first exit-driven exitProcess
		const speechIdx = lines.findIndex((l) => l.includes('SIGINT received'));
		const firstChildSpeech = lines.findIndex((l) => l.includes('child (pid '));
		expect(speechIdx).toBeGreaterThanOrEqual(0);
		expect(firstChildSpeech).toBeGreaterThan(speechIdx);
		host.kill('SIGKILL'); ui.kill('SIGKILL');
	}, 15000);
});
