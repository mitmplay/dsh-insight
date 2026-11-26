#!/usr/bin/env node
// drive.mjs — the DO-path of the dsi-drive-terminal skill (2026-11-24).
// One process, one action: `type` finds the floor, checks readiness quietly,
// takes the baton labelled, types the line, presses Enter and hands it back.
//
//   node drive.mjs type "<line>" [target] [--agent NAME] [--floor PORT] [--force]
//   node drive.mjs peek  [target] [--floor PORT] [--lines N]          (read-only)
//   node drive.mjs take  [target] [--agent NAME] [--floor PORT] [--force]   ┐ a job: hold the baton
//   node drive.mjs write "<text>"      (\n = Enter)                      │
//   node drive.mjs key   <enter|ctrl-c|esc|tab|backspace|up|down|left|right> │
//   node drive.mjs read  [--all] [--lines N]                                │
//   node drive.mjs release                                                  ┘
//
// Exit 0: done — one line on stdout.  Exit 3: CONCERN + FIX, nothing typed.
// Contract: dev/feature-contract-scenario/terminal-driving.md · ADR-0079.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** @typedef {{id: string, exited: boolean, readiness?: {settled?: boolean, settledSince?: number|null, reason?: string}|null, baton: {holder: string, holderId?: string, lastWriteAt: number|null, since: number}}} TermSession */
/** @typedef {{enabled: boolean, sessions: TermSession[]}} TermState */
/** @typedef {{status: number, body: any}} ApiResult */

const STATE = join(tmpdir(), 'dsi-drive.json');
const PRODUCTION = 5174; // Port Ledger: the built DSI floor
const PACE_MS = 120; // one keystroke per write, ~120 ms (KB terminal-driving.md)
const USAGE = 'usage: drive.mjs type \"<line>\" [target] | peek [target] | take [target] | write \"<text>\" | key <name> | read [--all] | release   (flags: --agent NAME --floor PORT --force --lines N)';

class Blocked {
  /** @param {string} text @param {string} fix */
  constructor(text, fix) { this.text = text; this.fix = fix; }
}
/** @param {string} text @param {string} fix @returns {never} */
function concern(text, fix) { throw new Blocked(text, fix); }
/** @param {string} text @returns {never} */
function die(text) { throw new Error(text); }
/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── command line ──
const argv = process.argv.slice(2);
const cmd = argv[0];
/** @type {{force?: boolean, all?: boolean, agent?: string, floor?: number, lines?: number}} */
const flags = {};
/** @type {string[]} */
const pos = [];
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--force') flags.force = true;
  else if (a === '--all') flags.all = true;
  else if (a === '--agent') flags.agent = argv[++i];
  else if (a === '--floor') flags.floor = Number(argv[++i]);
  else if (a === '--lines') flags.lines = Number(argv[++i]);
  else pos.push(a);
}
const agent = flags.agent ?? 'agent';
/** @param {string} line */
function out(line) { process.stdout.write(line + '\n'); }

