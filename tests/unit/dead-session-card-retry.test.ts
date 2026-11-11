/**
 * DeadSessionCard — Try again affordance (Born-Late Panel T3-T, ADR-0059
 * D2): the dead card renders the retry control and clicking it fires the
 * wire-bound retry verb; a healthy row (the sidebar session row) never
 * shows the card or its retry. Paraglide key: messages.tryAgain.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DeadSessionCard from '../../src/lib/components/sessions/DeadSessionCard.svelte';
import RowSessionItemHost from '../fixtures/RowSessionItemHost.svelte';
import type { DsiSessionSummary, DsiWorkspaceSummary } from '../../src/lib/types';

const workspaces: DsiWorkspaceSummary[] = [];

function mountCard() {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const onretry = vi.fn();
	const onclose = vi.fn();
	const c = mount(DeadSessionCard, {
		target,
		props: {
			message: 'Session sch-1 not found on the DSH host. It may have been reaped.',
			onretry,
			onclose
		}
	});
	flushSync();
	return { target, onretry, onclose, c };
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('dead-session-card Try again (ADR-0059 T3-T)', () => {
	it('the dead card renders the Try again control with the honest message', () => {
		const { target, c } = mountCard();
		const card = target.querySelector('[data-testid="panel-error"]');
		expect(card).not.toBeNull();
		expect(card?.getAttribute('role')).toBe('alert');
		expect(target.querySelector('[data-testid="panel-error-retry"]')?.textContent?.trim()).toBe('Try again');
		expect(target.querySelector('[data-testid="panel-error-close"]')).not.toBeNull();
		unmount(c);
		target.remove();
	});

	it('clicking Try again fires the retry verb (not close)', () => {
		const { target, onretry, onclose, c } = mountCard();
		(target.querySelector('[data-testid="panel-error-retry"]') as HTMLButtonElement).click();
		flushSync();
		expect(onretry).toHaveBeenCalledTimes(1);
		expect(onclose).not.toHaveBeenCalled();
		unmount(c);
		target.remove();
	});

	it('a healthy session row never shows the card or its retry', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const session: DsiSessionSummary = {
			sessionId: 'healthy-1',
			title: 'A live session',
			workspace: '/tmp/ws',
			running: false,
			updatedAt: Date.now(),
			parentSessionId: null,
			origin: null,
			agentPreset: null
		} as never;
		const c = mount(RowSessionItemHost, { target, props: { session, workspaces } });
		flushSync();
		expect(target.querySelector('[data-testid="panel-error"]')).toBeNull();
		expect(target.querySelector('[data-testid="panel-error-retry"]')).toBeNull();
		unmount(c);
		target.remove();
	});
});
