#!/usr/bin/env node
// The `dsi` CLI. `dsi web` serves the SvelteKit production build (adapter-node
// output) without rebuilding — the same split as `dsh web`: `pnpm run build`
// prepares the artifacts, this launcher only runs them. The build is resolved
// relative to this file, not the cwd, so a globally installed or npx-run
// package serves its own bundled build from any directory.
// `--zai` (on `dsi web` / `dsi dsh --sync`) bootstraps a fresh DSH install:
// it adds the ZAI provider and the default model to ~/.dsh/settings.yaml
// (idempotent — existing entries win). The standalone `dsi zai` command was
// decommissioned — the flag does the same work before anything boots.
// `dsi dsh --token <token>` copies a dsh launch token into DSI's config
// ($DSI_CONFIG_PATH or ~/.dsi/settings.yaml, key dsh.authToken — the same
// file scripts/dsh-web-synced.sh keeps fresh). `dsi dsh --sync` runs that
// script AND serves the dsi build — one foreground pair, one Ctrl-C.
// `--dev` serves the Vite dev server instead of the build (sources only).
// `dsi dsh --sync-kills` sweeps orphans a lost previous run left behind.
// `dsi dsh --ov` (or --sync --ov, or web --ov) installs the OpenViking
// memory plugin into
// the active dsh profile by delegating to `dsh plugin ... add` (idempotent).

import { spawn, spawnSync } from 'node:child_process';
import net from 'node:net';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse, stringify } from 'yaml';

import { mirrorSkills } from './lib/mirror-skills.mjs';
import { dshLauncherCmd, parsePluginArgs, takeoverFloorPorts, hostBounceDecision, floorUiPort, parseDevFloorPids, launchUrl, tokenFromSettings } from './lib/plugin-chain.mjs';
import { parseDevArg, devModeEnv, modeFromBoolean, resolveBounceMode, extractInspectArgs, parseInspectArgsFromEnv } from './lib/dev-mode.mjs';

// Layman-facing help: wrapped near 76 columns, continuation lines indented,
// the recommended one-liner first. --zai is optional on purpose — no GLM
// account, no problem, the flag can simply be dropped.
const USAGE = [
	'usage: dsi <command>',
	'',
	'  Recommended first run (fetches and serves the latest DSI):',
	'',
	'      npx @deepseek-insight/dsi@latest dsh --sync --zai',
	'',
	'  One command, one window: it starts the DSH host AND the DSI page',
	'  together in the foreground — one Ctrl-C stops both. Every flag, once —',
	'  the same flag means the same thing on any command that accepts it:',
	'',
	'      --sync   sync the one-time launch token into ~/.dsi/settings.yaml,',
	'               then serve host + page as one pair',
	'      --zai    bootstrap the GLM (Z.AI) provider into ~/.dsh/settings.yaml',
	'               before anything boots. No GLM account? Skip it — drop this',
	'               flag and keep whatever provider you already configured:',
	'',
	'      npx @deepseek-insight/dsi@latest dsh --sync',
	'',
	'      --token <token>',
	'               store the dsh launch token as dsh.authToken in',
	'               ~/.dsi/settings.yaml, then serve',
	'      --dev    serve the Vite dev server instead of the built page (takes',
	'               port 5175; needs a full checkout: pnpm install). Optional',
	'               value: --dev in-process boots the DSH host INSIDE the dev',
	'               server process; --playwright-mcp (with --dev) embeds the',
	'               glass browser\'s MCP brain in-process too (ADR-0029 D7).',
	'               server process (one process, one Ctrl-C; host still on',
	'               port 3080; token via in-process intercept). Bare --dev',
	'               keeps the two-port pair; --dev pair is the same spelled out.',
	'      --sync-kills',
	'               kill orphaned dsh/dsi processes left by an earlier run',
	'      --ov    install the OpenViking memory plugin into the active dsh',
	'              profile (dsh plugin ... add). Client only — the memory',
	'              server itself is set up separately (dsi-ov-setup skill)',
	'      --plugin <add|remove> <pkg> [--profile <p>]',
	'              run the dsh plugin command, then bounce the floor:',
	'              killOrphans + token re-sync + re-serve (The Plugin Rack',
	'              ADR D5). --plugin-restart is the bounce alone.',
	'',
	'  Ports: `dsi dsh --sync` serves the DSI page on 5174 and opens your',
	'  browser there. With --dev the Vite dev server takes 5175 instead',
	'  and the browser follows. Override with PORT=<n>. The HOST half',
	'  takes 3080 by default; when that port is held by a dsh web you',
	'  must keep running (another conversation floor), forward',
	'  --port <n> — it goes to `dsh web` and DSI follows it automatically.',
	'',
	'  All commands (flags — see above):',
	'',
	'      dsi web [--zai] [--ov] [--dev] [--token <token>]',
	'                   serve the DSI page alone (PORT env default 5174,',
	'                   HOST env default 127.0.0.1)',
	'      dsi dsh --token <token>',
	'                   store the dsh launch token in ~/.dsi/settings.yaml',
	'      dsi dsh --sync [--zai] [--dev] [--ov]',
	'                   run dsh-web-synced.sh (dsh web + token sync) AND serve',
	'                   dsi — see the recommended command above',
	'      dsi dsh --ov',
	'                   install the OpenViking memory plugin into the active',
	'                   dsh profile (idempotent; alone, without --sync)',
	'      dsi dsh --sync-kills',
	'                   kill orphaned dsh/dsi processes left by an earlier run',
	'      dsi dsh --plugin add git+https://github.com/Temoa/dsh-rules-paths.git',
	'                   install via dsh plugin, then restart the pair (The',
	'                   Plugin Rack ADR D5); --plugin-restart bounces alone',
	'      dsi dsh --plugin remove <pkg>'
].join('\n');