// ── floors and the baton facet (all token-free reads) ──
// Discovery ladder (ADR-0080 D4, MAC AND LINUX): (1) lsof -nP -iTCP
// -sTCP:LISTEN (macOS + Linux), (2) lsof absent/fails → ss -ltn (Linux
// minimal), (3) both absent → sweep-probe 5100-5299 (51xx floors + 52xx
// worktree lanes). EVERY path ends in
// the same JSON-probe confirmation (an 'enabled' boolean in the GET body),
// so a broken-JSON port is never returned as a floor. Both tools are
// invoked by BARE name so PATH shims work (tests stub them there).
/** @param {string} text */
function portsFromText(text) {
  const ports = new Set();
  for (const line of text.split('\n')) { const m = /:(\d+)(?:\s|$)/.exec(line); if (m) ports.add(Number(m[1])); }
  // ADR-0080 amendment (live-verify 2026-11-24): ADR-0072 worktree lanes
  // listen in the 52xx band — the discovery band covers 51xx AND 52xx.
  return [...ports].filter((p) => (p >= 5100 && p <= 5199) || (p >= 5200 && p <= 5299)).sort((a, b) => a - b);
}
function portsFromLsof() {
  let text = '';
  try { text = execFileSync('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; }
  return portsFromText(text);
}
function portsFromSs() {
  let text = '';
  try { text = execFileSync('ss', ['-ltn'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return null; }
  return portsFromText(text);
}
async function portsFromSweep() {
  const found = [];
  // 51xx floors + 52xx worktree lanes (ADR-0080 amendment, 2026-11-24)
  for (let p = 5100; p <= 5299; p++) {
    try { const r = await api(p, ''); if (r.status === 200 && r.body && typeof r.body.enabled === 'boolean') found.push(p); } catch { /* closed or foreign */ }
  }
  return found.sort((a, b) => a - b);
}
/** Ladder only (no HTTP confirm) — exported for the discovery pins. */
export async function candidatePorts() {
  const a = portsFromLsof();
  if (a !== null) return a; // lsof spoke — trust its answer (even empty)
  const b = portsFromSs();
  if (b !== null) return b;
  return portsFromSweep();
}
/** @param {number} port @param {string} path @param {RequestInit} [init] @returns {Promise<ApiResult>} */
async function api(port, path, init = {}) {
  const res = await fetch('http://127.0.0.1:' + port + '/api/terminal' + path, { ...init, signal: AbortSignal.timeout(4000) });
  const text = await res.text();
  let body = null; try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body };
}
/** Candidate ports confirmed by the JSON probe — a listener whose GET
 *  /api/terminal is not DSI JSON is never returned (ADR-0080 D4). */
export async function confirmedFloors() {
  const found = new Set();
  for (const port of await candidatePorts()) {
    try { const r = await api(port, ''); if (r.status === 200 && r.body && typeof r.body.enabled === 'boolean') found.add(port); } catch { /* not a DSI floor */ }
  }
  return [...found].sort((a, b) => a - b);
}
async function floors() {
  if (flags.floor) return [flags.floor];
  return confirmedFloors();
}
/** @param {number} port @returns {Promise<TermState|null>} */
async function list(port) { const r = await api(port, ''); return r.body; }
/** @param {TermSession} s */
const live = (s) => !s.exited;
/** @param {number|null|undefined} ms */
function fmtAgo(ms) { if (ms === null || ms === undefined) return 'never typed in'; const s = Math.max(0, Math.round((Date.now() - ms) / 1000)); return s < 60 ? s + 's ago' : Math.round(s / 60) + ' min ago'; }

// ── which shell ──
/** @param {string|undefined} target */
function targetId(target) {
  if (target === undefined) return { named: false };
  let m;
  if ((m = /^T\d+:(t-\d+)$/.exec(target))) return { named: true, id: m[1] };
  if (/^t-\d+$/.test(target)) return { named: true, id: target };
  if (/^T\d+/.test(target)) return { named: true, tab: target };
  return { named: true, bad: target };
}
/** @param {number} port @param {string} id @param {string} last */
function notReady(port, id, last) {
  return concern('Shell ' + id + ' on ' + port + ' does not look ready — its last line is ' + JSON.stringify(last.slice(0, 80)) + '.', 'It may be running something or hold a half-typed line. Wait for it, press Ctrl+C in that tab, or add --force to type anyway.');
}
// Resolves the floor and the shell, asking nothing; every dead end is a CONCERN + FIX.
/** @param {string|undefined} target */
async function resolve(target) {
  const ps = await floors();
  if (ps.length === 0) return concern('No DSI terminal floor is listening (looked on ports 5100-5199).', 'Start the floor (your dsi command), or pass --floor <port> if it runs elsewhere.');
  /** @type {{port: number, l: TermState}[]} */ const enabled = [];
  for (const port of ps) { const l = await list(port); if (l && l.enabled === true) enabled.push({ port, l }); }
  if (enabled.length === 0) return concern('The terminal is switched off on ' + ps.join(', ') + '.', 'Set terminal.enabled in the DSI settings, then open the desk with /dsi-terminal.');
  const t = targetId(target);
  if (t.bad) return concern('\"' + t.bad + '\" is not a tab I can resolve: the wire knows session ids (t-7) and desk badges (T1:7), never tab positions.', 'Read the badge on the tab and pass it, e.g. T1:7 — or omit the target.');
  if (t.tab) {
    const options = enabled.flatMap((v) => v.l.sessions.filter(live).map((s) => v.port + ': ' + s.id));
    return concern('\"' + t.tab + '\" names a tab POSITION; positions are not session ids (RCA 2026-11-04).', options.length ? 'Say which shell by id: ' + options.join(' · ') + ' — or omit the target.' : 'No live shell on ' + enabled.map((v) => v.port).join(', ') + '; omit the target and I open one.');
  }
  if (t.named) {
    const hit = enabled.find((v) => v.l.sessions.some((s) => s.id === t.id));
    if (!hit) return concern('No shell ' + t.id + ' on ' + enabled.map((v) => v.port).join(', ') + '.', 'Pick one from the list, or omit the target.');
    const s = hit.l.sessions.find((x) => x.id === t.id);
    if (!s || !live(s)) return concern('Shell ' + t.id + ' on ' + hit.port + ' is dead (it exited).', 'Run /dsi-terminal --new-tab for a fresh one, or omit the target.');
    return { port: hit.port, id: s.id, opened: false };
  }
  const withLive = enabled.map((v) => ({ port: v.port, live: v.l.sessions.filter(live) })).filter((v) => v.live.length > 0);
  const total = withLive.reduce((n, v) => n + v.live.length, 0);
  if (total === 1) return { port: withLive[0].port, id: withLive[0].live[0].id, opened: false };
  if (total > 1) {
    const options = withLive.flatMap((v) => v.live.map((s) => v.port + ': ' + s.id + ' (held by ' + s.baton.holder + ', ' + fmtAgo(s.baton.lastWriteAt) + ')'));
    return concern(total + ' live shells and no target named.', 'Say which one: ' + options.join(' · ') + '.');
  }
  const port = enabled.some((v) => v.port === PRODUCTION) ? PRODUCTION : enabled.length === 1 ? enabled[0].port : null;
  if (port === null) return concern('No live shell on floors ' + enabled.map((v) => v.port).join(', ') + ', and more than one floor to open one on.', 'Pass --floor <port> and I open a fresh shell there.');
  return { port, id: null, opened: true };
}

// ── baton: open / take / write / release ──
/** @type {{port: number, id: string, token: string, offset: number, heals: number}|null} */ let st = null; // the baton this process holds
function save() { writeFileSync(STATE, JSON.stringify(st)); }
function load() { try { st = JSON.parse(readFileSync(STATE, 'utf8')); } catch { die('no baton is held — run drive.mjs take first'); } }
function clear() { try { rmSync(STATE, { force: true }); } catch { /* nothing held */ } }
const json = { 'content-type': 'application/json' };
/** @param {number} port */
async function openShell(port) {
  const r = await api(port, '', { method: 'POST', headers: json, body: JSON.stringify({ holder: 'automation', holderId: agent }) });
  if (r.status !== 200 || !r.body || !r.body.sessionId) die('open refused on ' + port + ': HTTP ' + r.status + ' ' + JSON.stringify(r.body));
  // a fresh shell prints its first prompt ~1 s later; wait until its output holds still
  let prev = -1, still = 0, offset = 0;
  for (let i = 0; i < 24 && still < 3; i++) {
    await sleep(250);
    const o = await api(port, '/' + r.body.sessionId + '/output?fromByte=0');
    offset = o.body && typeof o.body.nextOffset === 'number' ? o.body.nextOffset : 0;
    still = offset > 0 && offset === prev ? still + 1 : 0; prev = offset;
  }
  return { id: r.body.sessionId, token: r.body.token, offset };
}
/** @param {number} port @param {string} id */
async function take(port, id) {
  const r = await api(port, '/' + id + '/reattach', { method: 'POST', headers: json, body: JSON.stringify({ holder: 'automation', holderId: agent }) });
  if (r.status !== 200 || !r.body || !r.body.token) die('take refused on ' + id + ': HTTP ' + r.status + ' ' + JSON.stringify(r.body));
  return r.body; // {token, fromByte}
}
/** @param {string} action @param {Record<string, unknown>} [extra] */
async function send(action, extra = {}) { if (st === null) return die('no baton is held — run drive.mjs take first'); return api(st.port, '/' + st.id + '/send', { method: 'POST', headers: json, body: JSON.stringify({ token: st.token, action, ...extra }) }); }
async function release() {
  const r = await send('release');
  clear();
  if (r.status === 403) return 'already lost (someone healed past it)';
  if (r.status !== 200) die('release refused: HTTP ' + r.status + ' ' + JSON.stringify(r.body));
  return 'released';
}
// One keystroke = one write, response checked; a refusal is READ, then healed (skill law 4).
/** @param {string} data @param {number} n */
async function typeKey(data, n) {
  const r = await send('write', { data });
  if (r.status === 200) return;
  if (r.status !== 403) die('write refused (key ' + (n + 1) + '): HTTP ' + r.status + ' ' + JSON.stringify(r.body));
  if (st === null) return die('no baton is held — run drive.mjs take first');
  const held = st; // narrowed: callbacks cannot see the narrowing of the outer let
  const l = await list(held.port); if (l === null) return die('terminal floor ' + held.port + ' is not answering.'); const s = l.sessions.find((x) => x.id === held.id); const b = s && s.baton;
  if (s && !live(s)) return concern('Shell ' + held.id + ' exited while I was typing (before key ' + (n + 1) + ').', 'Open a fresh tab and ask again.');
  if (b && b.holder === 'operator' && b.lastWriteAt !== null && b.lastWriteAt >= b.since) return concern('You started typing in ' + held.id + ' — I stopped before key ' + (n + 1) + ' and left the line to you.', 'Nothing to fix: finish your line, then ask me again.');
  if (held.heals >= 3) return concern('The baton on ' + held.id + ' keeps moving (3 heals already).', 'Another driver or a reloading desk is fighting for it; say which one should hold it.');
  held.token = (await take(held.port, held.id)).token; held.heals++; save();
  const again = await send('write', { data });
  if (again.status !== 200) return concern('A write to ' + held.id + ' was refused twice (HTTP ' + again.status + ').', 'Run drive.mjs peek, read who holds the baton, and decide.');
}
/** @param {string} text */
async function typeKeys(text) { let n = 0; for (const ch of text) { await typeKey(ch === '\n' ? '\r' : ch, n++); await sleep(PACE_MS); } }

// ── reading the screen (a guess: the ring is not a screenshot) ──
/** @param {string} text */
function strip(text) {
  return text
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '') // OSC (window titles)
    .replace(/\u001b\[[0-9;?]*[a-zA-Z=]/g, '') // CSI (colors, cursor moves)
    .replace(/\u001b[()][A-Za-z0-9]/g, '')
    .replace(/\u001b[=>]/g, '')
    .replace(/\u0007/g, '')
    .replace(/.\u0008/g, ''); // the line editor's redraw: x, backspace, xyz
}
/** @param {string} text */
function lines(text) { return strip(text).split(/\r\n|\n|\r/).map((s) => s.trimEnd()).filter((s) => s.trim() !== ''); }
const PROMPT_END = /(?:❯|[$%#>])\s*$/; // starship's \"❯ \" or a plain \"$ \" must END the last line
/** @param {string} text */
function look(text) { const ls = lines(text); const last = ls.at(-1) ?? ''; return { idle: PROMPT_END.test(last), last }; }
/** @param {number} port @param {string} id @param {number} [from] */
async function ring(port, id, from = 0) {
  const r = await api(port, '/' + id + '/output?fromByte=' + from);
  return r.body && typeof r.body.text === 'string' ? r.body : { text: '', nextOffset: 0, lossy: false };
}

// ── commands ──
/** @param {string|undefined} target @returns {Promise<{port: number, id: string, opened: boolean}>} */
async function grab(target) { // resolve → (open if none) → readiness → take; returns {port, id, opened}
  const r = await resolve(target);
  if (r.opened) { const o = await openShell(r.port); st = { port: r.port, id: o.id, token: o.token, offset: o.offset, heals: 0 }; save(); return { port: r.port, id: o.id, opened: true }; }
  const snapshot = await list(r.port);
  const s = snapshot && snapshot.sessions ? snapshot.sessions.find((x) => x.id === r.id) : null;
  if (!s || !live(s)) return concern('Shell ' + r.id + ' on ' + r.port + ' just exited.', 'Open a fresh tab and ask again.');
  // THE readiness gate (ADR-0080 D2): the wire's readiness.settled decides;
  // screen text is evidence, never the gate. Peek text is demoted to the
  // half-typed-line SECONDARY check below.
  if (s.readiness && s.readiness.settled !== true && !flags.force) {
    const since = s.readiness.settledSince === null || s.readiness.settledSince === undefined ? 'never' : new Date(s.readiness.settledSince).toISOString();
    return concern('Shell ' + r.id + ' on ' + r.port + ' is NOT settled (readiness.settled false, reason ' + JSON.stringify(s.readiness.reason ?? null) + ', settledSince ' + since + ') — output landed within the idle window, a command may be mid-flight.', 'Wait and re-read GET /api/terminal until readiness.settled is true, or add --force to type anyway.');
  }
  if (!s.readiness && !flags.force) {
    return concern('Shell ' + r.id + ' on ' + r.port + ' carries NO readiness field — this floor predates ADR-0080, so its settle state is unknown.', 'Update the floor, or add --force to type on the peek-text guess alone.');
  }
  const rid = /** @type {string} */ (r.id); // only the opened:true branch carries id:null, returned above
  const screen = await ring(r.port, rid); const k = look(screen.text);
  // SECONDARY (the half-typed line): settled only proves quiet output, not
  // an idle prompt — a half-typed line would still be mangled.
  if (!k.idle && !flags.force) return notReady(r.port, rid, k.last);
  const t = await take(r.port, rid);
  st = { port: r.port, id: rid, token: t.token, offset: t.fromByte, heals: 0 }; save();
  return { port: r.port, id: rid, opened: false };
}
/** @param {string|undefined} line @param {string|undefined} target */
async function cmdType(line, target) {
  if (line === undefined || line === '') die('usage: drive.mjs type \"<line>\" [target]');
  if (/[\r\n]/.test(line)) return concern('I type ONE line per call; this one has a line break.', 'Call me once per line.');
  const g = await grab(target);
  await typeKeys(line + '\n');
  const how = await release();
  out('typed ' + JSON.stringify(line) + ' → ' + g.id + ' on ' + g.port + ' · took the baton as ' + JSON.stringify(agent) + (g.opened ? ' · opened a new shell' : '') + ' · ' + how);
}
/** @param {string|undefined} target */
async function cmdTake(target) {
  const g = await grab(target);
  out('baton taken: ' + g.id + ' on ' + g.port + ' as ' + JSON.stringify(agent) + (g.opened ? ' (new shell)' : '') + ' · release it when done');
}
/** @param {string} text */
async function cmdWrite(text) { load(); const cur = /** @type {{port: number, id: string, token: string, offset: number, heals: number}} */ (st); await typeKeys(text); out('wrote ' + text.length + ' key(s) → ' + cur.id); }
const KEYS = { enter: '\r', 'ctrl-c': '\u0003', esc: '\u001b', tab: '\t', backspace: '\u007f', up: '\u001b[A', down: '\u001b[B', left: '\u001b[D', right: '\u001b[C' };
/** @param {string} name */
async function cmdKey(name) { load(); const k = KEYS[/** @type {keyof typeof KEYS} */ (name)]; if (k === undefined) die('unknown key ' + JSON.stringify(name) + '; known: ' + Object.keys(KEYS).join(', ')); await typeKeys(k); out('key ' + name + ' → ' + /** @type {{id: string}} */ (st).id); }
async function cmdRead() {
  load();
  const cur = /** @type {{port: number, id: string, token: string, offset: number, heals: number}} */ (st);
  const r = await ring(cur.port, cur.id, flags.all ? 0 : cur.offset);
  for (const ln of lines(r.text).slice(-(flags.lines ?? 30))) out(ln.slice(0, 200));
  cur.offset = r.nextOffset; save();
}
async function cmdRelease() { load(); const cur = /** @type {{port: number, id: string, token: string, offset: number, heals: number}} */ (st); const id = cur.id; const port = cur.port; out('baton ' + (await release()) + ' (' + id + ' on ' + port + ')'); }
/** @param {string|undefined} target */
async function cmdPeek(target) {
  const ps = await floors();
  if (ps.length === 0) return out('No DSI terminal floor is listening (looked on ports 5100-5199).');
  const t = targetId(target);
  for (const port of ps) {
    const l = await list(port);
    if (!l) continue;
    out('floor ' + port + ' · terminal ' + (l.enabled ? 'enabled' : 'DISABLED') + ' · ' + l.sessions.length + ' shell(s)');
    for (const s of l.sessions) {
      const r = await ring(port, s.id); const k = look(r.text); const b = s.baton;
      out('  ' + s.id + ' · ' + (live(s) ? 'live' : 'dead') + ' · baton: ' + b.holder + (b.holderId ? ' \"' + b.holderId + '\"' : '') + ' · last key ' + fmtAgo(b.lastWriteAt) + ' · screen ' + (live(s) ? (k.idle ? 'idle (a prompt)' : 'busy') : '-'));
      const wanted = !t.id || t.id === s.id;
      if (wanted && live(s) && !t.tab) for (const ln of lines(r.text).slice(-(flags.lines ?? 4))) out('      ' + ln.slice(0, 160));
    }
  }
}

async function main() {
  if (cmd === 'type') return cmdType(pos[0], pos[1]);
  if (cmd === 'peek') return cmdPeek(pos[0]);
  if (cmd === 'take') return cmdTake(pos[0]);
  if (cmd === 'write') { if (pos[0] === undefined) die('usage: drive.mjs write \"<text>\"'); return cmdWrite(pos[0]); }
  if (cmd === 'key') return cmdKey(pos[0]);
  if (cmd === 'read') return cmdRead();
  if (cmd === 'release') return cmdRelease();
  out(USAGE);
  process.exitCode = cmd ? 1 : 0;
}
// Run the command brain ONLY when invoked as the script — importing the
// module (the discovery pins do) must stay side-effect free.
const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  try {
    await main();
  } catch (e) {
    const held = /** @type {{port: number, id: string, token: string, offset: number, heals: number}|null} */ (st);
    if (held && held.token) { try { await send('release'); } catch { /* not ours any more */ } clear(); }
    if (e instanceof Blocked) { out('CONCERN: ' + e.text); out('FIX: ' + e.fix); process.exitCode = 3; }
    else { const err = /** @type {{message?: unknown}} */ (e); out('ERROR: ' + (err && err.message ? err.message : e)); process.exitCode = 1; }
  }
}
