// sync-theme-applier — inject the GENERATED pre-paint blocks into
// src/app.html between their BEGIN/END markers:
//   1. the base theme applier (ADR-0063 D2);
//   2. the panels boot block (ADR-0067 D1/D2) — publishes
//      window.__DSI_PANELS_BOOT = { profile, raw } before first paint.
// The inline scripts are the SINGLE SOURCE of their own logic: panel-prefs.ts
// stays the only parser (D3) and namespace.ts's suffix rule is mirrored, never
// imported (an inline block cannot import bundled TS). Run by `pnpm check`
// and `prepare`; twin pins fail on drift (tests/unit/theme-prefs.test.ts,
// tests/unit/panels-boot-emitter.test.ts). Set DSI_APP_HTML to inject into a
// fixture file instead of src/app.html (emitter tests only).
import { readFileSync, writeFileSync } from 'node:fs';
import { themeApplierScript } from '../packages/container-base/src/theming/applier.ts';
import { panelsBootScript } from '../packages/container-base/src/storage/boot-script.ts';

const HTML = process.env.DSI_APP_HTML
	? new URL('file://' + process.env.DSI_APP_HTML)
	: new URL('../src/app.html', import.meta.url);
const THEME_BEGIN = '<!-- container-base:theme-applier BEGIN (generated — do not edit by hand; scripts/sync-theme-applier.mjs) -->';
const THEME_END = '<!-- container-base:theme-applier END -->';
const PANELS_BEGIN = '<!-- container-base:panels-boot BEGIN (generated — do not edit by hand; scripts/sync-theme-applier.mjs) -->';
const PANELS_END = '<!-- container-base:panels-boot END -->';

const themeBody = themeApplierScript('dsi-theme')
	.split('\n')
	.map((l) => '\t\t\t' + l)
	.join('\n');
const THEME_BLOCK = THEME_BEGIN + '\n\t\t<script>\n' + themeBody + '\n\t\t</script>\n\t\t' + THEME_END;

// ADR-0067 D2/D3: the panels boot block is GENERATED from ONE source in
// container-base (storage/boot-script.ts, beside themeApplierScript) —
// every consumer app's sync script emits the same generated logic; no
// app owns a copy. The raw string is published, never parsed inline.
const panelsBody = panelsBootScript('dsi-panels')
	.split('\n')
	.map((l) => '\t\t\t' + l)
	.join('\n');
const PANELS_BLOCK = PANELS_BEGIN + '\n\t\t<script>\n' + panelsBody + '\n\t\t</script>\n\t\t' + PANELS_END;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const inject = (html, begin, end, block) => {
	const pattern = new RegExp(esc(begin) + '[\\s\\S]*?' + esc(end), 'g');
	if (pattern.test(html)) return html.replace(pattern, () => block);
	// first injection: insert right before the sveltekit head placeholder
	if (!html.includes('%sveltekit.head%')) {
		console.error('sync-theme-applier: no marker block and no %sveltekit.head% in ' + HTML.pathname);
		process.exit(1);
	}
	return html.replace('%sveltekit.head%', block + '\n\t\t%sveltekit.head%');
};

let html = readFileSync(HTML, 'utf8');
html = inject(html, THEME_BEGIN, THEME_END, THEME_BLOCK);
html = inject(html, PANELS_BEGIN, PANELS_END, PANELS_BLOCK);
writeFileSync(HTML, html);
console.log('sync-theme-applier: app.html updated');
