/**
 * Subagent Anchor popup surface — button + popup behavior (Subagent
 * Anchor Wave 4, Tasks 4.1-T/4.2-T): badge from the running roll-up,
 * hidden at zero, popup opens on click; sort order, honest dashes (null
 * tokens, unsighted clock), row-click callback, header count, footer sum
 * and its Σ-incomplete flip.
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SubagentAnchorButton from '$lib/components/anchor/subagent-anchor/SubagentAnchorButton.svelte';
import SubagentPopup from '$lib/components/anchor/subagent-anchor/SubagentPopup.svelte';
import { subagentClock } from '$lib/services/conversation/subagent-clock.svelte';
import type { Component } from 'svelte';
import type { DsiSubagentRow } from '$lib/types';

function row(over: Partial<DsiSubagentRow>): DsiSubagentRow {
	const base: DsiSubagentRow = {
		sessionId: 's',
		title: 'Helper',
		parentTitle: null,
		tokens: { input: 100, output: 50 },
		operateMs: null,
		running: false,
		updatedAt: 1
	};
	// Partial spread leaves `T | undefined` on overridden keys — the cast
	// re-asserts the row shape without loosening the fixture's types.
	return { ...base, ...over } as DsiSubagentRow;
}

/** Multi-await settle for the button's async fetch chains. */
async function settle(rounds = 8): Promise<void> {
	for (let i = 0; i < rounds; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}

const mounted: Array<() => void> = [];

// Component<any>: the mount helper must accept components with REQUIRED
// props (sessionId / rows) — the props object is checked at the call site.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mountComp(comp: Component<any>, props: Record<string, unknown>): HTMLElement {
	// the button REQUIRES a sessionId (the ?parent scoping) — default one in
	if (comp === SubagentAnchorButton && props.sessionId === undefined) props = { sessionId: 'panel-session', ...props };
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(comp, { target, props });
	mounted.push(() => {
		unmount(instance);
		target.remove();
	});
	return target;
}

const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, subagents: [] }) }));

function mockSubagents(rows: DsiSubagentRow[]): void {
	fetchMock.mockImplementation(
		async () => ({ ok: true, json: async () => ({ ok: true, subagents: rows }) }) as never
	);
}

