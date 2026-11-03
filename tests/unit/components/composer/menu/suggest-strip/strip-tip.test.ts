/**
 * StripTip unit tests — the multiline macro preview tooltip, direct
 * mounted. Pins the 2026-10-29 plain-text contract: the preview renders
 * a <pre> whose textContent preserves EVERY newline verbatim (the old
 * markdown render collapsed soft breaks and rewrote /lines into list
 * items — operator screenshot, ADR-0044 session).
 */
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';
import StripTip from '$lib/components/composer/menu/suggest-strip/StripTip.svelte';

function mountTip(text: string): { cleanup: () => void; anchor: HTMLElement } {
	const strip = document.createElement('div');
	strip.className = 'suggest-strip';
	Object.defineProperty(strip, 'getBoundingClientRect', {
		configurable: true,
		value: () => ({ left: 0, top: 20, width: 300, height: 24, right: 300, bottom: 44, x: 0, y: 20, toJSON: () => ({}) })
	});
	document.body.appendChild(strip);
	const anchor = document.createElement('button');
	strip.appendChild(anchor);
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(StripTip, { target, props: { anchor, active: true, text } });
	flushSync();
	return { cleanup: () => { unmount(instance); target.remove(); strip.remove(); }, anchor };
}

describe('StripTip — verbatim plain-text preview (2026-10-29)', () => {
	it('renders a <pre> whose textContent preserves every newline', () => {
		const text = '/new @ptc agentic-ai\n/permission danger-full-access\n/load project folder `~/x`';
		const h = mountTip(text);
		const pre = document.body.querySelector('.strip-tip pre.strip-tip-pre');
		expect(pre).not.toBeNull();
		expect(pre!.textContent).toBe(text);
		h.cleanup();
	});

	it('renders no markdown artifacts — no list items, no bullets from /lines', () => {
		const h = mountTip('/one\n/two\n/three');
		const tip = document.body.querySelector('.strip-tip');
		expect(tip?.querySelector('li, ul, ol, p, code')).toBeNull();
		expect(tip!.textContent).toBe('/one\n/two\n/three');
		h.cleanup();
	});

	it('renders the verbatim preview for a SINGLE-LINE active row too (2026-10-29 amendment: selection feedback no longer requires a newline)', () => {
		const text = 'on Glass do search on youtube `Dimas Senopati` sing `Whats up`';
		const h = mountTip(text);
		const pre = document.body.querySelector('.strip-tip pre.strip-tip-pre');
		expect(pre).not.toBeNull();
		expect(pre!.textContent).toBe(text);
		h.cleanup();
	});

	it('still hides while the row is NOT active (the active-row gate survives the amendment)', () => {
		const strip = document.createElement('div');
		strip.className = 'suggest-strip';
		Object.defineProperty(strip, 'getBoundingClientRect', {
			configurable: true,
			value: () => ({ left: 0, top: 20, width: 300, height: 24, right: 300, bottom: 44, x: 0, y: 20, toJSON: () => ({}) })
		});
		document.body.appendChild(strip);
		const anchor = document.createElement('button');
		strip.appendChild(anchor);
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(StripTip, { target, props: { anchor, active: false, text: 'single line' } });
		flushSync();
		expect(document.body.querySelector('.strip-tip')).toBeNull();
		unmount(instance);
		target.remove();
		strip.remove();
	});

	it('re-anchors when the strip MOVES without a flag change (2026-11-03: resize/scroll re-measure — the SC#1→SC#2 stale-rect bug)', () => {
		const strip = document.createElement('div');
		strip.className = 'suggest-strip';
		let rect = { left: 0, top: 20, width: 300, height: 96, right: 300, bottom: 116, x: 0, y: 20, toJSON: () => ({}) };
		Object.defineProperty(strip, 'getBoundingClientRect', { configurable: true, value: () => rect });
		document.body.appendChild(strip);
		const anchor = document.createElement('button');
		strip.appendChild(anchor);
		const target = document.createElement('div');
		document.body.appendChild(target);
		const instance = mount(StripTip, { target, props: { anchor, active: true, text: 'row' } });
		flushSync();
		const tip = () => document.body.querySelector('.strip-tip') as HTMLElement;
		expect(tip().style.top).toBe('16px');
		// The strip shrinks/moves (SC#1 → SC#2) while active stays true — the
		// tip must follow the new rect, not float at the stale one.
		rect = { ...rect, top: 80, height: 24, bottom: 104, y: 80 };
		window.dispatchEvent(new Event('resize'));
		flushSync();
		expect(tip().style.top).toBe('76px');
		unmount(instance);
		target.remove();
		strip.remove();
	});
});
