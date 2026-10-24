/**
 * The Glass Close Ladder (2026-10-24) task 2.2-T: the folded-glass ghost
 * rows derive PURELY from the slot mirror — a removeBrowserSlot prune
 * drops the roster ghost and the spine nest in the same derived stroke,
 * no reload (ADR D4). A failed-status glass is not a prune: only a
 * REMOVED entry drops rows.
 */
import { describe, expect, it } from 'vitest';

import { get } from 'svelte/store';

import { browserSlotStore, persistBrowserSlots, removeBrowserSlot } from '$lib/services/panels/browser-session-resolver.js';
import { foldedGlassRowsFor } from '$lib/services/panels/panel-rows';

function fakeStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
	const store = new Map<string, string>();
	return {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void store.set(k, v),
		removeItem: (k: string) => void store.delete(k)
	};
}

describe('foldedGlassRowsFor — ghost rows drop with the pruned slot (2.2)', () => {
	it('removing the slot entry drops the ghost row in the same stroke', () => {
		const st = fakeStorage();
		persistBrowserSlots([
			{ index: 0, sessionId: "bs-1", openedBy: "opener-a", folded: true },
			{ index: 1, sessionId: "bs-2", openedBy: "opener-b", folded: true }
		], st);
		const depthOf = (id: string) => (id === "opener-a" ? 2 : 0);
		const titleFor = (id: string) => "T-" + id;
		const before = foldedGlassRowsFor(get(browserSlotStore), depthOf, titleFor);
		expect(before.map((r) => r.panel.sessionId)).toEqual(["bs-1", "bs-2"]);
		expect(before[0].depth).toBe(3); // opener depth + 1
		expect(before[0].title).toBe("Browser — T-opener-a");
		removeBrowserSlot("bs-1", st);
		const after = foldedGlassRowsFor(get(browserSlotStore), depthOf, titleFor);
		expect(after.map((r) => r.panel.sessionId)).toEqual(["bs-2"]);
	});

	it('unfolded or key-less slots never ship ghost rows', () => {
		const st = fakeStorage();
		persistBrowserSlots([
			{ index: 0, sessionId: "live-1", openedBy: "opener-a" },
			{ index: 1, folded: true }
		], st);
		expect(foldedGlassRowsFor(get(browserSlotStore), () => 0, () => null)).toEqual([]);
	});
});