beforeEach(() => {
	subagentClock.observe([]); // expire every sample between tests
	fetchMock.mockReset();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	for (const destroy of mounted.splice(0)) destroy();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

describe('SubagentAnchorButton', () => {
	it('hidden at zero subagents (fetch answers an empty list)', async () => {
		const target = mountComp(SubagentAnchorButton, { pollMs: 60_000 });
		await settle();
		expect(target.querySelector('[data-testid="subagent-anchor-button"]')).toBeNull();
	});

	it('badge carries the RUNNING count, not the row count', async () => {
		mockSubagents([
			row({ sessionId: 'a', running: true }),
			row({ sessionId: 'b', running: true }),
			row({ sessionId: 'c', running: false })
		]);
		const target = mountComp(SubagentAnchorButton, { pollMs: 60_000 });
		await settle();
		const badge = target.querySelector('[data-testid="subagent-anchor-badge"]');
		expect(badge?.textContent?.trim()).toBe('2');
	});

	it('click opens the popup', async () => {
		mockSubagents([row({ sessionId: 'a' })]);
		const target = mountComp(SubagentAnchorButton, { pollMs: 60_000 });
		await settle();
		(target.querySelector('[data-testid="subagent-anchor-trigger"]') as HTMLButtonElement).click();
		flushSync();
		expect(document.querySelector('[data-testid="subagent-popup"]')).not.toBeNull();
	});

	it('every poll tick feeds the clock (first sight is recorded)', async () => {
		mockSubagents([row({ sessionId: 'tick', running: true })]);
		mountComp(SubagentAnchorButton, { pollMs: 60_000 });
		await settle();
		expect(subagentClock.sighted('tick')).toBe(true);
	});
});

describe('SubagentPopup — rows', () => {
	it('sorts running-first then token spend descending (nulls last)', () => {
		mountComp(SubagentPopup, {
			open: true,
			triggerEl: undefined,
			rows: [
				row({ sessionId: 'idle-big', title: 'idle-big', tokens: { input: 900, output: 100 } }),
				row({ sessionId: 'run-small', title: 'run-small', tokens: { input: 10, output: 5 }, running: true }),
				row({ sessionId: 'unknown', title: 'unknown', tokens: null }),
				row({ sessionId: 'run-big', title: 'run-big', tokens: { input: 500, output: 500 }, running: true })
			]
		});
		const order = [...document.querySelectorAll('[data-testid="subagent-row"]')].map(
			(r) => r.textContent ?? ''
		);
		expect(order.length).toBe(4);
		expect(order[0]).toContain('run-big');
		expect(order[1]).toContain('run-small');
		expect(order[2]).toContain('idle-big');
		expect(order[3]).toContain('unknown'); // unknown spend sorts last
	});

	it('null tokens render a dash — never a zero', () => {
		mountComp(SubagentPopup, {
			open: true,
			triggerEl: undefined,
			rows: [row({ sessionId: 'd', tokens: null })]
		});
		expect(document.querySelector('[data-testid="subagent-row-tokens"]')?.textContent?.trim()).toBe('—');
	});

	it('unsighted clock renders a dash — never a guess', () => {
		mountComp(SubagentPopup, {
			open: true,
			triggerEl: undefined,
			rows: [row({ sessionId: 'never-sighted', running: true })]
		});
		expect(document.querySelector('[data-testid="subagent-row-elapsed"]')?.textContent?.trim()).toBe('—');
	});

	it('sighted running row renders its elapsed (live registry)', () => {
		subagentClock.observe([{ sessionId: 'live', running: true }]);
		mountComp(SubagentPopup, {
			open: true,
			triggerEl: undefined,
			rows: [row({ sessionId: 'live', running: true })]
		});
		expect(document.querySelector('[data-testid="subagent-row-elapsed"]')?.textContent?.trim()).toMatch(
			/^\d+s$/
		);
	});

	it('row click fires the callback with that session id', () => {
		const onopenrow = vi.fn();
		mountComp(SubagentPopup, {
			open: true,
			triggerEl: undefined,
			rows: [row({ sessionId: 'open-me', title: 'open-me' }), row({ sessionId: 'not-me', title: 'not-me' })],
			onopenrow
		});
		const rows = [...document.querySelectorAll('[data-testid="subagent-row"]')] as HTMLButtonElement[];
		rows.find((r) => r.textContent?.includes('open-me'))!.click();
		flushSync();
		expect(onopenrow).toHaveBeenCalledTimes(1);
		expect(onopenrow).toHaveBeenCalledWith('open-me');
	});
});

describe('SubagentPopup — header and footer (D6/D7)', () => {
	it('header count chip matches the rows: N helpers, M running', () => {
		mountComp(SubagentPopup, {
			open: true,
			triggerEl: undefined,
			rows: [row({ sessionId: 'a', running: true }), row({ sessionId: 'b' }), row({ sessionId: 'c' })]
		});
		// the shell title row is retired (operator review 2026-10-26): the
		// chip IS the header — 'SUBAGENTS' no longer renders twice.
		expect(document.querySelector('[data-testid="subagent-popup-header"]')).toBeNull();
		expect(
			document
				.querySelector('[data-testid="subagent-popup-chip"]')
				?.textContent?.replace(/\s+/g, ' ')
				?.trim()
		).toBe('3 subagents · 1 running');
	});

	it('footer sum equals the row sum (Σ over exactly the header count)', () => {
		mountComp(SubagentPopup, {
			open: true,
			triggerEl: undefined,
			rows: [
				row({ sessionId: 'a', tokens: { input: 600_000, output: 100_000 } }),
				row({ sessionId: 'b', tokens: { input: 400_000, output: 100_000 } })
			]
		});
		const footer = document.querySelector('[data-testid="subagent-popup-footer"]')?.textContent ?? '';
		expect(footer).toContain('1.2M tok');
		// the Σ total right-aligns under the tokens column — no count suffix
		expect(footer).not.toContain('helper');
		expect(footer).not.toContain('incomplete');
		const footerTokens = document.querySelector('[data-testid="subagent-popup-footer-tokens"]')?.textContent ?? '';
		expect(footerTokens?.trim()).toBe('1.2M tok');
	});

	it('any null row flips the footer to Σ-incomplete — no partial number', () => {
		mountComp(SubagentPopup, {
			open: true,
			triggerEl: undefined,
			rows: [
				row({ sessionId: 'a', tokens: { input: 600_000, output: 100_000 } }),
				row({ sessionId: 'drift', tokens: null })
			]
		});
		const footer = document.querySelector('[data-testid="subagent-popup-footer"]')?.textContent ?? '';
		// operator-tuned footer grammar (2026-10-26): the i18n 'Total Tokens'
		// label (INVOKED — an un-invoked message getter stringifies into the
		// visible function source, the 2026-10-26 PR bug) + the degraded dash
		// — never a partial sum
		expect(footer).toContain('Total tokens');
		const footerTokens = document.querySelector('[data-testid="subagent-popup-footer-tokens"]')?.textContent ?? '';
		expect(footerTokens?.trim()).toBe('—');
		// no partial SUM: no digit-led '<n> tok' token number anywhere in the footer
		expect(footer).not.toMatch(/\d[\d.,]*[MK]?\s*tok/);
	});
});
