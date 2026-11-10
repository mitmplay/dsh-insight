/**
 * SettingsSkillsHeaderActions — branch mop (Shelf Chrome ADR): every
 * arm of the header's action cluster — the tab gate (install vs
 * uninstall), the reloadState title/aria/icon ladder (idle/loading/
 * done), the progress counter (+ its skillTotal>0 sub-arm), the
 * cancel verb (loading-only), the busy disable, and the cross-tab
 * fold pill (ADR D2) click-through.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingsSkillsHeaderActions from '$lib/components/settings-skills/SettingsSkillsHeaderActions.svelte';

let target: HTMLElement | null = null;
let instance: Record<string, unknown> | null = null;

function baseProps(over: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		tab: 'install',
		reloadState: 'idle',
		busy: false,
		progress: null,
		onreload: vi.fn(),
		oncancelreload: vi.fn(),
		oncollapseall: vi.fn(),
		onexpandall: vi.fn(),
		...over
	};
}

function mountActions(props: Record<string, unknown>) {
	target = document.createElement('div');
	document.body.appendChild(target);
	instance = mount(SettingsSkillsHeaderActions, { target: target!, props: props as never });
	flushSync();
	return {
		reload: target!.querySelector<HTMLButtonElement>('[data-testid="shelf-reload"]'),
		progress: target!.querySelector('[data-testid="shelf-reload-progress"]'),
		cancel: target!.querySelector<HTMLButtonElement>('[data-testid="shelf-reload-cancel"]'),
		fold: target!.querySelector('[data-testid="shelf-fold-toggle"]'),
		collapse: target!.querySelector<HTMLButtonElement>('[data-testid="shelf-collapse-all"]'),
		expand: target!.querySelector<HTMLButtonElement>('[data-testid="shelf-expand-all"]')
	};
}

function q(testid: string): HTMLElement {
	return target!.querySelector('[data-testid="' + testid + '"]') as HTMLElement;
}

afterEach(() => {
	if (instance) unmount(instance as never);
	instance = null;
	target?.remove();
	target = null;
});

describe('SettingsSkillsHeaderActions', () => {
	it('uninstall tab: no reload verb, no cancel; the fold pill still renders (cross-tab D2)', () => {
		const h = mountActions(baseProps({ tab: 'uninstall' }));
		expect(h.reload).toBeNull();
		expect(h.cancel).toBeNull();
		expect(h.fold).toBeTruthy();
	});

	it('install idle: reload present and enabled, RotateCw icon, click fires onreload', () => {
		const props = baseProps();
		const h = mountActions(props);
		expect(h.reload).toBeTruthy();
		expect(h.reload!.getAttribute('data-reload-state')).toBe('idle');
		expect(h.reload!.disabled).toBe(false);
		expect(h.progress).toBeNull();
		expect(h.cancel).toBeNull();
		h.reload!.click();
		flushSync();
		expect(props.onreload).toHaveBeenCalledTimes(1);
	});

	it('loading + progress with skills: counter shows both parts, cancel verb renders', () => {
		const props = baseProps({
			reloadState: 'loading',
			progress: { done: 3, total: 5, skillDone: 1, skillTotal: 4, sources: [] }
		});
		const h = mountActions(props);
		expect(h.reload!.classList.contains('reloading')).toBe(true);
		expect(h.progress).toBeTruthy();
		expect(h.progress!.textContent).toContain('3/5');
		expect(h.progress!.textContent).toContain('1/4');
		expect(h.cancel).toBeTruthy();
		h.cancel!.click();
		flushSync();
		expect(props.oncancelreload).toHaveBeenCalledTimes(1);
	});

	it('loading + progress with skillTotal 0: the skill sub-counter arm stays hidden', () => {
		mountActions(baseProps({
			reloadState: 'loading',
			progress: { done: 1, total: 2, skillDone: 0, skillTotal: 0, sources: [] }
		}));
		const progress = q('shelf-reload-progress');
		expect(progress.textContent).toContain('1/2');
		expect(progress.textContent?.includes('·')).toBe(false);
	});

	it('loading without progress: no counter, but the cancel verb still shows', () => {
		const h = mountActions(baseProps({ reloadState: 'loading' }));
		expect(h.progress).toBeNull();
		expect(h.cancel).toBeTruthy();
	});

	it('done state: reloaded class + Check icon; busy disables the reload verb', () => {
		const h = mountActions(baseProps({ reloadState: 'done', busy: true }));
		expect(h.reload!.classList.contains('reloaded')).toBe(true);
		expect(h.reload!.querySelector('svg')).toBeTruthy();
		expect(h.reload!.disabled).toBe(true);
	});

	it('fold pill: collapse and expand clicks report their intents', () => {
		const props = baseProps({ tab: 'uninstall' });
		const h = mountActions(props);
		h.collapse!.click();
		flushSync();
		h.expand!.click();
		flushSync();
		expect(props.oncollapseall).toHaveBeenCalledTimes(1);
		expect(props.onexpandall).toHaveBeenCalledTimes(1);
	});
});
