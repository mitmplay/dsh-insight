/**
 * api-workspace — GET /api/workspace/file-events?sessionId=…&root=…
 *
 * The Explorer root-freshness stream (ADR "The Silent Root" D2/D3,
 * 2026-11-12): one SSE channel per explorer panel, opened ONLY while the
 * panel is mounted and independent of the git gate (D3). Contract mirrors
 * git-events (the panel's existing ring hygiene): the FIRST event is the
 * BASELINE generation — the panel records it and ignores it; every later
 * `generation` event is a debounced ring the panel answers by deleting
 * levels[''] so the mount $effect refetches the root level. TRUTH NEVER
 * RIDES THIS STREAM — rows come from the unchanged tree routes.
 *
 * Watcher shape: a SHALLOW fs.watch(root) per connection — no recursion
 * (D2/N2), no standing interval (D4). Events coalesce through a 300 ms
 * trailing debounce so an agent writing many files costs ONE ring. Refusal
 * (bad/missing root) is plain JSON, non-stream — matching git-events'
 * gateless answer; the panel degrades to the manual world with a sticky
 * refusal. Abort (panel unmount) closes the watcher — no leak.
 */
import { statSync, watch } from 'node:fs';
import { json } from '@sveltejs/kit';

import type { RequestHandler } from './$types';

const DEBOUNCE_MS = 300;

export const GET: RequestHandler = async ({ url, request }) => {
	const sessionId = url.searchParams.get('sessionId');
	const root = url.searchParams.get('root');
	if (sessionId === null || sessionId.trim().length === 0 || root === null || root.trim().length === 0) {
		return json(
			{ ok: false, error: { code: 'bad-params', message: 'sessionId and root are required' } },
			{ status: 400 }
		);
	}

	// Refusal gate (plain JSON, not a stream — git-events' gateless shape):
	// the root must exist and be a directory. A workspace whose root was
	// deleted gets the sticky-refusal manual world, never a looping stream.
	try {
		const st = statSync(root);
		if (!st.isDirectory()) {
			return json(
				{ ok: false, error: { code: 'bad-root', message: 'root is not a directory' } },
				{ status: 400 }
			);
		}
	} catch {
		return json(
			{ ok: false, error: { code: 'bad-root', message: 'root does not exist' } },
			{ status: 400 }
		);
	}

	const encoder = new TextEncoder();
	let cleanup: () => void = () => undefined;

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			let closed = false;
			const send = (event: string, data: string): void => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode('event: ' + event + '\ndata: ' + data + '\n\n'));
				} catch {
					closed = true;
				}
			};

			let generation = 0;
			// First event after connect: the BASELINE — the panel ignores it.
			send('generation', String(generation));

			let debounceTimer: ReturnType<typeof setTimeout> | null = null;
			let watcher: ReturnType<typeof watch> | null = null;
			try {
				watcher = watch(root, { persistent: false }, () => {
					// 300 ms trailing debounce: an event storm (agent writes many
					// files) coalesces into exactly one ring per quiet window.
					if (debounceTimer !== null) clearTimeout(debounceTimer);
					debounceTimer = setTimeout(() => {
						debounceTimer = null;
						generation += 1;
						send('generation', String(generation));
					}, DEBOUNCE_MS);
				});
			} catch {
				// fs.watch refused (unsupported mount): close the stream — the
				// panel's onerror sticky-refusal path takes over (D3's manual world).
				send('event', 'unavailable');
			}

			function finish(): void {
				if (closed) return;
				closed = true;
				if (debounceTimer !== null) clearTimeout(debounceTimer);
				if (watcher !== null) watcher.close();
				try {
					controller.close();
				} catch {
					// already closed by the platform
				}
			}
			cleanup = finish;

			request.signal.addEventListener('abort', finish);
		},
		cancel() {
			cleanup();
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream; charset=utf-8',
			'cache-control': 'no-cache',
			connection: 'keep-alive',
			'x-accel-buffering': 'no'
		}
	});
};
