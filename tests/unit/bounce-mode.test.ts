import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDevModeFromPsE, resolveBounceMode } from '../../bin/lib/dev-mode.mjs';

// D6 (In-Process Host ADR amendment): the plugin-apply bounce runs in a
// fresh CLI that cannot see the original argv — the boolean dev signal
// restored an in-process floor as PAIR mode. The mode now travels as
// DSI_DEV_MODE in the vite child env and is read back via ps -E.
const inProcessEnv = 'TERM=xterm PATH=/usr/bin DSI_DEV=1 DSI_DEV_MODE=in-process HOME=/Users/x';
const pairEnv = 'TERM=xterm PATH=/usr/bin DSI_DEV=1 DSI_DEV_MODE=pair HOME=/Users/x';

describe('parseDevModeFromPsE', () => {
  it('reads in-process from a ps -E dump', () => {
    expect(parseDevModeFromPsE(inProcessEnv)).toBe('in-process');
  });

  it('returns null for a pair floor (marker is pair, not in-process)', () => {
    expect(parseDevModeFromPsE(pairEnv)).toBeNull();
  });

  it('returns null for an empty/failed read', () => {
    expect(parseDevModeFromPsE('')).toBeNull();
    expect(parseDevModeFromPsE(undefined as unknown as string)).toBeNull();
  });

  it('does not match a substring marker (DSI_DEV_MODE_X=...)', () => {
    expect(parseDevModeFromPsE('DSI_DEV_MODE_X=in-process')).toBeNull();
  });
});

describe('resolveBounceMode (D6 priority ladder)', () => {
  it('arm 1: explicit --dev with UNREADABLE floor env → pair (legacy semantics)', () => {
    expect(resolveBounceMode({ flagDev: true, devFloorAlive: true, floorEnv: '' })).toBe('pair');
  });

  it('arm 1b (Port Takeover 2026-10-12): --dev does NOT override a recorded in-process floor — the recorded mode wins, or two hosts fight for the port', () => {
    expect(resolveBounceMode({ flagDev: true, devFloorAlive: true, floorEnv: inProcessEnv })).toBe('in-process');
  });

  it('arm 2: alive floor env says in-process → restore in-process', () => {
    expect(resolveBounceMode({ devFloorAlive: true, floorEnv: inProcessEnv })).toBe('in-process');
  });

  it('arm 3: dev floor alive, env unreadable → pair (pre-D6 behavior)', () => {
    expect(resolveBounceMode({ devFloorAlive: true, floorEnv: '' })).toBe('pair');
    expect(resolveBounceMode({ devFloorAlive: true, floorEnv: pairEnv })).toBe('pair');
  });

  it('arm 4: nothing alive → build', () => {
    expect(resolveBounceMode({})).toBe('build');
  });
});

// dsi.mjs wiring pins (the CLI executes on import — source assertions):
describe('dsi.mjs bounce wiring (source pins)', () => {
  const src = readFileSync(join(process.cwd(), 'bin', 'dsi.mjs'), 'utf-8');

  it('the bounce resolves the mode enum BEFORE killOrphans (the sweep kills the probed floor)', () => {
    const modeIdx = src.indexOf('const mode = resolveBounceMode({');
    const sweepIdx = src.indexOf('killOrphans();', modeIdx);
    expect(modeIdx).toBeGreaterThan(-1);
    expect(sweepIdx).toBeGreaterThan(modeIdx);
  });

  it('the bounce reads the floor env via readFloorEnv(devFloorPid())', () => {
    // Faithful Bounce (ADR 2026-10-13): the dump is read once and shared by
    // the mode resolver AND the inspector-flag splitter (D3).
    expect(src.includes('const floorEnvDump = readFloorEnv(devFloorPid())')).toBe(true);
    expect(src.includes('floorEnv: floorEnvDump')).toBe(true);
    expect(src.includes('parseInspectArgsFromEnv(floorEnvDump)')).toBe(true);
  });

  it('the bounce re-serves the resolved mode + inspect argv, not a boolean', () => {
    // VERDICT (2026-10-20): source is authoritative. Commit 0bc5949 (Wave 3)
    // threaded --playwright-mcp through runSyncedPair as an opts arg; the bounce
    // call site passes { playwrightMcp: false } — the bounce never invents the
    // brain. Pin updated to the W3 call shape; the boolean-era pin is stale.
    expect(src.includes('runSyncedPair([], mode, bounceExecArgv, { playwrightMcp: false })')).toBe(true);
    expect(src.includes('runSyncedPair([], dev)')).toBe(false);
  });

  it('freeFloorPorts still runs (build/pair floors keep the listener sweep)', () => {
    expect(src.includes('await freeFloorPorts(floorPortSet())')).toBe(true);
    // default contract: the production DSI ports (DSI_FLOOR_PORTS overrides for test floors)
    expect(src.includes('if (!raw) return [3080, 5174, 5175];')).toBe(true);
  });
});
