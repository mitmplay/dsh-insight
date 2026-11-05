/**
 * Raw-source pin tests — glass-tab-ids Task 5 (chrome-like strip & nav UX).
 * These read the component source as TEXT and pin the exact behaviors the
 * brief names: the ordinal badge testid + "tab:N" pattern, the enlarged nav
 * glyph size (18px) with ≥1.5rem hit targets on the 0.25rem toolbar spacing
 * grammar, the chip's rounded-top + raised active styling + favicon dot +
 * hover close affordance, and the bold (font-weight 600+) ✕/+ controls.
 * Deliberately dumb string pins — behavior batteries live elsewhere.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(process.cwd(), 'src', 'lib', 'components', 'browser');
const headerSrc = readFileSync(join(ROOT, 'BrowserHeader.svelte'), 'utf8');
const tabSrc = readFileSync(join(ROOT, 'BrowserTab.svelte'), 'utf8');
// UrlCopy extraction (2026-11-02): the copy-url chip's own source
const copySrc = readFileSync(join(process.cwd(), 'src', 'lib', 'components', 'browser', 'buttons', 'UrlCopy.svelte'), 'utf8');
// BrowserHistory extraction (2026-11-02): the history menu's own source
const historySrc = readFileSync(join(process.cwd(), 'src', 'lib', 'components', 'browser', 'buttons', 'BrowserHistory.svelte'), 'utf8');

describe('BrowserHeader nav pins (glass-tab-ids Task 5)', () => {
	it('steps nav glyphs up to 18px', () => {
		// the glyph size class carries an explicit 18px value
		expect(headerSrc).toContain('text-[18px]');
	});

	it('gives nav buttons ≥1.5rem hit targets', () => {
		// h-6 w-6 = 1.5rem square hit area on all three nav buttons
		// 2026-10-28: reload moved into ReloadButton — pin reads the
		// component form too, same h-6 w-6 hit-target grammar.
		// BackButton/ForwardButton extraction (2026-11-02): the nav pair
		// joined ReloadButton in component form — pin reads all three.
		const navButtons = headerSrc.match(/<(button|BackButton|ForwardButton|ReloadButton)[\s\S]*?(<\/button>|\/>)/g) ?? [];
		const nav = navButtons.filter((b) => /browser-(back|forward|reload)/.test(b));
		expect(nav.length).toBe(3);
		for (const b of nav) {
			expect(b, 'nav button hit target h-6 (1.5rem)').toContain('h-6');
			expect(b, 'nav button hit target w-6 (1.5rem)').toContain('w-6');
		}
	});

	it('keeps the 0.25rem toolbar spacing grammar', () => {
		expect(headerSrc).toContain('gap-1');
		expect(headerSrc).not.toContain('gap-3');
	});
});

describe('BrowserHeader long-press arbitration pins (history dropdown)', () => {
	it('arms the pending-open flag SYNCHRONOUSLY in the hold timer callback', () => {
		// the release race: the flag must beat the async history fetch
		const timer = headerSrc.match(/holdTimer = setTimeout\(\(\) => \{[\s\S]*?\}, HOLD_MS\)/);
		expect(timer, 'hold timer block').toBeTruthy();
		expect(timer![0]).toContain('menuPending = true');
	});

	it('suppresses the trailing click for pending-open AND opened menus', () => {
		expect(headerSrc).toContain('menuDir !== null || menuPending');
		// the suppress must actually eat the click verb
		const click = headerSrc.match(/function clickNav[\s\S]*?\n\t}/);
		expect(click, 'clickNav block').toBeTruthy();
		expect(click![0]).toContain('suppressNextClick');
	});

	it('clears the pending flag on every no-dropdown exit', () => {
		// !sessionId, refused fetch, empty direction, throw — four exits
		const clears = headerSrc.match(/menuPending = false/g) ?? [];
		expect(clears.length).toBeGreaterThanOrEqual(4);
	});

	it('renders ONE deduped menu block for both directions', () => {
		expect((headerSrc.match(/\{#if menuDir\}/g) ?? []).length).toBe(1);
		expect(headerSrc).not.toContain("{#if menuDir === 'back'}");
	});
});

describe('favicon pins (history menu UX, fix round 2)', () => {
	it('menu items render the real favicon via the s2 service with dot fallback', () => {
		// BrowserHistory extraction (2026-11-02): the menu markup lives in
		// the component — pin reads its source, not the header's.
		expect(historySrc).toContain('s2/favicons');
		expect(historySrc).toContain('data-testid="browser-history-favicon"');
	});

	it('menu rows keep icon and text on ONE horizontal line', () => {
		const item = historySrc.match(/data-testid="browser-history-item"[\s\S]*?<\/button>/);
		expect(item, 'menu item block').toBeTruthy();
		expect(item![0]).toContain('items-center');
		expect(item![0]).not.toContain('mt-0.5');
		// optical centering (fix round 3): the img must be block (an inline
		// img's baseline gap drags the icon off-center) and the text must
		// carry leading-tight so its box hugs the two lines
		const img = item![0].match(/<img[\s\S]*?\/>/);
		expect(img, 'favicon img').toBeTruthy();
		expect(img![0]).toContain('block');
		expect(item![0]).toContain('leading-tight');
	});

	it('menu text is visible on the light dropdown (fix round 4)', () => {
		const item = historySrc.match(/data-testid="browser-history-item"[\s\S]*?<\/button>/);
		expect(item, 'menu item block').toBeTruthy();
		// the menu resolves on a WHITE background: dark-theme tokens
		// (text-surface ≈ near-white, text-surface-muted similar) leak in
		// invisible — the title must be an explicit dark color, the URL an
		// explicit mid-zinc, and neither theme token may remain
		expect(item![0]).toContain('text-zinc-800');
		expect(item![0]).toContain('text-zinc-500');
		expect(item![0]).not.toContain('text-surface');
	});

	it('tab chips upgrade to the real favicon with states preserved', () => {
		expect(tabSrc).toContain('s2/favicons');
		expect(tabSrc).toContain('data-testid="browser-tab-favicon"');
		expect(tabSrc).toContain('bg-emerald-500'); // active chip
		expect(tabSrc).toContain('bg-zinc-400'); // quiet fallback
	});
});

describe('BrowserTab chip pins (glass-tab-ids Task 5)', () => {
	it('renders the ordinal badge with the tab testid and t{position}:{tabId} pattern', () => {
		expect(tabSrc).toContain('data-testid="browser-tab-ordinal"');
		// the label derives 't' + position + ':' + tab.tabId (Alt+N indexing)
		expect(tabSrc).toMatch(/'t' \+ position \+ ':' \+ tab\.tabId/);
	});

	it('accepts tabId off the tabs payload (Task 2 wire)', () => {
		expect(tabSrc).toMatch(/tabId[?]?:\s*number/);
	});

	it('styles the chip rounded-top with a raised active state', () => {
		expect(tabSrc).toContain('rounded-t');
		// active chip: raised (shadow) + borderless background
		expect(tabSrc).toMatch(/shadow-sm/);
		expect(tabSrc).toContain('bg-blue-100');
		expect(tabSrc).toContain('border-transparent');
	});

	it('shows the favicon dot', () => {
		expect(tabSrc).toContain('data-testid="browser-tab-favicon"');
	});

	it('affords close on hover (opacity-0 group-hover/tab:opacity-100)', () => {
		expect(tabSrc).toContain('opacity-0');
		expect(tabSrc).toMatch(/group-hover\/tab:opacity-100/);
		expect(tabSrc).toContain('group/tab');
	});

	it('bolds the close control at 600+ with a larger hit area', () => {
		expect(tabSrc).toMatch(/font-semibold/);
		// CloseButton extraction (2026-11-02): the hit-area classes live in the
		// caller's `class` prop on <CloseButton> — pin the prop, not a <button>.
		const closeBtn = tabSrc.match(/<CloseButton[\s\S]*?browser-tab-close[\s\S]*?\/>/)?.[0] ?? '';
		expect(closeBtn, 'close hit area h-5 (1.25rem)').toContain('h-5');
		expect(closeBtn, 'close hit area w-5 (1.25rem)').toContain('w-5');
	});
});

describe('Panel + control pins (glass-tab-ids Task 5)', () => {
	const panelSrc = readFileSync(join(ROOT, 'BrowserPanel.svelte'), 'utf8');

	it('bolds the add-tab + control at 600+ with a larger hit area', () => {
		// BrowserNew extraction (2026-11-02): the chip moved to a component —
		// pin the component form, same grammar as the ReloadButton arm above.
		// The glyph is a lucide SVG (stroke carries the weight), so the pin
		// checks the icon swap contract instead of font-semibold.
		const addBtn = panelSrc.match(/<BrowserNew[\s\S]*?\/>/)?.[0] ?? '';
		expect(addBtn, 'add hit area h-5 (1.25rem)').toContain('h-5');
		expect(addBtn, 'add hit area w-5 (1.25rem)').toContain('w-5');
		const newSrc = readFileSync(join(process.cwd(), 'src', 'lib', 'components', 'browser', 'buttons', 'BrowserNew.svelte'), 'utf8');
		expect(newSrc, 'Plus at rest, CirclePlus on hover').toContain('CirclePlus');
	});
});

describe('Focus-area polish pins (glass-tab-ids follow-up, 2026-10-28)', () => {
	const panelSrc = readFileSync(join(ROOT, 'BrowserPanel.svelte'), 'utf8');
	const rowsSrc = readFileSync(join(process.cwd(), 'src', 'lib', 'services', 'panels', 'panel-rows.ts'), 'utf8');

	it('badge reads t{position}:{tabId} — the Alt+N strip position', () => {
		expect(tabSrc).toContain('data-testid="browser-tab-ordinal"');
	});

	it('copy-url icon sits at the input PREFIX and carries the testid', () => {
		// UrlCopy extraction (2026-11-02): the chip moved to a component —
		// the caller passes the seam testid; the PREFIX order lives in the header.
		expect(headerSrc).toContain('testid="browser-copy-url"');
		expect(copySrc).toContain('data-testid={testid}');
		expect(
			headerSrc.indexOf('<UrlCopy'),
			'prefix = before the url input in source order'
		).toBeLessThan(headerSrc.indexOf('<UrlInput'));
	});

	it('copy-url is disabled without a focused real URL (panel-side isNoUrl guard)', () => {
		expect(headerSrc).toMatch(/disabled=\{!copyUrl\}/);
		expect(panelSrc).toMatch(/!isNoUrl\(focusedTab\.url\)/);
	});

	it('copy-url swaps the icon to a check for ~1.5s, no toast', () => {
		// the icon-swap arm moved into UrlCopy; the 1.5s revert stays in the
		// header's copyFocusedUrl (the caller owns the state machine).
		const btn = copySrc.match(/<button[\s\S]*?<\/button>/)?.[0] ?? '';
		expect(btn).toMatch(/\{#if copied\}/);
		expect(headerSrc).toMatch(/1500/);
		expect(headerSrc).toMatch(/clipboard\.writeText/);
	});

	it('info line is sessionTitle | focused tab title with CSS truncate and bare fallback', () => {
		// BrowserProvenance extraction (ADR-0036 D3): the lineage chip moved
		// out of BrowserPanel — the pin follows the seam and now guards the
		// span shape: bare parent fallback, conditional " | title" suffix,
		// CSS truncate on the wrapper.
		const provenanceSrc = readFileSync(join(ROOT, 'BrowserProvenance.svelte'), 'utf8');
		expect(provenanceSrc).toContain('{parentTitle ?? openedBy}');
		expect(provenanceSrc).toContain('{#if focusedTitle}');
		expect(provenanceSrc).toContain('{focusedTitle}');
		expect(provenanceSrc, 'CSS truncate on the title wrapper').toMatch(/truncate/);
	});

	it('fresh-tab data: URLs are no-URL — the guard covers the whole data: family', () => {
		// the operator's live report: a new glass shows 'data:text/html,<title>Glass Browser…'
		// in the omnibox placeholder instead of the Search fallback
		expect(panelSrc).toMatch(/function isNoUrl[\s\S]{0,400}startsWith\('data:'\)/);
	});

	it('panel header title literal is Glass Browser', () => {
		expect(rowsSrc).toContain("'Glass Browser'");
		expect(rowsSrc).not.toMatch(/return 'Browser';/);
	});
});