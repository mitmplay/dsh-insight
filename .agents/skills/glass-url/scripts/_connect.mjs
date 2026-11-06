#!/usr/bin/env node
/**
 * _connect.mjs — shared glass connection for the glass-url / glass-dsi drivers.
 *
 * EXPORTS (do not guess — this header is the contract, keep it in sync):
 *   die(msg)                 — print a JSON error and exit 1.
 *   identityFrom(argv)       — caller identity, first-wins: --owner-session
 *                              flag > GLASS_OWNER_SESSION > DSH_SESSION_ID
 *                              (the harness built-in is CONDITIONAL —
 *                              dsh-shell-env index.js:89 injects it only
 *                              when the execution carries an agent binding,
 *                              RCA 2026-10-30 "the session id is gone" —
 *                              so explicit beats inherited).
 *   pickSession(sessions, envId)
 *                            — PURE D7 resolver (unit-tested): match the
 *                              caller's identity to ownerSessionId. NEVER
 *                              registry index (ADR-0045 amendment 3).
 *                              Returns { session } | { session:null, error }.
 *   connect()                — GET /api/browser (the ONLY source of truth,
 *                              ADR-0030) → pickSession → CDP connect →
 *                              { session, browser, ctx }. Dies LOUDLY on
 *                              ambiguity; degraded single-session runs print
 *                              a warning on stderr and proceed.
 *   pick(ctx, substr)        — page whose URL contains substr; NEVER
 *                              positional "newest" among foreign tabs (D2).
 */
import { chromium } from 'playwright-core';

/**
 * @typedef {Object} GlassSession
 * @property {string} id
 * @property {number} [port]
 * @property {string|null} [ownerSessionId]
 * @property {string} [createdAt]
 * @typedef {Object} PickResult
 * @property {GlassSession|null|undefined} session
 * @property {boolean} [degraded]
 * @property {string} [note]
 * @property {string} [error]
 */

// ── The Floor Seam (ADR "The Floor Seam" 2026-11-05, D1-D3) ────────────────
// The drivers dial the floor they SEE: DSI_UI env verbatim when set, else a
// parallel probe of the two known floor bases (5175 dev, 5174 build) with the
// D7 identity resolver as tiebreak. No port literal may survive in tab
// filtering — isFloorTab compares origins against the RESOLVED base (D2).

const DEFAULT_FLOOR_BASES = ['http://127.0.0.1:5175', 'http://127.0.0.1:5174'];

/** Candidate bases: the env seam wins verbatim (validated http), else both
 *  known floor bases — dev first so a dev-only machine keeps today's shape. */
