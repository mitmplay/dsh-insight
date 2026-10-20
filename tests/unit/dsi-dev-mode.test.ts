import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDevArg, devModeEnv, modeFromBoolean } from '../../bin/lib/dev-mode.mjs';

const dsiRoot = join(process.cwd());

describe('parseDevArg (D4 — --dev optional value)', () => {
  it('bare --dev is pair (today\'s meaning, unchanged)', () => {
    expect(parseDevArg(['--dev'])).toEqual({ mode: 'pair', rest: [] });
  });

  it('--dev pair is pair, value consumed', () => {
    expect(parseDevArg(['--dev', 'pair'])).toEqual({ mode: 'pair', rest: [] });
  });

  it('--dev in-process is in-process, value consumed', () => {
    expect(parseDevArg(['--dev', 'in-process'])).toEqual({ mode: 'in-process', rest: [] });
  });

  it('the value NEVER reaches the host args — --port survives untouched', () => {
    const r = parseDevArg(['--dev', 'in-process', '--port', '3477', '--no-open']);
    expect(r.mode).toBe('in-process');
    expect(r.rest).toEqual(['--port', '3477', '--no-open']);
  });

  it('an unrelated token after --dev is NOT consumed (no value)', () => {
    const r = parseDevArg(['--dev', '--port', '3477']);
    expect(r.mode).toBe('pair');
    expect(r.rest).toEqual(['--port', '3477']);
  });

  it('an unknown value token after --dev is forwarded to the host, not eaten', () => {
    const r = parseDevArg(['--dev', 'wat', '--flag']);
    expect(r.mode).toBe('pair');
    expect(r.rest).toEqual(['wat', '--flag']);
  });

  it('dsi-side flags are stripped (pre-existing contract kept)', () => {
    const r = parseDevArg(['--zai', '--dev', 'in-process', '--ov', '--port', '3081']);
    expect(r.mode).toBe('in-process');
    expect(r.rest).toEqual(['--port', '3081']);
  });

  it('no --dev at all is build', () => {
    expect(parseDevArg(['--port', '3081'])).toEqual({ mode: 'build', rest: ['--port', '3081'] });
  });
});

describe('devModeEnv (D4/D6 — mode rides as env)', () => {
  it('build: no dev markers at all', () => {
    expect(devModeEnv('build')).toEqual({});
  });

  it('pair: DSI_DEV=1 + DSI_DEV_MODE=pair, NO in-process marker', () => {
    expect(devModeEnv('pair')).toEqual({ DSI_DEV: '1', DSI_DEV_MODE: 'pair' });
  });

  it('in-process: all four markers (introspect = the boot that owns the bounce handle, ADR-0025 W3)', () => {
    expect(devModeEnv('in-process')).toEqual({
      DSI_DEV: '1',
      DSI_DEV_MODE: 'in-process',
      DSI_DEV_IN_PROCESS: '1',
      DSH_HOST_INTROSPECT: '1'
    });
  });
});

describe('modeFromBoolean (bounce bridge until 3.5)', () => {
  it('true → pair, false → build', () => {
    expect(modeFromBoolean(true)).toBe('pair');
    expect(modeFromBoolean(false)).toBe('build');
  });
});

// The pair-shape contract lives inside bin/dsi.mjs, which EXECUTES on import
// (CLI entry). The unit-testable decisions were extracted to dev-mode.mjs;
// the wiring below is pinned by source assertions (find/grep discipline):
// a regression here is a one-line revert, and Wave 4's e2e boots the real
// floor to prove the shape end to end.
describe('dsi.mjs source contract (wiring pins)', () => {
  const src = readFileSync(join(dsiRoot, 'bin', 'dsi.mjs'), 'utf-8');

  it('runSyncedPair skips the host spawn in in-process mode (host: null)', () => {
    expect(src.includes("const host = inProcess ? null : spawn('/bin/sh'")).toBe(true);
  });

  it('in-process skips the 3080 preflight (host port not this CLI\'s business)', () => {
    expect(src.includes("if (inProcess) {")).toBe(true);
    expect(src.includes("await preflightPort(uiPort, 'DSI page')")).toBe(true);
  });

  it('dev server env carries devModeEnv(mode) with the playwrightMcp opt', () => {
    // VERDICT (2026-10-20): source is authoritative. 0bc5949 (Wave 3) moved the
    // playwrightMcp decision into runSyncedPair's opts; startDsiDevServer now
    // normalizes via opts.playwrightMcp === true. Pin updated to the W3 shape.
    expect(src).toContain('...devModeEnv(mode, { playwrightMcp: opts.playwrightMcp === true })');
  });

  it('the --sync path parses the mode via parseDevArg on the mcp-stripped rest, then strips inspector flags (W3.6)', () => {
    expect(src.includes('const { mode, rest: hostArgs0 } = parseDevArg(restNoMcp)')).toBe(true);
    expect(src.includes('extractInspectArgs(hostArgs0)')).toBe(true);
    // VERDICT (2026-10-20): source is authoritative — 0bc5949 (Wave 3) threads
    // the --playwright-mcp flag into runSyncedPair as opts; W3.6 inspector-strip
    // contract (extractInspectArgs on the mcp-stripped rest) is unchanged.
    expect(src.includes('runSyncedPair(hostArgs, mode, inspectExecArgv, { playwrightMcp: withPlaywrightMcp })')).toBe(true);
  });

  it('teardown tolerates a null host (in-process: vite close hook owns the host)', () => {
    expect(src.includes("if (host) host.kill('SIGTERM')")).toBe(true);
  });

  it('usage documents --dev in-process', () => {
    expect(src).toContain('--dev in-process boots the DSH host INSIDE the dev');
  });
});
