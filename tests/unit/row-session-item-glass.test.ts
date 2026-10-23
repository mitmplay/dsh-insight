/**
 * RowSessionItem × glass rows (cluster T2) — a folded glass's spine row
 * (origin 'browser', ADR-0037 D4): no seed href, and the plain click is
 * the ONE summon seam (summonGlassFromRegistry), never the floor
 * add/replace verbs; the fork cue stays off a glass row even when the
 * session has a parent (fork = conversation lineage only).
 * Mount/stub conventions follow row-session-item-badge.test.ts.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RowSessionItemHost from '../fixtures/RowSessionItemHost.svelte';
import {
	registerAddPanel,
	registerReplaceSelected,
	registerSummonGlass,
	resetPanelRegistryForTests
} from '$lib/services/panels/panel-registry';
import type {
	DsiSessionSummary,
	DsiWorkspaceSummary
} from '$lib/types';
import type { SummonGlassHandler } from '$lib/services/panels/panel-registry';

const workspaces: DsiWorkspaceSummary[] = [];

function glassSession(over: Partial<DsiSessionSummary> = {}): DsiSessionSummary {
	return {
		sessionId: 'glass-1',
		title: 'Folded glass',
		workspace: '/tmp/ws',
		running: false,
		updatedAt: Date.now(),
		parentSessionId: null,
		origin: 'browser',
		agentPreset: null,
		...over
	} as never;
}

vi.stubGlobal(
	'fetch',
	vi.fn(async () => ({
		ok: true,
		json: async () => ({ ok: true, sessionId: 'x', jobs: [] })
	}))
);

function mountRow(session: DsiSessionSummary) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const component = mount(RowSessionItemHost, {
		target,
		props: { session, workspaces }
	});
	flushSync();
	return { component, target };
}

function clickRow(target: HTMLElement): { row: HTMLAnchorElement; click: MouseEvent } {
	const row = target.querySelector('a.row') as HTMLAnchorElement;
	const click = new MouseEvent('click', { bubbles: true, cancelable: true });
	row.dispatchEvent(click);
	return { row, click };
}

afterEach(() => {
	resetPanelRegistryForTests();
});

describe('RowSessionItem glass summon path', () => {
	it('a glass row renders with no seed href (session.origin browser)', () => {
		const { component, target } = mountRow(glassSession());
		const row = target.querySelector('a.row') as HTMLAnchorElement;
		expect(row.getAttribute('href')).toBeNull();
		expect(row.getAttribute('data-session-id')).toBe('glass-1');
		unmount(component);
		target.remove();
	});

	it('plain click summons the glass (sessionId + openedBy = parentSessionId, replace:false) and prevents navigation', () => {
		const summons: Array<{ glass: unknown; opts: { replace: boolean } }> = [];
		const adds: unknown[] = [];
		const replaces: unknown[] = [];
		registerSummonGlass(((glass, opts) => {
			summons.push({ glass, opts });
		}) as SummonGlassHandler);
		registerAddPanel((r) => {
			adds.push(r);
			return true;
		});
		registerReplaceSelected((r) => {
			replaces.push(r);
			return true;
		});
		const { component, target } = mountRow(glassSession({ parentSessionId: 'parent-1' }));
		const { row, click } = clickRow(target);
		expect(summons).toEqual([
			{ glass: { sessionId: 'glass-1', openedBy: 'parent-1' }, opts: { replace: false } }
		]);
		expect(adds).toHaveLength(0);
		expect(replaces).toHaveLength(0);
		expect(click.defaultPrevented).toBe(true);
		unmount(component);
		target.remove();
	});

	it('a glass with no parent summons openedBy: undefined (?? undefined arm)', () => {
		const summons: Array<{ glass: { openedBy?: string }; opts: { replace: boolean } }> = [];
		registerSummonGlass(((glass, opts) => {
			summons.push({ glass, opts });
		}) as SummonGlassHandler);
		const { component, target } = mountRow(glassSession({ parentSessionId: null }));
		clickRow(target);
		expect(summons).toHaveLength(1);
		expect(summons[0].glass.sessionId).toBe('glass-1');
		expect(summons[0].glass.openedBy).toBeUndefined();
		expect('openedBy' in summons[0].glass ? summons[0].glass.openedBy : undefined).toBeUndefined();
		unmount(component);
		target.remove();
	});

	it('the fork cue never renders on a glass row, even with a parent session', () => {
		const { component, target } = mountRow(glassSession({ parentSessionId: 'parent-1' }));
		// WorkspaceRowItem paints the fork cue as .ws-slot.fork (class:fork)
		// — it must stay absent on a glass row (fork = !isGlass arm).
		expect(target.querySelector('.fork')).toBeNull();
		expect(target.querySelector('a.row')).not.toBeNull();
		unmount(component);
		target.remove();
	});
});
