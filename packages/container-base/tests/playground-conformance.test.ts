import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import PanelListbox from '../src/components/PanelListbox.svelte';
import PanelListboxHeader from '../src/components/PanelListboxHeader.svelte';
import PanelListboxList from '../src/components/PanelListboxList.svelte';
import PanelListboxListItem from '../src/components/PanelListboxListItem.svelte';
import PanelListboxFilter from '../src/components/PanelListboxFilter.svelte';
import ControlBar from '../src/components/ControlBar.svelte';
import ControlBarTray from '../src/components/ControlBarTray.svelte';

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

	// 4.1-T (ADR-0066 D6): the header hosts the TITLE TEXT, and the two
	// promoted organs ride as its ACTIONS — the demo consumes the header
	// pattern like a real floor, not floating buttons on the body.
	it('hosts panel title text in a PanelHeaderSkeleton header (D6)', () => {
		expect(pageSrc).toMatch(/<PanelHeaderSkeleton title=\{pane\.title\}>/);
		expect(pageSrc).toMatch(/<span class="pane-title">\{pane\.title\}<\/span>/);
	});

	// 1.2-T (ADR-0070 W1): the four listbox organs are exported from the
	// single public surface and typed.
	it('exports the four PanelListbox organs from index.ts (1.2-T, ADR-0070)', () => {
		expect(PanelListbox).toBeTruthy();
		expect(PanelListboxHeader).toBeTruthy();
		expect(PanelListboxList).toBeTruthy();
		expect(PanelListboxListItem).toBeTruthy();
		// the public surface is index.ts ONLY — the four organs must be
		// re-exported there (the barrel is what dist/ and the playground consume)
		const indexSrc = readFileSync(new URL('../src/index.ts', 'file://' + here), 'utf8');
		for (const organ of ['PanelListbox', 'PanelListboxHeader', 'PanelListboxList', 'PanelListboxListItem']) {
			expect(indexSrc).toContain('export { default as ' + organ + " } from './components/" + organ + ".svelte'");
		}
	});

	// 1.3-T (ADR-0071 W1): the fifth organ rides the same public surface.
	it('exports PanelListboxFilter from index.ts (1.3-T, ADR-0071)', () => {
		expect(PanelListboxFilter).toBeTruthy();
		const indexSrc = readFileSync(new URL('../src/index.ts', 'file://' + here), 'utf8');
		expect(indexSrc).toContain(
			"export { default as PanelListboxFilter } from './components/PanelListboxFilter.svelte'"
		);
	});

	// 1.3-T (R10 W1, ADR-0073): the hover-tray organs ride the same
	// public surface, typed.
	it('exports ControlBar + ControlBarTray from index.ts (1.3-T, ADR-0073)', () => {
		expect(ControlBar).toBeTruthy();
		expect(ControlBarTray).toBeTruthy();
		const indexSrc = readFileSync(new URL('../src/index.ts', 'file://' + here), 'utf8');
		expect(indexSrc).toContain(
			"export { default as ControlBar } from './components/ControlBar.svelte'"
		);
		expect(indexSrc).toContain(
			"export { default as ControlBarTray } from './components/ControlBarTray.svelte'"
		);
	});

	it('renders PanelClose + CanvasCopyButton inside the header actions (D6)', () => {
		const from = pageSrc.indexOf('{#snippet actions()}');
		const actions = pageSrc.slice(from, pageSrc.indexOf('{/snippet}', from));
		expect(actions).toContain('<CanvasCopyButton');
		expect(actions).toContain('<PanelClose');
		// capture aims at the pane body element, bound per pane id
		expect(pageSrc).toMatch(/bind:this=\{paneBodies\[pane\.id\]\}/);
	});
});
