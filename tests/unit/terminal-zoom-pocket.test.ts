/**
 * Terminal pocket tests (ADR-0041 Amendment 3, the terminal zoom pocket):
 * the pocket wrapper's style IS the pinned fact — net scale 1 inside the
 * row's scale(zoom), engaged only at zoom ≠ 1, null-safe to 1. xterm stays
 * out of the asserted path (the same keep-list position as
 * terminal-panel.test.ts).
 */
import { mount, unmount, flushSync } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TerminalPanelHost from './TerminalPanelHost.svelte';

beforeEach(() => {
	// The solo-mount ladder attaches an SSE stream — stub it closed.
	vi.stubGlobal(
		'EventSource',
		vi.fn(function () {
			return { close() {}, addEventListener() {}, removeEventListener() {} };
		})
	);
	// Probe says enabled; every other endpoint answers ok-empty. The pocket
	// markup renders in the `{:else}` branch regardless of xterm's fate.
	vi.stubGlobal(
		'fetch',
		vi.fn(() =>
			Promise.resolve(
				new Response(JSON.stringify({ enabled: true, sessions: [], ok: true }), {
					headers: { 'content-type': 'application/json' }
				})
			)
		)
	);
});

async function mountWithZoom(zoom: number | null | undefined): Promise<{ app: ReturnType<typeof mount>; target: HTMLElement }> {
	const target = document.body.appendChild(document.createElement('div'));
	const app = mount(TerminalPanelHost, { target, props: { zoom } });
	flushSync();
	await new Promise((r) => setTimeout(r, 20));
	flushSync();
	return { app, target };
}

function pocketStyle(target: HTMLElement): string | null {
	const host = target.querySelector('[data-testid="terminal-host"]');
	if (!host) return null;
	const pocket = host.firstElementChild as HTMLElement | null;
	return pocket?.getAttribute('style') ?? null;
}

describe('TerminalPanel — the terminal zoom pocket (ADR-0041 Am.3)', () => {
	it('at zoom 0.9 the pocket pre-multiplies layout (90%) and counter-scales by 1/0.9', async () => {
		const { app, target } = await mountWithZoom(0.9);
		const style = pocketStyle(target);
		expect(style).toContain('width: 90%');
		expect(style).toContain('height: 90%');
		expect(style).toContain('transform');
		expect(style).toContain('scale(1.1111111111111112)');
		unmount(app);
		target.remove();
	});

	it('at zoom 1 the pocket applies NO transform (byte-equivalent markup)', async () => {
		const { app, target } = await mountWithZoom(1);
		expect(pocketStyle(target)).toBeNull();
		unmount(app);
		target.remove();
	});

	it('null zoom is safe and equals zoom 1 (no transform)', async () => {
		const { app, target } = await mountWithZoom(null);
		expect(pocketStyle(target)).toBeNull();
		unmount(app);
		target.remove();
	});

	it('undefined zoom (prop omitted) behaves as zoom 1', async () => {
		const target = document.body.appendChild(document.createElement('div'));
		const app = mount(TerminalPanelHost, { target });
		flushSync();
		await new Promise((r) => setTimeout(r, 20));
		flushSync();
		expect(pocketStyle(target)).toBeNull();
		unmount(app);
		target.remove();
	});
});
