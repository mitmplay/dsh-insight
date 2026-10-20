/**
 * Session copy-path button tests (Task 2.1-T, spec "2026-09-14 - The
 * Session Full Path", ADR D4) — the header affordance contract:
 *   - HIDDEN until /api/dsh/session/{id}/path answers 200 (no
 *     visible-disabled guess state);
 *   - present with the copied value after 200;
 *   - hidden again on 404 (and on id change → refetch);
 *   - click writes the DIRECTORY path (never an id, never a file path)
 *     to the clipboard via the house 2s-check feedback;
 *   - data-testid="conversation-header-copy-path" and FIRST-child
 *     placement in the identity cluster;
 *   - the floor's panel-header-copy-id affordance is untouched (it lives
 *     in PanelHeader — asserted absent here, pinned by its own suite).
 */
import { mount, unmount, flushSync, type ComponentProps } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SessionIdAndName from '$lib/components/conversation/header/SessionIdAndName.svelte';

const PATH = '/Users/op/.dsh/sessions/--Users-op-proj--/session-abc-123';

function okFetch(): ReturnType<typeof vi.fn> {
	return vi.fn().mockResolvedValue(
		new Response(JSON.stringify({ ok: true, path: PATH }), { status: 200 })
	);
}

function mountCluster(props: Partial<ComponentProps<typeof SessionIdAndName>> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(SessionIdAndName, {
		target,
		props: { sessionId: 'abc-123', title: 'My session', initialTitle: null, ...props }
	});
	return { target, cleanup: () => { unmount(comp); target.remove(); } };
}

function button(target: HTMLElement): HTMLElement | null {
	return target.querySelector('[data-testid="conversation-header-copy-path"]');
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('conversation-header-copy-path', () => {
	it('is HIDDEN before the route answers (no guess state)', async () => {
		vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined))); // never settles
		const { target, cleanup } = mountCluster();
		flushSync();
		expect(button(target)).toBeNull();
		cleanup();
	});

	it('renders as the cluster FIRST child with the testid after 200', async () => {
		vi.stubGlobal('fetch', okFetch());
		const { target, cleanup } = mountCluster({ title: 'My session', workspace: '/w' });
		await vi.waitFor(() => expect(button(target)).not.toBeNull());
		const container = target.querySelector('[data-testid="session-id-and-name"]') as HTMLElement;
		expect(container.firstElementChild).toBe(button(target));
		cleanup();
	});

	it('stays hidden on 404 — remote-host DSI is honest absence', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ ok: false, error: { code: 'session-path-not-found' } }), { status: 404 })
			)
		);
		const { target, cleanup } = mountCluster();
		await vi.waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
		flushSync();
		expect(button(target)).toBeNull();
		cleanup();
	});

	it('refetches when sessionId changes (fork) — hidden again after a 404', async () => {
		const fetchMock = vi.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, path: PATH }), { status: 200 }))
			.mockResolvedValue(new Response('{}', { status: 404 }));
		vi.stubGlobal('fetch', fetchMock);
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(SessionIdAndName, {
			target,
			props: { sessionId: 'first', title: null, initialTitle: null }
		});
		await vi.waitFor(() => expect(button(target)).not.toBeNull());
		unmount(comp);
		const target2 = document.createElement('div');
		document.body.appendChild(target2);
		const comp2 = mount(SessionIdAndName, {
			target: target2,
			props: { sessionId: 'forked-id', title: null, initialTitle: null }
		});
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/dsh/session/forked-id/path'));
		await vi.waitFor(() => expect(button(target2)).toBeNull());
		unmount(comp2);
		target.remove();
		target2.remove();
	});

	it('click copies the DIRECTORY path to the clipboard and shows the 2s check', async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
		vi.stubGlobal('fetch', okFetch());
		const { target, cleanup } = mountCluster();
		await vi.waitFor(() => expect(button(target)).not.toBeNull());
		button(target)!.click();
		await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith(PATH));
		expect(writeText).toHaveBeenCalledExactlyOnceWith(PATH);
		cleanup();
	});

	it('clipboard failure is surfaced (false feedback), path kept for retry', async () => {
		const writeText = vi.fn().mockRejectedValue(new Error('denied'));
		vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
		vi.stubGlobal('fetch', okFetch());
		const { target, cleanup } = mountCluster();
		await vi.waitFor(() => expect(button(target)).not.toBeNull());
		button(target)!.click();
		await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
		// Button remains — the operator can retry.
		expect(button(target)).not.toBeNull();
		cleanup();
	});

	it('the floor copy-id affordance does not move here (distinct testids)', async () => {
		vi.stubGlobal('fetch', okFetch());
		const { target, cleanup } = mountCluster();
		await vi.waitFor(() => expect(button(target)).not.toBeNull());
		expect(target.querySelector('[data-testid="panel-header-copy-id"]')).toBeNull();
		expect(target.querySelector('button[aria-label="Copy session id"]')).toBeNull();
		cleanup();
	});
});
