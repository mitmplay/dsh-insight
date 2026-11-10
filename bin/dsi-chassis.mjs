#!/usr/bin/env node
/**
 * dsi-chassis — the host companion (ADR-0054 D3/D4, spec 2026-11-08 Glass
 * Chassis Remote CDP task 1.1).
 *
 * A small helper that runs on the machine the operator's SCREENS are on.
 * A floor whose launcher stamped GLASS_CHASSIS_URL at this process asks it
 * to birth the headed glass THERE, by the house rules:
 *   - disposable profiles only (the Borrowed Chrome posture — the host's
 *     real Chrome profile is never mounted, read, or deletable);
 *   - one conversation = one glass, enforced HERE (ownership survives the
 *     machine boundary; a busy owner is refused with the writer-held
 *     contract);
 *   - it binds ONLY the interface address given via the required --bind
 *     flag, never 0.0.0.0 (D4);
 *   - it owns Chrome's debugging port and speaks clean CDP to the floor —
 *     HTTP endpoints are proxied with the Host header rewritten, JSON
 *     responses have their webSocketDebuggerUrl rewritten to route back
 *     through the companion, and websocket upgrades are raw-piped (this
 *     is the loopback/Host-header hop, ADR fact 7).
 *
 * The birth rules (profile naming, owner marker, pid-of-port) come from
 * src/lib/server/browser/chassis-shared.ts — the SAME module the floor's
 * registry imports; plain node strips the types natively (Node >= 23.6).
 *
 * Wire:
 *   POST /open   { width, height, ownerSessionId } -> { id, cdpTarget, pid, profileDir }
 *                  409 { error: 'BUSY' } when ownerSessionId already holds a glass
 *   POST /close  { id } (or { pid } / { profileDir }) -> { ok }
 *   GET  /status -> { bind, port, glasses: [...] }
 *   /cdp/<id>/...  CDP bridge (HTTP + websocket upgrade) to that glass
 *
 * Run:  node bin/dsi-chassis.mjs --bind 192.168.1.9 [--port 9560]
 */
import { createServer, request as httpRequest } from 'node:http';
import { connect as netConnect } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import {
	disposableProfilePath,
	pidOfPort,
	writeOwnerMarker
} from '../src/lib/server/browser/chassis-shared.ts';

/** @typedef {{ ok: false, error: string } | { ok: true, addr: string }} BindVerdict */
/** @typedef {{ bind: string | undefined, port: number | undefined }} ParsedArgs */
/** @typedef {{ profileDir: string, args: string[], headless: boolean, width: number, height: number }} LaunchOptions */
/** @typedef {{ pid: number | null, port: number, close: () => Promise<void> }} LaunchResult */
/** @typedef {{ id: string, ownerSessionId: string, debugPort: number, pid: number | null, profileDir: string, close: () => Promise<void> }} Glass */
/** @typedef {{
 *   bind?: string,
 *   port?: number,
 *   debugPort?: number,
 *   profileRoot?: string,
 *   launch?: (o: LaunchOptions) => Promise<LaunchResult>,
 *   portFor?: (preferred?: number) => Promise<number>
 * }} CompanionOptions */
/** @typedef {{ server: import('node:http').Server, port: number, glasses: Map<string, Glass>, stop: () => Promise<void> }} Companion */

/** The companion's disposable root — the same default the floor config
 *  ships (insight-config). The companion runs on the host and answers to
 *  the Borrowed Chrome posture, so deletes are GUARDED to this root. */
const PROFILE_ROOT = join(homedir(), '.dsi', 'browser-profiles');

/** D4 — the bind verdict. Pure: `--bind` is REQUIRED and 0.0.0.0 (and the
 *  IPv6 all-interfaces '::') are refused. The stamp already names the
 *  exact interface; bind-all buys nothing and invites every device. */
