/**
 * /api/a2a/register (2026-08-25) — record one delegation at send: INSERT
 * the waiting row (server mints the id when absent) and ensure the
 * watcher runs. The composer (runMention, 3.3) calls this AFTER the
 * prompt receipt — prompt first, register second (order is the contract).
 *
 * ADR: dev/architectural-decission/2026-08-26 - The a2a Signature —
 *      Correlation IDs and the Delegation Ledger.md §6 (INSERT-at-send).
 * Spec: dev/specs/2026-08-25 - DSI a2a Signature and Delegation Ledger
 *      (Tasks 3.2/3.2-T; PRD communication map "composer → server").
 */

import { json } from '@sveltejs/kit';
import { mintA2aId } from '$lib/services/chat/a2a-protocol.js';
import { registerWatch, configureWatcher } from '$lib/server/a2a/watcher.js';
import { readA2aConfig } from '$lib/server/insight-config.js';
import { getDshConnection } from '$lib/server/dsh-connection.js';
import type { RequestHandler } from './$types';

/** Strict body validation — honest 400s, never silent guesses. */
function readBody(raw: unknown): { from: string; to: string; message: string; watermark: number; id?: string } | { error: string } {
	if (raw === null || typeof raw !== 'object') return { error: 'body must be an object' };
	const b = raw as Record<string, unknown>;
	if (typeof b.from !== 'string' || b.from === '') return { error: '"from" must be a non-empty string' };
	if (typeof b.to !== 'string' || b.to === '') return { error: '"to" must be a non-empty string' };
	if (typeof b.message !== 'string' || b.message === '') return { error: '"message" must be a non-empty string' };
	if (typeof b.watermark !== 'number' || !Number.isInteger(b.watermark)) return { error: '"watermark" must be an integer' };
	if (b.id !== undefined && (typeof b.id !== 'string' || b.id === '')) return { error: '"id" must be a non-empty string when present' };
	return {
		from: b.from,
		to: b.to,
		message: b.message,
		watermark: b.watermark,
		...(b.id !== undefined ? { id: b.id as string } : {})
	};
}

export const POST: RequestHandler = async ({ request }) => {
	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		return json({ ok: false, error: { code: 'bad-json', message: 'request body is not valid JSON' } }, { status: 400 });
	}
	const parsed = readBody(raw);
	if ('error' in parsed) {
		return json({ ok: false, error: { code: 'bad-body', message: parsed.error } }, { status: 400 });
	}
	// Server mints the id when the sender supplied none (Task 3.2 binding).
	const id = parsed.id ?? mintA2aId();
	// Watcher config sync (W4 4.1): fresh a2a.* values on every register —
	// but never over a test's explicitly injected timings. file-read errors
	// keep the defaults (the no-cache reader contract — config is a
	// convenience, never a gate).
	try {
		const cfg = readA2aConfig();
		configureWatcher({
			fastPollMs: cfg.fastPollMs,
			watchTimeoutMs: cfg.watchTimeoutMs,
			retentionDays: cfg.retentionDays
		});
	} catch {
		// Reader blew up — defaults stand.
	}
	// Seq-watermark fallback (2026-08-25 bug fix): live hosts ship no
	// `sessionStats.turns`, so a spine watermark of -1 is the NORM, not the
	// exception — the row would ride a degrade lane whose gate
	// (updatedAt/running) never moves host-side either. Capture what
	// provably moves: the target LEDGER's newest event seq. One history
	// read at register; any assistant reply after it carries a higher seq.
	// A failed read leaves watermark_seq NULL — the honest deadline owns
	// the row (never a silent guess).
	let watermarkSeq: number | null = null;
	if (parsed.watermark < 0) {
		try {
			const page = await getDshConnection().history(parsed.to);
			const events = page.events ?? [];
			watermarkSeq = events.length > 0 ? events[events.length - 1].event.seq : -1;
		} catch {
			watermarkSeq = null;
		}
	}
	registerWatch({
		id,
		fromSession: parsed.from,
		toSession: parsed.to,
		message: parsed.message,
		watermarkTurn: parsed.watermark,
		watermarkSeq,
		sentAt: Date.now()
	});
	return json({ ok: true, id });
};
