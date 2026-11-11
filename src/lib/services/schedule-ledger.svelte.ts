/**
 * Schedule ledger join (ADR-0057 Amendment 2026-11-11, D1-prime): the
 * floor's host is a pinned published release whose session headers carry
 * no origin for scheduler-born sessions, so the distinguishing fact comes
 * from the host surface the host already commits to - the schedule ledger
 * (GET /api/dsh/schedule), the same read the Scheduler Shelf renders from.
 * A session is scheduled when its id appears as a ledger targetSessionId.
 * Read-only: DSI never mutates schedules here (the Shelf is the write UI).
 * Fail-open: a failed or shape-drifted fetch yields an empty set (no
 * badges), never a wrong mark.
 */

interface ScheduleLedgerItem {
	/** Ledger row shape - only what the join needs; extra fields ignored. */
	readonly targetSessionId?: string | null;
	/** ADR-0059 T1: a delivery fact = the reserved session was born. */
	readonly lastDelivery?: { readonly deliveredAt?: string } | null;
}

const ledgerSessionIds = $state<Set<string>>(new Set<string>());
/**
 * Born map (ADR-0059 T1): targetSessionId -> lastDelivery.deliveredAt for
 * ledger rows that HAVE delivered. A present key = the host has created
 * (born) the reserved session; absence = not born (or row gone). Fail-open
 * like the id set: a failed fetch keeps the previous map.
 */
const ledgerBornAt = $state<Record<string, string>>({});
let fetchInFlight: Promise<void> | null = null;

/** Fetch the ledger once and re-derive the id set. Idempotent; concurrent
 *  calls share one request (single-flight, same contract as DshAuth.mint).
 *  Browser-only: SSR has no fetch base and no rows to mark. */
export function refreshScheduleLedger(): Promise<void> {
	if (typeof window === 'undefined') return Promise.resolve();
	fetchInFlight ??= fetch('/api/dsh/schedule')
		.then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
		.then((body: { items?: ScheduleLedgerItem[] }) => {
			const ids = new Set<string>();
			const born: Record<string, string> = {};
			for (const item of body.items ?? []) {
				const id = item?.targetSessionId;
				if (typeof id !== 'string' || id.length === 0) continue;
				ids.add(id);
				const deliveredAt = item.lastDelivery?.deliveredAt;
				if (typeof deliveredAt === 'string' && deliveredAt.length > 0) born[id] = deliveredAt;
			}
			ledgerSessionIds.clear();
			for (const id of ids) ledgerSessionIds.add(id);
			// Replace (not merge): an id that left the ledger loses its birth
			// fact - absence is the honest not-born answer (ADR-0059 prune path).
			for (const k of Object.keys(ledgerBornAt)) delete ledgerBornAt[k];
			Object.assign(ledgerBornAt, born);
		})
		.catch(() => {
			// Fail-open: keep the previous set (empty on first load) - an
			// unreachable host must not badge arbitrary rows.
		})
		.finally(() => {
			fetchInFlight = null;
		});
	return fetchInFlight;
}

/** Reactive birth read (ADR-0059 T1): when this session id was born
 *  (its schedule's lastDelivery time), or null = not born. Reads the
 *  reactive born map, so $effect callers re-run when a ledger tick lands. */
export function bornAt(sessionId: string): string | null {
	return ledgerBornAt[sessionId] ?? null;
}

/** Reactive join: is this session id born from a schedule? Reads the
 *  reactive set, so $derived callers re-run when the ledger lands. */
export function isScheduledSession(sessionId: string): boolean {
	return ledgerSessionIds.has(sessionId);
}