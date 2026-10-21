/**
 * SidebarSessionsList — the viewport-cap heartbeat $effect (ADR-0034).
 *
 * Mounts the sidebar list component directly and spies on the
 * heartbeatScope seam:
 *  - happy-dom ships no IntersectionObserver → the fallback feeds
 *    heartbeatScope.setViewport ALL rendered ids (mode is 'viewport-cap',
 *    the appConfig default);
 *  - with a stubbed global IntersectionObserver: the constructor gets
 *    { rootMargin: '200px 0px' }, every a[data-session-id] anchor inside
 *    [data-testid=sidebar-spine-group-rows] is observe()d, the entries
 *    callback filters by data-session-id + isIntersecting and reports only
 *    the ON ids, unmount disconnect()s, and entries without
 *    data-session-id are skipped.
 */

import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SidebarSessionsList from '$lib/components/sessions/SidebarSessionsList.svelte';
import { heartbeatScope } from '$lib/services/jobs/heartbeat-scope.svelte';
import { defaultSpineGroupPrefs } from '$lib/utils/spine-group-prefs';
import type { DsiSessionSummary } from '$lib/types';

function summary(sessionId: string): DsiSessionSummary {
	return {
		sessionId,
		title: `Session ${sessionId}`,
		agentPreset: 'research',
		running: false,
		blank: false,
		updatedAt: Date.now(),
		workspace: '/tmp/e2e-harness',
		turns: null
	};
}

/** Controllable IntersectionObserver stand-in (conversation-panel pattern):
 *  tests inspect constructor options / observed targets and fire the callback. */
class FakeIntersectionObserver {
	static instances: FakeIntersectionObserver[] = [];
	callback: IntersectionObserverCallback;
	options: IntersectionObserverInit | undefined;
	observed: Element[] = [];
	disconnected = false;

	constructor(
		callback: IntersectionObserverCallback,
		options?: IntersectionObserverInit
	) {
		this.callback = callback;
		this.options = options;
		FakeIntersectionObserver.instances.push(this);
	}

	observe(target: Element): void {
		this.observed.push(target);
	}
	unobserve(): void {}
	disconnect(): void {
		this.disconnected = true;
	}

	/** Fire the entries callback with plain fixture entries. */
	report(
		entries: { target: Element; isIntersecting: boolean }[]
	): void {
		this.callback(entries as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
	}
}

function mountList(visible: DsiSessionSummary[]) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(SidebarSessionsList, {
		target,
		props: {
			current: null,
			visible,
			workspaces: [],
			spine: defaultSpineGroupPrefs()
		}
	});
	flushSync();
	return { target, instance };
}

function rowsAnchors(target: HTMLElement): HTMLElement[] {
	return [
		...target.querySelectorAll<HTMLElement>(
			'[data-testid="sidebar-spine-group-rows"] a[data-session-id]'
		)
	];
}

let setModeSpy: ReturnType<typeof vi.spyOn>;
let setViewportSpy: ReturnType<typeof vi.spyOn>;
let setSpineSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	// Pin the mode BEFORE mounting so the effect's first run takes the
	// viewport-cap branch (the appConfig default already is viewport-cap;
	// this guards against mode leakage from another test file's scope).
	heartbeatScope.setMode('viewport-cap');
	heartbeatScope.reset();
	// Spies that swallow: no real rebuild → no jobsRoster arming / fetch.
	setModeSpy = vi.spyOn(heartbeatScope, 'setMode').mockImplementation(() => {});
	setViewportSpy = vi.spyOn(heartbeatScope, 'setViewport').mockImplementation(() => {});
	setSpineSpy = vi.spyOn(heartbeatScope, 'setSpine').mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	heartbeatScope.reset();
	document.body.innerHTML = '';
});

describe('SidebarSessionsList — viewport-cap heartbeat effect', () => {
	it('no IntersectionObserver (happy-dom): the fallback reports ALL rendered ids via setViewport', () => {
		// This happy-dom build ships an observer; the no-observer DOM still
		// must take the fallback, so stub the global away explicitly.
		vi.stubGlobal('IntersectionObserver', undefined);
		expect(typeof IntersectionObserver).toBe('undefined');
		const { target, instance } = mountList([summary('a'), summary('b'), summary('c')]);
		expect(setModeSpy).toHaveBeenCalledWith('viewport-cap');
		const reported = setViewportSpy.mock.calls.at(-1)?.[0] ?? [];
		expect([...reported].sort()).toEqual(['a', 'b', 'c']);
		unmount(instance);
	});

	it('stubbed observer: rootMargin 200px 0px, every anchor observed, callback reports only ON ids, unmount disconnects', () => {
		FakeIntersectionObserver.instances = [];
		vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
		const { target, instance } = mountList([summary('s1'), summary('s2'), summary('s3')]);

		const io = FakeIntersectionObserver.instances[0];
		expect(io).toBeDefined();
		expect(io!.options).toEqual({ rootMargin: '200px 0px' });

		const anchors = rowsAnchors(target);
		expect(anchors).toHaveLength(3);
		for (const a of anchors) expect(io!.observed).toContain(a);

		// s1 ON, s2 OFF, s3 ON → only s1 and s3 reported
		io!.report([
			{ target: anchors[0]!, isIntersecting: true },
			{ target: anchors[1]!, isIntersecting: false },
			{ target: anchors[2]!, isIntersecting: true }
		]);
		let reported = setViewportSpy.mock.calls.at(-1)?.[0] ?? [];
		expect([...reported].sort()).toEqual(['s1', 's3']);

		// s2 comes into view → the ON set widens
		io!.report([{ target: anchors[1]!, isIntersecting: true }]);
		reported = setViewportSpy.mock.calls.at(-1)?.[0] ?? [];
		expect([...reported].sort()).toEqual(['s1', 's2', 's3']);

		// s1 scrolls out → dropped from the report
		io!.report([{ target: anchors[0]!, isIntersecting: false }]);
		reported = setViewportSpy.mock.calls.at(-1)?.[0] ?? [];
		expect([...reported].sort()).toEqual(['s2', 's3']);

		expect(io!.disconnected).toBe(false);
		unmount(instance);
		expect(io!.disconnected).toBe(true);
	});

	it('an entry whose target lacks data-session-id is skipped', () => {
		FakeIntersectionObserver.instances = [];
		vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
		const { target, instance } = mountList([summary('keep')]);

		const io = FakeIntersectionObserver.instances[0]!;
		const stranger = document.createElement('div'); // no data-session-id
		io.report([
			{ target: stranger, isIntersecting: true },
			{ target: rowsAnchors(target)[0]!, isIntersecting: true }
		]);
		const reported = setViewportSpy.mock.calls.at(-1)?.[0] ?? [];
		expect(reported).toEqual(['keep']);
		unmount(instance);
	});
});
