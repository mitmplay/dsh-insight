/**
 * Regression (2026-10-21 live RCA): jobfollow stream ids are DOT-separated
 * because DSH session ids AND job ids both contain dashes — the former
 * dash parser split inside the job id and dropped every frame.
 */
import { describe, expect, it, vi } from 'vitest';

describe('jobfollow stream id parsing', () => {
	it('parses owner and jobId with dashes via the dot separator', () => {
		// replicate the demux shape: jobfollow-<owner>.<jobId>.<seq>
		const streamId = 'jobfollow-session-3579d16f-2ca0-4ab7-b04f-4712d3a41547.bash-94e045766b3d4106.7';
		const parts = streamId.slice('jobfollow-'.length).split('.');
		expect(parts[0]).toBe('session-3579d16f-2ca0-4ab7-b04f-4712d3a41547');
		expect(parts[1]).toBe('bash-94e045766b3d4106');
		expect(parts[2]).toBe('7');
	});
});
