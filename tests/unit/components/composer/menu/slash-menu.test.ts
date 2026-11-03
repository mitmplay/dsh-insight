/**
 * SlashMenu component tests (task 2.1-T): the menu renders the session's
 * three-section vocabulary — DSI gestures above Commands above Skills
 * (ADR §1.1's layer order), host order within wire sections, strip-parity
 * And-filter over name + description — and fires the kind-correct pick
 * event per row (gesture → seed insert, no-hint command → execute, hint
 * command → insert, skill → insert). Keyboard interception is HOST-owned
 * (Resolved decision 6: the strip's row-gated guard lives in Composer's
 * onkeydown — the menu owns no key listener by construction, mirroring
 * SuggestStrip); Enter/Esc/IME are pinned in prompt-input-slash-menu.test.ts
 * (2.2-T).
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SlashMenu from '$lib/components/composer/menu/SlashMenu.svelte';
// The pure helpers live in a .ts module (raw tsc cannot see named exports
// through the '*.svelte' ambient declaration).
import {
	slashMenuMatches,
	slashMenuScrollIntoView
} from '$lib/components/composer/menu/slash-menu-shared';
import SlashMenuHarness from '../../../../fixtures/SlashMenuHarness.svelte';

/** The fixtures' shared flush (panels-row.test.ts's settle): drain every
 *  effect/microtask queue before asserting. */
