import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { reaperEligible } from '../../src/lib/server/browser/registry.js';

// Task 1.2-T — the lifecycle contract after The Headed Downgrade
// (ADR-0047 retirement amendment): a headed disposable glass is reaped and
// killed exactly like any glass — per today-for-today, no exemptions.

const src = readFileSync('src/lib/server/browser/registry.ts', 'utf8');

describe('headed lifecycle (task 1.2-T)', () => {
	const now = 1_000_000;

	it('a dead-signal entry is reaper-eligible regardless of the headed flag — headed glasses are reaped like any glass', () => {
		// the flag rides a REAL entry shape — typed wide on purpose: the
		// reaper must ignore it, not read it
		const headedEntry = { streamSubscribers: 0, lastMcpActivity: 0, headedOpen: true } as { streamSubscribers: number; lastMcpActivity: number };
		expect(reaperEligible(headedEntry, 60_000, now)).toBe(true);
	});

	it('a plain dead-signal entry stays eligible (unchanged)', () => {
		expect(reaperEligible({ streamSubscribers: 0, lastMcpActivity: 0 }, 60_000, now)).toBe(true);
	});

	it('live traffic keeps any entry immune (unchanged)', () => {
		const liveHeaded = { streamSubscribers: 2, lastMcpActivity: now, headedOpen: true } as { streamSubscribers: number; lastMcpActivity: number };
		expect(reaperEligible(liveHeaded, 60_000, now)).toBe(false);
	});

	it('the reaper has NO borrowed exemption branch left; close has NO detach branch left', () => {
		// zero-CODE-reference gate: the word may survive only in RCA audit-trail
		// comments; no identifier, call, or branch may carry it.
		const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
		expect(code).not.toMatch(/borrow/i);
		// the detach path (close without context.close()) is gone — every
		// close kills the context and deletes the disposable dir
		expect(src).toContain('await entry.context.close()');
		expect(src).not.toContain("DETACH, DON'T KILL");
	});
});