/** @param {string | undefined} bind @returns {BindVerdict} */
export function resolveBind(bind) {
	if (bind === undefined || bind === '') {
		return { ok: false, error: 'dsi-chassis: --bind <addr> is required (the private interface from the GLASS_CHASSIS_URL stamp); refusing to guess' };
	}
	if (bind === '0.0.0.0' || bind === '::' || bind === '[::]') {
		return { ok: false, error: 'dsi-chassis: refusing 0.0.0.0 — bind the ONE private interface from the stamp (ADR-0054 D4)' };
	}
	return { ok: true, addr: bind };
}

/** CLI arg parsing — pure, so the pins drive it directly. */
/** @param {string[]} argv @returns {ParsedArgs} */
export function parseArgs(argv) {
	/** @type {ParsedArgs} */
	const out = { bind: undefined, port: undefined };
	for (let i = 0; i < argv.length; i += 1) {
		const a = argv[i];
		if (a === '--bind') { out.bind = argv[i + 1]; i += 1; }
		else if (a.startsWith('--bind=')) out.bind = a.slice('--bind='.length);
		else if (a === '--port') { out.port = Number(argv[i + 1]); i += 1; }
		else if (a.startsWith('--port=')) out.port = Number(a.slice('--port='.length));
	}
	return out;
}

/** A free port for Chrome's debugging listener — net probe, no lsof
 *  dependency, same behavior on macOS and Linux hosts. */
/** @param {number} [preferred] @returns {Promise<number>} */
async function freeChassisPort(preferred) {
	const { createServer: probeServer } = await import('node:net');
	/** @param {number} port @returns {Promise<boolean>} */
	const tryBind = (port) =>
		new Promise((resolve) => {
			const s = probeServer();
			s.once('error', () => resolve(false));
			s.once('listening', () => s.close(() => resolve(true)));
			s.listen(port, '127.0.0.1');
		});
	if (preferred && (await tryBind(preferred))) return preferred;
	for (let p = 9520; p < 9620; p += 1) if (await tryBind(p)) return p;
	throw new Error('dsi-chassis: no free debugging port in 9520..9619');
}

/** The REAL launcher: headed Chromium on a disposable profile via the
 *  repo's pinned playwright-core, channel 'chrome' with the bundled
 *  chromium fallback — the same posture registry.open() births with. */