export function floorCandidates(env = process.env) {
  const ui = env.DSI_UI;
  if (ui && /^http:\/\//.test(ui)) return [ui.replace(/\/$/, '')];
  return [...DEFAULT_FLOOR_BASES];
}

/** Resolve the live floor: fetch /api/browser on every candidate in
 *  PARALLEL (3 s timeout each), then — one answer wins; both answer →
 *  pickSession per floor with the caller's identity, the floor holding the
 *  caller's OWN glass wins, a double-claim dies loud (D7 stands); none
 *  answer → die naming BOTH ports and BOTH launch commands. */
/** @param {{ env?: Record<string, string|undefined>, fetchImpl?: typeof fetch, identity?: string|undefined, pickSessionFn?: (s: GlassSession[]|null|undefined, id: string|undefined) => PickResult, dieFn?: (msg: string) => never, timeoutMs?: number }} [opts] @returns {Promise<{ base: string, reg: { sessions: GlassSession[] } }>} — never resolves undefined: every fall-through path dies. */
export async function resolveDsiBase({ env = process.env, fetchImpl = fetch, identity = undefined, pickSessionFn = pickSession, dieFn = die, timeoutMs = 3000 } = {}) {
  const candidates = floorCandidates(env);
  const probes = await Promise.all(candidates.map(async (base) => {
    try {
      const res = await fetchImpl(base + '/api/browser', { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) return { base, reg: null };
      return { base, reg: await res.json() };
    } catch { return { base, reg: null }; }
  }));
  const answered = probes.filter((p) => p.reg?.sessions);
  if (answered.length === 0) {
    dieFn('no DSI floor answers — probed ' + candidates.join(', ') +
      ' (dev: dsi dsh --sync --dev --playwright-mcp · build: dsi dsh --sync · or set DSI_UI=<floor url>)');
  }
  if (answered.length === 1) return answered[0];
  // Both floors live — the caller's own glass picks the floor (D7 tiebreak).
  const claims = answered.map((p) => ({ ...p, verdict: pickSessionFn(p.reg.sessions, identity) }));
  const mine = claims.filter((c) => c.verdict.session);
  if (mine.length === 1) return mine[0];
  if (mine.length > 1) {
    dieFn('a glass owned by you lives on BOTH floors (' + mine.map((m) => m.base).join(', ') +
      ') — set DSI_UI=<floor url> to name the floor; refusing to guess (D7)');
  }
  return dieFn('both floors answer but neither holds YOUR glass (' + answered.map((m) => m.base).join(', ') +
    ') — click the Browser chip in THIS conversation');
}

/** True when a tab url's ORIGIN is the resolved floor's origin (D2): the
 *  DSI tab is the floor's own page, whatever port it landed on. */
/** @param {string} url @param {string} base @returns {boolean} */
export function isFloorTab(url, base) {
  try { return new URL(url).origin === new URL(base).origin; } catch { return false; }
}

/** @param {string} msg @returns {never} */
export function die(msg) {
  console.error(JSON.stringify({ error: msg, fallback: 'SKILL.md Step 1 — ask the OPERATOR to click the Browser chip IN THE RIGHT CONVERSATION, then catch the session via GET /api/browser. If DSH_SESSION_ID is absent from env, pass --owner-session <id> (the session id you already know from context).' }));
  process.exit(1);
}

/** @param {string[]} argv @returns {string|undefined} */
export function identityFrom(argv) {
  const flag = argv.indexOf('--owner-session');
  if (flag !== -1 && argv[flag + 1]) return argv[flag + 1];
  if (process.env.GLASS_OWNER_SESSION) return process.env.GLASS_OWNER_SESSION;
  if (process.env.DSH_SESSION_ID) return process.env.DSH_SESSION_ID;
  return undefined;
}

/** @param {GlassSession[]|null|undefined} sessions @param {string|undefined} envId @returns {PickResult} */
export function pickSession(sessions, envId) {
  const list = sessions ?? [];
  if (envId) {
    const mine = list.filter((s) => (s.ownerSessionId ?? null) === envId);
    if (mine.length === 1) return { session: mine[0], degraded: false };
    if (mine.length > 1) {
      const newest = [...mine].sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''))).at(-1);
      return { session: newest, degraded: false, note: 'multiple glasses owned by ' + envId + ' — newest wins' };
    }
    if (list.length === 1 && (list[0].ownerSessionId ?? null) === null) {
      return { session: list[0], degraded: true, note: 'legacy session without ownerSessionId — degraded match' };
    }
    return { session: null, error: 'no glass owned by ' + envId + ' — your glass is dead or never summoned (click the Browser chip in THIS conversation); live glasses belong to other conversations and are untouchable (D7)' };
  }
  if (list.length === 1) {
    return { session: list[0], degraded: true, note: 'no explicit identity in env — degraded single-session resolution' };
  }
  return { session: null, error: 'multiple live glasses and no explicit identity — pass --owner-session <id> (or GLASS_OWNER_SESSION) from the session id you already know; refusing to guess (D7)' };
}

/** @returns {Promise<{ session: GlassSession, browser: import('playwright-core').Browser, ctx: import('playwright-core').BrowserContext, base: string }>} */
export async function connect() {
  const { base, reg } = await resolveDsiBase({ env: process.env, identity: identityFrom(process.argv) });
  const { session, degraded, note, error } = pickSession(reg.sessions, identityFrom(process.argv));
  if (!session) die(error ?? 'no glass session resolved — operator must click the Browser chip');
  if (degraded || note) console.error(JSON.stringify({ warn: note ?? 'degraded', sessionId: session.id }));
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + session.port).catch(() => null);
  if (!browser) die('CDP connect failed on port ' + session.port);
  return { session, browser, ctx: browser.contexts()[0], base };
}

/** @param {import('playwright-core').BrowserContext} ctx @param {string} substr @returns {import('playwright-core').Page|undefined} */
export function pick(ctx, substr) {
  return ctx.pages().find((p) => p.url().includes(substr));
}