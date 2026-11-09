#!/usr/bin/env node
/**
 * _connect.mjs — shared glass connection for the glass-dsh driver (skills/glass-dsh).
 * Dated copy 2026-11-09; derived from glass-dsi's helper (ADR-0045 D1/D12 —
 * accepted duplication, each copy dated and attributed).
 *
 * EXPORTS (do not guess — this header is the contract):
 *   die(msg)             — print a JSON error and exit 1.
 *   identityFrom(argv)   — caller identity, first-wins: --owner-session flag
 *                          > GLASS_OWNER_SESSION > DSH_SESSION_ID env.
 *   pickSession(sessions, envId)
 *                        — PURE D7 resolver: match identity to ownerSessionId;
 *                          NEVER a registry index. { session } | { session:null, error }.
 *   resolveDsiBase({env, fetchImpl, timeoutMs})
 *                        — the floor that owns the registry: DSI_UI env wins,
 *                          else probe http://127.0.0.1:5175 then :5174 (/api/browser).
 *                          Returns { base, reg }; dies loudly when no floor answers.
 *   resolveDshBase(argv, env)
 *                        — the DSH surface to verify (D13, probe-then-env):
 *                          --dsh-url / --dsh-port argument > DSH_PORT env >
 *                          default http://127.0.0.1:3080. Returns origin string.
 *   connect(argv)        — resolveDsiBase → pickSession → chromium.connectOverCDP
 *                          → { session, browser, ctx, floorBase, dshOrigin }.
 *                          Dies loudly on ambiguity (D7) or CDP failure.
 *   pickByOrigin(ctx, origin) — the page whose URL ORIGIN equals `origin`
 *                          (never a port substring, never positional). Dies when
 *                          absent, naming the resolved origin.
 */
import { chromium } from 'playwright-core';

const DEFAULT_FLOOR_BASES = ['http://127.0.0.1:5175', 'http://127.0.0.1:5174'];

export function die(msg) {
  console.error(JSON.stringify({ error: msg }));
  process.exit(1);
}

export function identityFrom(argv) {
  const flag = argv.indexOf('--owner-session');
  if (flag !== -1 && argv[flag + 1]) return argv[flag + 1];
  if (process.env.GLASS_OWNER_SESSION) return process.env.GLASS_OWNER_SESSION;
  if (process.env.DSH_SESSION_ID) return process.env.DSH_SESSION_ID;
  return undefined;
}

export function pickSession(sessions, envId) {
  const list = sessions ?? [];
  if (envId) {
    const mine = list.filter((s) => (s.ownerSessionId ?? null) === envId);
    if (mine.length === 1) return { session: mine[0], degraded: false };
    if (mine.length > 1) {
      const newest = [...mine]
        .sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')))
        .at(-1);
      return { session: newest, degraded: false, note: 'multiple glasses owned by ' + envId + ' — newest wins' };
    }
    if (list.length === 1 && (list[0].ownerSessionId ?? null) === null) {
      return { session: list[0], degraded: true, note: 'legacy session without ownerSessionId — degraded match' };
    }
    return { session: null, error: 'no glass owned by ' + envId + ' — your glass is dead or never summoned (the operator clicks the Browser chip in THIS conversation); live glasses belong to other conversations and are untouchable (D7)' };
  }
  if (list.length === 1) {
    return { session: list[0], degraded: true, note: 'no explicit identity in env — degraded single-session resolution' };
  }
  return { session: null, error: 'multiple live glasses and no explicit identity — pass --owner-session <id>; refusing to guess (D7)' };
}

export async function resolveDsiBase({ env = process.env, fetchImpl = fetch, timeoutMs = 3000 } = {}) {
  const candidates = env.DSI_UI && /^http:\/\//.test(env.DSI_UI)
    ? [env.DSI_UI.replace(/\/$/, '')]
    : [...DEFAULT_FLOOR_BASES];
  const probes = await Promise.all(candidates.map(async (base) => {
    try {
      const res = await fetchImpl(base + '/api/browser', { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) return { base, reg: null };
      return { base, reg: await res.json() };
    } catch { return { base, reg: null }; }
  }));
  const answered = probes.filter((p) => p.reg?.sessions);
  if (answered.length === 0) {
    die('no DSI floor answers — probed ' + candidates.join(', ') +
      ' (the glass session registry lives on the DSI floor; open the glass from the floor panel)');
  }
  return answered[0];
}

/** D13 — explicit argument > DSH_PORT env > default 3080; returns an origin string. */
export function resolveDshBase(argv = [], env = process.env) {
  const urlFlag = argv.indexOf('--dsh-url');
  if (urlFlag !== -1 && argv[urlFlag + 1]) return new URL(argv[urlFlag + 1]).origin;
  const portFlag = argv.indexOf('--dsh-port');
  if (portFlag !== -1 && argv[portFlag + 1]) return new URL('http://127.0.0.1:' + argv[portFlag + 1]).origin;
  if (env.DSH_PORT) return new URL('http://127.0.0.1:' + env.DSH_PORT).origin;
  return new URL('http://127.0.0.1:3080').origin;
}

export function originOf(url) {
  try { return new URL(url).origin; } catch { return null; }
}

export async function connect(argv = []) {
  const { base, reg } = await resolveDsiBase({ env: process.env });
  const { session, degraded, note, error } = pickSession(reg.sessions, identityFrom(argv));
  if (!session) die(error ?? 'no glass session resolved — the operator clicks the Browser chip');
  if (degraded || note) console.error(JSON.stringify({ warn: note ?? 'degraded', sessionId: session.id }));
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + session.port).catch(() => null);
  if (!browser) die('CDP connect failed on port ' + session.port);
  const ctx = browser.contexts()[0];
  const dshOrigin = resolveDshBase(argv, process.env);
  return { session, browser, ctx, floorBase: base, dshOrigin };
}

export function pickByOrigin(ctx, origin) {
  const page = ctx.pages().find((p) => originOf(p.url()) === origin);
  if (!page) {
    die('no DSH tab at origin ' + origin + ' in the glass — open ' + origin +
      ' (or pass --dsh-url/--dsh-port for a second floor); refusing positional guesses (D13)');
  }
  return page;
}
