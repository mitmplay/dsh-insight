/**
 * ChordPaletteOverlay — floor arm (coverage headroom, 2026-11-23): the
 * decay clock's falsy-since fallback, source L51
 * `open ? Math.max(0, Math.min(now - (since || Date.now()), idleCloseMs)) : 0`.
 *
 * The sibling suite (chord-palette-overlay.test.ts) always passes a real
 * timestamp, so the `Date.now()` arm never ran. Pinned: a FALSY since (0 —
 * a missing arming stamp) never reads as instantly expired — the clock
 * starts at NOW: elapsed 0 / width 0% / in-action phase at mount and NO
 * onexpire. Without the arm, `now - 0` clamps to idleCloseMs and the
 * overlay expires at mount. A fake clock (vi.setSystemTime) keeps
 * Date.now() deterministic.
 *
 * KNOWN QUIRK (characterized below, reported to the lead 2026-11-23): the
 * fallback is evaluated INSIDE the derived, so with a falsy since it
 * re-anchors on every tick — `now - Date.now()` is ~0 forever, the bar
 * stays at 0% and onexpire NEVER fires. The second test pins that current
 * behavior so a fix (anchor once, then decay) flips it deliberately.
 *
 * NOT forced (reported to the lead): the progress div's compiler fallbacks
 * `barColor ?? ''` (L92; barColor is a ternary of two string literals, L65)
 * and `pct ?? ''` (L93; pct is Math.round(...) — a number, never nullish).
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChordPaletteOverlay from '../../src/components/ChordPaletteOverlay.svelte';

const T0 = Date.parse('2026-11-23T12:00:00Z');

function mountOverlay(props: { since: number; windowMs: number; idleCloseMs: number; onexpire?: () => void }) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(ChordPaletteOverlay, {
		target,
		props: {
			open: true,
			rows: [{ key: 'd', label: 'Done' }],
			since: props.since,
			windowMs: props.windowMs,
			idleCloseMs: props.idleCloseMs,
			title: 'ALT+S',
			ariaLabel: 'Chord armed: Alt S',
			...(props.onexpire ? { onexpire: props.onexpire } : {})
		}
	});
	flushSync();
	return { target, instance };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(T0);
});

afterEach(() => {
	vi.useRealTimers();
	document.body.innerHTML = '';
});

describe('ChordPaletteOverlay — falsy since (L51 `since || Date.now()` arm)', () => {
	it('since=0 starts the clock at NOW — never reads as already-expired at mount', () => {
		const onexpire = vi.fn();
		const { target, instance } = mountOverlay({ since: 0, windowMs: 2000, idleCloseMs: 500, onexpire });
		const overlay = target.querySelector('[data-testid="chord-palette"]') as HTMLElement;
		const bar = target.querySelector('[data-testid="chord-palette-progress"]') as HTMLElement;
		// Without the arm, `now - 0` clamps to idleCloseMs: elapsed would read
		// 500 and onexpire would already have fired.
		expect(overlay.getAttribute('data-chord-elapsed')).toBe('0');
		expect(bar.style.width).toBe('0%');
		expect(bar.getAttribute('data-chord-phase')).toBe('action');
		expect(onexpire).not.toHaveBeenCalled();
		unmount(instance);
	});

	it('KNOWN QUIRK: the fallback re-anchors every tick — elapsed stays 0 and onexpire never fires', () => {
		const onexpire = vi.fn();
		const { target, instance } = mountOverlay({ since: 0, windowMs: 2000, idleCloseMs: 500, onexpire });
		vi.advanceTimersByTime(600); // six 100ms ticks — well past the 500ms idle window
		flushSync();
		// The derived re-reads Date.now() on every tick, so `now - Date.now()`
		// stays ~0: the clock never advances while since is falsy.
		expect((target.querySelector('[data-testid="chord-palette"]') as HTMLElement).getAttribute('data-chord-elapsed')).toBe('0');
		expect(onexpire).not.toHaveBeenCalled();
		unmount(instance);
	});
});
