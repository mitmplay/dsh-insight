#!/usr/bin/env node
/**
 * probe-dsh.mjs — Gates 0–2 of the glass-dsh skill: console baseline + crash scan.
 * Reloads the DSH tab, arms a console listener, and emits ONE JSON verdict.
 * Evidence over presence: `slot entry crashed in '<slot>'` naming the plugin is
 * an automatic FAIL (D14) even when everything else looks fine.
 *
 * Usage (from the DSI repo root):
 *   node skills/glass-dsh/scripts/probe-dsh.mjs [--expect '<selector>'] [--store '<localStorageKey>']
 *       [--plugin-id '<plugin id>'] [--dsh-url|--dsh-port|--owner-session]
 *
 * Emits: { dshOrigin, url, moduleLoader, expectPresent?, storeRaw?,
 *          consoleErrors, crashedSlots, pass }
 * pass=false when a crashedSlot matches --plugin-id (or any crash, if no id given).
 */
import { connect, pickByOrigin } from './_connect.mjs';

const argv = process.argv.slice(2);
function opt(name) {
  const i = argv.indexOf(name);
  return i !== -1 ? argv[i + 1] : undefined;
}
const expectSel = opt('--expect');
const storeKey = opt('--store');
const pluginId = opt('--plugin-id');

const { ctx, dshOrigin } = await connect(argv);
const page = pickByOrigin(ctx, dshOrigin);

const errors = [];
const onConsole = (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 500)); };
page.on('console', onConsole);

await page.reload({ waitUntil: 'networkidle' }).catch(() => {});
await new Promise((r) => setTimeout(r, 2500));

const probe = await page.evaluate(({ expectSel, storeKey }) => {
  const el = expectSel ? document.querySelector(expectSel) : null;
  return {
    moduleLoader: typeof window.__ModuleLoader__ !== 'undefined' && typeof window.__ModuleLoader__.load === 'function',
    expectPresent: expectSel ? !!el : undefined,
    expectText: el && expectSel ? (el.textContent || '').slice(0, 80) : undefined,
    storeRaw: storeKey ? window.localStorage.getItem(storeKey) : undefined,
  };
}, { expectSel, storeKey });

page.off('console', onConsole);

const crashedSlots = errors
  .filter((t) => t.includes("slot entry crashed in '"))
  .map((t) => {
    const slot = t.split("slot entry crashed in '")[1]?.split("'")[0] ?? '?';
    return { slot, text: t };
  });
const relevant = crashedSlots.filter((c) => !pluginId || c.text.includes(pluginId));
const pass = relevant.length === 0 && errors.length === 0;

console.log(JSON.stringify({ dshOrigin, url: page.url(), ...probe, consoleErrors: errors, crashedSlots, pass }));
process.exit(0);