/** @param {LaunchOptions} opts @returns {Promise<LaunchResult>} */
async function defaultLaunch({ profileDir, args, headless, width, height }) {
	const { chromium } = await import('playwright-core');
	const ignoreDefaultArgs = ['--enable-automation', '--mute-audio', '--hide-scrollbars'];
	// headless honors the floor's plain-click contract (no OS window); only
	// the Shift+click headed open passes false (ADR-0054 D2 — the chassis
	// exists so a HEADED glass can be born where the screens are).
	// Anti-bot parity (registry's PLAIN_IDENTITY posture): a headless birth
	// must not advertise HeadlessChrome — Google captcha'd the first VM-floor
	// plain click on 2026-11-08 while the host floor's spoofed glass passed.
	const identity = headless === true
		? { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' }
		: {};
	// Viewport parity (ADR-0041's local contract, carried across the machine
	// boundary): HEADED is window-driven — viewport null so the page tracks
	// Browser.setWindowBounds. HEADLESS has no OS window: pin the viewport to
	// the requested box (no +6/+70 chassis padding — that pads OS title bars,
	// and a headless glass has none) or the mirror is cut off at the bottom
	// (live witness 2026-11-08: VM plain click vs host panel box).
	const viewport = headless === true
		? { defaultViewport: { width: Number(width) || 730, height: Number(height) || 830 } }
		: { defaultViewport: null };
	let context;
	try {
		context = await chromium.launchPersistentContext(profileDir, { channel: 'chrome', headless: headless === true, ignoreDefaultArgs, ...identity, ...viewport, args });
	} catch {
		context = await chromium.launchPersistentContext(profileDir, { headless: headless === true, ignoreDefaultArgs, ...identity, ...viewport, args });
	}
	const port = Number(args.find((a) => a.startsWith('--remote-debugging-port='))?.split('=')[1]);
	const pid = pidOfPort(port);
	return {
		pid,
		port,
		close: async () => { await context.close(); }
	};
}

/**
 * Start the companion. `launch` is injectable so the pins can drive the
 * whole open/close/ownership/bridge contract without a real Chromium.
 * Returns { server, port, glasses, stop }.
 */
/** @param {CompanionOptions} [opts] @returns {Promise<Companion>} */
export async function startChassisCompanion(opts = {}) {
	const bindVerdict = resolveBind(opts.bind);
	if (!bindVerdict.ok) throw new Error(bindVerdict.error);
	const bind = bindVerdict.ok ? bindVerdict.addr : undefined;
	const launch = opts.launch ?? defaultLaunch;
	const portFor = opts.portFor ?? freeChassisPort;
	// Injectable for the pins (and a VM host may relocate the root); the
	// default stays the Borrowed Chrome root. Deletes are GUARDED to THIS
	// root — the guard is a PATH check, never a flag (the borrowed-wipe RCA).
	const profileRoot = opts.profileRoot ?? PROFILE_ROOT;

	// The ownership registry lives IN this process: one conversation = one
	// glass, keyed by the requesting floor's ownerSessionId (karpathy edge
	// case: two floors stamping the same companion each carry their own id).
	/** @type {Map<string, Glass>} */
	const glasses = new Map(); // id -> glass
	/** @type {Map<string, string>} */
	const byOwner = new Map(); // ownerSessionId -> id

	const server = createServer(async (req, res) => {
		try {
			const url = new URL(req.url ?? '/', 'http://' + (req.headers.host ?? bind));
			// --- the CDP bridge: /cdp/<id>/... proxies to that glass's port ---
			const cdp = url.pathname.match(/^\/cdp\/([^/]+)(\/.*)$/);
			if (cdp) {
				const glass = glasses.get(cdp[1]);
				if (!glass) { res.statusCode = 404; res.end('unknown glass'); return; }
				const headers = { ...req.headers, host: '127.0.0.1:' + glass.debugPort };
				const preq = httpRequest({ host: '127.0.0.1', port: glass.debugPort, path: cdp[2] + url.search, method: req.method, headers }, (pres) => {
					const ctype = String(pres.headers['content-type'] ?? '');
					if (ctype.includes('json')) {
						/** @type {Buffer[]} */
						const chunks = [];
						pres.on('data', (c) => chunks.push(c));
						pres.on('end', () => {
							// Rewrite the advertised debugger urls to route back
							// through THIS companion — the floor never needs to know
							// Chrome's loopback port (ADR fact 7, the Host hop).
							const body = Buffer.concat(chunks).toString('utf8')
								.split('ws://127.0.0.1:' + glass.debugPort).join('ws://' + (req.headers.host ?? bind + ':' + glassPort(server)) + '/cdp/' + glass.id);
							const headers = { ...pres.headers };
							delete headers['transfer-encoding'];
							res.writeHead(pres.statusCode ?? 200, { ...headers, 'content-length': Buffer.byteLength(body) });
							res.end(body);
						});
						return;
					}
					res.writeHead(pres.statusCode ?? 200, pres.headers);
					pres.pipe(res);
				});
				preq.on('error', () => { try { res.statusCode = 502; res.end('cdp bridge down'); } catch { /* gone */ } });
				req.pipe(preq);
				return;
			}
			if (req.method === 'GET' && url.pathname === '/status') {
				res.writeHead(200, { 'content-type': 'application/json' });
				res.end(JSON.stringify({
					bind,
					port: glassPort(server),
					glasses: [...glasses.values()].map((g) => ({ id: g.id, ownerSessionId: g.ownerSessionId, pid: g.pid, profileDir: g.profileDir }))
				}));
				return;
			}
			if (req.method === 'POST' && url.pathname === '/open') {
				/** @type {Buffer[]} */
				const chunks = [];
				for await (const c of req) chunks.push(c);
				let body;
				try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { body = {}; }
				const ownerSessionId = typeof body.ownerSessionId === 'string' ? body.ownerSessionId : '';
				if (!ownerSessionId) {
					res.writeHead(400, { 'content-type': 'application/json' });
					res.end(JSON.stringify({ error: 'BAD_REQUEST', message: 'ownerSessionId is required — ownership is keyed by the requesting conversation' }));
					return;
				}
				// Writer-held, enforced HERE (D3): a busy owner is refused, and
				// the refusal is HONEST — the floor surfaces it, no fallback.
				if (byOwner.has(ownerSessionId)) {
					res.writeHead(409, { 'content-type': 'application/json' });
					res.end(JSON.stringify({ error: 'BUSY', message: 'writer-held: owner session ' + ownerSessionId + ' already holds a glass on this chassis' }));
					return;
				}
				const id = crypto.randomUUID();
				const profileDir = disposableProfilePath(profileRoot, id);
				mkdirSync(profileDir, { recursive: true });
				writeOwnerMarker(profileDir); // shared birth rule — the sweep contract holds on the host too
				const debugPort = await portFor(opts.debugPort);
				const width = Math.max(200, Math.min(1920, Number(body.width) || 730));
				const height = Math.max(120, Math.min(1080, Number(body.height) || 830));
				const args = [
					'--no-first-run',
					'--remote-debugging-port=' + debugPort,
					'--disable-dev-shm-usage',
					'--disable-renderer-backgrounding',
					'--disable-background-timer-throttling',
					'--disable-backgrounding-occluded-windows',
					'--disable-blink-features=AutomationControlled',
					'--autoplay-policy=no-user-gesture-required',
					'--window-size=' + (width + 6) + ',' + (height + 70)
				];
				let born;
				try {
					born = await launch({ profileDir, args, headless: body.headless === true, width, height });
				} catch (e) {
					// a failed birth must not leave a profile dir behind (and the
					// error rides the honest 500 to the floor's panel)
					try { if (profileDir.startsWith(profileRoot)) rmSync(profileDir, { recursive: true, force: true }); } catch { /* best-effort */ }
					throw e;
				}
				const glass = {
					id,
					ownerSessionId,
					debugPort,
					pid: born.pid ?? null,
					profileDir,
					close: born.close
				};
				glasses.set(id, glass);
				byOwner.set(ownerSessionId, id);
				res.writeHead(200, { 'content-type': 'application/json' });
				// The cdpTarget routes THROUGH this companion (the bridge above) —
				// the floor attaches its relay to this URL, never to Chrome raw.
				// Root it at the address the floor DIALED (the request's Host
				// header — same idiom as the ws rewrite in the bridge): `bind`
				// is often 127.0.0.1, which only means "this machine" to the
				// HOST — to a remote floor (VM over the OrbStack bridge) it is
				// the wrong machine and connectOverCDP dials itself (witness
				// 2026-11-08: ECONNREFUSED 127.0.0.1:9525 from the VM floor).
				const dialHost = req.headers.host ?? (bind + ':' + glassPort(server));
				res.end(JSON.stringify({ id, cdpTarget: 'http://' + dialHost + '/cdp/' + id, pid: glass.pid, profileDir }));
				return;
			}
			if (req.method === 'POST' && url.pathname === '/close') {
				/** @type {Buffer[]} */
				const chunks = [];
				for await (const c of req) chunks.push(c);
				let body;
				try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { body = {}; }
				// Karpathy edge case: the companion may have restarted, so a
				// glass is closable by id, pid, or profileDir — not id alone.
				const glass = glasses.get(String(body.id ?? ''))
					?? [...glasses.values()].find((g) => (body.pid !== undefined && g.pid === body.pid) || (body.profileDir !== undefined && g.profileDir === body.profileDir));
				if (!glass) {
					res.writeHead(404, { 'content-type': 'application/json' });
					res.end(JSON.stringify({ error: 'NO_GLASS', message: 'no such glass on this chassis' }));
					return;
				}
				await releaseGlass(glass);
				res.writeHead(200, { 'content-type': 'application/json' });
				res.end(JSON.stringify({ ok: true }));
				return;
			}
			res.statusCode = 404;
			res.end();
		} catch (e) {
			// Honest failure: a birth or close that throws is a 500 with the
			// reason — the floor's panel surfaces it verbatim (no fallback).
			try {
				res.writeHead(500, { 'content-type': 'application/json' });
				res.end(JSON.stringify({ error: 'CHASSIS_FAILED', message: e instanceof Error ? e.message : String(e) }));
			} catch { /* client gone */ }
		}
	});

	/** @param {Glass} glass @returns {Promise<void>} */
	function releaseGlass(glass) {
		glasses.delete(glass.id);
		if (byOwner.get(glass.ownerSessionId) === glass.id) byOwner.delete(glass.ownerSessionId);
		return (async () => {
			try { await glass.close(); } catch { /* already dead */ }
			try { if (glass.pid) process.kill(glass.pid, 'SIGKILL'); } catch { /* already dead */ }
			// Borrowed Chrome: deletes are GUARDED to the disposable root.
			if (glass.profileDir.startsWith(profileRoot)) rmSync(glass.profileDir, { recursive: true, force: true });
		})();
	}

	/** @param {import('node:http').IncomingMessage} req @param {import('node:net').Socket} socket @param {Buffer} head */
	const upgrade = (req, socket, head) => {
		const m = (req.url ?? '').match(/^\/cdp\/([^/]+)(\/devtools\/.*)$/);
		if (!m) { socket.destroy(); return; }
		const glass = glasses.get(m[1]);
		if (!glass) { socket.destroy(); return; }
		// Raw pipe to Chrome's loopback port; the Host header is rewritten —
		// recent Chrome validates it (ADR fact 7) and the companion is the hop.
		/** @type {string[]} */
		const headers = [];
		const raw = req.rawHeaders;
		for (let i = 0; i < raw.length; i += 2) {
			headers.push(raw[i] + ': ' + (raw[i].toLowerCase() === 'host' ? '127.0.0.1:' + glass.debugPort : raw[i + 1]));
		}
		const upstream = netConnect(glass.debugPort, '127.0.0.1', () => {
			upstream.write(req.method + ' ' + m[2] + ' HTTP/1.1\r\n' + headers.join('\r\n') + '\r\n\r\n');
			if (head?.length) upstream.write(head);
			socket.pipe(upstream);
			upstream.pipe(socket);
		});
		const fail = () => { socket.destroy(); upstream.destroy(); };
		upstream.on('error', fail);
		socket.on('error', fail);
	};
	server.on('upgrade', upgrade);

	const wanted = opts.port ?? 9560;
	const boundPort = await (/** @type {Promise<number>} */ (new Promise((res, rej) => {
		server.once('error', rej);
		server.listen(wanted, bind, () => {
			const a = server.address();
			res(typeof a === 'object' && a ? a.port : wanted);
		});
	})));
	return {
		server,
		port: boundPort,
		glasses,
		stop: async () => {
			server.removeAllListeners('upgrade');
			for (const g of [...glasses.values()]) await releaseGlass(g);
			await /** @type {Promise<void>} */ (new Promise((res) => server.close(() => res())));
		}
	};
}

/** @param {import('node:http').Server} server @returns {number} */
function glassPort(server) {
	const a = server.address();
	return typeof a === 'object' && a ? a.port : 0;
}

// ---- direct run: parse CLI, resolve bind, start, stay up --------------------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const { bind, port } = parseArgs(process.argv.slice(2));
	const verdict = resolveBind(bind);
	if (!verdict.ok) {
		console.error(verdict.error);
		process.exit(1);
	}
	startChassisCompanion({ bind: verdict.addr, port })
		.then((c) => {
			console.log('dsi-chassis: listening on ' + verdict.addr + ':' + c.port + ' (stamp me as GLASS_CHASSIS_URL=http://' + verdict.addr + ':' + c.port + ')');
		})
		.catch((e) => {
			console.error('dsi-chassis: ' + (e instanceof Error ? e.message : String(e)));
			process.exit(1);
		});
}