const command = process.argv[2];
if (command === '--help' || command === '-h' || command === 'help') {
	console.log(USAGE);
	process.exit(0);
}
if (command !== 'web' && command !== 'dsh') {
	console.error(command === undefined ? 'dsi: missing command' : `dsi: unknown command "${command}"`);
	console.error(USAGE);
	process.exit(64);
}

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The OpenViking memory plugin DSI's host profile wants. Client-side only:
 *  it never starts openviking-server — it reconnects on its own once the
 *  server is healthy (KB 2026-09-16 §2). */
const OV_PLUGIN = '@openviking/dsh-memory-plugin';

// ── dsi zai ────────────────────────────────────────────────────────────────

/** The ZAI provider block, byte-for-byte the fresh-install shape. */
const ZAI_PROVIDER = {
	apiKeyEnv: 'ZAI_API_KEY',
	api: 'openai-completions',
	baseURL: 'https://api.z.ai/api/coding/paas/v4',
	compat: { thinkingFormat: 'zai' },
	models: [
		{ id: 'glm-4.7' },
		{ id: 'glm-5-turbo' },
		{ id: 'glm-5.1' },
		{ id: 'glm-5.2' },
		{
			id: 'glm-5.3',
			name: 'GLM-5.3',
			contextWindow: 1_000_000,
			maxTokens: 131_072,
			input: ['text']
		},
		{
			id: 'glm-5.3-flash',
			name: 'GLM-5.3-Flash',
			contextWindow: 1_000_000,
			maxTokens: 131_072,
			input: ['text', 'image']
		}
	]
};

/** The default-model block a fresh ZAI install wants. */
const ZAI_DEFAULT_MODEL = { provider: 'zai', model: 'glm-5.3-flash' };

