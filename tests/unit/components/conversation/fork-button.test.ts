/**
 * ForkButton unit tests — the conversation-header session fork shell:
 *  - sub-agent panels hide the button (read-only transcript view)
 *  - click forks WITHOUT an atSeq anchor (body {} — the host cuts at the
 *    last completed turn) and passes the live title through to the spine
 *  - one fork at a time: the button locks (disabled + "forking…") until
 *    the spine resolves, and a click while locked is dropped
 *  - the host's refusal surfaces VERBATIM in a transient alert chip that
 *    auto-clears after 4s; a new attempt clears it immediately
 *  - transport errors and non-JSON HTTP failures render their message too
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ForkButton from '$lib/components/conversation/header/ForkButton.svelte';
import LensForkButtonHost from '../../LensForkButtonHost.svelte';
import {
	registerAddPanel,
	resetPanelRegistryForTests
} from '$lib/services/panels/panel-registry';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	resetPanelRegistryForTests();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	fetchMock.mockReset();
	document.body.innerHTML = '';
});

function jsonRes(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function mountButton(props: {
	sessionId: string;
	title?: string | null;
	agentPreset?: string | null;
	subagent?: boolean;
}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(ForkButton, { target, props });
	flushSync();
	return { target, comp };
}

/** Microtask-only settle — timer-agnostic, so fake-timer tests share it. */
async function settle(): Promise<void> {
	for (let i = 0; i < 12; i++) {
		flushSync();
		await Promise.resolve();
	}
	flushSync();
}

const btn = (target: HTMLElement): HTMLButtonElement =>
	target.querySelector('[data-testid="fork-button"]') as HTMLButtonElement;

const errorChip = (target: HTMLElement): HTMLElement | null =>
	target.querySelector('[data-testid="fork-error"]');

describe('ForkButton — visibility', () => {
	it('sub-agent panels render nothing (read-only transcript)', () => {
		const { target, comp } = mountButton({ sessionId: 'sub-1', subagent: true });
		expect(btn(target)).toBeNull();
		expect(errorChip(target)).toBeNull();
		expect(target.textContent?.trim()).toBe('');
		unmount(comp);
	});

	it('regular panels render the fork button with its label', () => {
		const { target, comp } = mountButton({ sessionId: 's-1' });
		expect(btn(target).getAttribute('aria-label')).toBe('Fork session');
		expect(btn(target).getAttribute('title')).toContain('Fork session');
		unmount(comp);
	});
});

describe('ForkButton — the fork click', () => {
	it('click forks without an anchor: one POST with body {} — last-completed-turn cut', async () => {
		const add = vi.fn();
		registerAddPanel(add);
		fetchMock.mockImplementation(async () => jsonRes({ ok: true, sessionId: 'child-1' }));
		const { target, comp } = mountButton({ sessionId: 'src-1' });
		btn(target).click();
		await settle();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0];
		expect(String(url)).toBe('/api/dsh/session/src-1/fork');
		expect(JSON.parse(String(init?.body))).toEqual({});
		expect(errorChip(target)).toBeNull();
		unmount(comp);
	});

	it('the live title reaches the spine — the child is renamed " (fork)"', async () => {
		registerAddPanel(vi.fn());
		fetchMock.mockImplementation(async (url: URL | Request | string) =>
			String(url).endsWith('/rename')
				? jsonRes({ ok: true, title: 'Loader (fork)' })
				: jsonRes({ ok: true, sessionId: 'child-1' })
		);
		const { target, comp } = mountButton({ sessionId: 'src-1', title: 'Loader' });
		btn(target).click();
		await settle();
		const renameCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/rename'));
		expect(renameCall).toBeDefined();
		expect(JSON.parse(String(renameCall?.[1]?.body))).toEqual({ title: 'Loader (fork)' });
		expect(errorChip(target)).toBeNull();
		unmount(comp);
	});

	it('no title → no rename POST (nothing to disambiguate)', async () => {
		registerAddPanel(vi.fn());
		fetchMock.mockImplementation(async () => jsonRes({ ok: true, sessionId: 'child-1' }));
		const { target, comp } = mountButton({ sessionId: 'src-1' });
		btn(target).click();
		await settle();
		expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/rename'))).toHaveLength(0);
		unmount(comp);
	});
});

