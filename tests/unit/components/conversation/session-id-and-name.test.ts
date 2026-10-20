/**
 * SessionIdAndName tests (2026-08-23; copy-id moved out 2026-08-25): the
 * identity cluster — workspace chip PREFIXED to the title button, title
 * display, and the inline rename form living INSIDE the container
 * (input + Save + Cancel + error). The session id rides the container's
 * data-session-id attribute (the copy-id button now lives in the floor's
 * PanelHeader).
 */
import { mount, unmount, flushSync, type ComponentProps } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import SessionIdAndName from '$lib/components/conversation/header/SessionIdAndName.svelte';

function mountCluster(props: Partial<ComponentProps<typeof SessionIdAndName>> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const ontitlechange = vi.fn();
	const comp = mount(SessionIdAndName, {
		target,
		props: {
			sessionId: 's-abc-123',
			title: null,
			initialTitle: null,
			ontitlechange,
			...props
		}
	});
	return { target, ontitlechange, cleanup: () => { unmount(comp); target.remove(); } };
}

describe('SessionIdAndName', () => {
	it('carries no copy-id button; the id rides the container attribute', () => {
		const { target, cleanup } = mountCluster({ title: 'My session' });
		const container = target.querySelector('[data-testid="session-id-and-name"]') as HTMLElement;
		expect(container).not.toBeNull();
		expect(container.getAttribute('data-session-id')).toBe('s-abc-123');
		// The copy-id affordance moved to the floor's PanelHeader — nothing
		// copy-ish remains here.
		expect(container.querySelector('[data-testid="session-id"]')).toBeNull();
		expect(container.querySelector('button[aria-label="Copy session id"]')).toBeNull();
		cleanup();
	});

	it('workspace chip renders PREFIXED to the title button (geometry)', () => {
		const { target, cleanup } = mountCluster({
			title: 'My session',
			workspace: '/Users/wharsojo/Projects/dsi'
		});
		const container = target.querySelector('[data-testid="session-id-and-name"]') as HTMLElement;
		const chip = container.querySelector('[data-testid="session-workspace"]') as HTMLElement;
		const titleBtn = container.querySelector('[data-testid="session-title"]') as HTMLElement;
		expect(chip).not.toBeNull();
		expect(chip.textContent).toContain('dsi'); // basename label
		expect(chip.getAttribute('title')).toBe('/Users/wharsojo/Projects/dsi'); // full path
		// Prefix geometry: the chip sits LEFT of the title button.
		expect(chip.getBoundingClientRect().right <= titleBtn.getBoundingClientRect().left).toBe(true);
		cleanup();
	});

	it('registered workspace → registry title label (ADR D5 header-chip parity, 2026-09-07)', () => {
		const { target, cleanup } = mountCluster({
			title: 'My session',
			workspace: '/Users/wharsojo/Projects/dsi',
			workspaces: [{ id: 'w1', path: '/Users/wharsojo/Projects/dsi', title: 'Agentic-AI Loh' } as never]
		});
		const chip = target.querySelector('[data-testid="session-workspace"]') as HTMLElement;
		expect(chip.textContent).toContain('Agentic-AI Loh'); // registry title, not the basename
		expect(chip.textContent).not.toContain('dsi');
		expect(chip.getAttribute('title')).toBe('/Users/wharsojo/Projects/dsi'); // full path tooltip kept
		expect(chip.className).not.toContain('ghost'); // registered → blue identity
		cleanup();
	});

	it('no workspace → no chip; the title button is the cluster’s first child', () => {
		const { target, cleanup } = mountCluster({ title: 'My session', workspace: null });
		const container = target.querySelector('[data-testid="session-id-and-name"]') as HTMLElement;
		expect(container.querySelector('[data-testid="session-workspace"]')).toBeNull();
		const first = container.firstElementChild as HTMLElement;
		expect(first.getAttribute('data-testid')).toBe('session-title');
		cleanup();
	});

	it('access badge: R/W/F letters after the workspace chip, label on the tooltip', () => {
		const cases = [
			['read-only', 'R', 'Access: Read only'],
			['workspace-write', 'W', 'Access: Workspace write'],
			['danger-full-access', 'F', 'Access: Full access'],
			['custom', 'C', 'Access: Custom']
		] as const;
		for (const [mode, letter, label] of cases) {
			const { target, cleanup } = mountCluster({
				title: 'My session',
				workspace: '/tmp/proj',
				access: mode
			});
			const container = target.querySelector('[data-testid="session-id-and-name"]') as HTMLElement;
			const badge = container.querySelector('[data-testid="session-access"]') as HTMLElement;
			expect(badge, mode).not.toBeNull();
			// 2026-08-26: brackets dropped by manual design change — bare letter.
			expect(badge.textContent, mode).toBe(letter);
			expect(badge.getAttribute('title'), mode).toBe(label);
			// Geometry: the badge sits BETWEEN the workspace chip and the title.
			const chip = container.querySelector('[data-testid="session-workspace"]') as HTMLElement;
			const titleBtn = container.querySelector('[data-testid="session-title"]') as HTMLElement;
			expect(chip.getBoundingClientRect().right <= badge.getBoundingClientRect().left).toBe(true);
			expect(badge.getBoundingClientRect().right <= titleBtn.getBoundingClientRect().left).toBe(true);
			cleanup();
		}
	});

	it('access badge colors: green R, amber W, red F, neutral slate C (traffic light by consequence)', () => {
		// Three-state lamp sweep (2026-10-10): badges speak token classes so
		// they flip with data-theme — pass/pending/fail + neutral border.
		const cases = [
			['read-only', 'status-pass'],
			['workspace-write', 'status-pending'],
			['danger-full-access', 'danger-wash'],
			['custom', 'surface']
		] as const;
		for (const [mode, tone] of cases) {
			const { target, cleanup } = mountCluster({ access: mode });
			const badge = target.querySelector('[data-testid="session-access"]') as HTMLElement;
			expect(badge, mode).not.toBeNull();
			// One tone family across border + bg + text — readable at a glance.
			expect(badge.className, mode).toContain(`border-${tone}`); // danger-wash pairs with its -border token
			expect(badge.className, mode).toContain(`bg-${tone}`);
			expect(badge.className, mode).toContain('text-');
			// The mode itself rides the element for e2e/CSS-free assertions.
			expect(badge.getAttribute('data-access'), mode).toBe(mode);
			cleanup();
		}
	});

	it('access badge: null or unknown mode renders nothing (never a guess)', () => {
		for (const access of [null, undefined, 'some-deployment-preset']) {
			const { target, cleanup } = mountCluster({ title: 'My session', access });
			const container = target.querySelector('[data-testid="session-id-and-name"]') as HTMLElement;
			expect(container.querySelector('[data-testid="session-access"]'), String(access)).toBeNull();
			cleanup();
		}
	});

	it('no title → id-prefix fallback text', () => {
		const { target, cleanup } = mountCluster({ title: null });
		expect((target.querySelector('[data-testid="session-title"]') as HTMLElement).textContent).toContain('s-abc-123');
		cleanup();
	});

	it('clicking the title opens the INLINE form inside the container (input + Save + Cancel)', async () => {
		const { target, cleanup } = mountCluster({ title: 'Old' });
		(target.querySelector('[data-testid="session-title"]') as HTMLElement).click();
		flushSync();
		const container = target.querySelector('[data-testid="session-id-and-name"]') as HTMLElement;
		expect(container.querySelector('[data-testid="rename-input"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="rename-save"]')).not.toBeNull();
		expect(container.querySelector('[data-testid="rename-cancel"]')).not.toBeNull();
		const input = container.querySelector('[data-testid="rename-input"]') as HTMLInputElement;
		expect(input.value).toBe('Old'); // draft seeds from the current title
		cleanup();
	});

	it('accepted rename: POSTs, adopts the normalized title, notifies the page, closes the form', async () => {
		// URL-aware mock: the copy-path mount effect (Session Full Path,
		// 2026-09-14) also fetches on mount — answer it 404 and give the
		// rename POST its response by URL, not by call order.
		const fetchMock = vi.fn((input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes('/path')) {
				return Promise.resolve(new Response(JSON.stringify({ ok: false }), { status: 404 }));
			}
			return Promise.resolve(
				new Response(JSON.stringify({ ok: true, title: 'Normalized Title' }), { status: 200 })
			);
		});
		vi.stubGlobal('fetch', fetchMock);
		const { target, ontitlechange, cleanup } = mountCluster({ title: 'Old' });

		(target.querySelector('[data-testid="session-title"]') as HTMLElement).click();
		flushSync();
		const input = target.querySelector('[data-testid="rename-input"]') as HTMLInputElement;
		input.value = 'New Name';
		input.dispatchEvent(new Event('input'));
		flushSync();
		(target.querySelector('[data-testid="rename-save"]') as HTMLElement).click();
		await vi.waitFor(() => expect(ontitlechange).toHaveBeenCalledWith('Normalized Title'));

		expect(fetchMock).toHaveBeenCalledWith(
			'/api/dsh/session/s-abc-123/rename',
			expect.objectContaining({ method: 'POST' })
		);
		expect(target.querySelector('[data-testid="rename-input"]')).toBeNull(); // form closed
		vi.unstubAllGlobals();
		cleanup();
	});

	it('rejected rename keeps the form open with the error INSIDE the container', async () => {
		// URL-aware mock — same reason as the accepted-rename case above.
		const fetchMock = vi.fn((input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes('/path')) {
				return Promise.resolve(new Response(JSON.stringify({ ok: false }), { status: 404 }));
			}
			return Promise.resolve(
				new Response(JSON.stringify({ ok: false, error: { message: 'name taken' } }), { status: 409 })
			);
		});
		vi.stubGlobal('fetch', fetchMock);
		const { target, ontitlechange, cleanup } = mountCluster({ title: 'Old' });

		(target.querySelector('[data-testid="session-title"]') as HTMLElement).click();
		flushSync();
		const input = target.querySelector('[data-testid="rename-input"]') as HTMLInputElement;
		input.value = 'Taken';
		input.dispatchEvent(new Event('input'));
		flushSync();
		(target.querySelector('[data-testid="rename-save"]') as HTMLElement).click();
		await vi.waitFor(() => expect(target.querySelector('[data-testid="rename-error"]')).not.toBeNull());

		const container = target.querySelector('[data-testid="session-id-and-name"]') as HTMLElement;
		expect(container.querySelector('[data-testid="rename-error"]')?.textContent).toContain('name taken');
		expect(target.querySelector('[data-testid="rename-input"]')).not.toBeNull(); // still editing
		expect(ontitlechange).not.toHaveBeenCalled(); // old title kept
		vi.unstubAllGlobals();
		cleanup();
	});

	it('Escape cancels the edit — draft discarded, display state back', () => {
		const { target, cleanup } = mountCluster({ title: 'Old' });
		(target.querySelector('[data-testid="session-title"]') as HTMLElement).click();
		flushSync();
		const input = target.querySelector('[data-testid="rename-input"]') as HTMLInputElement;
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		flushSync();
		expect(target.querySelector('[data-testid="rename-input"]')).toBeNull();
		expect((target.querySelector('[data-testid="session-title"]') as HTMLElement).textContent).toContain('Old');
		cleanup();
	});
});
