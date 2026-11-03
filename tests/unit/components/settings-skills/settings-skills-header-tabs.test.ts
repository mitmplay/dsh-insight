/**
 * SettingsSkillsHeaderTabs tests (The Shelf Chrome D3): the shelf's own
 * pill speaks install/uninstall natively, PLAIN labels — no counts.
 */
import { flushSync } from 'svelte';
import { mount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingsSkillsHeaderTabs from '$lib/components/settings-skills/SettingsSkillsHeaderTabs.svelte';

function mountGroup(props: Record<string, unknown> = {}) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	mount(SettingsSkillsHeaderTabs, { target, props });
	flushSync();
	return target;
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('SettingsSkillsHeaderTabs', () => {
	it('defaults to the install segment with plain labels (no counts)', () => {
		const target = mountGroup();
		const install = target.querySelector('[data-testid="shelf-tab-install"]')!;
		// Plugin Rack amendment IV (2026-10-31): the pill lives in SegmentedTabs;
		// the segment's ON state is aria-pressed, not a scoped .on class.
		expect(install.getAttribute('aria-pressed')).toBe('true');
		expect(install.textContent!.trim()).toBe('Install');
		expect(target.querySelector('[data-testid="shelf-tab-uninstall"]')!.textContent!.trim()).toBe('Uninstall');
		expect(install.textContent).not.toContain('(');
	});

	it('reports native install/uninstall intents', () => {
		const ontabchange = vi.fn();
		const target = mountGroup({ ontabchange });
		target.querySelector<HTMLButtonElement>('[data-testid="shelf-tab-uninstall"]')!.click();
		flushSync();
		expect(ontabchange).toHaveBeenCalledWith('uninstall');
	});
});
