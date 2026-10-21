/**
 * api-dsh — GET /api/dsh/jobs/follow?sessionId=…&jobId=…
 *
 * The Job Follower Tab's browser face (ADR-0035 D2/D4): one text/event-stream
 * per subscribed tab. Frames (opened/output/status/error) ride as SSE `data:`
 * lines; the browser's abort closes the stream and unrefs the relay — the
 * last unsubscriber closes the host job.follow stream. Read-only by
 * construction: no POST exists on this route.
 */

import { getDshConnection } from '$lib/server/dsh-connection';
import type { DsiJobFollowEvent } from '$lib/types';

import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => {
	const jobId = url.searchParams.get('jobId') ?? '';
	const owner = url.searchParams.get('sessionId') ?? '';
	if (!jobId) {
		return new Response(JSON.stringify({ ok: false, error: { code: 'bad-job', message: 'jobId is required' } }), { status: 400 });
	}
	const relay = getDshConnection().relay;
	const encoder = new TextEncoder();
	let unsubscribe: (() => void) | null = null;
	const stream = new ReadableStream({
		start(controller) {
			const send = (event: DsiJobFollowEvent) => {
				try {
					controller.enqueue(encoder.encode('data: ' + JSON.stringify(event) + '\n\n'));
				} catch {
					// consumer gone — the cancel path unrefs
				}
			};
			unsubscribe = relay.subscribeJobFollow(owner, jobId, send);
		},
		cancel() {
			unsubscribe?.();
			unsubscribe = null;
		}
	});
	return new Response(stream, { headers: {
		'content-type': 'text/event-stream',
		'cache-control': 'no-cache',
		connection: 'keep-alive'
	} });
};
