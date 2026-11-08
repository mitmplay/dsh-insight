/**
 * plugin-chain — the testable half of 'dsi dsh --plugin' (The Plugin Rack
 * ADR 2026-09-27, D3/D5): argument validation and the dsh launcher rule
 * (DSH_WEB_CMD override, else the pinned published dsh via npx — the same
 * rule runOvPlugin established). The impure half (spawnSync, killOrphans,
 * runSyncedPair) stays in dsi.mjs; this module never touches a process.
 */

/**
 * Parse 'dsi dsh --plugin <add|remove> <pkg> [--profile <p>]' arguments.
 *
 * @param {string[]} argv
 * @param {{ envProfile?: string }} [options]
 * @returns {null | { error: string } | { action: 'add' | 'remove' | 'restart', pkg: string, profile: string, dev?: boolean }}
 *   null = argv is not a --plugin invocation (the caller falls through to
 *   its own unknown-flag error); { error } = a --plugin invocation with a
 *   bad shape (usage exit 64).
 */
export function parsePluginArgs(argv, options = {}) {
	const envProfile = options.envProfile ?? 'web';
	const [flag] = argv;
	if (flag !== '--plugin' && flag !== '--plugin-restart') return null;
	const rest = argv.slice(1);
	if (flag === '--plugin-restart') {
		// --dev is the only accepted extra: the bounce must restore the SAME
		// UI mode the floor was serving (RCA 2026-09-27 — a dev-mode floor
		// bounced into build mode came back on 5174 while the browser sat on
		// 5175's corpse; the UI mode rides the DSI_DEV env marker).
		const dev = rest.includes('--dev');
		if (rest.some((arg) => arg !== '--dev')) return { error: 'usage: dsi dsh --plugin-restart [--dev]' };
		return { action: 'restart', pkg: '', profile: envProfile, dev };
	}
	const [action, pkg, ...tail] = rest;
	if (action !== 'add' && action !== 'remove') {
		return { error: 'usage: dsi dsh --plugin <add|remove> <pkg> [--profile <p>]' };
	}
	if (!pkg || pkg.startsWith('-')) {
		return { error: 'usage: dsi dsh --plugin <add|remove> <pkg> [--profile <p>]' };
	}
	let profile = envProfile;
	for (let i = 0; i < tail.length; i++) {
		if (tail[i] === '--profile') {
			const value = tail[i + 1];
			if (!value || value.startsWith('-')) return { error: 'usage: --profile needs a profile name' };
			profile = value;
			i++;
		} else {
			return { error: 'unexpected argument: ' + tail[i] };
		}
	}
	return { action, pkg, profile };
}

/**
 * The bounce's dev-mode decision (RCA 2026-09-27, second order): an explicit
 * --dev flag wins, otherwise the chain asks whether a dev floor is alive.
 * Pure: the process-table probe is injected so the real pgrep stays in
 * dsi.mjs's impure half.
 *
 * @param {boolean} flagDev — the parsed `--plugin-restart --dev` flag
 * @param {() => boolean} devFloorAlive — probe for a running vite dev server
 * @returns {boolean}
 */
export function bounceDevMode(flagDev, devFloorAlive) {
	if (flagDev) return true;
	try {
		return devFloorAlive() === true;
	} catch {
		return false;
	}
}

/** The takeover's bounded-wait budget and poll cadence (The Port Takeover
 *  ADR 2026-10-12, D3): after the SIGTERM sweep the chain waits until every
 *  DSI port actually frees — at most this budget — then re-serves. A port
 *  still held at the deadline is an honest exit 64, never a half-boot. */
export const TAKEOVER_BUDGET_MS = 10_000;
export const TAKEOVER_POLL_MS = 250;

/** The host-level bounce's retry window (ADR-0025 D3): the chain POSTs the
 *  running floor's /api/plugins/host-bounce at most this many times before
 *  giving up and taking the whole-floor sweep fallback. */
export const HOST_BOUNCE_TRIES = 2;
export const HOST_BOUNCE_RETRY_MS = 1_000;

/**
 * The bounce fork (ADR-0025 D1/D3): an in-process floor with a live bounce
 * verb bounces AT THE HOST — the chain POSTs the route and, on ok, sweeps
 * NOTHING (vite never dies). Any other mode, refusal, or unreachable route
 * falls back to today's whole-floor sweep. Pure orchestration: the POST and
 * the sweep are injected, so unit tests pin BOTH branches.
 *
 * @param {{ mode: string, post: () => Promise<boolean>, sweep: () => void | Promise<void>,
 *            sleep?: (ms: number) => Promise<void>, tries?: number }} params
 * @returns {Promise<'host' | 'sweep'>} which body ran
 */
export async function hostBounceDecision({ mode, post, sweep, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), tries = HOST_BOUNCE_TRIES }) {
	if (mode !== 'in-process') {
		await sweep();
		return 'sweep';
	}
	for (let attempt = 1; attempt <= tries; attempt++) {
		try {
			if ((await post()) === true) return 'host';
		} catch {
			// unreachable or refused — retry, then sweep
		}
		if (attempt < tries) await sleep(HOST_BOUNCE_RETRY_MS);
	}
	await sweep();
	return 'sweep';
}

