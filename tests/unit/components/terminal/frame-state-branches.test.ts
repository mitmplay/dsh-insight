/**
 * frame-state branch sweep — completes the coverage pins for the pure
 * reducer the TerminalPanel projects (Wave 4). terminal-panel.test.ts
 * carries the settled / closed / error arms; this file hits the ones that
 * test leaves open: the exit frame is ignored, the close ladder's
 * non-quiescent arm, and the post-close freeze for every late frame kind.
 */
import { describe, expect, it } from 'vitest';

import {
	initialTerminalPanelState,
	reduceTerminalFrame
} from '$lib/components/terminal/frame-state.js';

describe('frame-state reducer — uncovered branches', () => {
	it('an exit frame never changes the state — xterm owns the exit view', () => {
		const s = reduceTerminalFrame(initialTerminalPanelState, {
			event: 'exit',
			outcome: { exitCode: 0, signal: null }
		});
		expect(s).toBe(initialTerminalPanelState);
	});

	it('a closed frame records quiescence=false on the non-quiescent ladder arm', () => {
		const s = reduceTerminalFrame(initialTerminalPanelState, {
			event: 'closed',
			quiescent: false,
			lingeringPids: [4242]
		});
		expect(s).toEqual({
			lastSettle: null,
			closed: true,
			quiescent: false,
			errored: false
		});
	});

	it('after close, error frames are frozen out too — not just settled', () => {
		let s = reduceTerminalFrame(initialTerminalPanelState, {
			event: 'closed',
			quiescent: true
		});
		s = reduceTerminalFrame(s, { event: 'error', error: 'STREAM_DIED' });
		expect(s).toMatchObject({ closed: true, errored: false });
	});

	it('after close, exit frames are frozen out too', () => {
		let s = reduceTerminalFrame(initialTerminalPanelState, {
			event: 'closed',
			quiescent: true
		});
		s = reduceTerminalFrame(s, {
			event: 'exit',
			outcome: { exitCode: 1, signal: 'SIGKILL' }
		});
		expect(s.quiescent).toBe(true);
	});
});
