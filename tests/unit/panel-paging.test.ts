/**
 * Paging unit tests — the panel's load-older / load-all state machine,
 * exercised through its public surface only (constructor, loadOlder,
 * loadAllOlder). The conversation store is a plain fake (the class only
 * reads .entries and calls .prependOlder) and global fetch is stubbed
 * per test — the store module itself is mocked so no real runes store
 * loads.
 *
 * Client-runes module ($state in paging.svelte.ts) → runs under the 'dom'
 * project (happy-dom + svelte plugin compiles the runes) — deliberately
 * NOT in serverOnlyTestFiles.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Paging } from '../../src/lib/components/conversation/panel/paging.svelte';

vi.mock('$lib/services/conversation/store.svelte', () => ({ createConversationStore: vi.fn() }));

type Entry = { seq: number; text: string };

function makeStore(entries: Entry[]) {
	return {
		entries,
		prependOlder: vi.fn((older: Entry[]) => {
			entries.unshift(...older);
			return older.length > 0;
		})
	};
}

function makePaging(entries: Entry[], hasMore?: boolean) {
	const store = makeStore(entries);
	return {
		paging: new Paging({ store: store as unknown as ConstructorParameters<typeof Paging>[0]['store'], sessionId: 'sess-1' }, hasMore),
		store
	};
}

function jsonRes(body: unknown, ok = true) {
	return { ok, status: 500, json: async () => body } as unknown as Response;
}

const PAGE = (from: number): Entry[] => [{ seq: from, text: 'older' }];

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('Paging constructor', () => {
	it("hasOlder starts from the cold load's hasMore; firstSeq anchors at the head entry", () => {
		const { paging } = makePaging([{ seq: 42, text: 'x' }], true);
		expect(paging.hasOlder).toBe(true);
		expect(paging.firstSeq).toBe(42);
		expect(paging.loadingOlder).toBe(false);
		expect(paging.olderError).toBeNull();
	});

	it('hasMore undefined and empty entries collapse to the safe defaults', () => {
		const { paging } = makePaging([], undefined);
		expect(paging.hasOlder).toBe(false);
		expect(paging.firstSeq).toBe(-1);
	});
});

describe('Paging.loadOlder', () => {
	it('no-ops without touching the wire when hasOlder is false', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const { paging } = makePaging([{ seq: 5, text: 'x' }], false);

		await paging.loadOlder();

		expect(fetchMock).not.toHaveBeenCalled();
		expect(paging.loadingOlder).toBe(false);
	});

	it('no-ops when there is no page anchor (firstSeq <= 0)', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const { paging } = makePaging([], true);

		await paging.loadOlder();

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('fetches beforeSeq=firstSeq, prepends the page, and refreshes hasOlder', async () => {
		const fetchMock = vi.fn(async () => jsonRes({ ok: true, entries: PAGE(3), hasMore: true }));
		vi.stubGlobal('fetch', fetchMock);
		const { paging, store } = makePaging([{ seq: 10, text: 'head' }], true);

		await paging.loadOlder();

		expect(fetchMock).toHaveBeenCalledExactlyOnceWith('/api/dsh/session/sess-1/history?beforeSeq=10');
		expect(store.prependOlder).toHaveBeenCalledExactlyOnceWith([PAGE(3)[0]]);
		expect(paging.hasOlder).toBe(true);
		expect(paging.firstSeq).toBe(3);
		expect(paging.olderError).toBeNull();
		expect(paging.loadingOlder).toBe(false);
	});

	it('hasMore=false on the page ends the ladder', async () => {
		const fetchMock = vi.fn(async () => jsonRes({ ok: true, entries: PAGE(3), hasMore: false }));
		vi.stubGlobal('fetch', fetchMock);
		const { paging } = makePaging([{ seq: 10, text: 'head' }], true);

		await paging.loadOlder();
		expect(paging.hasOlder).toBe(false);
	});

	it('a duplicate page (nothing added) ends the ladder even with hasMore=true', async () => {
		const fetchMock = vi.fn(async () => jsonRes({ ok: true, entries: [], hasMore: true }));
		vi.stubGlobal('fetch', fetchMock);
		const { paging, store } = makePaging([{ seq: 10, text: 'head' }], true);
		store.prependOlder.mockReturnValue(false);

		await paging.loadOlder();
		expect(paging.hasOlder).toBe(false);
	});

	it('an error body keeps the list intact and surfaces the message for retry', async () => {
		const fetchMock = vi.fn(async () => jsonRes({ ok: false, error: { code: 'x', message: 'boom' } }));
		vi.stubGlobal('fetch', fetchMock);
		const { paging } = makePaging([{ seq: 10, text: 'head' }], true);

		await paging.loadOlder();

		expect(paging.olderError).toBe('boom');
		expect(paging.hasOlder).toBe(true);
		expect(paging.loadingOlder).toBe(false);
	});

	it('an HTTP failure without an error body falls back to the status text', async () => {
		const fetchMock = vi.fn(async () => jsonRes({}, false));
		vi.stubGlobal('fetch', fetchMock);
		const { paging } = makePaging([{ seq: 10, text: 'head' }], true);

		await paging.loadOlder();
		expect(paging.olderError).toBe('load older failed (500)');
	});

	it('a thrown fetch surfaces the error message and resets loadingOlder', async () => {
		const fetchMock = vi.fn(async () => {
			throw new Error('wire down');
		});
		vi.stubGlobal('fetch', fetchMock);
		const { paging } = makePaging([{ seq: 10, text: 'head' }], true);

		await paging.loadOlder();
		expect(paging.olderError).toBe('wire down');
		expect(paging.loadingOlder).toBe(false);
	});

	it('concurrent callers join the SAME in-flight promise — one fetch total', async () => {
		let release!: () => void;
		const gate = new Promise<void>((res) => (release = res));
		const fetchMock = vi.fn(async () => {
			await gate;
			return jsonRes({ ok: true, entries: PAGE(3), hasMore: false });
		});
		vi.stubGlobal('fetch', fetchMock);
		const { paging } = makePaging([{ seq: 10, text: 'head' }], true);

		const first = paging.loadOlder();
		const second = paging.loadOlder();
		release();
		await Promise.all([first, second]);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(paging.firstSeq).toBe(3);
		expect(paging.loadingOlder).toBe(false);
	});
});

describe('Paging.loadAllOlder', () => {
	it('drains every remaining page and stops on ledger truth (hasMore false)', async () => {
		let next = 10;
		const fetchMock = vi.fn(async () => {
			const from = next - 1;
			next = from;
			return jsonRes({ ok: true, entries: PAGE(from), hasMore: from > 8 });
		});
		vi.stubGlobal('fetch', fetchMock);
		const { paging } = makePaging([{ seq: 10, text: 'head' }], true);

		await paging.loadAllOlder();

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(paging.firstSeq).toBe(8);
		expect(paging.olderError).toBeNull();
	});

	it('stops as soon as a page reports an error', async () => {
		let call = 0;
		const fetchMock = vi.fn(async () => {
			call += 1;
			if (call === 2) return jsonRes({ ok: false, error: { code: 'x', message: 'mid-drain boom' } });
			return jsonRes({ ok: true, entries: PAGE(9), hasMore: true });
		});
		vi.stubGlobal('fetch', fetchMock);
		const { paging } = makePaging([{ seq: 10, text: 'head' }], true);

		await paging.loadAllOlder();
		expect(paging.olderError).toBe('mid-drain boom');
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('stops when a page makes no progress (firstSeq unchanged)', async () => {
		const fetchMock = vi.fn(async () => jsonRes({ ok: true, entries: PAGE(10), hasMore: true }));
		vi.stubGlobal('fetch', fetchMock);
		const { paging } = makePaging([{ seq: 10, text: 'head' }], true);

		await paging.loadAllOlder();
		// one fetch, then the progress belt-and-braces returns
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(paging.olderError).toBeNull();
	});

	it('no-ops entirely when there is nothing older', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const { paging } = makePaging([{ seq: 10, text: 'head' }], false);

		await paging.loadAllOlder();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('caps a lying server at 200 pages with an honest error', async () => {
			let seq = 500;
		const fetchMock = vi.fn(async () => {
			const e = [{ seq, text: 'older' }];
			seq -= 1;
			return jsonRes({ ok: true, entries: e, hasMore: true });
		});
		vi.stubGlobal('fetch', fetchMock);
		const { paging } = makePaging([{ seq: 10, text: 'head' }], true);

		await paging.loadAllOlder();
		expect(fetchMock).toHaveBeenCalledTimes(200);
		expect(paging.olderError).toBe('stopped after 200 pages — the ledger kept reporting more');
	});
});