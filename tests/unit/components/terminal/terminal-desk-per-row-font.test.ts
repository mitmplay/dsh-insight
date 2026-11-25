/**
 * TerminalDesk per-row font wiring (ADR-0083 2.1-T) — the desk relays
 * each pane its OWN font: a restored mirror honors every row's stored
 * fontPx (split slot or scalar), a legacy row seeds ONCE from the old
 * floor global, and dragging pane 1's slider fires pane 1 only — pane 2's
 * forwarded font never hears it. TerminalPanel is swapped for the font
 * stub double so the forwarded termFontSize prop is observable as
 * data-font, and dragFont fires the real onFontChange channel.
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/components/terminal/TerminalPanel.svelte', async () =>
	await import('../../TerminalFontPanelStub.svelte')
);

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

type FetchRoute = (url: string, init?: RequestInit) => Promise<Response> | undefined;
let fetchRoute: FetchRoute = () => undefined;

function jsonResponse(body: unknown): Response {
	return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

async function tick(ms = 10): Promise<void> {
	await new Promise((r) => setTimeout(r, ms));
}

function stubInstances(): Array<{ sessionId: string | null; dragFont: (px: number) => void }> {
	return ((globalThis as { __stubPanelInstances?: unknown[] }).__stubPanelInstances ?? []) as never;
}

function panes(target: HTMLElement): Array<HTMLElement> {
	return Array.from(target.querySelectorAll('[data-testid="terminal-panel"]'));
}

async function mountDesk(props: Record<string, unknown> = {}): Promise<{ target: HTMLElement; mirrors: unknown[]; cleanup: () => void }> {
	(globalThis as { __stubPanelEvents?: unknown[] }).__stubPanelEvents = [];
	(globalThis as { __stubPanelInstances?: unknown[] }).__stubPanelInstances = [];
	const mirrors: unknown[] = [];
	const { default: Host } = await import('../../TerminalDeskHost.svelte');
	const target = document.body.appendChild(document.createElement('div'));
	const app = mount(Host, {
		target,
		props: { onShellExit: () => {}, onMirror: (m: unknown) => mirrors.push(m), ...props }
	});
	flushSync();
	await tick();
	await tick();
	flushSync();
	return { target, mirrors, cleanup: () => { unmount(app); target.remove(); } };
}

beforeEach(() => {
	localStorage.clear();
	vi.stubGlobal('fetch', vi.fn((url: string | URL | Request, init?: RequestInit) => fetchRoute(String(url), init)));
});

afterEach(() => {
	vi.unstubAllGlobals();
	localStorage.clear();
	document.body.innerHTML = '';
});

function liveRoute(sessions: string[]): FetchRoute {
	return (url, init) => {
		if (url === '/api/terminal' && !init) return Promise.resolve(jsonResponse({ enabled: true, sessions: sessions.map((id) => ({ id, exited: false })) }));
		if (typeof url === 'string' && url.includes('/reattach')) {
			return Promise.resolve(jsonResponse({ token: 'tok-' + url.split('/').slice(-2)[0] }));
		}
		return Promise.resolve(jsonResponse({}));
	};
}

describe('TerminalDesk — per-row font wiring (ADR-0083 2.1-T)', () => {
	it('boot from a restored split mirror honors EACH row\'s stored fontPx', async () => {
		fetchRoute = liveRoute(['s1', 's2']);
		const h = await mountDesk({
			restored: { tabs: [{ sessionIds: ['s1', 's2'], rowFonts: [14, 10] }], selectedTab: 0 }
		});
		const fonts = panes(h.target).map((p) => p.getAttribute('data-font'));
		expect(fonts).toEqual(['14', '10']);
		h.cleanup();
	});

	it('a single-row tab seeds its scalar fontPx; a legacy row seeds ONCE from the old global', async () => {
		localStorage.setItem('dsi-panels', JSON.stringify({ panels: [], panelWidth: 600, zoom: 1, termFontSize: 16 }));
		fetchRoute = liveRoute(['s1', 's2']);
		const h = await mountDesk({
			restored: { tabs: [{ sessionIds: ['s1'], fontPx: 13 }, { sessionIds: ['s2'] }], selectedTab: 0 }
		});
		const fonts = panes(h.target).map((p) => p.getAttribute('data-font'));
		expect(fonts).toEqual(['13', '16']); // own scalar wins; legacy row takes the old floor value
		h.cleanup();
	});

	it('dragging pane 1 fires pane 1 ONLY — pane 2\'s forwarded font is untouched', async () => {
		fetchRoute = liveRoute(['s1', 's2']);
		const h = await mountDesk({
			restored: { tabs: [{ sessionIds: ['s1', 's2'], rowFonts: [14, 10] }], selectedTab: 0 }
		});
		const instances = stubInstances();
		expect(instances).toHaveLength(2);
		instances[0].dragFont(16);
		flushSync();
		const fonts = panes(h.target).map((p) => p.getAttribute('data-font'));
		expect(fonts).toEqual(['16', '10']); // pane 2 never hears the drag
		// The drag persists through the EXISTING onMirror path — rowFonts
		// index-aligned with the remembered sessionIds.
		const last = h.mirrors[h.mirrors.length - 1] as { tabs: Array<{ sessionIds: string[]; rowFonts?: number[]; fontPx?: number }> };
		expect(last.tabs[0].rowFonts).toEqual([16, 10]);
		h.cleanup();
	});

	it('the clamp is the desk\'s single bound site — an out-of-band drag clamps', async () => {
		fetchRoute = liveRoute(['s1']);
		const h = await mountDesk({
			restored: { tabs: [{ sessionIds: ['s1'], fontPx: 12 }], selectedTab: 0 }
		});
		const instances = stubInstances();
		instances[0].dragFont(99);
		flushSync();
		expect(panes(h.target)[0].getAttribute('data-font')).toBe('20');
		const last = h.mirrors[h.mirrors.length - 1] as { tabs: Array<{ fontPx?: number }> };
		expect(last.tabs[0].fontPx).toBe(20);
		h.cleanup();
	});
});
