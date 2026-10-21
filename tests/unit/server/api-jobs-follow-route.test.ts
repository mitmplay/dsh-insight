/**
 * api-dsh follow route tests (SUCCESS paths): GET /api/dsh/jobs/follow —
 * the SSE face of the Job Follower Tab (ADR-0035 D2/D4). Pins the
 * text/event-stream headers, the relay subscription wiring, the happy-path
 * `data:` frame shapes, and that aborting the stream unsubscribes.
 * Error/validation branches live in api-jobs-follow-route-errors.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { subscribeSpy, unsubscribeSpy } = vi.hoisted(() => ({
	subscribeSpy: vi.fn(),
	unsubscribeSpy: vi.fn()
}));

vi.mock('$lib/server/dsh-connection', () => ({
	getDshConnection: () => ({
		relay: {
			subscribeJobFollow: subscribeSpy
		}
	})
}));

import { GET } from '../../../src/routes/api/dsh/jobs/follow/+server';

function get(query: string): Response {
	return GET({ url: new URL('http://localhost/api/dsh/jobs/follow' + query) } as never) as Response;
}

async function readFrames(res: Response, count: number): Promise<string[]> {
	const reader = res.body!.getReader();
	const frames: string[] = [];
	while (frames.length < count) {
		const chunk = await reader.read();
		if (chunk.done) break;
		frames.push(new TextDecoder().decode(chunk.value));
	}
	await reader.cancel();
	return frames;
}

beforeEach(() => {
	subscribeSpy.mockReset();
	unsubscribeSpy.mockReset();
});

describe('GET /api/dsh/jobs/follow (success paths)', () => {
	it('subscribes to the relay and answers with an SSE stream', async () => {
		subscribeSpy.mockReturnValue(unsubscribeSpy);
		const res = get('?sessionId=s1&jobId=j1');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('text/event-stream');
		expect(res.headers.get('cache-control')).toBe('no-cache');
		expect(res.headers.get('connection')).toBe('keep-alive');
		expect(subscribeSpy).toHaveBeenCalledWith('s1', 'j1', expect.any(Function));
		await res.body!.cancel();
	});

	it('delivers opened/output/status frames as SSE data lines', async () => {
		let send: ((event: unknown) => void) | null = null;
		subscribeSpy.mockImplementation((_owner: string, _job: string, fn: typeof send) => {
			send = fn;
			return unsubscribeSpy;
		});
		const res = get('?sessionId=s1&jobId=j1');
		// start() runs synchronously on ReadableStream construction
		send!({ type: 'opened', jobId: 'j1' });
		send!({ type: 'output', jobId: 'j1', chunk: 'hello' });
		send!({ type: 'status', jobId: 'j1', state: 'done' });

		const frames = await readFrames(res, 3);
		expect(frames).toEqual([
			'data: ' + JSON.stringify({ type: 'opened', jobId: 'j1' }) + '\n\n',
			'data: ' + JSON.stringify({ type: 'output', jobId: 'j1', chunk: 'hello' }) + '\n\n',
			'data: ' + JSON.stringify({ type: 'status', jobId: 'j1', state: 'done' }) + '\n\n'
		]);
		for (const frame of frames) {
			expect(frame.startsWith('data: ')).toBe(true);
			expect(frame.endsWith('\n\n')).toBe(true);
			expect(() => JSON.parse(frame.slice(6))).not.toThrow();
		}
	});

	it('cancelling the stream unsubscribes exactly once', async () => {
		subscribeSpy.mockReturnValue(unsubscribeSpy);
		const res = get('?sessionId=s1&jobId=j1');
		await res.body!.cancel();
		expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
	});
});
