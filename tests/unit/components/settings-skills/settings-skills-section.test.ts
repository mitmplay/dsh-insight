/**
 * SettingsSkillsSection — branch mop (Shelf Chrome ADR): the group
 * head's credential gates (version tag, repo door, author door — all
 * null vs present, D5), the badge ladder (signed / foreign-installed /
 * neither), the caret flip + rows gate (hidden), the reload chip arms
 * (working / done / null), the optional-callback arms (ontogglegroup,
 * ontoggle, onuninstall) and the uninstall-tab gate on the verb.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SettingsSkillsSection from '$lib/components/settings-skills/SettingsSkillsSection.svelte';

let target: HTMLElement | null = null;
let instance: Record<string, unknown> | null = null;

const SKILLS = [
	{ n: '1.1', id: 'signed-one', tier: 'stable', installed: true, signed: true, overview: 'does things', dup: false },
	{ n: '1.2', id: 'foreign-one', tier: null, installed: true, signed: false, overview: null },
	{ n: '1.3', id: 'absent-one', tier: null, installed: false, signed: false, overview: null }
];

function baseProps(over: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		sourceId: 'pstack',
		index: 1,
		author: 'Lauren Tan',
		authorUrl: 'https://example.com/author',
		version: '1.2.3',
		repoUrl: 'https://example.com/repo',
		stars: 42,
		skills: SKILLS,
		hidden: false,
		selected: new Set<string>(),
		uninstallable: new Set<string>(['signed-one']),
		tab: 'install',
		busy: false,
		ontoggle: vi.fn(),
		ontogglegroup: vi.fn(),
		onuninstall: vi.fn(),
		reloadChip: null,
		...over
	};
}

function mountSection(props: Record<string, unknown>) {
	target = document.createElement('div');
	document.body.appendChild(target);
	instance = mount(SettingsSkillsSection, { target: target!, props: props as never });
	flushSync();
}

function q(testid: string): HTMLElement | null {
	return target!.querySelector('[data-testid="' + testid + '"]');
}

afterEach(() => {
	if (instance) unmount(instance as never);
	instance = null;
	target?.remove();
	target = null;
});

describe('SettingsSkillsSection — group head credentials', () => {
	it('full credentials: version tag, repo door, author door all render', () => {
		mountSection(baseProps());
		expect(q('shelf-version-pstack')).toBeTruthy();
		expect(q('shelf-door-repo-pstack')).toBeTruthy();
		expect(q('shelf-door-author-pstack')).toBeTruthy();
	});

	it('null credential arms: no version tag, no doors, no stars badge', () => {
		mountSection(baseProps({ version: null, repoUrl: null, authorUrl: null, stars: null }));
		expect(q('shelf-version-pstack')).toBeNull();
		expect(q('shelf-door-repo-pstack')).toBeNull();
		expect(q('shelf-door-author-pstack')).toBeNull();
	});
});

describe('SettingsSkillsSection — badges and rows', () => {
	it('badge ladder: signed → installed badge; foreign → foreign badge; neither → none', () => {
		mountSection(baseProps());
		const badges = target!.querySelectorAll('[data-testid="shelf-row-signed-one"] [data-testid="shelf-badge"]');
		expect(badges.length).toBe(1);
		expect(badges[0].textContent).not.toContain('foreign');

		const foreign = target!.querySelector('[data-testid="shelf-row-foreign-one"] [data-testid="shelf-badge"]');
		expect(foreign).toBeTruthy();

		expect(q('shelf-row-absent-one')!.querySelector('[data-testid="shelf-badge"]')).toBeNull();
	});

	it('hidden=true: caret flips, no rows render; group-head click reports ontogglegroup', () => {
		const props = baseProps({ hidden: true });
		mountSection(props);
		expect(q('shelf-row-signed-one')).toBeNull();
		const head = q('shelf-group-pstack') as HTMLButtonElement;
		expect(head.getAttribute('aria-expanded')).toBe('false');
		head.click();
		flushSync();
		expect(props.ontogglegroup).toHaveBeenCalledTimes(1);
	});

	it('visible group: rows render, row checkbox fires ontoggle with the row key', () => {
		const props = baseProps();
		mountSection(props);
		const head = q('shelf-group-pstack') as HTMLButtonElement;
		expect(head.getAttribute('aria-expanded')).toBe('true');
		const box = target!.querySelector<HTMLInputElement>('[data-testid="shelf-row-signed-one"] input[type="checkbox"]')!;
		box.click();
		flushSync();
		expect(props.ontoggle).toHaveBeenCalledWith('1.1');
	});

	it('uninstall tab: the verb renders for the signed id and fires onuninstall', () => {
		const props = baseProps({ tab: 'uninstall' });
		mountSection(props);
		expect(q('shelf-row-signed-one')!.querySelector('button')).toBeTruthy();
		// absent + install tab: no uninstall verb at all
		expect(q('shelf-row-absent-one')!.querySelector('button')).toBeNull();
		const btn = q('shelf-row-signed-one')!.querySelector('button') as HTMLButtonElement;
		btn.click();
		flushSync();
		expect(props.onuninstall).toHaveBeenCalledWith('signed-one');
	});
});

describe('SettingsSkillsSection — reload chip arms', () => {
	it('working chip: spinner span on the group head', () => {
		mountSection(baseProps({ reloadChip: 'working' }));
		expect(q('shelf-source-working-pstack')).toBeTruthy();
		expect(q('shelf-source-done-pstack')).toBeNull();
	});

	it('done chip: check span; pending/null render nothing', () => {
		mountSection(baseProps({ reloadChip: 'done' }));
		expect(q('shelf-source-done-pstack')).toBeTruthy();
		expect(q('shelf-source-working-pstack')).toBeNull();

		if (instance) unmount(instance as never);
		target!.remove();
		mountSection(baseProps({ reloadChip: 'pending' }));
		expect(q('shelf-source-done-pstack')).toBeNull();
		expect(q('shelf-source-working-pstack')).toBeNull();
	});
});
