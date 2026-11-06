/**
 * SidebarFooter unit tests — the sidebar's bottom strip (extracted from
 * SessionsList, 2026-09-04): the broadcast box above the version chip +
 * "+ New chat" strip, with the hosted missing-selection alert.
 *
 * Pins: the version chip renders both editions; the unarmed create
 * (no preset) raises the HOSTED alert (footer-create's first child,
 * alertInline=false) and its × dismisses it; an armed create rides
 * preset + workspace up through oncreated; the Replace verb
 * (onreplace provided) dispatches through the verb toggle.
 */
import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SidebarFooter from '../../src/lib/components/sessions/SidebarFooter.svelte';
import { APP_VERSION, DSH_VERSION } from '../../src/lib/version';

const jsonResponse = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let instance: Record<string, unknown> | null = null;
let host: HTMLElement | null = null;

function mountFooter(
	props: Partial<Record<string, unknown>> = {},
	fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
): HTMLElement {
	if (fetchImpl) vi.stubGlobal('fetch', vi.fn(fetchImpl));
	host = document.createElement('div');
	document.body.appendChild(host);
	instance = mount(SidebarFooter, {
		target: host,
		props: { preset: null, workspace: null, oncreated: vi.fn(), onreplace: null, ...props }
	});
	flushSync();
	return host;
}

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	host?.remove();
	host = null;
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	localStorage.clear();
});

describe('SidebarFooter — the bottom strip', () => {
	it('renders the two-line version chip and the create strip', () => {
		const h = mountFooter();
		const chip = h.querySelector('[data-testid="sidebar-footer-version"]');
		expect(chip).not.toBeNull();
		expect(chip?.textContent).toContain('v' + APP_VERSION);
		expect(chip?.textContent).toContain('v' + DSH_VERSION);
		expect(h.querySelector('[data-testid="new-chat-button"]')).not.toBeNull();
	});

	it('an UNARMED create (no preset) raises the hosted alert and creates nothing', async () => {
		const oncreated = vi.fn();
		const fetchSpy = vi.fn();
		vi.stubGlobal('fetch', fetchSpy);
		const h = mountFooter({ preset: null, oncreated });
		const create = h.querySelector('[data-testid="new-chat-button"]') as HTMLButtonElement;
		create.click();
		flushSync();
		// The alert is HOSTED here (footer's own copy, not NewChatButton's).
		const alerts = h.querySelectorAll('[data-testid="new-chat-selection-alert"]');
		expect(alerts.length).toBe(1);
		// No POST ever fired — the guard returned before the fetch.
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(oncreated).not.toHaveBeenCalled();
	});

	it('the hosted alert × button dismisses it', async () => {
		const h = mountFooter({ preset: null });
		(h.querySelector('[data-testid="new-chat-button"]') as HTMLButtonElement).click();
		flushSync();
		expect(h.querySelector('[data-testid="new-chat-selection-alert"]')).not.toBeNull();
		(h.querySelector('[data-testid="new-chat-selection-alert-close"]') as HTMLButtonElement).click();
		flushSync();
		expect(h.querySelector('[data-testid="new-chat-selection-alert"]')).toBeNull();
	});

	it('an armed create rides preset + workspace and reports upward through oncreated', async () => {
		const oncreated = vi.fn();
		const h = mountFooter(
			{ preset: 'research', workspace: '/tmp/alpha', oncreated },
			() => jsonResponse({ ok: true, sessionId: 's-new', agentPreset: null })
		);
		(h.querySelector('[data-testid="new-chat-button"]') as HTMLButtonElement).click();
		await new Promise((r) => setTimeout(r, 20));
		flushSync();
		// The dispatch rides the HOST's echoed agentPreset (?? null), not
		// the armed pill — the pill shaped the request body, the response
		// shapes the callback.
		expect(oncreated).toHaveBeenCalledWith('s-new', null);
	});

	it('a create without a workspace posts the preset-only body (host default cwd)', async () => {
		const oncreated = vi.fn();
		const fetchSpy = vi.fn(() => jsonResponse({ ok: true, sessionId: 's-nocwd' }));
		vi.stubGlobal('fetch', fetchSpy);
		const h = mountFooter({ preset: 'main', workspace: null, oncreated });
		(h.querySelector('[data-testid="new-chat-button"]') as HTMLButtonElement).click();
		await new Promise((r) => setTimeout(r, 20));
		flushSync();
		const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
		expect(JSON.parse(String(init?.body))).toEqual({ agentPreset: 'main' });
		expect(oncreated).toHaveBeenCalledWith('s-nocwd', null);
	});

	it('no onreplace → no verb toggle renders', () => {
		const h = mountFooter({ onreplace: null });
		expect(h.querySelector('[data-testid="chat-mode-toggle"]')).toBeNull();
	});

	it('with onreplace, the Replace verb dispatches through the mode toggle', async () => {
		const oncreated = vi.fn();
		const onreplace = vi.fn();
		const h = mountFooter(
			{ preset: 'main', oncreated, onreplace },
			() => jsonResponse({ ok: true, sessionId: 's-rep' })
		);
		expect(h.querySelector('[data-testid="chat-mode-toggle"]')).not.toBeNull();
		(h.querySelector('[data-testid="chat-mode-replace"]') as HTMLButtonElement).click();
		flushSync();
		(h.querySelector('[data-testid="new-chat-button"]') as HTMLButtonElement).click();
		await new Promise((r) => setTimeout(r, 20));
		flushSync();
		expect(onreplace).toHaveBeenCalledWith('s-rep', null);
		expect(oncreated).not.toHaveBeenCalled();
	});
});
