/**
 * JobsButton — floor arms (coverage headroom, 2026-11-23): the toggle
 * contract of the press/click pair (source L59-L64) and the empty-session
 * read (source L39), which the sibling suite (tests/unit/jobs-button.test.ts)
 * never drives — it only calls `.click()`, whose synthetic detail is 0.
 *
 * Pinned (2026-11-21 press-time rule):
 *  - L60 `if (e.button === 0)`: a PRIMARY pointerdown toggles open (popup
 *    renders + trigger .active); a non-primary press (button 2) never does.
 *  - L63 `if (e.detail === 0)`: keyboard activation (detail 0) toggles; a real
 *    mouse click (detail >= 1) never does — press-time owns the mouse path.
 *  - L39 `sessionId ? jobsRoster.jobs(sessionId) : []`: an empty sessionId
 *    reads [] — NOTHING renders and no roster poll starts.
 * Roster seeding mirrors the sibling (fetch double + fake timers).
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import JobsButton from '../../src/lib/components/anchor/job-anchor/JobsButton.svelte';

const job = (id: string, status: string) => ({
	id,
	kind: 'bash',
	label: 'job ' + id,
	status,
	startedAt: 1,
	output: { total: 256, earliest: 0 }
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	vi.useFakeTimers();
	fetchMock = vi.fn(async (url: string | URL | Request) => {
		const sessionId = new URL(String(url), 'http://localhost').searchParams.get('sessionId');
		return { ok: true, json: async () => ({ ok: true, sessionId, jobs: sessionId === 'conv-1' ? [job('bash-1', 'running')] : [] }) };
	});
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

async function mountButton(sessionId = 'conv-1') {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const component = mount(JobsButton, { target, props: { sessionId } });
	flushSync(); // mount effect → watch() fires
	await vi.advanceTimersByTimeAsync(0); // settle the snapshot fetch chain
	flushSync();
	return { component, target };
}

const triggerOf = (target: HTMLElement) => target.querySelector('[data-testid="jobs-button-trigger"]') as HTMLButtonElement;
const isOpen = (target: HTMLElement): boolean =>
	target.querySelector('[data-testid="jobs-button-popup"]') !== null && triggerOf(target).classList.contains('active');

describe('JobsButton — press/click toggle arms (L60, L63)', () => {
	it('a PRIMARY pointerdown (button 0) opens the popup and marks the trigger active; the next press closes it', async () => {
		const { component, target } = await mountButton();
		const trigger = triggerOf(target);
		expect(isOpen(target)).toBe(false);
		trigger.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
		flushSync();
		expect(isOpen(target)).toBe(true);
		trigger.dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true }));
		flushSync();
		expect(isOpen(target)).toBe(false);
		unmount(component);
	});

	it('a NON-primary pointerdown (button 2) never toggles', async () => {
		const { component, target } = await mountButton();
		triggerOf(target).dispatchEvent(new PointerEvent('pointerdown', { button: 2, bubbles: true }));
		flushSync();
		expect(isOpen(target)).toBe(false);
		unmount(component);
	});

	it('a mouse click (detail 1) never toggles — press-time owns it; keyboard activation (detail 0) still does', async () => {
		const { component, target } = await mountButton();
		const trigger = triggerOf(target);
		trigger.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true }));
		flushSync();
		expect(isOpen(target)).toBe(false);
		// the same node answers the keyboard path — the null above is not a dead handler
		trigger.dispatchEvent(new MouseEvent('click', { detail: 0, bubbles: true }));
		flushSync();
		expect(isOpen(target)).toBe(true);
		unmount(component);
	});
});

describe('JobsButton — empty sessionId (L39 `: []` arm)', () => {
	it('renders NOTHING and starts no roster poll', async () => {
		const { component, target } = await mountButton('');
		expect(target.querySelector('[data-testid="jobs-button"]')).toBeNull();
		expect(target.querySelector('[data-testid="jobs-button-trigger"]')).toBeNull();
		expect(fetchMock.mock.calls.length).toBe(0);
		unmount(component);
	});
});
