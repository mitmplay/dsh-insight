import { describe, expect, it } from 'vitest';

import {
	mintTabId,
	retireTabId,
	healPreserveOrdinal,
	resolveTab
} from '$lib/server/browser/registry.js';
import type { RegistryEntry } from '$lib/server/browser/registry.js';

/** Glass tab ordinal ids (glass-tab-ids task 1) — pure registry-map tests:
 *  mint/heal/retire/resolve never touch a browser, only the per-session
 *  ordinal maps, so these run against a minimal fake entry. */
function makeEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
	return {
		id: 'test-session',
		createdAt: new Date().toISOString(),
		context: {} as RegistryEntry['context'],
		tabs: new Map(),
		tabOrder: [],
		tabIds: new Map(),
		nextTabId: 1,
		activeTargetId: null,
		viewport: { width: 730, height: 830 },
		zoom: 1, // the slider field — irrelevant to ordinals, required by the type
		headless: true,
		port: 0,
		brainPort: 0,
		streamSubscribers: 0,
		lastMcpActivity: Date.now(),
		pid: null,
		profileDir: '/tmp/nope',
		mcpChild: null,
		mcpInProcess: null,
		mcpHealth: 'up',
		mcpError: null,
		ownerSessionId: null, // ADR-0045 amendment 3 D7 — lockstep fixture field
		closed: false,
		...overrides
	};
}

describe('registry ordinal tab ids (glass-tab-ids task 1)', () => {
	it('mint assigns 1, 2, 3… and records both map sides', () => {
		const e = makeEntry();
		expect(mintTabId(e, 'tA')).toBe(1);
		expect(mintTabId(e, 'tB')).toBe(2);
		expect(mintTabId(e, 'tC')).toBe(3);
		expect(e.tabIds.get(1)).toBe('tA');
		expect(e.tabIds.get(2)).toBe('tB');
		expect(e.tabIds.get(3)).toBe('tC');
		expect(e.nextTabId).toBe(4);
		// mint is idempotent per targetId — no double ordinals
		expect(mintTabId(e, 'tA')).toBe(1);
		expect(e.nextTabId).toBe(4);
	});

	it('heal replaces the targetId keeping the SAME ordinal', () => {
		const e = makeEntry();
		const ord = mintTabId(e, 'dead-target');
		expect(ord).toBe(1);
		const kept = healPreserveOrdinal(e, 'dead-target', 'fresh-target');
		expect(kept).toBe(1);
		expect(e.tabIds.get(1)).toBe('fresh-target');
		expect(e.nextTabId).toBe(2); // no ordinal burned by the heal
		// healing an unknown page falls back to a fresh mint
		expect(healPreserveOrdinal(e, 'never-seen', 'new-page')).toBe(2);
	});

	it('retire removes both sides; ordinals are NEVER reused', () => {
		const e = makeEntry();
		mintTabId(e, 't1');
		mintTabId(e, 't2');
		retireTabId(e, 't1');
		expect(e.tabIds.has(1)).toBe(false);
		expect(mintTabId(e, 't3')).toBe(3); // 1 is retired, not reissued
	});

	it("resolve('active') follows activeTargetId and its ordinal", () => {
		const e = makeEntry();
		mintTabId(e, 'tA');
		mintTabId(e, 'tB');
		e.activeTargetId = 'tB';
		expect(resolveTab(e, 'active')).toEqual({ ok: true, targetId: 'tB', tabId: 2 });
		// following the pointer: repoint and resolve again
		e.activeTargetId = 'tA';
		expect(resolveTab(e, 'active')).toEqual({ ok: true, targetId: 'tA', tabId: 1 });
		// no active tab at all — explicit error, never a silent guess
		e.activeTargetId = null;
		expect(resolveTab(e, 'active').ok).toBe(false);
	});

	it('resolve by ordinal (number or numeric string); retired/unknown is an explicit error', () => {
		const e = makeEntry();
		mintTabId(e, 'tA');
		mintTabId(e, 'tB');
		retireTabId(e, 'tA');
		expect(resolveTab(e, 2)).toEqual({ ok: true, targetId: 'tB', tabId: 2 });
		expect(resolveTab(e, '2')).toEqual({ ok: true, targetId: 'tB', tabId: 2 });
		// by targetId string still works
		expect(resolveTab(e, 'tB')).toEqual({ ok: true, targetId: 'tB', tabId: 2 });
		// retired ordinal — explicit error, NO nearest-match
		expect(resolveTab(e, 1).ok).toBe(false);
		expect(resolveTab(e, '1').ok).toBe(false);
		// unknown ordinal / unknown targetId
		expect(resolveTab(e, 99).ok).toBe(false);
		expect(resolveTab(e, 'nope').ok).toBe(false);
		expect(resolveTab(e, 'not-a-number').ok).toBe(false);
	});
});
