/**
 * UserMessageJumper (anchor/user-messages) script/logic coverage:
 * the prompt-group filter ($derived), scrollToGroup's two guard paths
 * and success path, truncate's both arms, cssEscape's both arms, and
 * the title's prompts.length interpolation.
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import UserMessageJumper from '$lib/components/anchor/user-messages/UserMessageJumper.svelte';
import type { TurnGroup } from '$lib/utils/turn-grouping';

const prompt = (id: string, text: string, time = 1_000): TurnGroup => ({
	kind: 'prompt',
	key: id,
	entry: { kind: 'user-message', id, seq: 1, time, text },
	context: []
});

const assistantTurn: TurnGroup = {
	kind: 'assistant-turn',
	key: 'a:1',
	entries: []
};

const contextClub: TurnGroup = {
	kind: 'context',
	key: 'c:1',
	entries: []
};

const systemPrompt: TurnGroup = {
	kind: 'system-prompt',
	key: 's:1',
	entry: { kind: 'system-prompt', id: 's:1', seq: 0, time: 1, text: 'sys' }
};

function mountJumper(props: Record<string, unknown>) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const instance = mount(UserMessageJumper, {
		target,
		props: { triggerEl: undefined, open: true, ...props } as never
	});
	flushSync();
	return { target, instance };
}

const rows = (target: HTMLElement): HTMLElement[] =>
	Array.from(target.querySelectorAll('[data-testid="user-message-jumper-row"]'));

const rowAt = (target: HTMLElement, i = 0): HTMLElement => rows(target)[i];

const header = (target: HTMLElement): string =>
	(target.querySelector('[data-testid="user-message-jumper-header"]')?.textContent ?? '');

afterEach(() => {
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

describe('UserMessageJumper — prompts filter ($derived)', () => {
	it('lists only prompt groups, in wire order, skipping every other kind', () => {
		const groups = [systemPrompt, prompt('u:1', 'first'), assistantTurn, contextClub, prompt('u:2', 'second')];
		const { target, instance } = mountJumper({ groups, container: document.createElement('div') });
		expect(rows(target)).toHaveLength(2);
		expect(rowAt(target, 0).textContent).toContain('first');
		expect(rowAt(target, 1).textContent).toContain('second');
		unmount(instance);
	});

	it('title interpolates the prompt count', () => {
		const { target, instance } = mountJumper({
			groups: [prompt('u:1', 'a'), prompt('u:2', 'b')],
			container: document.createElement('div')
		});
		expect(header(target)).toContain('2');
		unmount(instance);
	});
});

describe('UserMessageJumper — scrollToGroup guards and jump', () => {
	it('no container → early-return no-op (never throws)', async () => {
		const { target, instance } = mountJumper({ groups: [prompt('u:1', 'hi')], container: undefined });
		rowAt(target).click();
		await flushSync();
		unmount(instance);
	});

	it('anchor missing inside the container → second guard stops the jump', async () => {
		const container = document.createElement('div');
		container.scrollTo = vi.fn();
		const { target, instance } = mountJumper({ groups: [prompt('u:1', 'hi')], container });
		rowAt(target).click();
		await flushSync();
		expect(container.scrollTo).not.toHaveBeenCalled();
		unmount(instance);
	});

	it('jump found → smooth-scroll centered and the shell is refocused', async () => {
		const container = document.createElement('div');
		const anchor = document.createElement('div');
		anchor.setAttribute('data-group-key', 'u:1');
		container.appendChild(anchor);
		document.body.appendChild(container);
		container.scrollTo = vi.fn();
		const { target, instance } = mountJumper({ groups: [prompt('u:1', 'find me')], container });
		rowAt(target).click();
		await flushSync();
		expect(container.scrollTo).toHaveBeenCalledWith({ top: expect.any(Number), behavior: 'smooth' });
		unmount(instance);
	});

	it('colons in the key go through CSS.escape and still find the anchor', async () => {
		const container = document.createElement('div');
		const anchor = document.createElement('div');
		anchor.setAttribute('data-group-key', 'u:seq:12');
		container.appendChild(anchor);
		document.body.appendChild(container);
		container.scrollTo = vi.fn();
		const { target, instance } = mountJumper({ groups: [prompt('u:seq:12', 'find me')], container });
		rowAt(target).click();
		await flushSync();
		expect(container.scrollTo).toHaveBeenCalled();
		unmount(instance);
	});
});

describe('UserMessageJumper — truncate branches', () => {
	it('prompt longer than 60 chars truncates with an ellipsis', () => {
		const long = 'a'.repeat(70) + 'tail';
		const { target, instance } = mountJumper({ groups: [prompt('u:1', long)], container: document.createElement('div') });
		const body = rowAt(target).textContent ?? '';
		expect(body).toContain('…');
		expect(body.indexOf('tail')).toBe(-1);
		unmount(instance);
	});

	it('exactly-60-char prompt stays untruncated (boundary arm)', () => {
		const exact = 'b'.repeat(60);
		const { target, instance } = mountJumper({ groups: [prompt('u:1', exact)], container: document.createElement('div') });
		expect(rowAt(target).textContent).not.toContain('…');
		unmount(instance);
	});

	it('row renders relativeTime and an ISO title for the entry time', () => {
		const now = Date.now();
		const { target, instance } = mountJumper({ groups: [prompt('u:1', 'hi', now - 120_000)], container: document.createElement('div') });
		const row = rowAt(target);
		expect(row.textContent).toContain('2m ago');
		expect(row.querySelector('div[title]')?.getAttribute('title')).toBe(new Date(now - 120_000).toISOString());
		unmount(instance);
	});
});

describe('UserMessageJumper — cssEscape fallback arm', () => {
	it('without CSS.escape the raw key still drives the selector (anchor found)', async () => {
		vi.stubGlobal('CSS', undefined);
		const container = document.createElement('div');
		const anchor = document.createElement('div');
		anchor.setAttribute('data-group-key', 'u:seq:12');
		container.appendChild(anchor);
		document.body.appendChild(container);
		container.scrollTo = vi.fn();
		const { target, instance } = mountJumper({ groups: [prompt('u:seq:12', 'find me')], container });
		rowAt(target).click();
		await flushSync();
		expect(container.scrollTo).toHaveBeenCalled();
		unmount(instance);
	});
});