/** The browser launch URL after a bounce (ADR-0025 D4, amended
 *  2026-10-14): the DSH launch token is minted INSIDE the host process
 *  (WeakMap keyed on the cordis root, dsh-client-connection processLaunchToken)
 *  and has no preset seam, so an in-place bounce cannot re-boot with the OLD
 *  token. The equivalent guarantee: after the bounce the chain reads the NEW
 *  token from the sink and hands the operator a URL that works on first
 *  click. Pure: port and token are injected.
 *
 * @param {{ port?: number|string, token?: string, host?: string }} p
 * @returns {string} the launch URL ('' when the token is unknown)
 */
export function launchUrl({ port = 3080, token = '', host = '127.0.0.1' } = {}) {
	if (!token) return '';
	return 'http://' + host + ':' + port + '/?token=' + encodeURIComponent(token);
}

/** Reads dsh.authToken out of the DSI settings.yaml text. Pure: the file
 *  text is injected; dsi.mjs reads the file.
 *
 * @param {string} yamlText - full settings.yaml text
 * @returns {string} the token ('' when absent or not parseable)
 */
export function tokenFromSettings(yamlText) {
	const m = /authToken:\s*['"]?([^"'/\s]+)/.exec(String(yamlText || ''));
	return m ? m[1] : '';
}

/** The dev floor's vite pid(s) parsed from ONE ps -eo pid,command dump
 *  (ADR-0025 Wave 3 gate finding, 2026-10-14): pgrep -f proved blind to the
 *  vite process on the live floor (exit 1 while ps listed it), which made
 *  the bounce chain misread the mode and sweep a bounceable floor. ps -eo
 *  sees what pgrep does not, and parsing is pure + unit-pinned here; the
 *  ps invocation stays in dsi.mjs.
 *
 * @param {string} psOutput - full `ps -eo pid=,command=` dump
 * @returns {string[]} matching pids (as strings), oldest-first order kept
 */
export function parseDevFloorPids(psOutput) {
	return String(psOutput || '').split('\n').flatMap((line) => {
		const m = /^\s*(\d+)\s+(.*)$/.exec(line);
		return m && m[2].includes('node_modules/vite/bin/vite.js') ? [m[1]] : [];
	});
}

/** The port the floor's DSI UI answers on (ADR-0025 Wave 3 gate finding,
 *  2026-10-14): the host-bounce route is a DSI (vite) route, so the bounce
 *  chain must POST the VITE port - the DSH host port only knows the fence
 *  (401) or 404. Resolution order: DSI_PORT= (the 2026-11-08 rename) then
 *  legacy PORT= in the floor env dump, then --port N on the vite command
 *  line, then the 5175 default the launcher pins. Pure: both inputs are
 *  strings read by dsi.mjs (ps -E and ps -o command), so unit tests pin
 *  all arms.
 *
 * @param {{ floorEnv?: string, command?: string }} params
 * @returns {number} the UI port
 */
export function floorUiPort({ floorEnv = '', command = '' } = {}) {
	const envPort = /(?:^|\s)DSI_PORT=(\d+)/.exec(floorEnv || '') || /(?:^|\s)PORT=(\d+)/.exec(floorEnv || '');
	if (envPort) return Number(envPort[1]);
	const argPort = /--port\s+(\d+)/.exec(command || '');
	if (argPort) return Number(argPort[1]);
	return 5175;
}

/**
 * The takeover sweep (The Port Takeover ADR 2026-10-12, D2/D3/D5): SIGTERM
 * whatever LISTENS on the given ports, then WAIT until each port frees,
 * bounded. Pure orchestration — every effect is injected, so unit tests run
 * it against fakes and the real half stays in dsi.mjs.
 *
 * @param {number[]} ports
 * @param {{ listListeners: (port: number) => number[], terminate: (pid: number) => void,
 *            portFree: (port: number) => boolean | Promise<boolean>, sleep: (ms: number) => Promise<void>,
 *            now: () => number, log: (line: string) => void }} effects
 * @returns {Promise<{ ok: boolean, port?: number, pid?: number | string }>} ok:false names the port and holder (exit 64 is the caller's)
 */
export async function takeoverFloorPorts(ports, effects) {
	const { listListeners, terminate, portFree, sleep, now, log } = effects;
	const start = now();
	for (const port of ports) {
		for (const pid of listListeners(port)) {
			terminate(pid);
			log('takeover: SIGTERM pid ' + pid + ' on port ' + port);
		}
	}
	for (const port of ports) {
		let freed = null;
		while (now() - start <= TAKEOVER_BUDGET_MS) {
			if (await portFree(port)) {
				freed = now() - start;
				break;
			}
			await sleep(TAKEOVER_POLL_MS);
		}
		if (freed === null) {
			const holder = listListeners(port)[0] ?? 'unknown';
			log('takeover: port ' + port + ' still held by pid ' + holder + ' after ' + TAKEOVER_BUDGET_MS + 'ms — giving up');
			return { ok: false, port, pid: holder };
		}
		log('takeover: port ' + port + ' free after ' + freed + 'ms');
	}
	return { ok: true };
}

/**
 * The dsh launcher rule (runOvPlugin's, generalized): DSH_WEB_CMD override,
 * else the pinned published dsh via npx. The webVersion pin comes from the
 * caller (dsi.mjs owns package.json reads).
 *
 * @param {string} profile
 * @param {'add' | 'remove'} action
 * @param {string} pkg
 * @param {string} webVersion
 */
export function dshLauncherCmd(profile, action, pkg, webVersion) {
	const base = process.env.DSH_WEB_CMD || 'npx --yes @deepseek-ai/dsh@' + (webVersion || 'latest');
	return base + ' plugin --profile ' + profile + ' ' + action + ' ' + pkg;
}
