import { describe, expect, it } from 'vitest';
import { formatRunDuration, relativeTime } from '$lib/utils/time';

describe('relativeTime', () => {
	const now = 1_800_000_000_000; // fixed clock

	it('returns "just now" under 10 seconds', () => {
		expect(relativeTime(now - 5_000, now)).toBe('just now');
	});

	it('formats seconds', () => {
		expect(relativeTime(now - 45_000, now)).toBe('45s ago');
	});

	it('formats minutes', () => {
		expect(relativeTime(now - 5 * 60_000, now)).toBe('5m ago');
	});

	it('formats hours', () => {
		expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3h ago');
	});

	it('formats days up to 6', () => {
		expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2d ago');
	});

	it('clamps future timestamps to "just now"', () => {
		expect(relativeTime(now + 30_000, now)).toBe('just now');
	});

	it('falls back to YYYY-MM-DD after a week', () => {
		expect(relativeTime(now - 8 * 86_400_000, now)).toBe('2027-01-07');
	});
});

describe('formatRunDuration (DSH formatRunDuration parity)', () => {
	it('formats sub-minute wall time as bare seconds', () => {
		expect(formatRunDuration(19_400)).toBe('19s');
		expect(formatRunDuration(0)).toBe('0s');
	});
	it('pads seconds past a minute: "2m 08s"', () => {
		expect(formatRunDuration(128_000)).toBe('2m 08s');
		expect(formatRunDuration(2 * 60_000 + 8_000)).toBe('2m 08s');
		expect(formatRunDuration(60_000)).toBe('1m 00s');
		expect(formatRunDuration(3_599_000)).toBe('59m 59s');
	});
	it('clamps negative durations to zero', () => {
		expect(formatRunDuration(-5_000)).toBe('0s');
	});
});
