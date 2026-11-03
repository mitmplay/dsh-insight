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

const DSI = 'http://127.0.0.1:5175';

export function die(msg) {
  console.error(JSON.stringify({ error: msg, fallback: 'SKILL.md Step 1 — ask the OPERATOR to click the Browser chip IN THE RIGHT CONVERSATION, then catch the session via GET /api/browser. If DSH_SESSION_ID is absent from env, pass --owner-session <id> (the session id you already know from context).' }));
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

export async function connect() {
  let reg;
  try {
    reg = await (await fetch(DSI + '/api/browser')).json();
  } catch {
    die('DSI dev server not reachable on 5175 — floor not up (dsi dsh --sync --dev --playwright-mcp)');
  }
  const { session, degraded, note, error } = pickSession(reg.sessions, identityFrom(process.argv));
  if (!session) die(error ?? 'no glass session resolved — operator must click the Browser chip');
  if (degraded || note) console.error(JSON.stringify({ warn: note ?? 'degraded', sessionId: session.id }));
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + session.port).catch(() => null);
  if (!browser) die('CDP connect failed on port ' + session.port);
  return { session, browser, ctx: browser.contexts()[0] };
}

export function pick(ctx, substr) {
  return ctx.pages().find((p) => p.url().includes(substr));
}
