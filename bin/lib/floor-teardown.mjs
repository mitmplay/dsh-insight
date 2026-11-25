// floor-teardown.mjs — ADR-0082 (The Loud Floor) D1: no child exit dies
// silently. Every child exit prints one line — role (host or ui), pid, and
// exit code or signal — BEFORE the sibling is killed, so a co-tenant's kill
// of the vite child reads on the floor's own transcript instead of costing
// an afternoon of ps and lsof (evidence: dev/kb/rca/2026-11-20 - RCA — The
// Floor That Died Quietly.md). Our own SIGINT/SIGTERM forward speaks too.
// Exit code stays 1 for any child exit or signal (existing semantics).
//
// Pure wiring with injectable edges (log, exitProcess, signal registration)
// so the unit tests drive REAL stub child processes and assert the spoken
// line's ORDER against the sibling's death.

/** @typedef {{ pid?: number | undefined, on?: (event: string, listener: (code: number | null, signal: NodeJS.Signals | null) => void) => unknown, kill?: (signal?: NodeJS.Signals) => unknown }} SpokenChild */

/**
 * @param {number | null} [code]
 * @param {NodeJS.Signals | null} [signal]
 * @returns {string}
 */
const describeCause = (code, signal) =>
	signal ? `signalled with ${signal}` : `exited with code ${code ?? 'null'}`;

/**
 * @param {{ host?: SpokenChild | null, ui?: SpokenChild | null, signals?: NodeJS.Signals[], log?: (line: string) => void, exitProcess?: (code: number) => void, onSignal?: ((signal: NodeJS.Signals, forward?: (signal: NodeJS.Signals) => void) => void) | null }} [edges]
 * @returns {{ forward: (signal: NodeJS.Signals) => void }}
 */
export function wireFloorTeardown({
	host,
	ui,
	signals = ['SIGINT', 'SIGTERM'],
	log = (line) => console.log(line),
	exitProcess = (code) => process.exit(code),
	onSignal
} = {}) {
	const spoken = new Set();
	/**
	 * @param {string} role
	 * @param {SpokenChild} child
	 * @param {number | null} code
	 * @param {NodeJS.Signals | null} signal
	 */
	const speakExit = (role, child, code, signal) => {
		if (!child || spoken.has(child)) return;
		spoken.add(child);
		log(`dsi dsh: ${role} child (pid ${child.pid}) ${describeCause(code, signal)}`);
	};

	/**
	 * @param {string} role
	 * @param {SpokenChild} dying
	 * @param {SpokenChild | null | undefined} sibling
	 * @returns {(code: number | null, signal: NodeJS.Signals | null) => void}
	 */
	const handle = (role, dying, sibling) => (code, signal) => {
		// SPEAK FIRST: the cause lands on stdout before the sibling dies and
		// before this process exits (D1 — the line must survive the teardown).
		speakExit(role, dying, code, signal);
		try { sibling?.kill?.('SIGTERM'); } catch { /* sibling already gone */ }
		exitProcess(1);
	};
	if (host?.on) host.on('exit', handle('host', host, ui));
	if (ui?.on) ui.on('exit', handle('ui', ui, host));

	/** @param {NodeJS.Signals} signal */
	const forward = (signal) => {
		log(`dsi dsh: ${signal} received — tearing down floor (host pid ${host?.pid ?? 'none'}, ui pid ${ui?.pid ?? 'none'})`);
		try { host?.kill?.(signal); } catch { /* already gone */ }
		try { ui?.kill?.(signal); } catch { /* already gone */ }
		if (onSignal) onSignal(signal); else exitProcess(1);
	};
	for (const signal of signals) {
		// Tests pass onSignal to receive the forward instead of touching the
		// test process's real signal table.
		if (onSignal) onSignal(signal, forward);
		else process.on(signal, () => forward(signal));
	}
	return { forward };
}
