/**
 * Contract drift test — DSI's terminal mirrors vs the DSH blueprint.
 *
 * Reads the DSH checkout's subprocess types (and the dsh-terminal README's
 * code lists) at test time and pins DSI's mirrors member-for-member
 * (ADR 2026-09-23 D2). A failure here means DSH moved and DSI's mirrors
 * must follow — deliberately, never silently.
 *
 * The checkout path resolves: DSH_CHECKOUT env → repo-sibling
 * `../deepseek-harness`. Absent checkout = loud SKIP, not a pass.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

import {
	TERMINAL_SIGNALS,
	TERMINAL_SETTLE_REASONS,
	TERMINAL_REFUSAL_CODES,
	TERMINAL_SPEC_MEMBERS,
	BATON_HOLDERS,
	TERMINAL_SESSION_EVENT_TYPES,
	BATON_EVENT_MEMBERS
} from './_terminal-contract-refs.js';

const repoRoot = resolve(import.meta.dirname, '../..');
const dshCheckout = process.env.DSH_CHECKOUT ?? join(repoRoot, '../deepseek-harness');
const dshTypes = join(dshCheckout, 'packages/subprocess/subprocess/src/types.ts');
const dshReadme = join(dshCheckout, 'packages/terminal/terminal/README.md');

describe.skipIf(!existsSync(dshTypes))('terminal contract mirrors (DSH blueprint)', () => {
	const dshSource = readFileSync(dshTypes, 'utf8');
	const dshReadmeText = existsSync(dshReadme) ? readFileSync(dshReadme, 'utf8') : '';

	it('signal union matches DSH member-for-member', () => {
		const m = dshSource.match(/export type SubprocessTerminalSignal = ([^;]+);/);
		expect(m).not.toBeNull();
		const dshMembers = (m![1].match(/'(SIG[A-Z]+)'/g) ?? []).map((s) => s.replaceAll("'", ''));
		expect([...TERMINAL_SIGNALS]).toEqual(dshMembers);
	});

	it('TerminalSpec carries the DSH spec members (documented omissions only)', () => {
		const m = dshSource.match(/export interface SubprocessTerminalSpawnSpec \{([\s\S]*?)\n\}/);
		expect(m).not.toBeNull();
		const dshMembers = (m![1].match(/\t\t?(\w+)(\?|):/g) ?? []).map((s) =>
			s.replace(/[\t?:]/g, '')
		);
		const documentedOmissions = new Set(['signal', 'shellActivity']);
		const required = dshMembers.filter((name) => !documentedOmissions.has(name));
		for (const name of required) {
			expect([...TERMINAL_SPEC_MEMBERS], 'missing mirrored spec member: ' + name).toContain(name);
		}
	});

	it('settle reasons each appear verbatim in the dsh-terminal README', () => {
		expect(dshReadmeText.length).toBeGreaterThan(0);
		for (const reason of TERMINAL_SETTLE_REASONS) expect(dshReadmeText).toContain(reason);
	});

	it('DSI refusal codes carry the README codes plus the documented DSI-native ones', () => {
		for (const code of ['SEND_ACTIVE', 'FOREIGN_SESSION', 'NO_SESSION'] as const) {
			expect(dshReadmeText).toContain(code);
			expect([...TERMINAL_REFUSAL_CODES]).toContain(code);
		}
		expect([...TERMINAL_REFUSAL_CODES]).toContain('NOT_ENABLED');
		expect([...TERMINAL_REFUSAL_CODES]).toContain('LINGERING_PIDS');
	});
});

describe('baton facet contracts (ADR-0079 — DSI-native additions, no DSH blueprint)', () => {
	it('the holder vocabulary is exactly operator | automation | unassigned (D1/D3)', () => {
		expect([...BATON_HOLDERS]).toEqual(['operator', 'automation', 'unassigned']);
	});

	it('the session event vocabulary carries the baton frame beside the four mirrored facts (D7)', () => {
		expect([...TERMINAL_SESSION_EVENT_TYPES]).toEqual(['output', 'settled', 'exit', 'closed', 'baton']);
	});

	it('the baton frame carries exactly type/holder/holderId/since (D7 wire shape)', () => {
		expect([...BATON_EVENT_MEMBERS]).toEqual(['type', 'holder', 'holderId', 'since']);
	});
});
