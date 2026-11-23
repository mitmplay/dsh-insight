/**
 * WorkspaceFileTabsClear — branch floor (ADR 2026-09-17 D3/D5, D5c
 * amendment 2026-11-03). Direct mount of the sticky clear control; pins
 * the arms of the Esc guard the parent-strip suite
 * (tests/unit/workspace-file-tabstrip-clear.test.ts) never takes. Source
 * branches cited by
 * src/lib/components/workspace-file/filetab/WorkspaceFileTabsClear.svelte:
 *   L30 `if (clearOpen && e.key === 'Escape')` — the ONE uncovered arm is
 *       the key guard's false side: the popover is OPEN and a non-Escape
 *       keydown reaches window → the popover must stay open (Escape is the
 *       only key that cancels). Also pinned: the closed side of the guard
 *       (Escape with no popover → no-op, no intent), and — through the
 *       component itself rather than the strip — that each verb closes the
 *       popover and emits exactly ONE scoped intent (L25-28, L57-65).
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import WorkspaceFileTabsClear from '$lib/components/workspace-file/filetab/WorkspaceFileTabsClear.svelte';

type Scope = 'all' | 'non-dirty' | 'other';

let target: HTMLElement | null = null;
let instance: Record<string, unknown> | null = null;

function mountClear(onClear: (scope: Scope) => void = () => {}): HTMLElement {
	target = document.createElement('div');
	document.body.appendChild(target);
	instance = mount(WorkspaceFileTabsClear, { target, props: { onClear } });
	flushSync();
	return target;
}

afterEach(() => {
	if (instance) unmount(instance as never);
	instance = null;
	target?.remove();
	target = null;
});

const button = (root: HTMLElement) => root.querySelector('[data-testid="workspace-file-tabstrip-clear"]') as HTMLButtonElement;
const pop = (root: HTMLElement) => root.querySelector('[data-testid="workspace-file-tabstrip-clear-pop"]');

function key(k: string): void {
	window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
	flushSync();
}

describe('WorkspaceFileTabsClear — the Esc guard (L30)', () => {
	it('OPEN + a non-Escape keydown: the popover stays open, nothing is emitted', () => {
		const onClear = vi.fn();
		const root = mountClear(onClear);
		button(root).click();
		flushSync();
		expect(pop(root)).not.toBeNull();
		for (const k of ['Enter', 'a', 'Tab', 'Escape' /* control: checked below */]) {
			if (k === 'Escape') break; // the cancel arm is the sibling suite's
			key(k);
			expect(pop(root), `popover must survive ${JSON.stringify(k)}`).not.toBeNull();
		}
		expect(button(root).getAttribute('aria-expanded')).toBe('true');
		expect(onClear).not.toHaveBeenCalled();
	});

	it('CLOSED + Escape: the guard short-circuits on clearOpen — no popover, no intent, no throw', () => {
		const onClear = vi.fn();
		const root = mountClear(onClear);
		expect(() => key('Escape')).not.toThrow();
		expect(pop(root)).toBeNull();
		expect(button(root).getAttribute('aria-expanded')).toBe('false');
		expect(onClear).not.toHaveBeenCalled();
		// the control is still live afterwards
		button(root).click();
		flushSync();
		expect(pop(root)).not.toBeNull();
	});
});

describe('WorkspaceFileTabsClear — the three verbs through the component itself (L25-28, L57-65)', () => {
	it.each<[string, Scope, string]>([
		['all', 'all', 'workspace-file-tabstrip-clear-all'],
		['other', 'other', 'workspace-file-tabstrip-clear-other'],
		['non-dirty', 'non-dirty', 'workspace-file-tabstrip-clear-nondirty']
	])('%s: one click closes the popover and emits exactly ONE %j intent', (_label, scope, testid) => {
		const onClear = vi.fn();
		const root = mountClear(onClear);
		button(root).click();
		flushSync();
		expect(pop(root)).not.toBeNull();
		(root.querySelector(`[data-testid="${testid}"]`) as HTMLButtonElement).click();
		flushSync();
		expect(onClear).toHaveBeenCalledTimes(1);
		expect(onClear).toHaveBeenCalledWith(scope);
		expect(pop(root)).toBeNull();
		expect(button(root).getAttribute('aria-expanded')).toBe('false');
	});
});
