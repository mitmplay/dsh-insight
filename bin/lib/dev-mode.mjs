/**
 * dev-mode — parse the --dev flag's optional value and derive env markers.
 *
 * ADR: dev/architectural-decission/2026-10/2026-10-11 - The In-Process Host
 * (D4: --dev gains an optional value; bare --dev keeps today's meaning;
 * the mode rides to vite via env, never past the CLI to the dsh web host).
 *
 * Modes:
 *   'build'      — the built page (no --dev)
 *   'pair'       — vite dev server + separate host child (bare --dev / --dev pair)
 *   'in-process' — vite dev server boots the host itself (--dev in-process)
 */

/** Tokens the --dev flag may consume as its value. Anything else after
 *  --dev belongs to some other flag (or the host) and is left alone. */
const DEV_VALUES = new Set(['in-process', 'pair']);

/**
 * Parse a rest-args array for --dev (and strip dsi-side flags).
 * @param {string[]} rest — args AFTER the subcommand (e.g. after 'dsh --sync')
 * @returns {{ mode: 'build'|'pair'|'in-process', rest: string[] }}
 *   rest — args with --dev (and its value) plus other dsi-side flags removed,
 *   safe to forward to the dsh web host.
 */
export function parseDevArg(rest) {
	const out = [];
	/** @type {'build' | 'pair' | 'in-process'} */
	let mode = 'build';
	for (let i = 0; i < rest.length; i++) {
		const arg = rest[i];
		if (arg === '--zai' || arg === '--ov') continue; // dsi-side, stripped (pre-existing contract)
		if (arg === '--dev') {
			const next = rest[i + 1];
			if (next && DEV_VALUES.has(next)) {
				mode = next === 'pair' ? 'pair' : 'in-process';
				i++; // consume the value — it never reaches the host
			} else {
				mode = 'pair'; // bare --dev keeps today's meaning (D4)
			}
			continue;
		}
		out.push(arg);
	}
	return { mode, rest: out };
}

/**
 * Env additions for the vite child expressing the chosen mode.
 * DSI_DEV=1 is the pre-existing dev-floor marker (RCA 2026-09-27) — kept for
 * the bounce chain's boolean probe; DSI_DEV_MODE is the D6 mode enum.
 */
/** @param {string} mode
 * @param {{ playwrightMcp?: boolean }} [opts]
 * @returns {Record<string, string>}
 */
export function devModeEnv(mode, opts = {}) {
	if (mode === 'build') return {};
	/** @type {Record<string, string>} */
	const env = { DSI_DEV: '1', DSI_DEV_MODE: mode };
	if (mode === 'in-process') {
		env.DSI_DEV_IN_PROCESS = '1';
		// ADR-0025 Wave 3 (real-floor gate finding, 2026-10-14): the bounce
		// verb only exists when the embed OWNS the host - a runCli boot has
		// no stop handle and the host-bounce route answers 409 no-handle,
		// sending every in-process bounce down the whole-floor sweep. The
		// introspection boot (DSH_HOST_INTROSPECT=1, ADR-0024) is the boot
		// that carries the handle, so in-process floors default to it.
		env.DSH_HOST_INTROSPECT = '1';
	}
	// ADR-0029 D7: the glass browser's MCP brain runs in-process (opt-in,
	// dev floor only — the tandem/production floors keep the stdio child)
	if (opts.playwrightMcp) env.DSI_MCP_IN_PROCESS = '1';
	return env;
}

/**
 * Map the legacy boolean dev signal (bounceDevMode's return, older floors)
 * to a mode. Wave 3.5 will teach the bounce the enum; until then the bounce
 * can only ever restore 'pair' or 'build'.
 */
/** @param {boolean} dev
 * @returns {'pair' | 'build'}
 */
export function modeFromBoolean(dev) {
	return dev ? 'pair' : 'build';
}

/**
 * Parse ps -E -p <pid> output for the floor's DSI_DEV_MODE marker (D6).
 * Pure: the ps invocation is injected by dsi.mjs.
 * @param {string} psOutput — full environment dump of the vite process
 * @returns {'in-process' | null} null = marker absent (pair/build floor)
 */
export function parseDevModeFromPsE(psOutput) {
	const m = /(?:^|\s)DSI_DEV_MODE=(\S+)/.exec(psOutput || '');
	return m && m[1] === 'in-process' ? 'in-process' : null;
}

/**
 * Resolve the mode a bounce must RESTORE (D6 — the plugin-apply restart
 * runs in a fresh CLI that cannot see the original argv).
 *
 * Priority:
 *   1. the alive floor's own env says in-process → restore 'in-process'
 *      (D6, sharpened 2026-10-12 Port Takeover: the floor's RECORDED mode is
 *      authoritative over the bounce's --dev flag — the verb's chain always
 *      carries --dev, and letting it win bounced in-process floors into
 *      'pair', which spawned a sync-script host AND left the stale
 *      DSI_DEV_IN_PROCESS marker active in the chain env, so two hosts
 *      fought for 3080 and the floor died on EADDRINUSE every click)
 *   2. explicit --dev flag on the bounce itself → 'pair' (legacy semantics;
 *      the operator asked for a dev re-serve)
 *   3. a dev floor is alive (boolean probe) → 'pair'
 *   4. nothing alive → 'build'
 * @param {{ flagDev?: boolean, devFloorAlive?: boolean, floorEnv?: string }} p
 */
export function resolveBounceMode(p = {}) {
	if (p.floorEnv && parseDevModeFromPsE(p.floorEnv) === 'in-process') return 'in-process';
	if (p.flagDev) return 'pair';
	if (p.devFloorAlive) return 'pair';
	return 'build';
}

/**
 * Parse a ps -E environment dump for DSI_INSPECT_ARGS (ADR 2026-10-13
 * "The Faithful Bounce", D3): the space-joined inspector flags the launcher
 * stamped beside the dev-mode markers. Pure: the dump string is injected.
 * @param {string} psOutput — full environment dump of the vite process
 * @returns {string[]} inspector argv ([] = none recorded / pre-stamp floor)
 */
export function parseInspectArgsFromEnv(psOutput) {
	// ps -E is ONE line of KEY=VALUE tokens — the value ends at the next
	// KEY= token (identifier-shaped, so '--inspect=...' never trips it),
	// at a newline, or at end-of-dump. Lazy capture + lookahead.
	const m = /(?:^|\s)DSI_INSPECT_ARGS=(.*?)(?=\s+[A-Za-z_][A-Za-z0-9_]*=|\s*$|\n|\r)/.exec(psOutput || '');
	if (!m) return [];
	return m[1].trim().split(/\s+/).filter(Boolean);
}

/**
 * Pull Node inspector flags out of the rest-args: --inspect, --inspect-brk,
 * --inspect=<host:port>. Forwarded to the vite child's execArgv (D7) —
 * NEVER via NODE_OPTIONS, which would leak the inspector to every child
 * dsi.mjs spawns and collide on the default port.
 * @param {string[]} rest
 * @returns {{ rest: string[], execArgv: string[] }}
 */
export function extractInspectArgs(rest) {
	const out = [];
	const execArgv = [];
	for (const arg of rest) {
		if (arg === '--inspect' || arg === '--inspect-brk' || arg.startsWith('--inspect=')) {
			execArgv.push(arg);
			continue;
		}
		out.push(arg);
	}
	return { rest: out, execArgv };
}