/**
 * Raw-source pin tests — glass-tab-ids Alt+N tab focus (window-level owner,
 * fix round 1: canvas focus is not how operators use the panel, so the
 * interception lives on <svelte:window>, owned exclusively there; the canvas
 * CDP relay path must NOT carry the arm). Dumb string pins per convention.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const panelSrc = readFileSync(
	join(process.cwd(), 'src', 'lib', 'components', 'browser', 'BrowserPanel.svelte'),
	'utf8'
);

describe('BrowserPanel Alt+N tab-focus pins (window-level owner)', () => {
	it('binds the interception at WINDOW level via <svelte:window onkeydown>', () => {
		expect(panelSrc).toMatch(/<svelte:window[^>]*onkeydown=\{onWindowKey\}/);
	});

	it('owns a dedicated onWindowKey handler with the Alt-digit arm', () => {
		expect(panelSrc).toMatch(/function onWindowKey\(e: KeyboardEvent\): void \{/);
		expect(panelSrc).toMatch(/function onWindowKey[\s\S]{0,600}activateTab\(/);
	});

	it('matches on event.code Digit1..Digit9, not event.key (Option remap safe)', () => {
		expect(panelSrc).toMatch(/function onWindowKey[\s\S]{0,600}\^Digit\(/);
		expect(panelSrc).not.toMatch(/e\.key\s*===\s*['"]\d['"]/);
	});

	it('guards on altKey inside the window handler', () => {
		expect(panelSrc).toMatch(/function onWindowKey[\s\S]{0,600}e\.altKey/);
	});

	it('dispatches by STRIP POSITION, not tabId, and arms Alt+0 to the LAST tab', () => {
		expect(panelSrc).toMatch(/tabs\[\s*n\s*-\s*1\s*\]/);
		expect(panelSrc).toMatch(/n\s*===\s*0[\s\S]{0,120}\.at\(-1\)|\.at\(-1\)[\s\S]{0,120}n\s*===\s*0/);
		expect(panelSrc).not.toMatch(/tabId\s*===\s*n/);
	});

	it('window handler OWNS the arm exclusively — canvas onKey has no Alt-digit branch', () => {
		// bound the slice to the onKey FUNCTION BODY — everything between
		// onKey and onWindowKey in the source is unrelated surface, and a
		// wide slice false-positives on their legit activateTab calls
		const start = panelSrc.indexOf('function onKey(');
		const nextFn = panelSrc.indexOf('function ', start + 10);
		const canvasBody = panelSrc.slice(start, nextFn > -1 ? nextFn : undefined);
		// Amended 2026-11-12 (ADR-0061 D6-D8 wave): the pin's INTENT is "the
		// canvas never carries the Alt+DIGIT arm" — the glass-selection wave
		// legitimately mentions altKey in onKey to SWALLOW Alt chords (they
		// must never dispatch as keys), which is not an arm. Pin the real
		// contract: no Digit matching and no tab activation on the canvas.
		expect(canvasBody).not.toMatch(/\^Digit\(/);
		expect(canvasBody).not.toContain('activateTab');
	});
});