function isRecord(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ── dsi dsh ────────────────────────────────────────────────────────────────

/** One pkill -f sweep per orphan signature. The patterns match only the
 *  process shapes this CLI and the sync script mint — the sync script, the
 *  npx-published dsh bin, the source-launched dsh bin, and the dsi server
 *  entry — so a plain sweep cannot reach unrelated processes. */
const ORPHAN_PATTERNS = [
	'dsh-web-synced.sh',
	'@deepseek-ai/dsh/lib/bin.js',
	// The npx-published launch's REAL argv shape (observed 2026-11-06:
	// `node …/_npx/<hash>/node_modules/.bin/dsh web`) — the published
	// package's own .bin shim, which neither lib/bin.js nor the npx shims
	// pattern above matches.
	'_npx/[^/]*/node_modules/.bin/dsh',
	'apps/cli/src/bin.ts web',
	'deepseek-insight/build/index.js',
	// --dev mode's UI half (scoped to the DSI checkout's vite, never a
	// foreign project's dev server).
	'deepseek-insight/node_modules/vite/bin/vite.js'
];

if (command === 'dsh') {
	const flag = process.argv[3];
	if (flag === '--token') {
		const token = process.argv[4];
		if (token === undefined || token === '') {
			console.error('dsi dsh: --token needs the launch token as its value');
			process.exit(64);
		}
		setDshAuthToken(token);
		process.exit(0);
	}
	if (flag === '--ov') {
		runOvPlugin();
		process.exit(0);
	}
	if (flag === '--sync') {
		// --zai and --dev are dsi-side flags, stripped from the args the sync
		// script forwards to `dsh web` (which would refuse them):
		// --zai bootstraps the ZAI provider BEFORE the host boots, so the fresh
		// settings are picked up by this very run.
		// --dev serves the Vite dev server instead of the built UI — the same
		// HMR surface as `pnpm dev`, beside the same synced host.
		const rest = process.argv.slice(4);
		const withZai = rest.includes('--zai');
		const withOv = rest.includes('--ov');
		// The Glass Browser (ADR-0029 D7): --playwright-mcp opts the DEV floor
		// into the in-process MCP brain — a dsi-side flag, stripped before the
		// host spawn (dsh web would refuse it) and carried to vite as an env
		// marker, the exact idiom of DSI_DEV_IN_PROCESS.
		const withPlaywrightMcp = rest.includes('--playwright-mcp');
		const restNoMcp = withPlaywrightMcp ? rest.filter((a) => a !== '--playwright-mcp') : rest;
		if (withZai) addZaiProvider();
		if (withOv) runOvPlugin();
		runSkillsMirror();
		// --dev parse (D4): 'in-process' | 'pair' consumed as a value; bare
		// --dev stays 'pair'. dsi-side flags stripped before the host spawn.
		const { mode, rest: hostArgs0 } = parseDevArg(restNoMcp);
		// D7: inspector flags ride the vite child's execArgv, never the host.
		const { rest: hostArgs, execArgv: inspectExecArgv } = extractInspectArgs(hostArgs0);
		runSyncedPair(hostArgs, mode, inspectExecArgv, { playwrightMcp: withPlaywrightMcp });
	} else if (flag === '--plugin' || flag === '--plugin-restart') {
		// The Plugin Rack ADR (2026-09-27, D3/D5): the dsh CLI is the writer,
		// dsi owns the bounce. Install/remove delegates to the launcher rule
		// (DSH_WEB_CMD override, else the pinned npx dsh), fails loud, and
		// ONLY a successful apply reaches the restart chain: killOrphans,
		// then the synced pair (dsh web + token re-sync + DSI re-serve).
		const parsed = parsePluginArgs(process.argv.slice(3), {
			envProfile: process.env.DSH_PROFILE ?? 'web'
		});
		if (parsed === null) {
			console.error(`dsi dsh: unknown flag "${flag}"`);
			console.error(USAGE);
			process.exit(64);
		}
		if ('error' in parsed) {
			console.error('dsi dsh: ' + parsed.error);
			process.exit(64);
		}
		if (parsed.action !== 'restart') {
			const cmd = dshLauncherCmd(parsed.profile, parsed.action, parsed.pkg, dshWebVersion());
			console.log(`dsi dsh: plugin ${parsed.action} into the ${parsed.profile} profile (${cmd})`);
			const result = spawnSync('/bin/sh', ['-c', cmd], { stdio: 'inherit' });
			if (result.error !== undefined) throw result.error;
			const code = result.status ?? 1;
			if (code !== 0) {
				console.error(`dsi dsh: plugin ${parsed.action} failed (exit ${code}) — nothing bounced; fix the cause above, then re-run`);
				process.exit(code);
			}
		}
		console.log('dsi dsh: bouncing the floor (orphan sweep + synced pair re-run)');
		// Dev-floor detection must run BEFORE the sweep kills what it would
		// detect (RCA 2026-09-27, second order): the DSI_DEV env marker only
		// exists on floors launched by THIS CLI's dev launcher — a floor from
		// before the marker existed, or from plain `pnpm dev`, carries none.
		// The vite dev process itself is visible to pgrep (unlike the npx
		// shims — different argv rewriting), so ask the process table.
		// D6 (2026-10-11): the boolean is no longer enough — an in-process
		// floor re-served as 'pair' would double-spawn the host. Read the
		// alive vite's DSI_DEV_MODE via ps -E BEFORE the sweep, resolve the
		// enum, restore exactly what was running.
		const floorEnvDump = readFloorEnv(devFloorPid());
		const mode = resolveBounceMode({
			flagDev: parsed.dev === true,
			devFloorAlive: isDevFloorAlive(),
			floorEnv: floorEnvDump
		});
		// The Faithful Bounce (ADR 2026-10-13, D3): the SAME floor env that
		// records the mode records the inspector flags — re-forward them so
		// the bounce boot comes back debuggable when it left that way.
		const bounceExecArgv = parseInspectArgsFromEnv(floorEnvDump);
		// ADR-0025 D1/D3 — the bounce fork: an in-process floor with a live
		// bounce verb bounces AT THE HOST via the running floor's route; the
		// vite process never dies and the sweep is SKIPPED. Pair/build floors,
		// a missing verb, or an unreachable route take the sweep below.
		const sweepAndReserve = async () => {
			killOrphans();
			// The pkill sweep cannot see every floor shape (RCA 2026-09-27: the
			// npx shims — 'npm exec @deepseek-ai/dsh…' and '.bin/dsh web' — are
			// invisible to pkill -f on macOS, so the dsh host survived holding
			// 3080 and preflightPort exited 64, killing the detached chain
			// silently). The bounce chain owns the DSI ports by contract, so
			// free them by listener, not by name.
			await freeFloorPorts(floorPortSet());
			// Restore the SAME UI mode the floor was serving. The bounce's
			// boolean signal normalizes to 'pair'/'build' inside runSyncedPair;
			// 3.5 teaches the bounce the full enum via DSI_DEV_MODE.
			runSyncedPair([], mode, bounceExecArgv, { playwrightMcp: false }); // the bounce never invents the brain (restores mode only)
		};
		const bounceVerdict = await hostBounceDecision({
			mode,
			post: async () => {
				// ADR-0025 Wave 3 gate finding (2026-10-14): the route is a DSI
				// (vite) route - POST the vite UI port, not the DSH host port.
				const uiPort = floorUiPort({
					floorEnv: floorEnvDump,
					command: floorCommand(devFloorPid())
				});
				const res = await fetch('http://127.0.0.1:' + uiPort + '/api/plugins/host-bounce', { method: 'POST' });
				return res.ok;
			},
			sweep: sweepAndReserve,
		});
		if (bounceVerdict === 'host') {
			console.log('dsi dsh: host-level bounce done via the running floor — vite never died, sweep skipped (ADR-0025)');
			// D4 amended (2026-10-14): the DSH launch token is minted inside the
			// host process (dsh-client-connection processLaunchToken, a WeakMap on
			// the cordis root — no preset seam), so the bounce CANNOT re-boot with
			// the old token. The bounce's announce intercept lands the NEW token in
			// settings.yaml; hand the operator a URL that works on first click.
			await new Promise((r) => setTimeout(r, 1500));
			const fresh = tokenFromSettings(readFileSync(dsiConfigPath(), 'utf-8'));
			const url = launchUrl({ port: process.env.DSH_HOST_PORT ?? 3080, token: fresh });
			if (url) console.log('dsi dsh: fresh launch URL after the bounce (loaded pages keep working — durable cookie):\n\t  ' + url);
		} else {
			console.log('dsi dsh: host bounce unavailable — whole-floor sweep fallback (ADR-0025 D3)');
			await sweepAndReserve();
		}
	} else if (flag === '--sync-kills') {
		killOrphans();
		process.exit(0);
	} else {
		console.error(flag === undefined ? 'dsi dsh: missing flag (--token <token> | --sync | --sync-kills)' : `dsi dsh: unknown flag "${flag}"`);
		console.error(USAGE);
		process.exit(64);
	}
}

/** Config file resolution matches DSI's reader and dsh-web-synced.sh
 *  exactly: $DSI_CONFIG_PATH or ~/.dsi/settings.yaml — the LIVE config
 *  (config.json is the migrated-from legacy file, never read again). */
function dsiConfigPath() {
	return process.env.DSI_CONFIG_PATH ?? path.join(homedir(), '.dsi', 'settings.yaml');
}

/** Store a dsh launch token as dsh.authToken. Same-file semantics as the
 *  sync script: merge into the existing dsh section, atomic tmp+rename
 *  write. A byte-identical token is a no-op (no mtime churn). Exits
 *  non-zero when the file exists but is not parseable YAML. The token is
 *  never echoed — argv exposure is the caller's choice, output stays clean. */
function setDshAuthToken(token) {
	const configPath = dsiConfigPath();

	let doc = {};
	if (existsSync(configPath)) {
		try {
			const parsed = parse(readFileSync(configPath, 'utf-8'));
			if (!isRecord(parsed)) throw new Error('not a YAML mapping');
			doc = parsed;
		} catch (error) {
			console.error(`dsi dsh: cannot parse ${configPath}: ${error?.message ?? error}`);
			process.exit(65);
		}
	}

	const current = isRecord(doc['dsh']) ? doc['dsh'].authToken : undefined;
	if (current === token) {
		console.log(`dsi dsh: ${configPath} already has this authToken — nothing to do`);
		return;
	}
	doc['dsh'] = { ...(isRecord(doc['dsh']) ? doc['dsh'] : {}), authToken: token };

	mkdirSync(path.dirname(configPath), { recursive: true });
	const temp = `${configPath}.${process.pid}.tmp`;
	writeFileSync(temp, stringify(doc), 'utf-8');
	renameSync(temp, configPath);
	// Tilde-compress $HOME so the log line stays portable (no /Users/<you> leak).
	console.log(`dsi dsh: authToken updated in ${configPath.startsWith(homedir()) ? `~${configPath.slice(homedir().length)}` : configPath}`);
}

/** The pinned published dsh version for `dsi dsh --sync`, from this
 *  package.json's dsh.webVersion (empty when absent — the sync script then
 *  falls back to the registry's latest tag). An exact pin, not a range: a
 *  range drifts to whatever the registry resolves, and the pin exists
 *  precisely because latest can change the API contract under DSI. */
function dshWebVersion() {
	const doc = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf-8'));
	const version = doc?.dsh?.webVersion;
	return typeof version === 'string' && version !== '' ? version : 'latest';
}

/** True when something is already listening on 127.0.0.1:port. Probed with
 *  Node's own net stack — no lsof/ss/netstat needed, so it behaves the same
 *  on macOS and Linux. Returns false on any other probe error (the host's
 *  own boot error is the honest reporter in that case). */
function portInUse(port) {
	return new Promise((resolve) => {
		const probe = net.createServer();
		probe.once('error', (error) => resolve(error.code === 'EADDRINUSE'));
		probe.once('listening', () => probe.close(() => resolve(false)));
		probe.listen(port, '127.0.0.1');
	});
}

/** Poll until something LISTENS on 127.0.0.1:port — the same net probe as
 *  portInUse, inverted. The browser-open gate (bug 2026-10-17): the page
 *  used to open on a fixed 2s timer, landing on a host that had not bound
 *  yet (boot variance, or a first-run pin still downloading). Returns
 *  false on budget exhaustion; the caller opens anyway, best-effort. */
async function waitPortListening(port, budgetMs) {
	for (let waited = 0; waited < budgetMs; waited += 500) {
		if (await portInUse(port)) return true;
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
	return portInUse(port);
}

/** The dsh host hard-fails on a busy 3080 with a long Cordis stack; catch
 *  it before the pair spawns. First sweep the known orphan shapes
 *  (pkill -f — same BSD/procps flag set on macOS and Linux), wait for the
 *  socket to actually free, then give up with a one-line hint if something
 *  foreign still holds the port. */
async function preflightPort(port, label) {
	if (!(await portInUse(port))) return;
	console.log(`dsi dsh: port ${port} (${label}) is busy — sweeping orphaned dsh/dsi processes`);
	killOrphans();
	for (let waited = 0; waited < 5000; waited += 250) {
		if (!(await portInUse(port))) {
			console.log(`dsi dsh: port ${port} is free — continuing`);
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	console.error(`dsi dsh: port ${port} (${label}) is still in use by a process the sweep does not own — free it yourself, then re-run`);
	process.exit(64);
}

/** Open the default browser at url once the pair has had a moment to boot.
 *  Best-effort only: a missing or failing opener never disturbs the pair —
 *  the URL is already on screen in the logs. Detached + unref: the opener
 *  is fire-and-forget and must not hold this process alive. */
function openBrowser(url, delayMs = 2000) {
	setTimeout(() => {
		const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
		try {
			spawn(opener, [url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
		} catch {
			// no opener on this host — the printed URL is the fallback
		}
	}, delayMs);
}

/** Run the PAIR in the foreground: scripts/dsh-web-synced.sh (dsh web plus
 *  the live token watcher) as the host, then the dsi build — or, with dev,
 *  the Vite dev server (`pnpm dev`'s surface) — as the UI. The pair shares
 *  one lifecycle — a signal or one child's exit tears down the other, so no
 *  orphan survives a Ctrl-C or a crash. */
async function runSyncedPair(extraArgs, dev = 'build', execArgv = [], opts = {}) {
	// dev accepts the D4 mode enum ('build' | 'pair' | 'in-process'); the
	// legacy boolean true is normalized so older call sites keep working.
	const mode = typeof dev === 'boolean' ? modeFromBoolean(dev) : dev;
	const script = path.join(packageRoot, 'scripts', 'dsh-web-synced.sh');
	const inProcess = mode === 'in-process';
	if (!inProcess && !existsSync(script)) {
		console.error(`dsi dsh: no sync script at ${script}`);
		process.exit(66);
	}
	// UI port: the built server takes 5174 — the same port `dsi web` uses,
	// so plain `dsi dsh --sync` listens on ONE port. --dev's Vite dev server
	// takes 5175 instead (vite.config.ts pins 5174 strictPort, so pair mode
	// passes 5175 explicitly), giving the two-port dev shape. in-process is
	// also a vite floor: same 5175.
	const uiPort = process.env.PORT ?? (mode === 'build' ? '5174' : '5175');
	// The host half takes --port <n> when forwarded (a 3080 held by a
	// dsh web this CLI does not own — e.g. another live conversation
	// floor — is exactly the case the preflight must not kill). The
	// forwarded flag goes to `dsh web` untouched; DSI follows via
	// DSH_BASE_URL so the page dials the host wherever it landed.
	// IN-PROCESS: no host child will be spawned, so preflighting 3080 is
	// pointless — the plugin boots the host on 3080 AFTER vite is up, and
	// a stale 3080 from a foreign floor is that floor's business (the
	// embedded boot fails loud in the plugin, killing nothing).
	const firstRun = warnIfFirstRunDownload();
	// IN-PROCESS: the plugin reads its port from DSH_HOST_PORT (default 3080)
	// — the UI half MUST dial the same port, so DSH_HOST_PORT participates in
	// the dshBase derivation exactly like a forwarded --port flag. (Smoke
	// bug 2026-10-11: DSH_HOST_PORT=3477 booted the host there while the
	// page dialed 3080 — the production floor — → "Failed to fetch".)
	const pluginPort = inProcess && process.env.DSH_HOST_PORT ? parseInt(process.env.DSH_HOST_PORT, 10) : undefined;
	const hostPort = hostPortFromArgs(extraArgs) ?? pluginPort ?? 3080;
	const dshBase = hostPort === 3080 ? undefined : `http://127.0.0.1:${hostPort}`;
	if (inProcess) {
		await preflightPort(uiPort, 'DSI page');
	} else {
		await preflightPort(hostPort, 'dsh host');
		await preflightPort(uiPort, 'DSI page');
	}
	// IN-PROCESS: no sync script, no host child — the vite plugin owns the
	// host lifecycle (vite close hook stops it; one Ctrl-C, no orphan).
	const host = inProcess ? null : spawn('/bin/sh', [script, ...extraArgs], {
		stdio: 'inherit',
		env: { ...process.env, DSH_WEB_VERSION: dshWebVersion() }
	});
	const ui = mode === 'build' ? startDsiServer(uiPort, dshBase) : startDsiDevServer(uiPort, dshBase, mode, execArgv, opts);
	// The browser follows the UI: the built page (5174) — or, in --dev mode,
	// the dev server (5175). Gated on the HOST actually listening (bug
	// 2026-10-17): the fixed 2s timer lost every race the host booted slower
	// than — a first-run pin still downloading worst of all. Budget: 30s for a
	// cached pin, 5 minutes while a new pin downloads. On exhaustion it still
	// opens (best-effort, the old behavior) and says so.
	void waitPortListening(hostPort, firstRun ? 300000 : 30000).then((up) => {
		if (!up) console.log(`dsi dsh: host port ${hostPort} not listening after the wait — opening the page anyway; refresh once the host prints its URL`);
		openBrowser(`http://localhost:${uiPort}/`, 0);
	});
	for (const signal of ['SIGINT', 'SIGTERM']) {
		process.on(signal, () => {
			if (host) host.kill(signal); // in-process: no host child — vite close hook stops it
			ui.kill(signal);
		});
	}
	const teardown = (code, signal) => {
		if (host) host.kill('SIGTERM');
		ui.kill('SIGTERM');
		process.exit(signal ? 1 : (code ?? 1));
	};
	if (host) host.on('exit', teardown);
	ui.on('exit', teardown);
}

/** Kill orphaned dsh/dsi leftovers — a pair whose parent died before it
 *  could tear down its sibling, or a previous run the terminal lost. */
function killOrphans() {
	// Test-floor isolation (Port Ledger 34xx/51xx): a scratch floor's bounce
	// must never pkill the production floor's shapes.
	if (process.env.DSI_SKIP_ORPHAN_SWEEP === '1') {
		console.log('dsi dsh: orphan sweep skipped (DSI_SKIP_ORPHAN_SWEEP=1)');
		return;
	}
	for (const pattern of ORPHAN_PATTERNS) {
		try {
			spawnSync('pkill', ['-f', pattern], { stdio: 'pipe' });
		} catch {
			// pkill missing is only possible on a non-POSIX host; the next
			// pattern's try still runs and the report below stays honest.
		}
	}
	console.log('dsi dsh: orphan sweep done (dsh-web-synced.sh, dsh bin, dsi server)');
}

/** The DSI ports the bounce owns. DSI_FLOOR_PORTS overrides for isolated
 *  test floors (Port Ledger: 34xx host, 5180+ UI) so a scratch bounce never
 *  touches the production ports. */
function floorPortSet() {
	const raw = process.env.DSI_FLOOR_PORTS;
	if (!raw) return [3080, 5174, 5175];
	const ports = raw.split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
	return ports.length ? ports : [3080, 5174, 5175];
}

/** SIGTERM whatever LISTENS on these ports, then WAIT until they actually
 *  free (The Port Takeover ADR 2026-10-12, D2/D3/D5): the fire-and-forget
 *  kill of RCA 2026-09-27 raced the successor's bind — the dying in-process
 *  host still held 3080 two seconds later and the new floor died on
 *  EADDRINUSE (incident: tmp/bounce.log 2026-10-12T03:49:06Z). Every kill
 *  and every freed port gets a receipt line; a port still held at the
 *  budget exits 64 naming the port and the holder. Only the bounce uses
 *  this — the click is the consent (ADR D1); a manual --sync preflight
 *  still REFUSES a busy port it does not own. */
async function freeFloorPorts(ports) {
	const listListeners = (port) => {
		try {
			const probe = spawnSync('/bin/sh', ['-c', 'lsof -ti tcp:' + port + ' -sTCP:LISTEN 2>/dev/null || true'], { stdio: 'pipe', encoding: 'utf8' });
			return (probe.stdout || '').split('\n').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
		} catch {
			// no lsof (or no sh): nothing to signal; the wait loop below will
			// report the port honestly if it never frees.
			return [];
		}
	};
	const result = await takeoverFloorPorts(ports, {
		listListeners,
		terminate: (pid) => {
			try { process.kill(pid, 'SIGTERM'); } catch { /* already gone — the wait decides */ }
		},
		portFree: (port) => portInUse(port).then((busy) => !busy),
		sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		now: () => Date.now(),
		log: (line) => console.log(line)
	});
	if (!result.ok) {
		console.error('dsi dsh: port ' + result.port + ' is still in use by a process the takeover does not own (pid ' + result.pid + ') — free it yourself, then re-run');
		process.exit(64);
	}
}

/** True when a vite dev server of THIS checkout is alive. Only the
 *  checkout's own vite matches — a foreign project's dev server never
 *  carries the deepseek-insight path segment. ADR-0025 Wave 3 (2026-10-14):
 *  the probe rides devFloorPid's ps -eo discovery — pgrep -f went blind to
 *  the vite process on the live floor, so this boolean read false-negative
 *  and the bounce chain swept floors it could have host-bounced. */
function isDevFloorAlive() {
	return devFloorPid() !== null;
}

/** The alive dev floor's vite pid (first match), or null. Same match rule
 *  as isDevFloorAlive — the pid feeds the D6 mode read (ps -E). */
function devFloorPid() {

	// ADR-0025 Wave 3 gate finding (2026-10-14): pgrep -f went BLIND to the
	// vite process on the live floor (exit 1 while ps listed it), so the
	// chain misread the floor as absent and swept a bounceable in-process
	// floor. ps -eo pid,command sees what pgrep does not; the parse is the
	// pure parseDevFloorPids twin in plugin-chain.mjs.
	const probe = spawnSync('ps', ['-eo', 'pid=,command='], { stdio: 'pipe', timeout: 5000 });
	if ((probe.status ?? 1) !== 0) return null;
	const first = parseDevFloorPids(probe.stdout?.toString() || '')[0];
	return first ?? null;
}

/** The floor process's command line (ps -o command), or '' on any failure -
 *  feeds floorUiPort's --port arm (the launcher passes the vite port as an
 *  argument, not as env). */
function floorCommand(pid) {
	if (!pid) return '';
	try {
		const ps = spawnSync('ps', ['-o', 'command', '-p', String(pid)], { stdio: 'pipe', timeout: 5000 });
		if (ps.status !== 0) return '';
		const lines = (ps.stdout?.toString() || '').split('\n').filter(Boolean);
		return lines.length > 1 ? lines.slice(1).join('\n') : '';
	} catch {
		return '';
	}
}

/** The floor's DSI_DEV_MODE via ps -E (macOS: own processes only). Returns
 *  '' when the read fails for any reason — resolveBounceMode then falls back
 *  to the boolean arms, the pre-D6 behavior, never a wrong restore. */
function readFloorEnv(pid) {
	if (!pid) return '';
	try {
		const ps = spawnSync('ps', ['-E', '-p', String(pid)], { stdio: 'pipe', timeout: 5000 });
		return ps.status === 0 ? ps.stdout?.toString() || '' : '';
	} catch {
		return '';
	}
}

/** Add the ZAI provider and default model to ~/.dsh/settings.yaml when
 *  absent. Existing entries always win — an already-configured host is
 *  rewritten only when at least one block was added. Exits non-zero when
 *  the settings file exists but is not parseable YAML. */
function addZaiProvider() {
	const settingsPath =
		process.env.DSH_SETTINGS_PATH ?? path.join(homedir(), '.dsh', 'settings.yaml');

	let doc = {};
	if (existsSync(settingsPath)) {
		try {
			const parsed = parse(readFileSync(settingsPath, 'utf-8'));
			if (!isRecord(parsed)) throw new Error('not a YAML mapping');
			doc = parsed;
		} catch (error) {
			console.error(`dsi zai: cannot parse ${settingsPath}: ${error?.message ?? error}`);
			process.exit(65);
		}
	}

	const added = [];
	if (!isRecord(doc['llm-pi-ai']) || !isRecord(doc['llm-pi-ai'].providers)) {
		doc['llm-pi-ai'] = { providers: {} };
	}
	if (!isRecord(doc['llm-pi-ai'].providers.zai)) {
		doc['llm-pi-ai'].providers.zai = ZAI_PROVIDER;
		added.push('llm-pi-ai.providers.zai');
	}
	if (doc['agent-default-model'] === undefined) {
		doc['agent-default-model'] = ZAI_DEFAULT_MODEL;
		added.push('agent-default-model');
	}

	if (added.length === 0) {
		console.log(`dsi zai: ${settingsPath} already has the ZAI provider — nothing to do`);
		return;
	}

	mkdirSync(path.dirname(settingsPath), { recursive: true });
	const temp = `${settingsPath}.${process.pid}.tmp`;
	writeFileSync(temp, stringify(doc), 'utf-8');
	renameSync(temp, settingsPath);
	for (const entry of added) console.log(`dsi zai: added ${entry}`);
	console.log(`dsi zai: ${settingsPath} updated — set ZAI_API_KEY in the harness env, then restart dsh web`);
}

/** Install the OpenViking memory plugin into the active dsh profile by
 *  delegating to `dsh plugin --profile <profile> add` — the same dsh
 *  launcher `dsi dsh --sync` uses (DSH_WEB_CMD override, else the published
 *  pin via npx). dsh's own reconcilePlugins appends the package to
 *  dsh.profile.bundles (it declares a dsh.bundle), so nothing is hand-edited
 *  here. Idempotent: a profile that already has the dependency AND the bundle
 *  entry skips the pnpm round-trip. Fail-loud: a nonzero child exit (or a
 *  missing pnpm — dsh exits 127 for it) propagates. */
function runOvPlugin() {
	const profile = process.env.DSH_PROFILE ?? 'web';
	const manifestPath = path.join(
		homedir(), '.dsh', 'profiles', profile, 'package.json'
	);
	if (existsSync(manifestPath)) {
		try {
			const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
			const deps = manifest?.dependencies ?? {};
			const bundles = manifest?.dsh?.profile?.bundles ?? [];
			if (deps[OV_PLUGIN] !== undefined && bundles.includes(OV_PLUGIN)) {
				console.log(`dsi dsh: ${OV_PLUGIN} already installed in the ${profile} profile — nothing to do`);
				return;
			}
		} catch (error) {
			console.error(`dsi dsh: cannot parse ${manifestPath}: ${error?.message ?? error}`);
			process.exit(65);
		}
	}
	const cmd = process.env.DSH_WEB_CMD
		? `${process.env.DSH_WEB_CMD} plugin --profile ${profile} add ${OV_PLUGIN}`
		: `npx --yes @deepseek-ai/dsh@${dshWebVersion()} plugin --profile ${profile} add ${OV_PLUGIN}`;
	console.log(`dsi dsh: installing ${OV_PLUGIN} into the ${profile} profile (${cmd})`);
	const result = spawnSync('/bin/sh', ['-c', cmd], { stdio: 'inherit' });
	if (result.error !== undefined) throw result.error;
	const code = result.status ?? 1;
	if (code !== 0) {
		console.error(`dsi dsh: plugin install failed (exit ${code}) — pnpm on PATH is required; fix the cause above, then re-run`);
		process.exit(code);
	}
	console.log(`dsi dsh: ${OV_PLUGIN} installed — it connects on its own once openviking-server answers (see the dsi-ov-setup skill for the server side)`);
}

/** Plant the shipped skills into the operator's skill mirror
 *  (~/.agents/skills) — ADR "The Skill Mirror" 2026-09-15, D1–D5:
 *  per-skill copy-only-if-absent, every repo skill, failures warn and
 *  never block the launch. Silent when nothing was copied or warned. */
function runSkillsMirror() {
	const report = mirrorSkills(
		path.join(packageRoot, '.agents', 'skills'),
		path.join(homedir(), '.agents', 'skills')
	);
	for (const name of report.warned) {
		console.error(`dsi: skills mirror — could not copy ${name} (skipping)`);
	}
	if (report.copied.length > 0 || report.warned.length > 0) {
		console.log(`dsi: skills mirror — ${report.copied.length} copied, ${report.skipped.length} skipped, ${report.warned.length} warned`);
	}
}

// ── dsi web ────────────────────────────────────────────────────────────────

/** Spawn the built server (adapter-node output): the one child `dsi web`
 *  serves in the foreground, and the UI half of the `dsi dsh --sync` pair
 *  (runSyncedPair passes its uiPort explicitly). Port truth: `dsh web` —
 *  the pair's host half — binds 3080 (packages/boot/cmdline default), so
 *  the UI's `PORT ?? 5174` never fights it. */
/** Spawn the Vite dev server — --dev mode's UI half, the same surface as
 *  `pnpm dev` (vite.config.ts pins port 5174 strictPort, so pair mode passes
 *  --port 5175 explicitly; a taken port fails loud, never a silent fallback).
 *  Dev mode runs SOURCES from the checkout, so it is only valid where the
 *  sources and devDependencies exist — a published tarball (bin + build)
 *  refuses loudly instead of half-booting. The --port CLI flag overrides the
 *  config's server.port while strictPort keeps the fail-loud contract. */
function startDsiDevServer(defaultPort = '5175', dshBase = undefined, mode = 'pair', execArgv = [], opts = {}) {
	const viteBin = path.join(packageRoot, 'node_modules', 'vite', 'bin', 'vite.js');
	if (!existsSync(viteBin)) {
		console.error(`dsi dsh --dev: no vite at ${viteBin} — --dev needs a full DSI checkout (pnpm install); use the built server instead`);
		process.exit(66);
	}
	// --host matches the built server's 127.0.0.1 bind: vite's default
	// 'localhost' can resolve ::1-only and strand a 127.0.0.1 client.
	return spawn(process.execPath, [...execArgv, viteBin, 'dev', '--host', process.env.HOST ?? '127.0.0.1', '--port', process.env.PORT ?? defaultPort], {
		// D7: inspector flags lead the child argv — node consumes options before
		// the script path, so `node --inspect vite.js dev` debugs THIS process
		// (vite + the embedded DSH host share one heap). The spawn execArgv
		// OPTION was tried first and empirically never activated the inspector
		// (silent no-op, probed 2026-10-11); leading args are the reliable form.
		// NODE_OPTIONS is banned — it leaks to every child and collides on port.
		stdio: 'inherit',
		cwd: packageRoot,
		env: {
			...process.env,
			// Same first-start bootstrap seam as the built server.
			DSI_TEMPLATE_PATH: process.env.DSI_TEMPLATE_PATH ?? path.join(packageRoot, 'template', '.dsi'),
			// Dev-floor marker (RCA 2026-09-27): the plugin-rack bounce reads
			// this from the API server's env to re-serve --dev instead of the
			// stale build. Nothing else may set it.
			DSI_DEV: '1',
			// D4/D6: the mode rides as env, never past the CLI to the host.
			...devModeEnv(mode, { playwrightMcp: opts.playwrightMcp === true }),
			// The Faithful Bounce (ADR 2026-10-13, D1): the inspector flags are
			// part of the launch record — stamped so every restorer (the bounce
			// boot via ps -E, the delayed re-serve via inherited env) can put
			// them back exactly as launched.
			...(execArgv.length ? { DSI_INSPECT_ARGS: execArgv.join(' ') } : {}),
			...(dshBase !== undefined ? { DSH_BASE_URL: dshBase } : {})
		}
	});
}

function startDsiServer(defaultPort = '5174', dshBase = undefined) {
	const serverEntry = path.join(packageRoot, 'build', 'index.js');
	if (!existsSync(serverEntry)) {
		console.error(`dsi: no build found at ${serverEntry} — run \`pnpm run build\` first`);
		process.exit(66);
	}
	return spawn(process.execPath, [serverEntry], {
		stdio: 'inherit',
		env: {
			...process.env,
			PORT: process.env.PORT ?? defaultPort,
			HOST: process.env.HOST ?? '127.0.0.1',
			// First-start bootstrap seam: the server clones template/.dsi to ~/.dsi
			// when the operator home is absent (src/lib/server/settings-document.ts).
			DSI_TEMPLATE_PATH: process.env.DSI_TEMPLATE_PATH ?? path.join(packageRoot, 'template', '.dsi'),
			...(dshBase !== undefined ? { DSH_BASE_URL: dshBase } : {})
		}
	});
}

/** True when @deepseek-ai/dsh@version already sits in an npx cache —
 *  the probe scans the same cache layout npm exec populates
 *  (the _npx cache dirs npm exec populates). */
function dshPackageCached(version) {
	const npxCache = path.join(process.env.npm_config_cache ?? path.join(homedir(), '.npm'), '_npx');
	if (!existsSync(npxCache)) return true; // no cache dir — skip the guess, stay quiet
	try {
		for (const entry of readdirSync(npxCache)) {
			const manifest = path.join(npxCache, entry, 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
			if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf-8')).version === version) return true;
		}
	} catch {
		// unreadable cache — stay quiet rather than warn on a guess
	}
	return false;
}

/** The silent-minutes bug (2026-11-06): piped through the token watcher,
 *  npm exec suppresses its download progress entirely, so a FIRST run of a
 *  new pinned dsh installs for minutes with zero output while the DSI half
 *  is already serving a floor whose every /api call fails. This heads-up
 *  fires before the host spawns, only when the pin is NOT yet cached.
 *  Returns true when the pin needs downloading — the readiness gate below
 *  spends a longer budget waiting for the host in that case. */
function warnIfFirstRunDownload() {
	if (process.env.DSH_WEB_CMD !== undefined) return false;
	// The env override (same one dsh-web-synced.sh honors) wins over the pin.
	const version = process.env.DSH_WEB_VERSION ?? dshWebVersion();
	if (dshPackageCached(version)) return false;
	console.log(`dsi dsh: fetching @deepseek-ai/dsh@${version} — first run for this pin, the download can take a few minutes; the browser opens once the host answers`);
	return true;
}

/** The host port a forwarded --port <n> (or --port=<n>) names, else null.
 *  Only the LAST occurrence wins — the same value `dsh web` would resolve. */
function hostPortFromArgs(args) {
	let port = null;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--port' && /^\d+$/.test(args[i + 1] ?? '')) port = Number(args[i + 1]);
		const eq = /^--port=(\d+)$/.exec(args[i] ?? '');
		if (eq) port = Number(eq[1]);
	}
	return port;
}

// The web command ends the script — and MUST fall off here, not dsh's:
// before this guard existed, `dsi dsh --sync` fell through to the web
// launcher below and spawned a SECOND build server on the same 5174 the
// pair had already taken. One printed "Listening on", the other crashed
// EADDRINUSE, the crash child's exit handler killed this launcher, and the
// fresh pair was orphaned in the background (RCA 2026-09-14).
if (command === 'web') {
	// Optional dsi-side flags, the same meanings as `dsi dsh --sync`: --zai
	// bootstraps the ZAI provider BEFORE anything boots (so this run picks it
	// up), --token stores the dsh launch token before the page serves, --ov
	// installs the OpenViking memory plugin, --dev swaps the built server for
	// the Vite dev server. Everything is done
	// first, then the one child spawns and the script falls off the end.
	const rest = process.argv.slice(3);
	const withZai = rest.includes('--zai');
	const withDev = rest.includes('--dev');
	const withOv = rest.includes('--ov');
	const tokenIdx = rest.indexOf('--token');
	let token;
	if (tokenIdx !== -1) {
		token = rest[tokenIdx + 1];
		if (token === undefined || token === '' || token.startsWith('--')) {
			console.error('dsi web: --token needs the launch token as its value');
			process.exit(64);
		}
	}
	const unknown = rest.filter((arg, i) =>
		arg !== '--zai' && arg !== '--ov' && arg !== '--dev'
		&& arg !== '--token' && !(tokenIdx !== -1 && i === tokenIdx + 1)
	);
	if (unknown.length > 0) {
		console.error(`dsi web: unknown flag "${unknown[0]}"`);
		console.error(USAGE);
		process.exit(64);
	}
	if (withZai) addZaiProvider();
	if (withOv) runOvPlugin();
	if (token !== undefined) setDshAuthToken(token);
	runSkillsMirror();
	const child = withDev ? startDsiDevServer() : startDsiServer();
	// Same browser-follows-the-UI contract as the pair (runSyncedPair): open
	// the default browser at the serving port — --dev's Vite server takes
	// 5175, the built server 5174; PORT/HOST overrides apply.
	openBrowser(`http://${process.env.HOST ?? '127.0.0.1'}:${process.env.PORT ?? (withDev ? '5175' : '5174')}/`);

	for (const signal of ['SIGINT', 'SIGTERM']) {
		process.on(signal, () => {
			child.kill(signal);
		});
	}
	child.on('exit', (code, signal) => {
		process.exit(signal ? 1 : (code ?? 1));
	});
}