// sync-theme-applier — inject the base theme applier (ADR-0063 D2) into
// src/app.html between the BEGIN/END markers. Run by `pnpm check` and
// `prepare`; the twin pin (tests/unit/theme-prefs.test.ts) fails on drift.
import { readFileSync, writeFileSync } from 'node:fs';
import { themeApplierScript } from '../packages/container-base/src/theming/applier.ts';

const HTML = new URL('../src/app.html', import.meta.url);
const BEGIN = '<!-- container-base:theme-applier BEGIN (generated — do not edit by hand; scripts/sync-theme-applier.mjs) -->';
const END = '<!-- container-base:theme-applier END -->';
const body = themeApplierScript('dsi-theme')
	.split('\n')
	.map((l) => '\t\t\t' + l)
	.join('\n');
const BLOCK = BEGIN + '\n\t\t<script>\n' + body + '\n\t\t</script>\n\t\t' + END;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pattern = new RegExp(esc(BEGIN) + '[\\s\\S]*?' + esc(END), 'g');

let html = readFileSync(HTML, 'utf8');
if (pattern.test(html)) {
	html = html.replace(pattern, () => BLOCK);
} else {
	// first injection: insert right before the sveltekit head placeholder
	if (!html.includes('%sveltekit.head%')) {
		console.error('sync-theme-applier: no marker block and no %sveltekit.head% in src/app.html');
		process.exit(1);
	}
	html = html.replace('%sveltekit.head%', BLOCK + '\n\t\t%sveltekit.head%');
}
writeFileSync(HTML, html);
console.log('sync-theme-applier: app.html updated');
