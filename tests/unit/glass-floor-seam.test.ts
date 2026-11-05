import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import {
	floorCandidates,
	resolveDsiBase,
	isFloorTab,
	pickSession
} from '../../.agents/skills/glass-url/scripts/_connect.mjs';
import { floorCandidates as floorCandidatesDsi, isFloorTab as isFloorTabDsi }
	from '../../.agents/skills/glass-dsi/scripts/_connect.mjs';

const okFetch = (base) => async () => ({ ok: true, json: async () => ({ sessions: [{ id: 's1', port: 9400, ownerSessionId: 'me' }] }), probed: base });
const dead = () => async () => { throw new Error('down'); };

// Task 1.1-T / 1.3-T — the Floor Seam decision tree (ADR D1-D3), pinned on
// the glass-url copy and shape-pinned on the glass-dsi copy.
describe('floorCandidates', () => {
	it('DSI_UI env wins verbatim — no probe past it', () => {
		expect(floorCandidates({ DSI_UI: 'http://127.0.0.1:9000' })).toEqual(['http://127.0.0.1:9000']);
	});
	it('defaults to dev first, build second', () => {
		expect(floorCandidates({})).toEqual(['http://127.0.0.1:5175', 'http://127.0.0.1:5174']);
	});
	it('ignores a non-http env value', () => {
		expect(floorCandidates({ DSI_UI: 'nonsense' })).toEqual(['http://127.0.0.1:5175', 'http://127.0.0.1:5174']);
	});
});

describe('resolveDsiBase', () => {
	it('env seam probes ONLY the env base — defaults never touched (D1a)', async () => {
		const fetched = [];
		const fetchImpl = async (url) => { fetched.push(url); return { ok: true, json: async () => ({ sessions: [{ id: 's', port: 9, ownerSessionId: null }] }) }; };
		const v = await resolveDsiBase({ env: { DSI_UI: 'http://127.0.0.1:9000' }, fetchImpl, identity: undefined, pickSessionFn: pickSession });
		expect(v.base).toBe('http://127.0.0.1:9000');
		// connect still needs the registry — one fetch to the env base ONLY
		expect(fetched).toEqual(['http://127.0.0.1:9000/api/browser']);
	});

	it('one answering floor wins — dead one costs nothing', async () => {
		const fetchImpl = async (url) => {
			if (url.startsWith('http://127.0.0.1:5174')) return { ok: true, json: async () => ({ sessions: [{ id: 's', port: 1, ownerSessionId: null }] }) };
			throw new Error('down');
		};
		const v = await resolveDsiBase({ env: {}, fetchImpl, identity: undefined, pickSessionFn: pickSession });
		expect(v.base).toBe('http://127.0.0.1:5174');
		expect(v.reg.sessions[0].id).toBe('s');
	});

	it('both floors alive — the floor holding MY glass wins the tiebreak (D7)', async () => {
		const fetchImpl = async (url) => ({
			ok: true,
			json: async () => url.includes(':5175/')
				? { sessions: [{ id: 'other', port: 1, ownerSessionId: 'someone-else' }] }
				: { sessions: [{ id: 'mine', port: 2, ownerSessionId: 'me' }] }
		});
		const v = await resolveDsiBase({ env: {}, fetchImpl, identity: 'me', pickSessionFn: pickSession });
		expect(v.base).toBe('http://127.0.0.1:5174');
	});

	it('both floors claim me — dies LOUD naming both (D7 stands)', async () => {
		const fetchImpl = async () => ({ ok: true, json: async () => ({ sessions: [{ id: 'x', port: 1, ownerSessionId: 'me' }] }) });
		const msg = await resolveDsiBase({ env: {}, fetchImpl, identity: 'me', pickSessionFn: pickSession,
			dieFn: (m) => { throw new Error(m); } }).catch((e) => e.message);
		expect(msg).toContain('BOTH floors');
		expect(msg).toContain('5175');
		expect(msg).toContain('5174');
	});

	it('no floor answers — dies naming both ports and both launch commands', async () => {
		const msg = await resolveDsiBase({ env: {}, fetchImpl: dead(), dieFn: (m) => { throw new Error(m); } }).catch((e) => e.message);
		expect(msg).toContain('http://127.0.0.1:5175');
		expect(msg).toContain('http://127.0.0.1:5174');
		expect(msg).toContain('--sync');
		expect(msg).toContain('DSI_UI');
	});
});

describe('isFloorTab (D2 origin compare)', () => {
	it('same origin (any path) = floor tab', () => {
		expect(isFloorTab('http://127.0.0.1:5174/some/path?x=1', 'http://127.0.0.1:5174')).toBe(true);
	});
	it('different port = foreign tab — even the dev floor', () => {
		expect(isFloorTab('http://127.0.0.1:5175/', 'http://127.0.0.1:5174')).toBe(false);
	});
	it('junk url is never a floor tab', () => {
		expect(isFloorTab('about:blank', 'http://127.0.0.1:5174')).toBe(false);
	});
});

// Task 1.3-T — raw-source pins: the glass-dsi copy carries the same seam
// (D3: shape-identical, import-free across dirs), and no port literal
// survives in tab filtering anywhere.
describe('glass-dsi copy + literal ban', () => {
	const dsiConnect = readFileSync('.agents/skills/glass-dsi/scripts/_connect.mjs', 'utf-8');
	const dsiGlass = readFileSync('.agents/skills/glass-dsi/scripts/glass.mjs', 'utf-8');
	const urlConnect = readFileSync('.agents/skills/glass-url/scripts/_connect.mjs', 'utf-8');
	const urlScript = readFileSync('.agents/skills/glass-url/scripts/glass-url.mjs', 'utf-8');

	it('glass-dsi _connect exports the same seam names', () => {
		expect(dsiConnect).toContain('export function floorCandidates');
		expect(dsiConnect).toContain('export async function resolveDsiBase');
		expect(dsiConnect).toContain('export function isFloorTab');
	});

	it('glass.mjs finds the DSI tab by isFloorTab, not a 5175 substring', () => {
		expect(dsiGlass).toContain('isFloorTab(p.url(), base)');
		expect(dsiGlass).not.toMatch(/includes\('5175'\)/);
	});

	it('no tab filter keeps a port literal — the only 5175s are candidate defaults or comments', () => {
		for (const [name, src] of [['url-connect', urlConnect], ['url-script', urlScript], ['dsi-connect', dsiConnect], ['dsi-glass', dsiGlass]]) {
			const codeLines = src.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/*'));
			const offenders = codeLines.filter((l) => l.includes(':5175') || l.includes("'5175'")).filter((l) => !l.includes('DEFAULT_FLOOR_BASES'));
			expect(offenders, name).toEqual([]);
		}
	});

	it('connect returns base in both copies', () => {
		expect(urlConnect).toContain('ctx: browser.contexts()[0], base }');
		expect(dsiConnect).toContain('ctx: browser.contexts()[0], base }');
	});
});
