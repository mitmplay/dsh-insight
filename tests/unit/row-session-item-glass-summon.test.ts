/**
 * The ghost-summon family rule (operator bug 2026-10-24): clicking a
 * folded-glass SPINE row brings back the OPENER conversation too — the
 * glass must never land on the floor as an orphan. Order pinned:
 * opener panel added first, glass summoned second (D6 pins it beside
 * its family). Registry handlers are spies.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
	registerAddPanel,
	registerSummonGlass
} from '$lib/services/panels/panel-registry';
import RowSessionItem from '$lib/components/sessions/RowSessionItem.svelte';

const calls: string[] = [];
const summonOpts: Array<{ replace: boolean; keepSelection?: boolean }> = [];
registerAddPanel((req) => {
	calls.push('add:' + req.sessionId);
	return true;
});
registerSummonGlass((glass, opts) => {
	calls.push('summon:' + (glass.sessionId ?? ''));
	summonOpts.push(opts);
});

function glassRow(): import("$lib/types").DsiSessionSummary {
	return {
		sessionId: "glass-1",
		title: "Browser — Closing-Ghost",
		agentPreset: null,
		running: false,
		blank: false,
		updatedAt: 0,
		workspace: "/tmp/w",
		turns: null,
		parentSessionId: "opener-1",
		origin: 'browser' as const
	};
}

describe('spine glass-row summon adopts the opener (operator bug 2026-10-24)', () => {
	afterEach(() => {
		calls.length = 0;
		summonOpts.length = 0;
		document.body.innerHTML = "";
	});

	it('clicking the row adds the OPENER panel first, then summons the glass', async () => {
		const target = document.createElement("div");
		document.body.appendChild(target);
		const instance = mount(RowSessionItem, {
			target,
			props: { session: glassRow(), workspaces: [] }
		});
		flushSync();
		target.querySelector('[data-testid="sidebar-session-card"]')!.dispatchEvent(
			new MouseEvent("click", { bubbles: true })
		);
		await Promise.resolve();
		flushSync();
		expect(calls).toEqual(["add:opener-1", "summon:glass-1"]);
		// the ghost click focuses the GLASS — keepSelection false (focus contract)
		expect(summonOpts[0]?.keepSelection).toBe(false);
		unmount(instance);
	});
});