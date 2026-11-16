// sync-boot-blocks — inject the GENERATED pre-paint prefs boot block into
// the playground's src/app.html (ADR-0067 D2). The inline logic comes from
// ONE source in the base (storage/boot-script.ts panelsBootScript) — this
// script is consumer glue only: it never owns a copy of the logic.
import { readFileSync, writeFileSync } from 'node:fs';
import { panelsBootScript } from '../../src/storage/boot-script.ts';

const HTML = new URL('../src/app.html', import.meta.url);
const BEGIN = '<!-- container-base:panels-boot BEGIN (generated — do not edit by hand; playground/scripts/sync-boot-blocks.mjs) -->';
const END = '<!-- container-base:panels-boot END -->';

const body = panelsBootScript('pg-panels')
	.split('\n')
	.map((l) => '\t\t\t' + l)
	.join('\n');
const BLOCK = BEGIN + '\n\t\t<script>\n' + body + '\n\t\t</script>\n\t\t' + END;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pattern = new RegExp(esc(BEGIN) + '[\\s\\S]*?' + esc(END), 'g');

let html = readFileSync(HTML, 'utf8');
if (pattern.test(html)) {
	html = html.replace(pattern, () => BLOCK);
} else if (html.includes('%sveltekit.head%')) {
	html = html.replace('%sveltekit.head%', BLOCK + '\n\t\t%sveltekit.head%');
} else {
	console.error('sync-boot-blocks: no marker block and no %sveltekit.head% in src/app.html');
	process.exit(1);
}
writeFileSync(HTML, html);
console.log('sync-boot-blocks: playground app.html updated');
