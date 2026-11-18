/**
 * SidebarSessionOpenHeader branch coverage — the consumer header
 * mounted directly. Drives both arms of every conditional:
 *   - subagentsHidden true → BotOff glyph + aria-pressed true +
 *     .active class + "Show sub-agents" title
 *   - subagentsHidden false → Bot glyph + aria-pressed false +
 *     no .active + "Hide sub-agents" title
 *   - headName string → chip renders; headName null → bare stem
 *   - dead / running tints pass through to the chip
 *   - collapsed true → chevron aria-expanded false (right chevron)
 *   - every callback fires from its own control
 */

import { flushSync } from 'svelte';
import { mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SidebarSessionOpenHeader from '$lib/components/sidebar/session-open/SidebarSessionOpenHeader.svelte';

type Props = Partial<{
	collapsed: boolean;
	headName: string | null;
	dead: boolean;
	running: boolean;
	allFolded: boolean;
	allUnfolded: boolean;
	oncollapseall: () => void;
	onexpandall: () => void;
	subagentsHidden: boolean;
	ontoggle: () => void;
	ontogglesubagents: () => void;
}>;

function mountHeader(props: Props) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(SidebarSessionOpenHeader, { target, props: props as never });
	flushSync();
	return { target, instance };
}

const head = (target: HTMLElement): HTMLElement =>
	target.querySelector('[data-testid="sidebar-panel-group-header"]') as HTMLElement;
const toggle = (target: HTMLElement): HTMLButtonElement =>
	target.querySelector('[data-testid="sidebar-panel-group-toggle"]') as HTMLButtonElement;
const chip = (target: HTMLElement): HTMLElement | null =>
	target.querySelector('[data-testid="sidebar-panel-group-chip"]');
const subBtn = (target: HTMLElement): HTMLButtonElement =>
	target.querySelector('[data-testid="sidebar-open-panels-subagents"]') as HTMLButtonElement;

function fullProps(overrides: Props = {}): Props {
	return {
		collapsed: false,
		headName: 'Research thread',
		dead: false,
		running: false,
		allFolded: false,
		allUnfolded: false,
		oncollapseall: () => {},
		onexpandall: () => {},
		subagentsHidden: false,
		ontoggle: () => {},
		ontogglesubagents: () => {},
		...overrides
	};
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('SidebarSessionOpenHeader — sub-agent filter branches', () => {
	it('subagentsHidden=false → Bot glyph, aria-pressed false, no .active, Hide title', () => {
		const { target, instance } = mountHeader(fullProps({ subagentsHidden: false }));
		const btn = subBtn(target);
		expect(btn).not.toBeNull();
		expect(btn.getAttribute('aria-pressed')).toBe('false');
		expect(btn.classList.contains('active')).toBe(false);
		expect(btn.getAttribute('title')).toBe('Hide sub-agents');
		expect(btn.querySelector('svg')).not.toBeNull();
		unmount(instance);
	});

	it('subagentsHidden=true → aria-pressed true, .active, Show title', () => {
		const { target, instance } = mountHeader(fullProps({ subagentsHidden: true }));
		const btn = subBtn(target);
		expect(btn.getAttribute('aria-pressed')).toBe('true');
		expect(btn.classList.contains('active')).toBe(true);
		expect(btn.getAttribute('title')).toBe('Show sub-agents');
		unmount(instance);
	});

	it('clicking the filter fires ontogglesubagents', () => {
		const ontogglesubagents = vi.fn();
		const { target, instance } = mountHeader(fullProps({ ontogglesubagents }));
		subBtn(target).click();
		expect(ontogglesubagents).toHaveBeenCalledTimes(1);
		unmount(instance);
	});
});

describe('SidebarSessionOpenHeader — title chip branches', () => {
	it('headName string renders the chip with the name', () => {
		const { target, instance } = mountHeader(fullProps({ headName: 'Research thread' }));
		const c = chip(target);
		expect(c).not.toBeNull();
		expect(c!.textContent).toContain('Research thread');
		expect(target.querySelector('[data-testid="sidebar-panel-group-title"]')!.textContent).toContain('Focused');
		unmount(instance);
	});

	it('headName null renders the bare stem with NO chip', () => {
		const { target, instance } = mountHeader(fullProps({ headName: null }));
		expect(chip(target)).toBeNull();
		expect(target.querySelector('[data-testid="sidebar-panel-group-title"]')!.textContent).toContain('Focused -');
		unmount(instance);
	});

	it('dead=true paints the dead tint on the chip', () => {
		const { target, instance } = mountHeader(fullProps({ dead: true }));
		expect(chip(target)!.classList.contains('dead')).toBe(true);
		unmount(instance);
	});

	it('running=true arms the run-state glyph inside the chip', () => {
		const { target, instance } = mountHeader(fullProps({ running: true }));
		const c = chip(target)!;
		expect(c.querySelector('.si-run, [class*="run"]')).not.toBeNull();
		unmount(instance);
	});
});

describe('SidebarSessionOpenHeader — collapse toggle + fold pair', () => {
	it('expanded (collapsed=false) → aria-expanded true', () => {
		const { target, instance } = mountHeader(fullProps({ collapsed: false }));
		expect(toggle(target).getAttribute('aria-expanded')).toBe('true');
		unmount(instance);
	});

	it('collapsed → aria-expanded false', () => {
		const { target, instance } = mountHeader(fullProps({ collapsed: true }));
		expect(toggle(target).getAttribute('aria-expanded')).toBe('false');
		unmount(instance);
	});

	it('toggle click fires ontoggle', () => {
		const ontoggle = vi.fn();
		const { target, instance } = mountHeader(fullProps({ ontoggle }));
		toggle(target).click();
		expect(ontoggle).toHaveBeenCalledTimes(1);
		unmount(instance);
	});

	it('lineage fold pair fires oncollapseall / onexpandall', () => {
		const oncollapseall = vi.fn();
		const onexpandall = vi.fn();
		const { target, instance } = mountHeader(fullProps({ oncollapseall, onexpandall }));
		const c = target.querySelector('[data-testid="sidebar-lineage-collapse-all"]') as HTMLButtonElement;
		const e = target.querySelector('[data-testid="sidebar-lineage-expand-all"]') as HTMLButtonElement;
		c.click();
		e.click();
		expect(oncollapseall).toHaveBeenCalledTimes(1);
		expect(onexpandall).toHaveBeenCalledTimes(1);
		unmount(instance);
	});

	it('collapsed group arms both fold segments (disabled=false)', () => {
		const { target, instance } = mountHeader(fullProps({ collapsed: true, allFolded: true, allUnfolded: true }));
		expect((target.querySelector('[data-testid="sidebar-lineage-collapse-all"]') as HTMLButtonElement).disabled).toBe(false);
		expect((target.querySelector('[data-testid="sidebar-lineage-expand-all"]') as HTMLButtonElement).disabled).toBe(false);
		unmount(instance);
	});
});
