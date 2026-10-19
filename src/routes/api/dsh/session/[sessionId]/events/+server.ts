/**
 * api-dsh — GET /api/dsh/session/[sessionId]/events?since=N
 *
 * PollResponse: entries (DsiEntry render list), lastSeq, running — plus the
 * POC-3 W1 additive answerer fields pendingAnswers/settledAnswers (BC-E:
 * control state rides the poll, never the ledger entries).
 *
 * Wave 3 wiring: raw ring-buffer events pass through dsh-events.entryForEvent
 * (the shared mapper) before serving — the same rules as the cold load.
 */

import { json } from '@sveltejs/kit';
import { getDshConnection } from '$lib/server/dsh-connection';
import { mapRpcFailure, statusFor } from '$lib/server/dsh-rpc';
import { entryForEvent, eventsToEntries, historyToEvents } from '$lib/services/conversation/dsh-events';
import { filterKnobEvents, permissionFromProjection } from '$lib/services/conversation/permission-state';
import { imageLimitsFromProjection } from '$lib/services/conversation/image-limits';
import { todosFromProjection } from '$lib/services/conversation/todo-projection';
import { planFromProjection } from '$lib/services/conversation/plan-projection';
import { goalFromProjection } from '$lib/services/conversation/goal-projection';
import { ledgerStatsFromProjections } from '$lib/services/conversation/ledger-stats';
import { deliverablesFromEvents } from '$lib/services/conversation/deliverables';
import type { DsiEntry } from '$lib/types';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, setHeaders }) => {
	setHeaders({ 'cache-control': 'no-store' });
	const sessionId = params.sessionId;
	const sinceRaw = url.searchParams.get('since');
	const since = sinceRaw !== null && Number.isFinite(Number(sinceRaw)) ? Number(sinceRaw) : -1;

	const conn = getDshConnection();
	conn.ensureDownlinks();
	conn.subscribe(sessionId); // 0.1.2: follow stream per session
	// POC-3 W1 — deliver pending/settled answer state alongside every delta.
	// Settlements are delivered-then-pruned: the client acks via ?acked=rpcIds;
	// un-acked ones ride again next poll (at-least-once, idempotent client-side).
	const acked = url.searchParams.get('acked');
	if (acked) {
		conn.pruneSettlements(sessionId, acked.split(',').filter((id) => id.length > 0));
	}
	const pendingAnswers = conn.pendingFor(sessionId);
	const settledAnswers = conn.settlementsFor(sessionId);
	try {
		// Wave 4.2 resync: full=1 asks for the LEDGER tail (BC-4 truth), not
		// the ring-buffer delta — used by the client after a detected gap.
		if (url.searchParams.get('full') === '1') {
			const page = await conn.history(sessionId);
			const ledgerEvents = historyToEvents(page.events);
			// Ledger tail → MERGED render list (chunk fragments fold into one
			// bubble id): same rules as the cold load — a raw per-event map
			// would emit duplicate keyed entries and crash the page's each.
			const entries = eventsToEntries(ledgerEvents);
			const lastSeq = ledgerEvents.at(-1)?.seq ?? -1;
			// ADR-0007: the tail page carries the access mode twice — the host's
			// projections value (authoritative baseline) and the raw knob events
			// (the client's delta-application base). Both ride the resync.
			return json({
				ok: true,
				entries,
				lastSeq,
				running: conn.isRunning(sessionId),
				liveStream: conn.liveAssistantStream(sessionId),
				pendingAnswers,
				settledAnswers,
				permission: permissionFromProjection(page.projections?.values?.['permissions']) ?? null,
				// W4 (task 4.2): the tail's admission numbers ride the same
				// resync payload — runtime-added panels pre-flight with the
				// host's limits, not guesses.
				imageLimits: imageLimitsFromProjection(page.projections?.values?.['imageLimits']),
				todos: todosFromProjection(page.projections?.values?.['todos']),
				plan: planFromProjection(page.projections?.values?.['plan']),
				goal: goalFromProjection(page.projections?.values?.['goal']),
				// Whole-log ledger stats (statsBar 'full-ledger'): the page is
				// projection-free on this wire, so the follow/control store is
				// the seed source here too.
				ledgerStats: ledgerStatsFromProjections(
					conn.projectionValue(sessionId, 'sessionStats'),
					conn.projectionValue(sessionId, 'tokenUsage')
				),
				knobEvents: filterKnobEvents(ledgerEvents),
				// ADR-0027f D1: the full presented-file inventory rides the
				// resync beside todos — derived from RAW events because the
				// entries lane drops the (silent) type server-side.
				deliverables: deliverablesFromEvents(ledgerEvents)
			});
		}

		const { events, lastSeq, running, gap } = conn.eventsSince(sessionId, since);
		const entries: DsiEntry[] = [];
		for (const e of events) {
			const mapped = entryForEvent(e);
			if (mapped) entries.push(mapped);
		}
		// 0.1.3-alpha.1 live tail: the in-flight attempt's FULL accumulated
		// text/reasoning (null = none in flight). Served beside the durable
		// delta — the client replaces its streaming bubble wholesale.
		const liveStream = conn.liveAssistantStream(sessionId);
		// ADR-0007: the delta's raw knob events (usually empty) — the client
		// folds them into its accumulated triple; the entry mapper drops them.
		// W2 (0.1.2): the live permissions projection rides every delta too —
		// the control/follow store is fresher than any ledger read (the 0.1.2
		// ledger PAGE carries no projections block, so this delta seed is the
		// chip's baseline source).
		const permission =
			permissionFromProjection(conn.projectionValue(sessionId, 'permissions')) ?? null;
		const imageLimits = imageLimitsFromProjection(conn.projectionValue(sessionId, 'imageLimits'));
		const todos = todosFromProjection(conn.projectionValue(sessionId, 'todos'));
		const plan = planFromProjection(conn.projectionValue(sessionId, 'plan'));
		const goal = goalFromProjection(conn.projectionValue(sessionId, 'goal'));
		const ledgerStats = ledgerStatsFromProjections(
			conn.projectionValue(sessionId, 'sessionStats'),
			conn.projectionValue(sessionId, 'tokenUsage')
		);
		// ADR-0027f D1: the DELTA's deliverables events ride beside the
		// mapped entries (the type is silent in the stream; the raw lane is
		// the only carrier). The client store appends by callId.
		const deliverables = deliverablesFromEvents(events);
		return json({
			ok: true,
			entries,
			lastSeq,
			running,
			gap,
			liveStream,
			pendingAnswers,
			settledAnswers,
			...(permission === null ? {} : { permission }),
			...(imageLimits === null ? {} : { imageLimits }),
			...(todos === undefined ? {} : { todos }),
			...(plan === null ? {} : { plan }),
			...(goal === undefined ? {} : { goal }),
			...(ledgerStats === null ? {} : { ledgerStats }),
			...(deliverables.length === 0 ? {} : { deliverables }),
			knobEvents: filterKnobEvents(events)
		});
	} catch (err) {
		return json(mapRpcFailure(err), { status: statusFor(err) });
	}
};
