/**
 * goal-bar tests (task 2.1-T) — the chip + sheet render contract (ADR
 * D2/D4): renders ONLY for phase active / paused / blocked; null,
 * undefined, and complete render nothing; blocked exposes the reason as
 * title and hides Pause; each visible button fires exactly its own
 * callback once per click and no other callback; expanded sheet shows
 * rounds and the blocked reason.
 *
 * Mounts GoalBar directly — presentational, props in / callbacks out
 * (the panel wiring suite covers the panel side in Wave 3).
 */
import { mount, unmount, flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import GoalBar from '$lib/components/anchor/goal/GoalBar.svelte';
import type { GoalResultGoal } from '$lib/utils/goals';

function goal(partial: Partial<GoalResultGoal> = {}): GoalResultGoal {
	return {
		id: 'goal-1',
		revision: 3,
		objective: 'finish the wave',
		phase: 'active',
		roundsStarted: 2,
		maxGoalRounds: 8,
		...partial
	};
}

function mountBar(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const onpause = vi.fn();
	const onresume = vi.fn();
	const onclear = vi.fn();
	const oncreate = vi.fn();
	const onedit = vi.fn();
	const comp = mount(GoalBar, {
		target,
		props: { goal: goal(), onpause, onresume, onclear, oncreate, onedit, ...props }
	});
	flushSync();
	const bar = () => target.querySelector('[data-testid="goal-bar"]');
	const chip = () => target.querySelector('[data-testid="goal-chip"]');
	const sheet = () => target.querySelector('[data-testid="goal-sheet"]');
	const q = (id: string) => target.querySelector('[data-testid="' + id + '"]') as HTMLButtonElement | null;
	const expand = () => {
		(target.querySelector('.goal-chip-label') as HTMLButtonElement).click();
		flushSync();
	};
	const cleanup = () => {
		unmount(comp);
		target.remove();
	};
	return { target, bar, chip, sheet, q, expand, onpause, onresume, onclear, oncreate, onedit, cleanup };
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('GoalBar — render contract (D4)', () => {
	it('null goal renders nothing', () => {
		const h = mountBar({ goal: null });
		expect(h.bar()).toBeNull();
		expect(h.chip()).toBeNull();
		h.cleanup();
	});

	it('undefined goal (key not delivered) renders nothing', () => {
		const h = mountBar({ goal: undefined });
		expect(h.bar()).toBeNull();
		h.cleanup();
	});

	it('complete phase renders nothing', () => {
		const h = mountBar({ goal: goal({ phase: 'complete' }) });
		expect(h.bar()).toBeNull();
		h.cleanup();
	});

	it('active chip: phase label plus objective', () => {
		const h = mountBar();
		expect(h.chip()!.textContent).toContain('active');
		expect(h.chip()!.textContent).toContain('finish the wave');
		h.cleanup();
	});

	it('paused chip shows the paused phase', () => {
		const h = mountBar({ goal: goal({ phase: 'paused' }) });
		expect(h.chip()!.getAttribute('data-phase')).toBe('paused');
		expect(h.chip()!.textContent).toContain('paused');
		h.cleanup();
	});
});

describe('GoalBar — blocked phase', () => {
	const blocked = goal({
		phase: 'blocked',
		blockedReason: { code: 'min-rounds', message: 'host set this goal to blocked' }
	});

	it('blocked chip exposes the reason as its title and hides Pause', () => {
		const h = mountBar({ goal: blocked });
		expect(h.chip()!.getAttribute('data-phase')).toBe('blocked');
		expect(h.chip()!.getAttribute('title')).toContain('min-rounds');
		expect(h.chip()!.getAttribute('title')).toContain('host set this goal to blocked');
		expect(h.q('goal-pause')).toBeNull();
		expect(h.q('goal-edit')).not.toBeNull();
		h.cleanup();
	});

	it('blocked without a reason still renders (reason is optional in the wire)', () => {
		const h = mountBar({ goal: goal({ phase: 'blocked' }) });
		expect(h.chip()!).not.toBeNull();
		expect(h.q('goal-pause')).toBeNull();
		h.cleanup();
	});
});

describe('GoalBar — actions fire exactly their own callback', () => {
	it('active: Pause fires onpause once, nothing else', () => {
		const h = mountBar();
		h.q('goal-pause')!.click();
		flushSync();
		expect(h.onpause).toHaveBeenCalledTimes(1);
		expect(h.onresume).not.toHaveBeenCalled();
		expect(h.onclear).not.toHaveBeenCalled();
		expect(h.onedit).not.toHaveBeenCalled();
		h.cleanup();
	});

	it('paused: Resume fires onresume once; Pause button is gone', () => {
		const h = mountBar({ goal: goal({ phase: 'paused' }) });
		expect(h.q('goal-pause')).toBeNull();
		h.q('goal-resume')!.click();
		flushSync();
		expect(h.onresume).toHaveBeenCalledTimes(1);
		expect(h.onpause).not.toHaveBeenCalled();
		h.cleanup();
	});

	it('Edit and Clear fire their own callbacks', () => {
		const h = mountBar();
		h.q('goal-edit')!.click();
		flushSync();
		h.q('goal-clear')!.click();
		flushSync();
		expect(h.onedit).toHaveBeenCalledTimes(1);
		expect(h.onclear).toHaveBeenCalledTimes(1);
		expect(h.onpause).not.toHaveBeenCalled();
		h.cleanup();
	});
});

describe('GoalBar — absent callbacks hide their buttons (display-only chip)', () => {
	it('no callbacks: only the label renders', () => {
		const target = document.createElement('div');
		document.body.appendChild(target);
		const comp = mount(GoalBar, { target, props: { goal: goal() } });
		flushSync();
		expect(target.querySelector('[data-testid="goal-pause"]')).toBeNull();
		expect(target.querySelector('[data-testid="goal-resume"]')).toBeNull();
		expect(target.querySelector('[data-testid="goal-edit"]')).toBeNull();
		expect(target.querySelector('[data-testid="goal-clear"]')).toBeNull();
		expect(target.querySelector('[data-testid="goal-chip"]')).not.toBeNull();
		unmount(comp);
		target.remove();
	});
});

describe('GoalBar — expanded sheet', () => {
	it('collapsed by default; click expands to the sheet with rounds', () => {
		const h = mountBar();
		expect(h.sheet()).toBeNull();
		h.expand();
		expect(h.sheet()).not.toBeNull();
		expect(h.sheet()!.textContent).toContain('finish the wave');
		expect(h.sheet()!.textContent).toContain('2 of 8 max');
		h.expand();
		expect(h.sheet()).toBeNull();
		h.cleanup();
	});

	it('blocked sheet names the reason', () => {
		const h = mountBar({
			goal: goal({ phase: 'blocked', blockedReason: { code: 'min-rounds', message: 'waiting on the host' } })
		});
		h.expand();
		expect(h.sheet()!.textContent).toContain('waiting on the host');
		h.cleanup();
	});

	it('sheet controls fire the same callbacks', () => {
		const h = mountBar();
		h.expand();
		h.q('goal-edit-sheet')!.click();
		flushSync();
		h.q('goal-clear-sheet')!.click();
		flushSync();
		expect(h.onedit).toHaveBeenCalledTimes(1);
		expect(h.onclear).toHaveBeenCalledTimes(1);
		h.cleanup();
	});
});

describe('goal-bar — editor form (Goal Editor W2, Task 2.1-T)', () => {
	const editorState = { objective: 'finish the wave', maxGoalRounds: 8 };

	function mountEditor(props: Record<string, unknown> = {}) {
		return mountBar({
			editor: { ...editorState },
			oneditinput: vi.fn(),
			oneditsubmit: vi.fn(),
			oneditcancel: vi.fn(),
			...props
		});
	}

	const q = (root: HTMLElement, id: string) => root.querySelector('[data-testid="' + id + '"]') as HTMLElement;
	const type = (el: HTMLElement, value: string) => {
		(el as HTMLInputElement).value = value;
		el.dispatchEvent(new Event('input', { bubbles: true }));
	};
	const key = (el: HTMLElement, k: string, shift = false) => {
		el.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true }));
	};

	it('renders the pre-filled form when editor is present (no sheet expansion needed)', () => {
		const h = mountEditor();
		expect(q(h.target, 'goal-edit-form')).not.toBeNull();
		expect((q(h.target, 'goal-edit-objective') as HTMLTextAreaElement).value).toBe('finish the wave');
		expect((q(h.target, 'goal-edit-rounds') as HTMLInputElement).value).toBe('8');
		h.cleanup();
	});

	it('renders no form when editor is absent', () => {
		const h = mountBar();
		expect(q(h.target, 'goal-edit-form')).toBeNull();
		h.cleanup();
	});

});

