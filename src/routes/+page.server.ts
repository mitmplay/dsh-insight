/**
 * Conversation route — cold load (BC-4: the LEDGER is the truth).
 *
 * session.history via the connection singleton → DsiEntry render list through
 * dsh-events.eventsToEntries. 404 when the host says session/not-found; 409 on
 * a subagent-ownership rejection (the host answered — the child opens through
 * its parent); blank sessions render an empty transcript (empty entries, not
 * an error); host unreachable → 503 page with retry context.
 */

import { error } from '@sveltejs/kit';
import { getDshConnection } from '$lib/server/dsh-connection';
import { DshRpcError, isSubagentRejection } from '$lib/server/dsh-rpc';
import { eventsToEntries, historyToEvents } from '$lib/services/conversation/dsh-events';
import { filterKnobEvents, permissionFromProjection, type DsiPermission } from '$lib/services/conversation/permission-state';
import type { DshRawEvent } from '$lib/services/conversation/dsh-events';
import { imageLimitsFromProjection, type DsiImageLimits } from '$lib/services/conversation/image-limits';
import { deliverablesFromEvents, type PresentedDelivery } from '$lib/services/conversation/deliverables';
import type { DsiEntry } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	// Seed key — the ?sessionKey= query (one-shot deep link, ADR-0006 R1).
	const sessionKeyRaw = url.searchParams.get('sessionKey');
	const sessionId = sessionKeyRaw !== null && sessionKeyRaw.length > 0 ? sessionKeyRaw : undefined;

	// Panel Floor W3 (task 3.1, GAP-7): the param is ABSENT on a bare
	// / arrival — no seed, no host call. The workspace
	// restores from localStorage client-side; the load stays empty so
	// refresh-restore never pays a wasted RPC (and never 404s).
	if (sessionId === undefined) return {};

	let historyEvents;
	let ledgerHasMore = false;
	let ledgerTitle: string | null = null;
	// ADR-0007: the access mode rides the SAME tail page — the host's
	// projections value (authoritative baseline) + the raw knob events
	// (the client's delta-application base).
	let permission: DsiPermission | null = null;
	/** W4: host admission numbers from the tail projections (null → defaults). */
	let imageLimits: DsiImageLimits | null = null;
	/** The tail page's own projections block (0.1.1-shaped fallback — the
	 *  0.1.2 page carries none; the live baseline below is the seed). */
	let tailProjections: Record<string, unknown> = {};
	let knobEvents: DshRawEvent[] = [];
	/** The session's presented-file inventory (ADR-0027f D1 cold seed). */
	let deliverables: PresentedDelivery[] = [];
	try {
		const historyPage = await getDshConnection().history(sessionId);
		historyEvents = historyPage.events;
		ledgerHasMore = historyPage.hasMore === true;
		tailProjections = historyPage.projections?.values ?? {};
		// POC-3 W3 (3.1): the tail page's projections block carries the session
		// title (present when the deployment mounts the projection registry) —
		// the header rename control's seed. Ledger truth, read once at cold load.
		const title = historyPage.projections?.values?.['title'];
		ledgerTitle = typeof title === 'string' && title.length > 0 ? title : null;
		permission = permissionFromProjection(historyPage.projections?.values?.['permissions']) ?? null;
		// W4 (task 4.2): the same tail block carries the host's admission
		// numbers — the composer's pre-flight reads them (BC-A6); null when
		// absent (older host) → the service's documented defaults.
		imageLimits = imageLimitsFromProjection(historyPage.projections?.values?.['imageLimits']);
		knobEvents = filterKnobEvents(historyToEvents(historyPage.events));
		// ADR-0027f D1: the presented-file inventory derived from the RAW
		// ledger events (the entries lane drops the silent type) — the
		// DeliverablesButton's cold seed.
		deliverables = deliverablesFromEvents(historyToEvents(historyPage.events));
	} catch (err) {
		if (err instanceof DshRpcError && err.code === 'session/not-found') {
			error(404, { message: `Session ${sessionId} not found on the DSH host.` });
		}
		// Subagent-ownership rejections mean the host ANSWERED: the session is
		// a spawned child and the address form or ownership is the problem —
		// a 409 with the host's own words, never "cannot reach the host".
		if (isSubagentRejection(err)) {
			error(409, {
				message: `Session ${sessionId} is a harness sub-agent owned by subagent routing — it opens through its durable parent session. (${err.message})`
			});
		}
		// Host unreachable / other transport failure — surface a distinct page state.
		error(503, {
			message:
				err instanceof Error
					? `Cannot reach the DSH host for session history: ${err.message}`
					: 'Cannot reach the DSH host for session history.'
		});
	}

	const entries: DsiEntry[] = eventsToEntries(historyToEvents(historyEvents));

	// Latest known state for the first paint: the buffer's truth if it has one,
	// else the ledger tail (buffer = freshness only, ledger = truth — BC-4).
	const conn = getDshConnection();
	conn.ensureDownlinks();
	conn.subscribe(sessionId); // 0.1.2: follow stream per session
	// 0.1.2: the cold page's access mode + admission numbers come from the
	// LIVE projection baseline (session/page carries no projections block) —
	// bounded wait for the baseline that subscribe just opened; an absent
	// block falls back to the (0.1.1-shaped) tail page's own projections.
	const liveBlock = await conn.waitForProjections(sessionId).catch(() => null);
	const projectionValues = liveBlock?.values ?? tailProjections;
	const lastLedgerSeq = historyEvents.at(-1)?.event.seq ?? -1;
	permission = permissionFromProjection(projectionValues['permissions']) ?? permission;
	imageLimits = imageLimitsFromProjection(projectionValues['imageLimits']) ?? imageLimits;
	const running = conn.isRunning(sessionId);

	// POC-2 W3: the ledger page's hasMore drives the load-older sentinel — the
	// cold load's tail page already knows whether older history exists.

	// Workspace (cwd) + agent preset of THIS session, for the header's
	// chips — session.list rows carry both (the agent retires from the
	// URL into the session row, ADR-0006 R3). Best-effort: a missing row
	// (or a failed list) hides the chips, never blocks the page (history
	// already loaded).
	let workspace: string | null = null;
	let agentPreset: string | null = null;
	try {
		const rows = await conn.listSessions();
		const row = rows.items.find((r) => r.sessionId === sessionId);
		workspace = row?.workspace ?? null;
		agentPreset = row?.agentPreset ?? null;
	} catch {
		workspace = null;
		agentPreset = null;
	}

	return {
		sessionId,
		title: ledgerTitle,
		workspace,
		agentPreset,
		permission,
		imageLimits,
		knobEvents,
		deliverables,
		entries,
		lastSeq: Math.max(lastLedgerSeq, -1),
		running,
		hasMore: ledgerHasMore
	};
};
