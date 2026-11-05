/**
 * Raw-source pin tests — glass-tab-ids Task 4 (omnibox speaks tab grammar).
 * These read the component source as TEXT and pin the exact behaviors the
 * brief names: focused-URL placeholder truncation, parseTabCommand import +
 * per-kind dispatch branches, the google-search fallback constant, the IME
 * isComposing guard, and the Escape-restores-placeholder handler. They are
 * deliberately dumb string pins — the behavior batteries live in the
 * browser-panel-*.test.ts files.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(process.cwd(), 'src', 'lib', 'components', 'browser');
const panelSrc = readFileSync(join(ROOT, 'BrowserPanel.svelte'), 'utf8');
const headerSrc = readFileSync(join(ROOT, 'BrowserHeader.svelte'), 'utf8');
// 2026-11-02 extraction: the input's own key handling (IME guard, Escape
// clear) moved into the UrlInput component — pins read it too.
const urlInputSrc = readFileSync(join(ROOT, 'buttons', 'UrlInput.svelte'), 'utf8');

describe('BrowserPanel omnibox pins (glass-tab-ids Task 4)', () => {
	it('imports parseTabCommand from the shared tab-grammar module', () => {
		expect(panelSrc).toMatch(/import\s*\{[^}]*parseTabCommand[^}]*\}\s*from\s*'[^']*tab-grammar[^']*'/);
	});

	it('dispatches every parser kind: open / focus / close / query-active / error', () => {
		for (const kind of ['open', 'focus', 'close', 'query-active', 'error']) {
			expect(panelSrc, `dispatch branch for kind '${kind}'`).toContain(`'${kind}'`);
		}
		expect(panelSrc).toContain('url-or-search');
	});

	it('keeps the google-search fallback URL constant', () => {
		expect(panelSrc).toContain("const SEARCH_URL = 'https://www.google.com/search?q='");
		// the fallback rides SEARCH_URL + encodeURIComponent(...)
		expect(panelSrc).toMatch(/SEARCH_URL\s*\+\s*encodeURIComponent/);
	});

	it('truncates the active tab URL placeholder to 64 chars', () => {
		expect(panelSrc).toContain('OMNIBOX_PLACEHOLDER_MAX = 64');
		expect(panelSrc).toMatch(/slice\(0,\s*OMNIBOX_PLACEHOLDER_MAX\)/);
	});

	it('treats about:blank (any case, optional suffix) as no-URL for the placeholder', () => {
		// fresh tabs report 'about:blank' — the omnibox must fall back to the
		// localized placeholder, not the raw URL. Pin: an about:blank guard
		// sits in the placeholder computation.
		expect(panelSrc).toMatch(/isNoUrl|about:blank/);
		expect(panelSrc).toMatch(/toLowerCase\(\)[\s\S]{0,160}startsWith\('about:blank#?'\)|toLowerCase\(\) === 'about:blank'/);
	});
	it('falls back to the paraglide placeholder message when no tab is active', () => {
		// t() takes the message REFERENCE (it calls fn itself — the instant-
		// switch locale contract), so the pin is the reference form.
		expect(panelSrc).toContain('t(m.browserUrlPlaceholder)');
	});

	it('resolves tabId against the panel tabs payload (no server resolution)', () => {
		expect(panelSrc).toMatch(/tabs\.find\(.*tabId ===/);
	});

	it('wires the omnibox submit through handleOmniboxSubmit', () => {
		expect(panelSrc).toContain('async function handleOmniboxSubmit(text: string): Promise<void>');
		expect(panelSrc).toMatch(/onnavigate=\{handleOmniboxSubmit\}/);
	});
});

describe('BrowserHeader omnibox input pins (glass-tab-ids Task 4)', () => {
	it('guards Enter against IME composition', () => {
		expect(urlInputSrc).toContain('e.isComposing');
	});

	it('Escape clears the input (placeholder restored)', () => {
		// UrlInput owns the draft via the bindable value prop — Escape
		// resets it, so the header's panel answer (placeholder) resurfaces.
		expect(urlInputSrc).toMatch(/key === 'Escape'/);
		expect(urlInputSrc).toMatch(/Escape[\s\S]{0,80}value = ''/);
	});

	it('placeholder binding accepts the panel-provided focused URL', () => {
		expect(headerSrc).toMatch(/placeholder=\{\s*placeholder \?\? m\.browserUrlPlaceholder\(\)\s*\}/);
	});

	it('exposes a value setter so query-active can echo tab:N <url>', () => {
		expect(headerSrc).toContain('export function setOmniboxValue');
	});
});
