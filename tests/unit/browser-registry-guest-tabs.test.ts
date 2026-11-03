import { describe, expect, it } from 'vitest';

import {
	admitGuestBirth,
	claimOwnerBirth
} from '$lib/server/browser/registry.js';
import type { RegistryEntry } from '$lib/server/browser/registry.js';

/** ADR-0040 Amendment 4 — the Guest's Tab. Pure registry-map tests: the
 *  classification seams (owner claim / guest admission) never touch a
 *  browser, so they run against a minimal fake entry. */
function makeEntry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
	return {
		id: 'test-session',
		createdAt: new Date().toISOString(),
		context: {} as RegistryEntry['context'],
		tabs: new Map(),
		tabIds: new Map(),
		nextTabId: 1,
		tabOrder: ['birth'],
		activeTargetId: 'birth',
		viewport: { width: 730, height: 830 },
		zoom: 1,
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
		ownerSessionId: null,
		ownBirths: new Set<string>(),
		closed: false,
		...overrides
	} as RegistryEntry;
}

describe('guest tab admission (ADR-0040 Amendment 4, D-A5/D-A6)', () => {
	it('owner claim marks the birth; admission refuses a claimed target', () => {
		const e = makeEntry();
		claimOwnerBirth(e, 'owner-tab');
		expect(e.ownBirths?.has('owner-tab')).toBe(true);
		// the browser-level watcher sees the claim and stands down
		expect(admitGuestBirth(e, 'owner-tab')).toBe(false);
		// the owner path (mint + activate) is the 'page' listener's job —
		// admission must not have minted a second ordinal for it
		expect(e.tabOrder).toEqual(['birth']);
	});

	it('guest birth mints an ordinal and lands LAST — pointer NEVER moves', () => {
		const e = makeEntry();
		e.activeTargetId = 'birth';
		const admitted = admitGuestBirth(e, 'guest-tab');
		expect(admitted).toBe(true);
		expect(e.tabOrder).toEqual(['birth', 'guest-tab']); // lands last
		const ord = [...e.tabIds.entries()].find(([, tid]) => tid === 'guest-tab');
		expect(ord).toBeDefined(); // citizen: addressable ordinal
		expect(e.activeTargetId).toBe('birth'); // throne untouched
	});

	it('a known target is a no-op (idempotent with listTabs adoption)', () => {
		const e = makeEntry();
		expect(admitGuestBirth(e, 'birth')).toBe(false);
		expect(e.tabOrder).toEqual(['birth']);
		expect(e.nextTabId).toBe(1); // no ordinal burned
	});

	it('a closed session refuses guests', () => {
		const e = makeEntry({ closed: true });
		expect(admitGuestBirth(e, 'late-tab')).toBe(false);
		expect(e.tabOrder).toEqual(['birth']);
	});

	it('ordinals stay unique across owner and guest paths', () => {
		const e = makeEntry();
		claimOwnerBirth(e, 'owner-tab');
		expect(admitGuestBirth(e, 'guest-tab')).toBe(true);
		const ords = [...e.tabIds.keys()];
		expect(new Set(ords).size).toBe(ords.length);
	});
});