async function settle(): Promise<void> {
	for (let i = 0; i < 4; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}
import { MENU_GESTURES } from '$lib/services/chat/command-help';
import type { DsiCommandRow, DsiSkillRow } from '$lib/types';

function cmd(partial: Partial<DsiCommandRow> = {}): DsiCommandRow {
	return { name: 'compact', description: 'Compact the session context', ...partial };
}
function skill(partial: Partial<DsiSkillRow> = {}): DsiSkillRow {
	return { name: 'dsh-doc', description: 'Answer from the DSH docs', modelInvocable: true, ...partial };
}

const COMMANDS: DsiCommandRow[] = [
	cmd(),
	cmd({ name: 'plan', description: 'Plan mode for the next turn', input: { hint: '<goal>' } })
];
const SKILLS: DsiSkillRow[] = [
	skill(),
	skill({ name: 'mux', description: 'Explain the multiplexer', modelInvocable: false, whenToUse: 'When asked about the mux' })
];

function mountMenu(props: Partial<Parameters<typeof mount>[0]> & Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const onpickgesture = vi.fn();
	const onpickcommand = vi.fn();
	const onpickcommandwithhint = vi.fn();
	const onpickskill = vi.fn();
	const comp = mount(SlashMenu, {
		target,
		props: {
			gestures: MENU_GESTURES,
			commands: COMMANDS,
			skills: SKILLS,
			state: 'ready' as const,
			query: '/',
			onpickgesture,
			onpickcommand,
			onpickcommandwithhint,
			onpickskill,
			...props
		}
	});
	flushSync();
	const q = (sel: string) => target.querySelector(sel);
	const qa = (sel: string) => Array.from(target.querySelectorAll(sel));
	const cleanup = () => {
		unmount(comp);
		target.remove();
	};
	return { target, q, qa, onpickgesture, onpickcommand, onpickcommandwithhint, onpickskill, cleanup };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('SlashMenu — sections + order', () => {
	it('renders the three labeled sections — DSI gestures above Commands above Skills — rows in order', () => {
		const h = mountMenu();
		const gesturesLabel = h.q('[data-testid="slash-gestures-label"]');
		const commandsLabel = h.q('[data-testid="slash-commands-label"]');
		const skillsLabel = h.q('[data-testid="slash-skills-label"]');
		expect(gesturesLabel?.textContent).toContain('DSI gestures');
		expect(commandsLabel?.textContent).toContain('Commands');
		expect(skillsLabel?.textContent).toContain('Skills');
		// DOM order: gestures → commands → skills (§1.1's layers A→B→C)
		expect(
			(gesturesLabel as Element).compareDocumentPosition(commandsLabel as Element) &
				Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
		expect(
			(commandsLabel as Element).compareDocumentPosition(skillsLabel as Element) &
				Node.DOCUMENT_POSITION_FOLLOWING
		).toBeTruthy();
		const names = h.qa('[data-testid="slash-gesture-row"]').map((el) => el.getAttribute('data-name'));
		// MENU_GESTURES order — /dsi-prompts joined 2026-09-06 (D7 menu
		// row); /dsi-settings + /dsh-settings joined 2026-09-07 (Settings
		// Panel ADR D3, one row per COMMAND_HELP); /workspace joined
		// 2026-09-15 (Workspace Command ADR D6); /loadinjected RETIRED
		// 2026-09-17 (The Retired Typed Command ADR D1).
		expect(names).toEqual([
			'new',
			'workspace',
			'terminal', // Web Terminal spec (2026-09-24): /dsi-terminal joins the menu
			'promptmanager',
			'skillshelf', // The Shelf Voice W1 (2026-09-21): /dsi-skills joins the menu
			'pluginrack', // Plugin Rack ADR D1 (2026-09-27): /dsi-plugins joins the menu
			'dsisettings',
			'dshsettings',
			'@mention'
		]);
		const cmdNames = h.qa('[data-testid="slash-command-row"]').map((el) => el.getAttribute('data-name'));
		expect(cmdNames).toEqual(['compact', 'plan']); // host order kept
		const skillNames = h.qa('[data-testid="slash-skill-row"]').map((el) => el.getAttribute('data-name'));
		expect(skillNames).toEqual(['dsh-doc', 'mux']);
		h.cleanup();
	});

	it('the mention gesture row renders verbatim — never re-prefixed with "/"', () => {
		const h = mountMenu();
		const rows = h.qa('[data-testid="slash-gesture-row"]');
		expect(rows[0]?.textContent).toContain('/new');
		expect(rows[1]?.textContent).toContain('/workspace'); // joined 2026-09-15
		expect(rows[2]?.textContent).toContain('/dsi-terminal'); // Web Terminal spec (2026-09-24)
		expect(rows[3]?.textContent).toContain('/dsi-prompts'); // joined 2026-09-06
		expect(rows[4]?.textContent).toContain('/dsi-skills'); // The Shelf Voice W1 (2026-09-21)
		expect(rows[5]?.textContent).toContain('/dsi-plugins'); // Plugin Rack ADR D1 (2026-09-27)
		expect(rows[6]?.textContent).toContain('/dsi-settings'); // joined 2026-09-07
		expect(rows[7]?.textContent).toContain('/dsh-settings'); // joined 2026-09-07
		expect(rows[8]?.textContent).toContain('@mention'); // /loadinjected retired 2026-09-17
		const last = rows[rows.length - 1];
		expect(last?.textContent).toContain('@mention');
		expect(last?.querySelector('.slash-name')?.textContent).not.toMatch(/^\//);
		h.cleanup();
	});

	it('a bare "/" lists the whole vocabulary (no terms match everything)', () => {
		const h = mountMenu();
		expect(h.qa('[data-testid="slash-gesture-row"]')).toHaveLength(9); // + /dsi-skills (W1, 2026-09-21); /dsi-terminal (2026-09-24); /dsi-plugins (Plugin Rack ADR D1, 2026-09-27)
		expect(h.qa('[data-testid="slash-command-row"]')).toHaveLength(2);
		expect(h.qa('[data-testid="slash-skill-row"]')).toHaveLength(2);
		h.cleanup();
	});
});

describe('SlashMenu — filter narrows both sections (strip parity)', () => {
	it('a name term narrows commands and skills together', () => {
		const h = mountMenu({ query: '/plan' });
		expect(h.qa('[data-testid="slash-command-row"]').map((e) => e.getAttribute('data-name'))).toEqual(['plan']);
		expect(h.qa('[data-testid="slash-skill-row"]')).toHaveLength(0);
		h.cleanup();
	});

	it('a description term matches too (name + description haystack)', () => {
		const h = mountMenu({ query: '/multiplexer' });
		expect(h.qa('[data-testid="slash-skill-row"]').map((e) => e.getAttribute('data-name'))).toEqual(['mux']);
		expect(h.qa('[data-testid="slash-command-row"]')).toHaveLength(0);
		h.cleanup();
	});

	it('multi-term AND: every term must hit, case-insensitive, ";" splits', () => {
		const h = mountMenu({ query: '/Mux MUXPLAIN'.replace('MUXPLAIN', 'multiplexer') });
		expect(h.qa('[data-testid="slash-skill-row"]').map((e) => e.getAttribute('data-name'))).toEqual(['mux']);
		h.cleanup();
		const h2 = mountMenu({ query: '/mux; multiplexer' });
		expect(h2.qa('[data-testid="slash-skill-row"]')).toHaveLength(1);
		h2.cleanup();
		// one term missing from every row → no rows
		const h3 = mountMenu({ query: '/mux nope' });
		expect(h3.qa('[data-testid="slash-skill-row"]')).toHaveLength(0);
		h3.cleanup();
	});
});

describe('SlashMenu — kind-aware picks', () => {
	it('clicking a gesture row fires onpickgesture with the row\'s seed (insert-only)', () => {
		const h = mountMenu();
		const rows = h.qa('[data-testid="slash-gesture-row"]');
		(rows[0] as HTMLElement).click();
		flushSync();
		expect(h.onpickgesture).toHaveBeenCalledTimes(1);
				(rows[1] as HTMLElement).click();
		flushSync();
		expect(h.onpickgesture).toHaveBeenCalledWith('/workspace '); // joined 2026-09-15
		(rows[3] as HTMLElement).click();
		expect(h.onpickgesture).toHaveBeenCalledWith('/dsi-prompts ');
		(rows[2] as HTMLElement).click();
		flushSync();
		expect(h.onpickgesture).toHaveBeenCalledWith('/dsi-terminal '); // Web Terminal spec (2026-09-24)
		(rows[4] as HTMLElement).click();
		flushSync();
		expect(h.onpickgesture).toHaveBeenCalledWith('/dsi-skills '); // The Shelf Voice W1 (2026-09-21)
		(rows[5] as HTMLElement).click();
		flushSync();
		expect(h.onpickgesture).toHaveBeenCalledWith('/dsi-plugins '); // Plugin Rack ADR D1 (2026-09-27)
		(rows[8] as HTMLElement).click();
		flushSync();
		expect(h.onpickgesture).toHaveBeenCalledWith('@session-'); // the mention scaffold (last row — /loadinjected retired 2026-09-17)
		expect(h.onpickcommand).not.toHaveBeenCalled();
		h.cleanup();
	});

	it('clicking a hint-less command fires onpickcommand with the row name', () => {
		const h = mountMenu();
		(h.qa('[data-testid="slash-command-row"]')[0] as HTMLElement).click();
		flushSync();
		expect(h.onpickcommand).toHaveBeenCalledTimes(1);
		expect(h.onpickcommand).toHaveBeenCalledWith('compact');
		expect(h.onpickcommandwithhint).not.toHaveBeenCalled();
		expect(h.onpickskill).not.toHaveBeenCalled();
		h.cleanup();
	});

	it('a hint command renders input.hint as its secondary line and fires onpickcommandwithhint (insert, not execute)', () => {
		const h = mountMenu();
		const rows = h.qa('[data-testid="slash-command-row"]');
		const hint = rows[1]?.querySelector('[data-testid="slash-hint"]');
		expect(hint?.textContent).toBe('<goal>');
		(rows[1] as HTMLElement).click();
		flushSync();
		expect(h.onpickcommandwithhint).toHaveBeenCalledTimes(1);
		expect(h.onpickcommandwithhint).toHaveBeenCalledWith('plan');
		expect(h.onpickcommand).not.toHaveBeenCalled();
		h.cleanup();
	});

	it('a skill row fires onpickskill; modelInvocable:false still picks (the host lists, DSI never adjudicates)', () => {
		const h = mountMenu();
		const rows = h.qa('[data-testid="slash-skill-row"]');
		expect(rows[1]?.querySelector('.slash-badge')?.textContent).toContain('you');
		(rows[0] as HTMLElement).click();
		flushSync();
		expect(h.onpickskill).toHaveBeenCalledWith('dsh-doc');
		(rows[1] as HTMLElement).click();
		flushSync();
		expect(h.onpickskill).toHaveBeenCalledWith('mux');
		expect(h.onpickcommand).not.toHaveBeenCalled();
		h.cleanup();
	});

	it('whenToUse renders as the skill row secondary line when present', () => {
		const h = mountMenu();
		const rows = h.qa('[data-testid="slash-skill-row"]');
		expect(rows[0]?.querySelector('[data-testid="slash-hint"]')).toBeNull(); // absent — no line
		expect(rows[1]?.querySelector('[data-testid="slash-hint"]')?.textContent).toContain('mux');
		h.cleanup();
	});
});

describe('SlashMenu — highlight + match count contract', () => {
	it('activeIndex highlights by composite position: gestures, commands, then skills', () => {
		const h = mountMenu({ activeIndex: 11 }); // 9 gestures + 2 commands → index 11 = first skill
		const selected = h.qa('[role="option"][aria-selected="true"]');
		expect(selected).toHaveLength(1);
		expect(selected[0]?.getAttribute('data-name')).toBe('dsh-doc');
		h.cleanup();
		const h2 = mountMenu({ activeIndex: 9 }); // index 9 = first command (9 gestures)
		const selected2 = h2.qa('[role="option"][aria-selected="true"]');
		expect(selected2[0]?.getAttribute('data-name')).toBe('compact');
		h2.cleanup();
	});

	it('a no-match query renders zero rows and the no-match status (no pick target exists)', () => {
		const h = mountMenu({ query: '/zzz-nope' });
		expect(h.qa('[data-testid="slash-gesture-row"]')).toHaveLength(0);
		expect(h.qa('[data-testid="slash-command-row"]')).toHaveLength(0);
		expect(h.qa('[data-testid="slash-skill-row"]')).toHaveLength(0);
		expect(h.q('[data-testid="slash-menu-nomatch"]')?.textContent).toContain('No matching');
		h.cleanup();
	});

	it('an empty host catalog still renders the gesture section; the wire sections stay label-only (subagent edge)', () => {
		const h = mountMenu({ commands: [], skills: [] });
		expect(h.q('[data-testid="slash-gestures-label"]')).not.toBeNull();
		expect(h.q('[data-testid="slash-commands-label"]')).not.toBeNull();
		expect(h.q('[data-testid="slash-skills-label"]')).not.toBeNull();
		expect(h.qa('[data-testid="slash-gesture-row"]')).toHaveLength(9); // + /dsi-skills (W1, 2026-09-21); /dsi-terminal (2026-09-24); /dsi-plugins (Plugin Rack ADR D1, 2026-09-27)
		expect(h.qa('[data-testid="slash-command-row"]')).toHaveLength(0);
		expect(h.qa('[data-testid="slash-skill-row"]')).toHaveLength(0);
		expect(h.q('[data-testid="slash-menu-nomatch"]')).toBeNull(); // empty is a correct answer
		h.cleanup();
	});
});

describe('SlashMenu — lifecycle rows (loading / failed)', () => {
	it('loading and idle render the loading row; failed renders the error row', () => {
		const h = mountMenu({ state: 'loading' });
		expect(h.q('[data-testid="slash-menu-loading"]')).not.toBeNull();
		expect(h.qa('[data-testid="slash-command-row"]')).toHaveLength(0);
		h.cleanup();
		const h2 = mountMenu({ state: 'idle' });
		expect(h2.q('[data-testid="slash-menu-loading"]')).not.toBeNull();
		h2.cleanup();
		const h3 = mountMenu({ state: 'failed' });
		expect(h3.q('[data-testid="slash-menu-error"]')?.textContent).toContain('Catalog unavailable');
		expect(h3.qa('[data-testid="slash-command-row"]')).toHaveLength(0);
		h3.cleanup();
	});
});

describe('slashMenuMatches — the shared matcher (host keyboard guard parity)', () => {
	const row = { name: 'dsh-doc', description: 'Answer from the DSH docs' };
	it('bare "/" matches everything; terms are case-insensitive; AND over name+description', () => {
		expect(slashMenuMatches(row, '/')).toBe(true);
		expect(slashMenuMatches(row, '/Dsh-Doc')).toBe(true);
		expect(slashMenuMatches(row, '/DOC answer')).toBe(true);
		expect(slashMenuMatches(row, '/doc mux')).toBe(false);
	});
	it('";" and whitespace both split terms', () => {
		expect(slashMenuMatches(row, '/doc; answer')).toBe(true);
		expect(slashMenuMatches(row, '/doc ; answer ; dsh')).toBe(true);
		expect(slashMenuMatches(row, '/doc; nope')).toBe(false);
	});
});

describe('slashMenuScrollIntoView — the keyboard-follow rule (2026-09-03 bug fix)', () => {
	const H = 300; // the capped menu's visible height
	it('active row BELOW the view scrolls the minimum: bottom edge to the container bottom', () => {
		// row 17 of 20 in a 15-row viewport: top 340, height 20, view 0..300
		expect(slashMenuScrollIntoView(340, 360, 0, H)).toBe(60);
	});
	it('active row ABOVE the view scrolls up to its top edge', () => {
		expect(slashMenuScrollIntoView(40, 60, 100, H)).toBe(40);
	});
	it('active row fully visible → null (no scroll, no jump)', () => {
		expect(slashMenuScrollIntoView(120, 140, 100, H)).toBeNull();
	});
	it('edges count as visible: top at scrollTop and bottom at the view bottom', () => {
		expect(slashMenuScrollIntoView(100, 120, 100, H)).toBeNull();
		expect(slashMenuScrollIntoView(280, 300, 0, H)).toBeNull();
	});
	it('a taller-than-view row aligns its top (the top breach wins; the bottom stays breached)', () => {
		expect(slashMenuScrollIntoView(0, 400, 50, H)).toBe(0);
	});
});

describe('SlashMenu — the scroll effect follows activeIndex (wiring, 2026-09-03)', () => {
	// happy-dom does no real layout, so geometry is stubbed onto the
	// elements. activeIndex moves through the SlashMenuHarness bridge —
	// the same reactive path the host's ArrowDown/ArrowUp drives.
	async function mountWithGeometry(activeIndex: number) {
		const many = Array.from({ length: 20 }, (_, i) => cmd({ name: `c${i}` }));
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(SlashMenuHarness, {
			target,
			props: { commands: many, activeIndex }
		});
		await settle();
		const container = target.querySelector('[data-testid="slash-menu"]') as HTMLElement;
		const rows = Array.from(
			target.querySelectorAll('[data-testid="slash-command-row"]')
		) as HTMLElement[];
		Object.defineProperty(container, 'clientHeight', { value: 300, configurable: true });
		Object.defineProperty(container, 'scrollTop', { value: 0, writable: true, configurable: true });
		rows.forEach((row, i) => {
			Object.defineProperty(row, 'offsetTop', { value: i * 20, configurable: true });
			Object.defineProperty(row, 'offsetHeight', { value: 20, configurable: true });
		});
		return {
			container,
			set: (props: { activeIndex: number }) =>
				(comp as unknown as { set: (p: { activeIndex: number }) => void }).set(props),
			settle,
			cleanup: () => {
				unmount(comp);
				target.remove();
			}
		};
	}

	it('an in-view active row leaves scrollTop untouched', async () => {
		const h = await mountWithGeometry(3); // row 3: 60..80 inside 0..300
		// (mount-flush ran the effect with zero geometry; drive one real
		// index change so the effect runs against the stubbed layout)
		h.set({ activeIndex: 4 });
		await h.settle();
		expect(h.container.scrollTop).toBe(0);
		h.cleanup();
	});

	it('arrowing PAST the view scrolls the active row into view (the bug)', async () => {
		const h = await mountWithGeometry(3);
		h.set({ activeIndex: 17 }); // row 17: 340..360 outside 0..300
		await h.settle();
		expect(h.container.scrollTop).toBe(60); // bottom edge 360 - view 300
		h.cleanup();
	});

	it('arrowing back ABOVE the view scrolls up to the row top', async () => {
		const h = await mountWithGeometry(17);
		h.set({ activeIndex: 18 }); // row 18: 360..380 → bottom aligns to 380-300
		await h.settle();
		expect(h.container.scrollTop).toBe(80);
		h.set({ activeIndex: 2 }); // row 2: 40..60 < scrollTop 80
		await h.settle();
		expect(h.container.scrollTop).toBe(40);
		h.cleanup();
	});
});
