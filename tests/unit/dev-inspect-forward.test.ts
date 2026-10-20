import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractInspectArgs } from '../../bin/lib/dev-mode.mjs';

// D7 (In-Process Host ADR): --inspect rides the vite child's execArgv so ONE
// debugger sees DSI server code AND the embedded DSH host (shared heap).
// NODE_OPTIONS propagation is banned — it leaks to every child and collides
// on the default port.
describe('extractInspectArgs', () => {
  it('plain --inspect is moved out', () => {
    const r = extractInspectArgs(['--dev', 'in-process', '--inspect']);
    expect(r.rest).toEqual(['--dev', 'in-process']);
    expect(r.execArgv).toEqual(['--inspect']);
  });

  it('--inspect-brk moves out', () => {
    const r = extractInspectArgs(['--inspect-brk']);
    expect(r.rest).toEqual([]);
    expect(r.execArgv).toEqual(['--inspect-brk']);
  });

  it('--inspect=<port> keeps its value attached', () => {
    const r = extractInspectArgs(['--inspect=9230']);
    expect(r.execArgv).toEqual(['--inspect=9230']);
  });

  it('no inspector flags: rest passthrough, empty execArgv', () => {
    const r = extractInspectArgs(['--port', '3081']);
    expect(r.rest).toEqual(['--port', '3081']);
    expect(r.execArgv).toEqual([]);
  });
});

// Wiring pins on bin/dsi.mjs (CLI entry executes on import — source pins):
describe('dsi.mjs inspector wiring (source pins)', () => {
  const src = readFileSync(join(process.cwd(), 'bin', 'dsi.mjs'), 'utf-8');

  it('the vite child argv LEADS with the inspector flags (node consumes options before the script)', () => {
    expect(src.includes("[...execArgv, viteBin, 'dev'")).toBe(true);
    // VERDICT (2026-10-20): source is authoritative. 0bc5949 (Wave 3) appended
    // the opts param to startDsiDevServer so playwrightMcp rides through; the
    // argv-leads-with-inspector-flags contract ([...execArgv, viteBin, 'dev')
    // is unchanged and still pinned above.
    expect(src.includes("startDsiDevServer(uiPort, dshBase, mode, execArgv, opts)")).toBe(true);
  });

  it('inspector flags are extracted BEFORE the host spawn args', () => {
    expect(src.includes('extractInspectArgs(hostArgs0)')).toBe(true);
  });

  it('no NODE_OPTIONS injection in launcher code (comment mentions aside)', () => {
    expect(src.includes('process.env.NODE_OPTIONS')).toBe(false);
  });
});
