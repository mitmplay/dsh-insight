/**
 * api-dsh — GET /api/dsh/schedule
 *
 * The Scheduler Shelf's ledger read (ADR-0058 D1/D4, W2 task 2.3): one
 * unary schedule/list through the connection's relay, normalized
 * NULL-WHEN-ABSENT. READ-ONLY over the wire — D4 forbids a mutation
 * method on this surface. The browser never reaches the DSH Host
 * directly (BC-1); wire bytes live behind dsh-connection (BC-6). The
 * relay-through seam mirrors the jobs route (getDshConnection().relay).
 */

import { json } from '@sveltejs/kit';
import { getDshConnection } from '$lib/server/dsh-connection';
import { mapRpcFailure, statusFor } from '$lib/server/dsh-rpc';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	try {
		const items = await getDshConnection().relay.listScheduledTasks();
		return json({ items });
	} catch (err) {
		return json(mapRpcFailure(err), { status: statusFor(err) });
	}
};
