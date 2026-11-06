/**
 * ChordPalette coverage (Chord Palette 2026-10-31, Tasks 3.1-T + round-2
 * D18): the armed chord's face is a PURE VIEW — renders only while open,
 * mirrors the rows it is given, holds no key logic. Round 2 adds the
 * centered placement and the 10s decay clock (green action phase under
 * 2s, yellow after, onexpire at 100%).
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChordPalette from '$lib/components/panels/ChordPalette.svelte';

function render(props: {
	open: boolean;
	rows: { key: string; label: string }[];
	since?: number;
	onexpire?: () => void;
}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(ChordPalette, {
		target,
		props: { since: Date.now(), prefix: 's' as const, onexpire: () => {}, ...props }
	});
	flushSync();
	return { target, unmount: () => unmount(comp) };
}
const rows = (t: HTMLElement) => t.querySelectorAll('[data-testid="chord-palette-row"]');

describe('ChordPalette (pure view, D16)', () => {
	it('renders nothing while closed', () => {
		const { target, unmount } = render({ open: false, rows: [{ key: 'b', label: 'Close all glass browsers' }] });
		expect(target.querySelector('[data-testid="chord-palette"]')).toBeNull();
		unmount();
	});

	it('renders one row per live option while open, key + label surfaced', () => {
		const { target, unmount } = render({
			open: true,
			rows: [
				{ key: '2', label: 'Width preset 2' },
				{ key: 'b', label: 'Close all glass browsers' },
				{ key: 't', label: 'Toggle terminal' }
			]
		});
		expect(rows(target)).toHaveLength(3);
		expect([...rows(target)].map((r) => r.getAttribute('data-chord-key'))).toEqual(['2', 'b', 't']);
		expect(target.querySelector('[data-testid="chord-palette"]')).toBeTruthy();
		expect(rows(target)[1].textContent).toContain('Close all glass browsers');
		unmount();
	});

	it('an empty live list still renders the armed surface (reducer owns dismissal)', () => {
		const { target, unmount } = render({ open: true, rows: [] });
		expect(target.querySelector('[data-testid="chord-palette"]')).toBeTruthy();
		expect(rows(target)).toHaveLength(0);
		unmount();
	});
});

describe('ChordPalette decay clock (D18)', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('progress bar sits in the action phase (pastel-green) under 2s', () => {
		const since = Date.now();
		const { target, unmount } = render({ open: true, rows: [], since });
		vi.advanceTimersByTime(1000);
		flushSync();
		const bar = target.querySelector('[data-testid="chord-palette-progress"]');
		expect(bar?.getAttribute('data-chord-phase')).toBe('action');
		const w = Number(/([\d.]+)%/.exec(bar?.getAttribute('style') ?? '')?.[1] ?? 0);
		expect(w).toBeGreaterThan(0);
		expect(w).toBeLessThan(50);
		unmount();
	});

	it('flips to the idle phase (pastel-yellow) after the 2s chord window', () => {
		const since = Date.now();
		const { target, unmount } = render({ open: true, rows: [], since });
		vi.advanceTimersByTime(3500);
		flushSync();
		flushSync();
		expect(target.querySelector('[data-testid="chord-palette-progress"]')?.getAttribute('data-chord-phase')).toBe('idle');
		unmount();
	});


	it('a zero/falsy since falls back to Date.now() (branch cover)', () => {
		const { target, unmount } = render({ open: true, rows: [], since: 0 });
		const bar = target.querySelector('[data-testid="chord-palette-progress"]');
		expect(bar?.getAttribute('data-chord-phase')).toBe('action');
		const w = Number(/([\d.]+)%/.exec(bar?.getAttribute('style') ?? '')?.[1] ?? 0);
		expect(w).toBeLessThanOrEqual(1);
		unmount();
	});

	it('clamps a future since (negative elapsed) to zero via Math.max', () => {
		const since = Date.now() + 5000;
		const { target, unmount } = render({ open: true, rows: [], since });
		const bar = target.querySelector('[data-testid="chord-palette-progress"]');
		expect(target.querySelector('[data-testid="chord-palette"]')?.getAttribute('data-chord-elapsed')).toBe('0');
		expect(bar?.getAttribute('data-chord-phase')).toBe('action');
		const w = Number(/([\d.]+)%/.exec(bar?.getAttribute('style') ?? '')?.[1] ?? 0);
		expect(w).toBeLessThanOrEqual(1);
		unmount();
	});

	it('fires onexpire at the 10s mark; a closed palette never fires', () => {
		const onexpire = vi.fn();
		const since = Date.now();
		const { unmount } = render({ open: true, rows: [], since, onexpire });
		vi.advanceTimersByTime(9900);
		flushSync();
		expect(onexpire).not.toHaveBeenCalled();
		vi.advanceTimersByTime(200);
		flushSync();
		expect(onexpire).toHaveBeenCalledTimes(1);
		unmount();
		const closed = render({ open: false, rows: [], since, onexpire });
		vi.advanceTimersByTime(15000);
		expect(onexpire).toHaveBeenCalledTimes(1);
		expect(closed.target.querySelector('[data-testid="chord-palette"]')).toBeNull();
		closed.unmount();
	});
});