describe('ForkButton — the forking lock', () => {
	it('in-flight: button disabled with the "forking…" label; a second click is dropped', async () => {
		registerAddPanel(vi.fn());
		let resolveFetch!: (r: Response) => void;
		const gate = new Promise<Response>((resolve) => {
			resolveFetch = resolve;
		});
		fetchMock.mockImplementation(() => gate);
		const { target, comp } = mountButton({ sessionId: 'src-1' });
		btn(target).click();
		await settle();
		expect(btn(target).disabled).toBe(true);
		expect(target.textContent).toContain('forking…');
		// The disabled attribute already swallows .click(); a synthetic
		// bubbling click proves the in-code lock too — fork() early-returns.
		btn(target).dispatchEvent(new MouseEvent('click', { bubbles: true }));
		await settle();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		resolveFetch(jsonRes({ ok: true, sessionId: 'child-1' }));
		await settle();
		expect(btn(target).disabled).toBe(false);
		expect(target.textContent).not.toContain('forking…');
		unmount(comp);
	});
});

describe('ForkButton — failure surfacing', () => {
	it('a host refusal surfaces verbatim in an alert chip; the lock releases', async () => {
		const { target, comp } = mountButton({ sessionId: 'src-1' });
		fetchMock.mockImplementation(async () =>
			jsonRes({ ok: false, error: { message: 'source has an open turn' } })
		);
		btn(target).click();
		await settle();
		const chip = errorChip(target);
		expect(chip).not.toBeNull();
		expect(chip?.getAttribute('role')).toBe('alert');
		expect(chip?.textContent?.trim()).toBe('source has an open turn');
		expect(btn(target).disabled).toBe(false);
		unmount(comp);
	});

	it('non-JSON HTTP failure renders the status message', async () => {
		const { target, comp } = mountButton({ sessionId: 'src-1' });
		fetchMock.mockResolvedValue(new Response('gateway down', { status: 503 }));
		btn(target).click();
		await settle();
		expect(errorChip(target)?.textContent?.trim()).toBe('fork failed (HTTP 503)');
		unmount(comp);
	});

	it('a transport failure renders the error message', async () => {
		const { target, comp } = mountButton({ sessionId: 'src-1' });
		fetchMock.mockRejectedValue(new Error('host unreachable'));
		btn(target).click();
		await settle();
		expect(errorChip(target)?.textContent?.trim()).toBe('host unreachable');
		unmount(comp);
	});

	it('the refusal chip auto-clears after 4s (the header self-heals)', async () => {
		vi.useFakeTimers();
		const { target, comp } = mountButton({ sessionId: 'src-1' });
		fetchMock.mockResolvedValue(new Response('gateway down', { status: 500 }));
		btn(target).click();
		await settle();
		expect(errorChip(target)).not.toBeNull();
		await vi.advanceTimersByTimeAsync(3999);
		flushSync();
		expect(errorChip(target)).not.toBeNull(); // still inside the window
		await vi.advanceTimersByTimeAsync(1);
		flushSync();
		expect(errorChip(target)).toBeNull();
		unmount(comp);
	});

	it('a new attempt clears a standing refusal immediately', async () => {
		const { target, comp } = mountButton({ sessionId: 'src-1' });
		fetchMock.mockResolvedValueOnce(new Response('gateway down', { status: 500 }));
		btn(target).click();
		await settle();
		expect(errorChip(target)).not.toBeNull();
		fetchMock.mockResolvedValueOnce(jsonRes({ ok: true, sessionId: 'child-1' }));
		registerAddPanel(vi.fn());
		btn(target).click();
		await settle();
		expect(errorChip(target)).toBeNull();
		expect(fetchMock).toHaveBeenCalledTimes(2);
		unmount(comp);
	});
});

describe('ForkButton — the lens disable (Panel Loupe D8, 2026-09-04)', () => {
	/** Mount the button inside a lens tree (the LensForkButtonHost
	 *  fixture = the PanelLoupe provider shape). */
	function mountLensButton(props: Record<string, unknown> = {}) {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(LensForkButtonHost, {
			target,
			props: { sessionId: 'src-1', ...props }
		});
		flushSync();
		return { target, comp };
	}

	it('plain mount: the fork button renders enabled (the floor behavior, the probe pin)', () => {
		const { target, comp } = mountButton({ sessionId: 'src-1' });
		expect(btn(target).disabled).toBe(false);
		unmount(comp);
	});

	it('a lens-tree mount renders the button visible and disabled; a forced click never reaches the spine', async () => {
		registerAddPanel(vi.fn());
		fetchMock.mockImplementation(async () => jsonRes({ ok: true, sessionId: 'child-1' }));
		const { target, comp } = mountLensButton();
		const button = btn(target);
		expect(button).not.toBeNull(); // visible — the verb renders whole
		expect(button.disabled).toBe(true); // the real attribute, D8's contract
		button.click(); // happy-dom swallows clicks at disabled buttons
		await settle();
		expect(fetchMock).not.toHaveBeenCalled(); // forkFromSession never fired
		expect(errorChip(target)).toBeNull();
		unmount(comp);
	});
});
