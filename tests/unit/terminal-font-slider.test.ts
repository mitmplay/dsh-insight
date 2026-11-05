import { describe, expect, it } from 'vitest';
import {
	TERM_FONT_DEFAULT,
	TERM_FONT_MAX,
	TERM_FONT_MIN,
	clampTermFontSize,
	defaultPanelPrefs,
	loadPanelPrefs,
	savePanelPrefs,
	type PanelPrefs
} from '$lib/utils/panel-prefs';

// ADR-0041 Amendment 4: the terminal base font is the preference NUMBER,
// zoom stays the multiplier. The clamp is the single bound site.

describe('clampTermFontSize', () => {
	it('keeps in-band values', () => {
		expect(clampTermFontSize(12)).toBe(12);
		expect(clampTermFontSize(TERM_FONT_MIN)).toBe(TERM_FONT_MIN);
		expect(clampTermFontSize(TERM_FONT_MAX)).toBe(TERM_FONT_MAX);
	});
	it('clamps out-of-band values into [8, 20]', () => {
		expect(clampTermFontSize(7)).toBe(8);
		expect(clampTermFontSize(21)).toBe(TERM_FONT_MAX);
		expect(clampTermFontSize(99)).toBe(TERM_FONT_MAX);
	});
	it('falls back to the default on junk', () => {
		expect(clampTermFontSize(undefined)).toBe(TERM_FONT_DEFAULT);
		expect(clampTermFontSize(null)).toBe(TERM_FONT_DEFAULT);
		expect(clampTermFontSize(NaN)).toBe(TERM_FONT_DEFAULT);
		expect(clampTermFontSize('14')).toBe(TERM_FONT_DEFAULT);
	});
	it('rounds fractional px', () => {
		expect(clampTermFontSize(13.6)).toBe(14);
	});
});

describe('blob round-trip', () => {
	it('saves and restores termFontSize', () => {
		const prefs = defaultPanelPrefs();
		prefs.termFontSize = 16;
		savePanelPrefs(prefs, 'fonttest');
		expect(loadPanelPrefs('fonttest').termFontSize).toBe(16);
	});
	it('defaults 12 on a legacy blob without the key', () => {
		const prefs = defaultPanelPrefs();
		const { termFontSize: _drop, ...legacy } = prefs;
		savePanelPrefs(legacy as PanelPrefs, 'fontlegacy');
		expect(loadPanelPrefs('fontlegacy').termFontSize).toBe(TERM_FONT_DEFAULT);
	});
	it('clamps junk stored values on load', () => {
		const prefs = defaultPanelPrefs();
		// junk smuggled past the type — the storage boundary is untyped JSON
		(savePanelPrefs as (p: PanelPrefs, prof: string) => void)(
			{ ...prefs, termFontSize: 99 as number },
			'fontjunk'
		);
		expect(loadPanelPrefs('fontjunk').termFontSize).toBe(TERM_FONT_MAX);
	});
});

describe('composition with zoom (ADR-0041 Am.3 formula)', () => {
	it('fontSize x zoom composes as the pocket expects', () => {
		const font = clampTermFontSize(15);
		const zoom = 0.8;
		expect(Math.round(font * zoom * 100) / 100).toBe(12);
	});
});

import { mount, unmount, flushSync } from 'svelte';
import TermFontSlider from '$lib/components/terminal/TermFontSlider.svelte';
import { readFileSync } from 'node:fs';

describe('TermFontSlider (the surface, ADR-0041 Am.4)', () => {
	function mountSlider(props: { font: number; onchange: (px: number) => void }): HTMLElement {
		const full = { label: 'terminal font size', testid: 'terminal-font-slider', ...props };
		const target = document.createElement('div');
		document.body.appendChild(target);
		const app = mount(TermFontSlider, { target, props: full });
		(document.body as any).__sliderApp = app;
		return target;
	}

	it('renders the px readout and carries the 8-20 band', () => {
		const target = mountSlider({ font: 12, onchange: () => {} });
		const readout = target.querySelector('[data-testid="terminal-font-slider-readout"]');
		expect(readout?.textContent?.trim()).toBe('12px');
		const input = target.querySelector('input[type=range]') as HTMLInputElement;
		expect(input.min).toBe('8');
		expect(input.max).toBe('20');
		expect(input.step).toBe('1');
		unmount((document.body as any).__sliderApp);
	});

	it('reports the dragged value upward as an integer px', () => {
		let got = 0;
		const target = mountSlider({ font: 12, onchange: (px) => (got = px) });
		const input = target.querySelector('input[type=range]') as HTMLInputElement;
		input.value = '15';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(got).toBe(15);
		unmount((document.body as any).__sliderApp);
	});
});

describe('placement + composition contract (source-level)', () => {
	const panelSrc = readFileSync('src/lib/components/terminal/TerminalPanel.svelte', 'utf8');
	const routeSrc = readFileSync('src/routes/+page.svelte', 'utf8');
	const deskSrc = readFileSync('src/lib/components/terminal/TerminalDesk.svelte', 'utf8');

	it('slider mounts AFTER the grow spacer in the settle-badge header row', () => {
		const rowStart = panelSrc.indexOf('terminal-settle-badge');
		const grow = panelSrc.indexOf('class="grow"', rowStart);
		const slider = panelSrc.indexOf('<TermFontSlider', rowStart);
		expect(grow).toBeGreaterThan(-1);
		expect(slider).toBeGreaterThan(grow);
	});

	it('no font literal remains in the panel — the default is the named constant', () => {
		expect(panelSrc).toContain('TERM_FONT_DEFAULT');
		expect(panelSrc).not.toMatch(/Math\.round\(12 \* /);
	});

	it('the prop chain is route to desk to panel (one authority, ADR-0041 Am.4)', () => {
		expect(routeSrc).toContain('termFontSize={pagePrefs.termFontSize}');
		expect(routeSrc).toContain('clampTermFontSize');
		expect(deskSrc).toContain('termFontSize={deskFont}');
		expect(panelSrc).toContain('font={baseFont}');
	});
});
