/**
 * GoalEditor unit tests (branch round-up).
 *
 * The component is presentational: fields pre-filled from the panel-owned
 * editor state, callbacks emitted only. These tests pin every branch arm:
 * optional oneditinput/oneditsubmit/oneditcancel called AND left undefined
 * (optional-chaining both arms), all keydown arms on both fields
 * (Enter-without-shift, Enter-with-shift ignored on the textarea, Escape,
 * other keys no-op), and the Save/Cancel button handlers.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import GoalEditor from '$lib/components/bar/goal-bar/GoalEditor.svelte';

let host: HTMLElement;

beforeEach(() => {
	host = document.body.appendChild(document.createElement('div'));
});

afterEach(() => {
	document.body.innerHTML = '';
});

function mountEditor(props: Record<string, unknown> = {}) {
	const comp = mount(GoalEditor, {
		target: host,
		props: { editor: { objective: 'ship it', maxGoalRounds: 12 }, ...props }
	});
	flushSync();
	return comp;
}

describe('GoalEditor — render', () => {
	it('pre-fills objective textarea and rounds input from the editor state', () => {
		const comp = mountEditor();
		const objective = host.querySelector('[data-testid="goal-edit-objective"]') as HTMLTextAreaElement;
		const rounds = host.querySelector('[data-testid="goal-edit-rounds"]') as HTMLInputElement;
		expect(objective.value).toBe('ship it');
		expect(rounds.value).toBe('12');
		expect(rounds.min).toBe('1');
		expect(rounds.step).toBe('1');
		expect(host.querySelector('[data-testid="goal-edit-form"]')).not.toBeNull();
		unmount(comp);
	});
});

describe('GoalEditor — field input callbacks', () => {
	it('textarea input emits oneditinput("objective", value)', () => {
		const oneditinput = vi.fn();
		const comp = mountEditor({ oneditinput });
		const objective = host.querySelector('[data-testid="goal-edit-objective"]') as HTMLTextAreaElement;
		objective.value = 'new objective';
		objective.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(oneditinput).toHaveBeenCalledWith('objective', 'new objective');
		unmount(comp);
	});

	it('rounds input emits oneditinput("maxGoalRounds", value)', () => {
		const oneditinput = vi.fn();
		const comp = mountEditor({ oneditinput });
		const rounds = host.querySelector('[data-testid="goal-edit-rounds"]') as HTMLInputElement;
		rounds.value = '5';
		rounds.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(oneditinput).toHaveBeenCalledWith('maxGoalRounds', '5');
		unmount(comp);
	});

	it('all callbacks undefined: input and keys do not throw (optional-chaining fallback arm)', () => {
		const comp = mountEditor({});
		const objective = host.querySelector('[data-testid="goal-edit-objective"]') as HTMLTextAreaElement;
		const rounds = host.querySelector('[data-testid="goal-edit-rounds"]') as HTMLInputElement;
		expect(() => {
			objective.value = 'x';
			objective.dispatchEvent(new Event('input', { bubbles: true }));
			objective.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
			objective.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
			rounds.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
			(host.querySelector('[data-testid="goal-edit-submit"]') as HTMLElement).click();
			(host.querySelector('[data-testid="goal-edit-cancel"]') as HTMLElement).click();
			flushSync();
		}).not.toThrow();
		unmount(comp);
	});
});

describe('GoalEditor — textarea keydown arms', () => {
	it('Enter without shift submits and preventDefaults', () => {
		const oneditsubmit = vi.fn();
		const oneditcancel = vi.fn();
		const comp = mountEditor({ oneditsubmit, oneditcancel });
		const objective = host.querySelector('[data-testid="goal-edit-objective"]') as HTMLTextAreaElement;
		const prevented = !objective.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		flushSync();
		expect(prevented).toBe(true);
		expect(oneditsubmit).toHaveBeenCalledTimes(1);
		expect(oneditcancel).not.toHaveBeenCalled();
		unmount(comp);
	});

	it('Enter WITH shift does not submit (shiftKey guard false arm) and is not prevented', () => {
		const oneditsubmit = vi.fn();
		const comp = mountEditor({ oneditsubmit });
		const objective = host.querySelector('[data-testid="goal-edit-objective"]') as HTMLTextAreaElement;
		const prevented = !objective.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
		flushSync();
		expect(prevented).toBe(false);
		expect(oneditsubmit).not.toHaveBeenCalled();
		unmount(comp);
	});

	it('Escape cancels', () => {
		const oneditcancel = vi.fn();
		const oneditsubmit = vi.fn();
		const comp = mountEditor({ oneditcancel, oneditsubmit });
		const objective = host.querySelector('[data-testid="goal-edit-objective"]') as HTMLTextAreaElement;
		objective.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		flushSync();
		expect(oneditcancel).toHaveBeenCalledTimes(1);
		expect(oneditsubmit).not.toHaveBeenCalled();
		unmount(comp);
	});

	it('any other key hits the no-op arm of both checks', () => {
		const oneditcancel = vi.fn();
		const oneditsubmit = vi.fn();
		const comp = mountEditor({ oneditcancel, oneditsubmit });
		const objective = host.querySelector('[data-testid="goal-edit-objective"]') as HTMLTextAreaElement;
		const prevented = !objective.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
		flushSync();
		expect(prevented).toBe(false);
		expect(oneditsubmit).not.toHaveBeenCalled();
		expect(oneditcancel).not.toHaveBeenCalled();
		unmount(comp);
	});
});

describe('GoalEditor — rounds-input keydown arms', () => {
	it('Enter submits and preventDefaults', () => {
		const oneditsubmit = vi.fn();
		const comp = mountEditor({ oneditsubmit });
		const rounds = host.querySelector('[data-testid="goal-edit-rounds"]') as HTMLInputElement;
		const prevented = !rounds.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
		flushSync();
		expect(prevented).toBe(true);
		expect(oneditsubmit).toHaveBeenCalledTimes(1);
		unmount(comp);
	});

	it('Escape cancels; other keys no-op', () => {
		const oneditcancel = vi.fn();
		const oneditsubmit = vi.fn();
		const comp = mountEditor({ oneditcancel, oneditsubmit });
		const rounds = host.querySelector('[data-testid="goal-edit-rounds"]') as HTMLInputElement;
		rounds.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
		flushSync();
		expect(oneditcancel).not.toHaveBeenCalled();
		expect(oneditsubmit).not.toHaveBeenCalled();
		rounds.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		flushSync();
		expect(oneditcancel).toHaveBeenCalledTimes(1);
		unmount(comp);
	});
});

describe('GoalEditor — button handlers', () => {
	it('Save clicks submit; Cancel clicks cancel', () => {
		const oneditsubmit = vi.fn();
		const oneditcancel = vi.fn();
		const comp = mountEditor({ oneditsubmit, oneditcancel });
		(host.querySelector('[data-testid="goal-edit-submit"]') as HTMLElement).click();
		flushSync();
		expect(oneditsubmit).toHaveBeenCalledTimes(1);
		expect(oneditcancel).not.toHaveBeenCalled();
		(host.querySelector('[data-testid="goal-edit-cancel"]') as HTMLElement).click();
		flushSync();
		expect(oneditcancel).toHaveBeenCalledTimes(1);
		unmount(comp);
	});
});
