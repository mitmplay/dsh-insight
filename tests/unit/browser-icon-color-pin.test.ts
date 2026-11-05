/**
 * Raw-source pin tests — glass-tab-ids icon-color unification (2026-10-28,
 * operator-approved): every icon in the Glass Browser panel follows ONE
 * color grammar — var(--color-accent-purple) — via a rule scoped to the
 * panel root (glass-browser-icons), never a global bare svg rule. The
 * zoom slider carries the same token. Deliberately dumb string pins.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(process.cwd(), 'src', 'lib', 'components', 'browser');
// Buttons extraction: BrowserClosed (and the other header glyphs) moved
// to ROOT/buttons/ (BrowserHeader imports './buttons/BrowserClosed.svelte').
const BUTTONS = join(ROOT, 'buttons');
const panelSrc = readFileSync(join(ROOT, 'BrowserPanel.svelte'), 'utf8');
const closedSrc = readFileSync(join(BUTTONS, 'BrowserClosed.svelte'), 'utf8');
const headerSrc = readFileSync(join(ROOT, 'BrowserHeader.svelte'), 'utf8');

describe('Glass Browser icon color grammar (glass-tab-ids)', () => {
	it('scopes the svg accent rule to the panel root, no global leak', () => {
		expect(panelSrc).toContain('glass-browser-icons');
		expect(panelSrc).toMatch(
			/\.glass-browser-icons\s+:global\(svg\)\s*\{[^}]*color:\s*var\(--color-accent-purple\)/
		);
		// never a bare unscoped svg rule
		expect(panelSrc).not.toMatch(/^\tsvg\s*\{/m);
	});

	it('paints the trash svg via currentColor so the accent rule reaches it', () => {
		expect(closedSrc).toContain('stroke="currentColor"');
		expect(closedSrc).not.toContain('stroke="red"');
	});

	it('binds the zoom slider to the same accent token', () => {
		// ZoomSlider extraction (2026-11-02): the slider — and its accent
		// token — live in the component; the panel mounts it.
		// 2026-11-05: the mount moved panel → BrowserProvenance; the pin
		// follows the mount, still guarding the same accent token.
		const zoomSrc = readFileSync(join(BUTTONS, 'ZoomSlider.svelte'), 'utf8');
		expect(zoomSrc).toContain('accent-[var(--color-accent-purple)]');
		const provenanceSrc = readFileSync(join(ROOT, 'BrowserProvenance.svelte'), 'utf8');
		expect(provenanceSrc).toContain('<ZoomSlider');
	});

	it('leaves state semantics alone (disabled + active chip untouched)', () => {
		expect(headerSrc).toContain('disabled:opacity-40');
		expect(readFileSync(join(ROOT, 'BrowserTab.svelte'), 'utf8')).toContain('bg-blue-100');
	});
});

describe('Glass Browser glyph controls join the icon grammar (fix round 1)', () => {
	const tabSrc = readFileSync(join(ROOT, 'BrowserTab.svelte'), 'utf8');

	it('marks the nav glyphs (back/forward/reload) with browser-glyph', () => {
		// 2026-10-28: reload moved into ReloadButton — pin reads the
		// component form too; browser-glyph stays on its class prop.
		// 2026-11-02: back/forward joined as BackButton/ForwardButton.
		const navButtons = headerSrc.match(/<(button|BackButton|ForwardButton|ReloadButton)[\s\S]*?(<\/button>|\/>)/g) ?? [];
		const nav = navButtons.filter((b) => /browser-(back|forward|reload)/.test(b));
		expect(nav.length).toBe(3);
		for (const b of nav) {
			expect(b, 'nav glyph carries browser-glyph class').toContain('browser-glyph');
		}
	});

	it('marks the tab close glyph destructive (hover stays white-on-red)', () => {
		// CloseButton extraction (2026-11-02): the glyph classes ride the
		// caller's `class` prop on <CloseButton> — pin the prop, not a <button>.
		const close = tabSrc.match(/<CloseButton[\s\S]*?\/>/)?.find((b) => b.includes('browser-tab-close'));
		expect(close, 'close glyph carries both glyph classes').toContain('browser-glyph browser-glyph-destructive');
		// destructive hover affordance untouched
		expect(close).toContain('hover:bg-red-500');
		expect(close).toContain('focus-visible:opacity-100');
	});

	it('carves the trash-bin OUT of the purple grammar — it stays red', () => {
		const closedSrc = readFileSync(join(BUTTONS, 'BrowserClosed.svelte'), 'utf8');
		expect(closedSrc).toContain('class="browser-icon-trash"');
		expect(panelSrc).toMatch(
			/\.glass-browser-icons\s+:global\(\.browser-icon-trash\)\s*\{[^}]*color:\s*red/
		);
	});

	it('extends the panel-scoped rule to the glyph classes', () => {
		expect(panelSrc).toMatch(
			/\.glass-browser-icons\s+:global\(\.browser-glyph\)\s*\{[^}]*color:\s*var\(--color-accent-purple\)/
		);
		expect(panelSrc).toMatch(
			/\.glass-browser-icons\s+:global\(\.browser-glyph-destructive:hover\)\s*\{[^}]*color:\s*#fff/
		);
	});
});
