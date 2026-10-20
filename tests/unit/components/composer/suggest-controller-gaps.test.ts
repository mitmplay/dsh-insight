/**
 * StripController branch-gap coverage — the base suite
 * (suggest-controller.test.ts) pins the happy paths; this file drives the
 * remaining branch arms: the locked-gate strip clear, the onrows mirror,
 * element-absent fallbacks, run-shape re-arm predicates, schedule
 * dedupe, the #fetch guards (no query / dismissed unlock / stale seq /
 * post-await edit / fetch throw / missing results), close without a
 * query, the accept no-op + find-splice arms, cycle wrap edges, and the
 * rename field-diff matrix (no-op body, 500 early return, 409 tolerance,
 * offline degrade) plus remove's offline arm.
 */
import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StripController } from '../../../../src/lib/components/composer/controller/suggest-controller.svelte';
import { DraftBox } from './_draft-box.svelte';

type Row = {
	id: number;
	text: string;
	use_count: number;
	label: string | null;
	macro: number;
	last_used_at: string;
	tags: string;
};

const mk = (r: Omit<Row, 'macro' | 'last_used_at' | 'tags'>): Row => ({
	...r,
	macro: 0,
	last_used_at: '',
	tags: ''
});

const ROWS: Row[] = [
	mk({ id: 1, text: 'the answer', use_count: 0, label: null }),
	mk({ id: 2, text: 'second thought', use_count: 1, label: null })
];

interface El {
	value: string;
	selectionStart: number;
	selectionEnd: number;
	focus: () => void;
}

