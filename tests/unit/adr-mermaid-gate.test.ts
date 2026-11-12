/**
 * ADR gate — every mermaid block in dev/architectural-decission must parse.
 *
 * Why a gate and not author discipline: hand-written mermaid fails by instinct
 * (semicolons inside message text are statement separators — The Frozen Roster
 * shipped two before this gate existed). The skill's rule "validate every
 * mermaid block parses (e.g. mermaid.parse) before claiming done" is enforced
 * here mechanically, so following it is the path of least resistance.
 *
 * Scope: every markdown file in the dev/architectural-decission tree — ADRs and their amendments.
 * Runs in the normal vitest suite; no separate invocation to remember.
 */
import { describe, it, expect } from 'vitest';
// @vitest-environment happy-dom
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function adrFiles(dir: string, acc: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const p = join(dir, entry);
		if (statSync(p).isDirectory()) adrFiles(p, acc);
		else if (p.endsWith('.md')) acc.push(p);
	}
	return acc;
}

const ADR_DIR = join(process.cwd(), 'dev', 'architectural-decission');

describe('ADR gate — mermaid blocks parse (dev/architectural-decission)', () => {
	// Parsing 270+ blocks after a lazy mermaid import lands at 2-4s standalone;
	// the default 5s timeout makes this flake when the full suite runs in parallel.
	it('every mermaid block in every ADR parses clean', { timeout: 30_000 }, async () => {
		const mermaid = (await import('mermaid')).default;
		mermaid.initialize({ startOnLoad: false });
		const files = adrFiles(ADR_DIR);
		expect(files.length).toBeGreaterThan(0);
		const failures: string[] = [];
		for (const file of files) {
			const doc = readFileSync(file, 'utf-8');
			const blocks = [...doc.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1]);
			for (const [i, block] of blocks.entries()) {
				try {
					await mermaid.parse(block);
				} catch (err) {
					failures.push(`${file} block #${i + 1}: ${(err as Error).message.split('\n')[0]}`);
				}
			}
		}
		expect(failures, failures.join('\n')).toEqual([]);
	});
});
