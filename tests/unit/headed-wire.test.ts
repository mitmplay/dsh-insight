import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// Task 2.1-T — the wire pins for the rename borrowProfile → headedOpen
// (The Headed Downgrade, 2026-11-05). The intent is POST-body only; the
// re-bind/GET chain stays clean.

const route = readFileSync('src/routes/api/browser/+server.ts', 'utf8');
const panel = readFileSync('src/lib/components/browser/BrowserPanel.svelte', 'utf8');
const page = readFileSync('src/routes/+page.svelte', 'utf8');
const resolver = readFileSync('src/lib/services/panels/browser-session-resolver.ts', 'utf8');
const factories = readFileSync('src/lib/services/panels/floor-registry/factories.ts', 'utf8');

describe('headed wire (task 2.1-T)', () => {
	it('the route parses headedOpen from the POST body and forwards it to open()', () => {
		expect(route).toContain('headedOpen?: boolean');
		expect(route).toContain('if (body.headedOpen === true) headedOpen = true;');
		expect(route).toContain('browserRegistry.open({ width, height, ownerSessionId, headedOpen })');
	});

	it('the body carries headedOpen ONLY on intent — plain opens send nothing', () => {
		// the sole headedOpen site in the POST body is the conditional spread:
		// the literal can appear exactly once, and only behind the ternary
		expect(panel.match(/headedOpen: true/g)).toHaveLength(1);
		expect(panel).toContain('...(headedOpen ? { headedOpen: true } : {})');
	});

	it('the re-bind path is clean — the GET chain (page/id) never carries headedOpen', () => {
		// re-bind = fetch of /api/browser/{id}/page — a GET, no body at all
		expect(panel).toContain("fetch(apiBase + '/api/browser/' + sessionId + '/page')");
		expect(route).not.toMatch(/GET[sS]{0,400}headedOpen/);
	});

	it('the spawn-time intent rides the panel entry: factories → page → panel prop', () => {
		expect(factories).toContain('...(headedOpen ? { headedOpen: true } : {})');
		expect(page).toContain("headedOpen={'headedOpen' in panel ? panel.headedOpen === true : false}");
		expect(resolver).toContain('...(deps.headedOpen ? { headedOpen: true } : {})');
	});

	it('zero borrowProfile references remain anywhere in src', () => {
		for (const [name, src] of [['route', route], ['panel', panel], ['page', page], ['resolver', resolver], ['factories', factories]]) {
			expect(src, name).not.toContain('borrowProfile');
		}
	});
});