describe('goal-bar — editor form callbacks (isolated spies)', () => {
	const editorState = { objective: 'obj', maxGoalRounds: 8 };
	function mountWith(spies: Record<string, ReturnType<typeof vi.fn>>) {
		return mountBar({ editor: { ...editorState }, ...spies });
	}
	const q = (root: HTMLElement, id: string) => root.querySelector('[data-testid="' + id + '"]') as HTMLElement;
	const type = (el: HTMLElement, value: string) => {
		(el as HTMLInputElement).value = value;
		el.dispatchEvent(new Event('input', { bubbles: true }));
	};
	const key = (el: HTMLElement, k: string, shift = false) => {
		el.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true }));
	};

	it('objective typing fires oneditinput("objective", value)', () => {
		const oneditinput = vi.fn();
		const h = mountWith({ oneditinput });
		type(q(h.target, 'goal-edit-objective'), 'new words');
		expect(oneditinput).toHaveBeenCalledWith('objective', 'new words');
		h.cleanup();
	});

	it('rounds typing fires oneditinput("maxGoalRounds", value)', () => {
		const oneditinput = vi.fn();
		const h = mountWith({ oneditinput });
		type(q(h.target, 'goal-edit-rounds'), '12');
		expect(oneditinput).toHaveBeenCalledWith('maxGoalRounds', '12');
		h.cleanup();
	});

	it('Enter in the objective field submits (Shift+Enter does not)', () => {
		const oneditsubmit = vi.fn();
		const h = mountWith({ oneditsubmit });
		key(q(h.target, 'goal-edit-objective'), 'Enter');
		key(q(h.target, 'goal-edit-objective'), 'Enter', true);
		expect(oneditsubmit).toHaveBeenCalledTimes(1);
		h.cleanup();
	});

	it('Enter in the rounds field submits; Escape cancels', () => {
		const oneditsubmit = vi.fn();
		const oneditcancel = vi.fn();
		const h = mountWith({ oneditsubmit, oneditcancel });
		key(q(h.target, 'goal-edit-rounds'), 'Escape');
		key(q(h.target, 'goal-edit-rounds'), 'Enter');
		expect(oneditcancel).toHaveBeenCalledTimes(1);
		expect(oneditsubmit).toHaveBeenCalledTimes(1);
		h.cleanup();
	});

	it('Save and Cancel buttons fire exactly their own callback', () => {
		const oneditsubmit = vi.fn();
		const oneditcancel = vi.fn();
		const h = mountWith({ oneditsubmit, oneditcancel });
		q(h.target, 'goal-edit-cancel').click();
		q(h.target, 'goal-edit-submit').click();
		expect(oneditcancel).toHaveBeenCalledTimes(1);
		expect(oneditsubmit).toHaveBeenCalledTimes(1);
		h.cleanup();
	});
});
