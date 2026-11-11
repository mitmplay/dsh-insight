#!/usr/bin/env node
// Dependency-graph extractor for DSI's Svelte tree (ADR-0018 D1/D3).
// Facts source: dev/kb/component-graph/2026-10-08 KB note; spec
// dev/specs/2026-10/2026-10-09 - Component Standard Enforcement/.
//
// Usage:
//   node scripts/dep-graph.mjs            # print summary, write tmp/dep-graph.json
//   node scripts/dep-graph.mjs --check    # exit 1 if any cross-domain component
//                                         # import is not in the frozen fixture
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, dirname, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const SRC = join(ROOT, 'src');
const FIXTURE = join(ROOT, 'tests', 'unit', 'fixtures', 'frozen-crossings.json');
const files = [];
function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(svelte|svelte\.ts|svelte\.js)$/.test(e.name)) files.push(p);
  }
}
walk(SRC);

const idOf = (p) => relative(SRC, p);
const resolveImport = (fromFile, spec) => {
  let base = null;
  if (spec.startsWith('$lib/')) base = join(SRC, spec.slice(5));
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else return null;
  const candidates = [base, base + '.svelte', base + '.ts', base + '.js',
    join(base, 'index.ts'), join(base, 'index.js'), join(base, 'index.svelte')];
  for (const c of candidates) {
    try { if (statSync(c).isFile()) return idOf(c); } catch {}
  }
  return null;
};

const graph = {};
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const id = idOf(f);
  const local = [];
  const re = /import\s+[\s\S]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const r = resolveImport(f, m[1] || m[2]);
    if (r) local.push(r);
  }
  graph[id] = { local };
}

const domain = (id) => {
  const parts = id.split('/').filter((p) => p !== 'lib');
  if (parts[0] === 'components') return parts[1] ?? '(root)';
  return parts[0];
};

const cross = [];
for (const [id, g] of Object.entries(graph)) {
  const d = domain(id);
  for (const t of g.local) {
    const rid = id.replace(/^lib\//, '');
    const rt = t.replace(/^lib\//, '');
    if (domain(t) !== d && rid.startsWith('components/') && rt.startsWith('components/')) {
      cross.push({ from: rid, fromDomain: d, toDomain: domain(t), to: rt });
    }
  }
}

// --write-fixture mode: regenerate the frozen fixture from the CURRENT
// crossings. ADR-0018: ONLY with operator sign-off (e.g. a commit-all-and-push
// instruction naming the relocation), and always update the _comment to record
// who signed off and why. Renamed/relocated components keep their crossings —
// this re-freezes the same budget at the new paths.
if (process.argv.includes('--write-fixture')) {
  const doc = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const comment = process.argv[process.argv.indexOf('--write-fixture') + 1];
  if (!comment) {
    console.error('usage: dep-graph.mjs --write-fixture "<sign-off note for _comment>"');
    process.exit(2);
  }
  doc._comment = comment;
  doc.crossings = cross.sort((a, b) => (a.from + a.to).localeCompare(b.from + b.to));
  writeFileSync(FIXTURE, JSON.stringify(doc, null, 2) + '\n');
  console.log('frozen-crossings regenerated: ' + doc.crossings.length + ' crossing(s)');
  process.exit(0);
}

// --check mode: every current crossing must appear in the frozen fixture
if (process.argv.includes('--check')) {
  if (!existsSync(FIXTURE)) {
    console.error('frozen-crossings fixture missing:', relative(ROOT, FIXTURE));
    process.exit(2);
  }
  const frozenDoc = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  const frozen = new Set((frozenDoc.crossings ?? frozenDoc).map((c) => c.from + '=>' + c.to));
  const violations = cross.filter((c) => !frozen.has(c.from + '=>' + c.to));
  if (violations.length) {
    console.error('ADR-0018 boundary violation — new cross-domain component import(s):');
    for (const v of violations) console.error('  ' + v.from + '  ->  ' + v.to);
    console.error('Rehome into the domain or common/, or regenerate the fixture ONLY with operator sign-off.');
    process.exit(1);
  }
  const retired = [...frozen].filter((k) => !cross.some((c) => c.from + '=>' + c.to === k));
  if (retired.length) {
    console.log('note: ' + retired.length + ' frozen crossing(s) no longer present (regenerate fixture to shrink the budget)');
  }
  console.log('boundary check passed: ' + cross.length + ' crossings, all frozen');
  process.exit(0);
}

const fanin = {};
for (const [, g] of Object.entries(graph)) for (const t of g.local) fanin[t] = (fanin[t] || 0) + 1;

// cycle detection (three-color DFS)
const state = {};
const stack = [];
const cycles = [];
function dfs(n) {
  state[n] = 1;
  stack.push(n);
  for (const t of graph[n].local) {
    if (!graph[t]) continue;
    if (state[t] === 1) cycles.push(stack.slice(stack.indexOf(t)).concat(t));
    else if (!state[t]) dfs(t);
  }
  stack.pop();
  state[n] = 2;
}
for (const n of Object.keys(graph)) if (!state[n]) dfs(n);

const domains = {};
for (const id of Object.keys(graph)) { const d = domain(id); domains[d] = (domains[d] || 0) + 1; }

const out = { generatedAt: new Date().toISOString(), totalFiles: files.length, domains,
  faninTop: Object.entries(fanin).sort((a, b) => b[1] - a[1]).slice(0, 25),
  fanoutTop: Object.entries(graph).map(([id, g]) => [id, g.local.length]).sort((a, b) => b[1] - a[1]).slice(0, 15),
  crossDomainCount: cross.length, crossDomain: cross,
  orphans: Object.keys(graph).filter((id) => !fanin[id] && id.startsWith('components/')),
  cycles };
writeFileSync(join(ROOT, 'tmp', 'dep-graph.json'), JSON.stringify(out, null, 2));
console.log('files:', files.length);
console.log('cross-domain imports:', cross.length, '| cycles:', cycles.length, '| orphans:', out.orphans.length);
console.log('fixture at', relative(ROOT, FIXTURE), existsSync(FIXTURE) ? 'exists' : 'MISSING — generate once with operator sign-off');
