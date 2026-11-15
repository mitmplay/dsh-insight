import { flushSync, mount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChordPaletteOverlay from '../../src/components/ChordPaletteOverlay.svelte';

function mountOverlay(props: {
	open?: boolean;
	rows?: { key: string; label: string }[];
	since?: number;
	windowMs?: number;
	idleCloseMs?: number;
	onexpire?: () => void;
} = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(ChordPaletteOverlay, {
		target,
		props: {
			open: props.open ?? true,
			rows: props.rows ?? [
				{ key: 'd', label: 'Done' },
				{ key: 'x', label: 'Close' }
			],
			since: props.since ?? Date.now(),
			windowMs: props.windowMs ?? 2000,
			...(props.idleCloseMs !== undefined ? { idleCloseMs: props.idleCloseMs } : {}),
			title: 'ALT+S',
			ariaLabel: 'Chord armed: Alt S',
			...(props.onexpire ? { onexpire: props.onexpire } : {})
		}
	});
	flushSync();
	return { target, instance };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('ChordPaletteOverlay — show/hide + countdown (W4 4.6-T)', () => {
	it('closed renders nothing (no overlay, no ticker)', () => {
		const { target } = mountOverlay({ open: false });
		expect(target.querySelector('[data-testid="chord-palette"]')).toBeNull();
	});

	it('open renders rows with key + consumer label; the overlay names the armed prefix via props', () => {
		const { target } = mountOverlay();
		expect(target.querySelector('[data-testid="chord-palette"]')).not.toBeNull();
		const rowKeys = Array.from(target.querySelectorAll('[data-testid="chord-palette-row"]')).map(
			(el) => el.getAttribute('data-chord-key')
		);
		expect(rowKeys).toEqual(['d', 'x']);
		expect(target.textContent).toContain('Done');
		expect(target.querySelector('[data-testid="chord-palette"]')?.getAttribute('aria-label')).toBe('Chord armed: Alt S');
		expect(target.textContent).toContain('ALT+S');
	});

	it('the overlay holds NO armed state: closing is the host\'s plain open=false', () => {
		// the face is a pure function of the open prop — a fresh mount with
		// open=false is the closed state, no internal reset ritual involved
		const { target } = mountOverlay({ open: false });
		expect(target.querySelector('[data-testid="chord-palette"]')).toBeNull();
	});

	it('decay progress: phase rides windowMs — inside the window action, past it idle', () => {
		const since = Date.now() - 1500;
		const { target } = mountOverlay({ since, windowMs: 2000 });
		const bar = target.querySelector<HTMLElement>('[data-testid="chord-palette-progress"]');
		expect(bar?.getAttribute('data-chord-phase')).toBe('action');
		// same elapsed against a 1000ms window reads idle
		const target2 = document.createElement('div');
		document.body.appendChild(target2);
		mount(ChordPaletteOverlay, {
			target: target2,
			props: { open: true, rows: [{ key: 'd', label: 'Done' }], since, windowMs: 1000, title: 'T', ariaLabel: 'A' }
		});
		flushSync();
		expect(
			target2.querySelector<HTMLElement>('[data-testid="chord-palette-progress"]')?.getAttribute('data-chord-phase')
		).toBe('idle');
	});

	it('fires onexpire ONCE at 100% of idleCloseMs', () => {
		vi.useFakeTimers();
		const onexpire = vi.fn();
		const since = Date.now();
		mountOverlay({ since, idleCloseMs: 500, onexpire });
		vi.advanceTimersByTime(1200);
		flushSync(); // effects flush after the mocked ticks
		expect(onexpire).toHaveBeenCalledTimes(1);
		vi.useRealTimers();
	});
});
