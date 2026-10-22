import { describe, expect, it } from 'vitest';
import { mount } from 'svelte';
import SessionStatus from '$lib/components/sessions/SessionStatus.svelte';
import { flushSync } from 'svelte';

/**
 * ADR-0037 as-built — the folded glass's glyph is the pulsing FRAME,
 * never the stream bars (operator bug 2026-10-22: the ghost row painted
 * bars). Render-level proof, not wiring proof.
 */
describe('SessionStatus — the browser variant (ADR-0037 D4)', () => {
	it('browser: renders the pulsing FRAME, zero bars', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(SessionStatus, { target, props: { running: true, browser: true } });
		flushSync();
		expect(target.querySelector('.frame')).not.toBeNull();
		expect(target.querySelectorAll('.bar')).toHaveLength(0);
		expect(target.querySelector('.status')?.classList.contains('browser')).toBe(true);
	});

	it('non-browser running: renders the BARS, zero frames — the session grammar untouched', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		mount(SessionStatus, { target, props: { running: true } });
		flushSync();
		expect(target.querySelectorAll('.bar').length).toBe(3);
		expect(target.querySelector('.frame')).toBeNull();
	});
});
