import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * 4.1-T (ADR-0065 W4) — playground conformance: the second consumer
 * names NO dot-separated pg keys (the pg.panel/pg.locale drift is dead)
 * and routes its blob through the registry door, not ad-hoc filters.
 */

const here = fileURLToPath(import.meta.url);
const pageSrc = readFileSync(
	new URL('../playground/src/routes/+page.svelte', 'file://' + here),
	'utf8'
);

describe('playground conformance (4.1-T, ADR-0065 W4)', () => {
	it('source contains no dot-separated pg keys', () => {
		expect(pageSrc).not.toMatch(/'pg\.[A-Za-z]/);
		expect(pageSrc).toMatch(/'pg-panels'/);
		expect(pageSrc).toMatch(/'pg-locale'/);
	});

	it('declares the demo kind through the registry door and revives through the loop', () => {
		expect(pageSrc).toMatch(/definePanelKind\(/);
		expect(pageSrc).toMatch(/kind: 'demo-pane'/);
		expect(pageSrc).toMatch(/revivePanels</);
		// the band is LAZY (D5): a resolver, not eager numbers
		expect(pageSrc).toMatch(/band: \(\) => \(\{ min: 280, max: 1400 \}\)/);
	});
});