function make(initial = '', opts: { locked?: () => boolean; onrows?: (rows: Row[]) => void; onrunmacro?: (i: number) => void } = {}) {
	const value = new DraftBox(initial);
	let element: El | undefined = {
		value: initial,
		selectionStart: initial.length,
		selectionEnd: initial.length,
		focus: () => {}
	};
	const focus = vi.fn();
	const strip = new StripController(
		{
			getElement: () => element as unknown as HTMLTextAreaElement | undefined,
			getValue: () => value.get(),
			setValue: (v: string) => {
				value.set(v);
				element = { value: v, selectionStart: v.length, selectionEnd: v.length, focus: () => {} };
			}
		},
		{ active: () => true, locked: opts.locked ?? (() => false) },
		{ focus, onrows: opts.onrows, onrunmacro: opts.onrunmacro }
	);
	const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ results: ROWS }) }) as Response);
	vi.stubGlobal('fetch', fetchMock);
	const tick = async () => {
		await vi.advanceTimersByTimeAsync(120);
		flushSync();
	};
	return {
		strip,
		fetchMock,
		focus,
		value,
		dropElement: () => {
			element = undefined;
		},
		setEl(v: string, caret = v.length, end = caret) {
			element = { value: v, selectionStart: caret, selectionEnd: end, focus: () => {} };
		},
		// mutate the CURRENT element in place — #fetch captures the element
		// at fetch start, so only in-place edits count as "during the fetch"
		mutateEl(v: string, caret = v.length) {
			if (element) {
				element.value = v;
				element.selectionStart = caret;
				element.selectionEnd = caret;
			}
		},
		tick
	};
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('StripController branch gaps', () => {
	it('the locked gate clears the strip and resets the index; unlocking restores service', async () => {
		// the DraftBox value is the reactive lock source: the shell's lock
		// gate reads live state, and the effect tracks reactive reads only
		const h = make('?test', { locked: () => h.value.get() === 'LOCK' });
		h.strip.schedule();
		await h.tick();
		expect(h.strip.rows.length).toBe(2);
		h.strip.index = 1;
		h.value.set('LOCK');
		flushSync();
		expect(h.strip.rows.length).toBe(0);
		expect(h.strip.index).toBe(0);
		h.value.set('?test');
		h.strip.schedule();
		await h.tick();
		expect(h.strip.rows.length).toBe(2);
	});

	it('the onrows mirror reports every row change upward', async () => {
		const seen: number[] = [];
		const h = make('?test', { onrows: (rows) => seen.push(rows.length) });
		h.strip.schedule();
		await h.tick();
		expect(seen).toContain(2);
		h.strip.forgetRows();
		flushSync();
		expect(seen[seen.length - 1]).toBe(0);
	});

	it('a missing element falls back to the shell value; liveMode defaults a null query to find', () => {
		const h = make('!run now');
		h.dropElement();
		expect(h.strip.liveQuery()).toBe('!run now');
		expect(h.strip.liveMode()).toBe('run');
		const h2 = make('plain text');
		h2.dropElement();
		expect(h2.strip.liveQuery()).toBeNull();
		expect(h2.strip.liveMode()).toBe('find');
	});

	it('runRearmNeeded distinguishes a run-shaped standing draft from find mode', () => {
		const h = make('!deploy');
		expect(h.strip.runRearmNeeded()).toBe(true);
		expect(h.strip.handles()).toBe(false); // no rows yet
		const h2 = make('?deploy');
		expect(h2.strip.runRearmNeeded()).toBe(false);
	});

	it('a second schedule inside the debounce window replaces the timer (one fetch)', async () => {
		const h = make('?test');
		h.strip.schedule();
		await vi.advanceTimersByTimeAsync(60);
		h.strip.schedule();
		await vi.advanceTimersByTimeAsync(80);
		expect(h.fetchMock).not.toHaveBeenCalled(); // the first timer was cleared at 60ms
		await vi.advanceTimersByTimeAsync(60);
		expect(h.fetchMock).toHaveBeenCalledTimes(1);
	});

	it('a fetch whose live query died clears rows without calling the API', async () => {
		const h = make('?test');
		h.setEl('plain'); // trigger gone before the debounce fires
		h.strip.schedule();
		await h.tick();
		expect(h.fetchMock).not.toHaveBeenCalled();
		expect(h.strip.rows.length).toBe(0);
	});

	it('typing past a dismissed query unlocks the refetch (BC-9 unlock arm)', async () => {
		const h = make('?a');
		h.strip.schedule();
		await h.tick();
		h.strip.close(false);
		h.strip.schedule();
		await h.tick();
		const calls = h.fetchMock.mock.calls.length;
		h.setEl('?ab');
		h.strip.schedule();
		await h.tick();
		expect(h.fetchMock.mock.calls.length).toBe(calls + 1); // longer query = fresh intent
		expect(h.strip.rows.length).toBe(2);
	});

	it('a stale response lands after a newer fetch and is discarded (out-of-order guard)', async () => {
		let release1: (v: Response) => void = () => {};
		const gate1 = new Promise<Response>((resolve) => (release1 = resolve));
		const h = make('?first');
		const fetchMock = vi.fn((input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes('q=first')) return gate1;
			return Promise.resolve({ ok: true, json: async () => ({ results: ROWS }) } as Response);
		});
		vi.stubGlobal('fetch', fetchMock);
		h.strip.schedule();
		await vi.advanceTimersByTimeAsync(120);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		h.setEl('?second');
		h.strip.schedule();
		await vi.advanceTimersByTimeAsync(120);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(h.strip.query).toBe('?second'); // the newer fetch landed its rows
		release1({
			ok: true,
			json: async () => ({ results: [mk({ id: 9, text: 'stale', use_count: 0, label: null })] })
		} as unknown as Response);
		await Promise.resolve();
		flushSync();
		expect(h.strip.rows.length).toBe(2); // the stale payload was discarded, the live rows stay
	});

	it('a thrown fetch degrades silently (catch arm)', async () => {
		const h = make('?test');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('offline');
			})
		);
		h.strip.schedule();
		await h.tick();
		expect(h.strip.rows.length).toBe(0);
	});

	it('an edit during the fetch discards the response (post-await guard)', async () => {
		let release: (v: Response) => void = () => {};
		const gate = new Promise<Response>((resolve) => (release = resolve));
		const h = make('?test');
		vi.stubGlobal('fetch', vi.fn(() => gate));
		h.strip.schedule();
		await vi.advanceTimersByTimeAsync(120);
		h.mutateEl('?other'); // text changed on the SAME element while in flight
		release({ ok: true, json: async () => ({ results: ROWS }) } as unknown as Response);
		await Promise.resolve();
		await Promise.resolve();
		flushSync();
		expect(h.strip.rows.length).toBe(0);
	});

	it('a results-less payload lands as an empty strip (results ?? [])', async () => {
		const h = make('?test');
		vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) }) as Response));
		h.strip.schedule();
		await h.tick();
		expect(h.strip.rows.length).toBe(0);
	});

	it('close with no live query still clears rows and refocuses without memoizing', async () => {
		const h = make('');
		h.strip.close(); // refocus default true
		expect(h.focus).toHaveBeenCalled();
		h.setEl('?later');
		h.strip.schedule();
		await h.tick();
		expect(h.fetchMock).toHaveBeenCalledTimes(1); // nothing was dismissed
	});

	it('accept no-ops on a missing element, a dead query, or an out-of-range row', () => {
		const h = make('?te');
		h.dropElement();
		h.strip.accept(0);
		expect(h.value.get()).toBe('?te');
		const h2 = make('no trigger here');
		h2.strip.accept(0);
		const h3 = make('?te');
		h3.strip.accept(5); // row 5 does not exist
		expect(h3.value.get()).toBe('?te');
	});

	it('find-accept splices over a selected span (selectionEnd wins the max)', async () => {
		const h = make('?te SELECTED tail');
		h.setEl('?te SELECTED tail', 3, 11);
		h.strip.schedule();
		await h.tick();
		h.strip.accept(0);
		expect(h.value.get()).toBe('the answerD tail');
	});

	it('run mode without an onrunmacro callback falls back to the query-span splice', async () => {
		// '!' mid-draft is no query at all (D3 first-line rule) — the
		// fallback arms on a LINE-START run draft
		const h = make('!run');
		h.strip.schedule();
		await h.tick();
		h.strip.accept(0);
		expect(h.value.get()).toBe('the answer');
	});

	it('a run-accept with refocus=false skips the focus callback', async () => {
		const macros: number[] = [];
		const h = make('!go', { onrunmacro: (i) => macros.push(i) });
		h.strip.schedule();
		await h.tick();
		h.strip.accept(0, false);
		expect(h.value.get()).toBe('');
		expect(macros).toEqual([0]);
		expect(h.focus).not.toHaveBeenCalled();
	});

	it('cycle no-ops on an empty strip and wraps in both directions', async () => {
		const h = make('?test');
		h.strip.cycle(1); // no rows: no-op, no crash
		expect(h.strip.index).toBe(0);
		h.strip.schedule();
		await h.tick();
		expect(h.strip.rows.length).toBe(2);
		h.strip.cycle(-1);
		expect(h.strip.index).toBe(1); // wrapped below zero
		h.strip.cycle(1);
		expect(h.strip.index).toBe(0); // wrapped above the top
		h.strip.cycle(3);
		expect(h.strip.index).toBe(1);
	});

	it('rearmRun forgets the dismissal and refetches immediately', async () => {
		const h = make('?a');
		h.strip.schedule();
		await h.tick();
		h.strip.close(false);
		h.strip.schedule();
		await h.tick();
		const calls = h.fetchMock.mock.calls.length;
		h.strip.rearmRun();
		await Promise.resolve();
		flushSync();
		expect(h.fetchMock.mock.calls.length).toBe(calls + 1);
	});

	it('rename with an unchanged row sends no PATCH but still refetches and refocuses', async () => {
		const h = make('?test');
		h.strip.schedule();
		await h.tick();
		const before = h.fetchMock.mock.calls.length;
		await h.strip.rename(ROWS[0], { uses: '0', label: '   ', text: 'the answer' });
		const patch = h.fetchMock.mock.calls.slice(before).find((call) => (call[1] as RequestInit | undefined)?.method === 'PATCH');
		expect(patch).toBeUndefined(); // empty body -> no PATCH
		expect(h.fetchMock.mock.calls.length).toBeGreaterThan(before); // the refetch ran
		expect(h.focus).toHaveBeenCalled();
	});

	it('rename clears a label to null and skips NaN / duplicate use counts', async () => {
		const h = make('?test');
		h.strip.schedule();
		await h.tick();
		const labeled = mk({ id: 3, text: 'same text', use_count: 2, label: 'old label' });
		await h.strip.rename(labeled, { uses: 'not-a-number', label: '  ', text: 'same text' });
		const patchCall = h.fetchMock.mock.calls.find((call) => String(call[0]).includes('/api/prompts/3') && call[1]);
		const body = JSON.parse(String((patchCall?.[1] as RequestInit).body));
		expect(body).toEqual({ label: null }); // the label fell to null; NaN uses and equal text were skipped
	});

	it('rename on a 500 keeps the UI and skips the refetch; 409 tolerates and refetches', async () => {
		const h = make('?test');
		h.strip.schedule();
		await h.tick();
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as unknown as Response)
		);
		await h.strip.rename(ROWS[0], { uses: '9', label: 'x', text: 'changed' });
		expect(h.focus).not.toHaveBeenCalled(); // early return: no refetch, no focus

		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				if (init?.method === 'PATCH') {
					return { ok: false, status: 409, json: async () => ({}) } as unknown as Response;
				}
				return { ok: true, json: async () => ({ results: ROWS }) } as unknown as Response;
			})
		);
		await h.strip.rename(ROWS[0], { uses: '9', label: 'x', text: 'changed' });
		expect(h.focus).toHaveBeenCalled(); // 409 fell through to the refetch + focus
	});

	it('rename offline (thrown PATCH) still refetches and refocuses', async () => {
		const h = make('?test');
		h.strip.schedule();
		await h.tick();
		const focusCalls = h.focus.mock.calls.length;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				if (init?.method === 'PATCH') throw new Error('offline');
				return { ok: true, json: async () => ({ results: ROWS }) } as unknown as Response;
			})
		);
		await h.strip.rename(ROWS[0], { uses: '9', label: 'x', text: 'changed' });
		expect(h.focus.mock.calls.length).toBe(focusCalls + 1);
	});

	it('remove survives a thrown DELETE without refetching', async () => {
		const h = make('?test');
		h.strip.schedule();
		await h.tick();
		const before = h.fetchMock.mock.calls.length;
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('offline');
			})
		);
		await h.strip.remove(ROWS[0]);
		expect(h.fetchMock.mock.calls.length).toBe(before);
	});
});