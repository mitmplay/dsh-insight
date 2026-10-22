import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const SCRIPT = resolve(ROOT, 'scripts/dep-graph.mjs');
const FIXTURE = resolve(ROOT, 'tests/unit/fixtures/frozen-crossings.json');

interface Crossing { from: string; to: string }

function runGraph(args: string[]): string {
  return execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8', cwd: ROOT });
}

function runGraphExpectFailure(args: string[]): number {
  try {
    execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8', cwd: ROOT });
    return 0;
  } catch (e) {
    return (e as { status?: number }).status ?? 1;
  }
}

function liveCrossings(): Crossing[] {
  runGraph([]); // writes tmp/dep-graph.json
  const g = JSON.parse(readFileSync(resolve(ROOT, 'tmp/dep-graph.json'), 'utf8'));
  // SORTED compare: the scanner's emission order follows fs-walk order
  // (it moved when RowGlassItem was deleted) — the gate pins the SET of
  // crossings, never their sequence.
  return g.crossDomain
    .map((c: Crossing) => ({ from: c.from, to: c.to }))
    .sort((a, b) => (a.from + '=>' + a.to).localeCompare(b.from + '=>' + b.to));
}

describe('dep-graph boundary gate (ADR-0018 D1)', () => {
  it('fixture holds the frozen nine, all component-to-component, distinct', () => {
    const doc = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    expect(doc.crossings).toHaveLength(20);
    for (const c of doc.crossings as Crossing[]) {
      expect(c.from).toMatch(/^components\//);
      expect(c.to).toMatch(/^components\//);
    }
    const keys = (doc.crossings as Crossing[]).map((c) => c.from + '=>' + c.to);
    expect(new Set(keys).size).toBe(20);
  });

  it('live tree matches the frozen fixture exactly (no silent drift)', () => {
    expect(liveCrossings()).toEqual([...JSON.parse(readFileSync(FIXTURE, 'utf8')).crossings].sort((a: Crossing, b: Crossing) => (a.from + '=>' + a.to).localeCompare(b.from + '=>' + b.to)));
  });

  it('--check passes when every crossing is frozen', () => {
    expect(runGraph(['--check'])).toContain('boundary check passed: 20 crossings');
  });

  it('--check exits 1 when a crossing is unfrozen', () => {
    const doc = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    const original = readFileSync(FIXTURE, 'utf8');
    try {
      writeFileSync(FIXTURE, JSON.stringify({ ...doc, crossings: doc.crossings.slice(0, 8) }, null, 2));
      expect(runGraphExpectFailure(['--check'])).toBe(1);
    } finally {
      writeFileSync(FIXTURE, original);
    }
  });
});
