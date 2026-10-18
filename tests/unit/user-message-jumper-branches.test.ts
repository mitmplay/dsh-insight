/**
 * UserMessageJumper TEMPLATE branch tests (SA-2): both sides of every
 * conditional reachable from rendering the anchor-path component
 * (src/lib/components/anchor/user-messages/UserMessageJumper.svelte).
 *
 * Branches exercised:
 *  - prompts filter predicate: g.kind === 'prompt' TRUE (rows rendered)
 *    and FALSE (context / system-prompt / assistant-turn groups dropped)
 *  - {#each prompts} with ZERO prompts (empty popup) vs MULTIPLE (row per
 *    prompt, keyed by group.key)
 *  - truncate ternary: text.length <= 60 TRUE (raw text, no ellipsis),
 *    FALSE (>60 → slice + ellipsis), and the exact-60 boundary
 *  - cssEscape ternary: CSS.escape present vs stubbed away (fallback arm)
 *  - scrollToGroup container guard both arms + shell?.focus() optional
 *    call (hit on a successful jump)
 */
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import UserMessageJumper from '$lib/components/anchor/user-messages/UserMessageJumper.svelte';
import type { TurnGroup } from '$lib/utils/turn-grouping';

const prompt = (id: string, text: string): TurnGroup =>
	({
		kind: 'prompt',
		key: id,
		entry: { kind: 'user-message', id, seq: 1, time: 1_000, text },
		context: []
	}) as TurnGroup;

/** Non-prompt group shapes — never listed, whatever their payload. */
const foreignGroup = (kind: 'context' | 'system-prompt' | 'assistant-turn'): TurnGroup =>
	({ kind, key: `x:${kind}` }) as unknown as TurnGroup;

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

const rows = (target: HTMLElement) =>
	Array.from(target.querySelectorAll('[data-testid="user-message-jumper-row"]'));
const rowAt = (target: HTMLElement, i = 0): HTMLElement => rows(target)[i] as HTMLElement;

afterEach(() => {
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

describe('UserMessageJumper — template branches (filter + each)', () => {
	it('prompt-kind groups are listed — one keyed row per prompt, in order', () => {
		const groups = [prompt('u:1', 'first'), foreignGroup('assistant-turn'), prompt('u:2', 'second')];
		const { target, instance } = mountJumper({ groups, container: document.createElement('div') });
		const texts = rows(target).map((r) => r.querySelector('.truncate')?.textContent);
		expect(texts).toEqual(['first', 'second']);
		unmount(instance);
	});

	it('filter false-arm: context, system-prompt and assistant-turn groups render NO rows', () => {
		const groups = [foreignGroup('context'), foreignGroup('system-prompt'), foreignGroup('assistant-turn')];
		const { target, instance } = mountJumper({ groups, container: document.createElement('div') });
		expect(rows(target)).toHaveLength(0);
		// The popup shell still renders (header present), only the list is empty.
		expect(target.querySelector('[data-testid="user-message-jumper-header"]')).toBeTruthy();
		unmount(instance);
	});

	it('empty groups array → zero rows (each-block false arm)', () => {
		const { target, instance } = mountJumper({ groups: [], container: document.createElement('div') });
		expect(rows(target)).toHaveLength(0);
		unmount(instance);
	});

	it('header title carries the prompt count, not the raw group count', () => {
		const groups = [prompt('u:1', 'a'), foreignGroup('context'), prompt('u:2', 'b')];
		const { target, instance } = mountJumper({ groups, container: document.createElement('div') });
		const header = target.querySelector('[data-testid="user-message-jumper-header"]');
		expect(header?.textContent).toContain('2');
		unmount(instance);
	});
});

describe('UserMessageJumper — truncate ternary (rendered)', () => {
	it('short prompt: length <= 60 → raw text, no ellipsis', () => {
		const { target, instance } = mountJumper({ groups: [prompt('u:1', 'short one')], container: document.createElement('div') });
		expect(rowAt(target).textContent).toContain('short one');
		expect(rowAt(target).textContent).not.toContain('…');
		unmount(instance);
	});

	it('exact-60 boundary → still untruncated (<= arm)', () => {
		const exact = 'b'.repeat(60);
		const { target, instance } = mountJumper({ groups: [prompt('u:1', exact)], container: document.createElement('div') });
		expect(rowAt(target).textContent).toContain(exact);
		unmount(instance);
	});

	it('61+ prompt: > arm → 60 chars + ellipsis, tail dropped', () => {
		const long = 'a'.repeat(60) + 'TAIL';
		const { target, instance } = mountJumper({ groups: [prompt('u:1', long)], container: document.createElement('div') });
		const text = rowAt(target).textContent ?? '';
		expect(text).toContain('…');
		expect(text.indexOf('TAIL')).toBe(-1);
		unmount(instance);
	});

	it('timestamp row renders relativeTime + ISO title for the entry', () => {
		const { target, instance } = mountJumper({ groups: [prompt('u:1', 'when')], container: document.createElement('div') });
		const meta = rowAt(target).querySelector('[title]') as HTMLElement;
		expect(meta.getAttribute('title')).toBe(new Date(1_000).toISOString());
		expect(meta.textContent?.trim().length).toBeGreaterThan(0);
		unmount(instance);
	});
});

describe('UserMessageJumper — click-path branches from rendered rows', () => {
	it('row click with container but NO matching anchor → second guard, no scroll', async () => {
		const container = document.createElement('div');
		container.scrollTo = vi.fn();
		const { target, instance } = mountJumper({ groups: [prompt('u:1', 'hi')], container });
		rowAt(target).click();
		await flushSync();
		expect(container.scrollTo).not.toHaveBeenCalled();
		unmount(instance);
	});

	it('row click with matching anchor → scroll + shell?.focus() called arm', async () => {
		const container = document.createElement('div');
		const anchor = document.createElement('div');
		anchor.setAttribute('data-group-key', 'u:seq:12');
		container.appendChild(anchor);
		document.body.appendChild(container);
		container.scrollTo = vi.fn();
		const { target, instance } = mountJumper({ groups: [prompt('u:seq:12', 'find me')], container });
		rowAt(target).click();
		await flushSync();
		expect(container.scrollTo).toHaveBeenCalledWith({ top: expect.any(Number), behavior: 'smooth' });
		unmount(instance);
	});

	it('cssEscape fallback arm: no CSS.escape → raw key selector still finds the anchor', async () => {
		vi.stubGlobal('CSS', undefined);
		const container = document.createElement('div');
		const anchor = document.createElement('div');
		anchor.setAttribute('data-group-key', 'u:seq:3');
		container.appendChild(anchor);
		document.body.appendChild(container);
		const scrollTo = vi.fn();
		container.scrollTo = scrollTo;
		const { target, instance } = mountJumper({ groups: [prompt('u:seq:3', 'fallback')], container });
		rowAt(target).click();
		await flushSync();
		expect(scrollTo).toHaveBeenCalled();
		unmount(instance);
	});

	it('container undefined → early-return arm, click is a no-op', async () => {
		const { target, instance } = mountJumper({ groups: [prompt('u:1', 'hi')], container: undefined });
		expect(() => rowAt(target).click()).not.toThrow();
		await flushSync();
		unmount(instance);
	});

	it('open=false renders the shell but keeps the popup closed (bindable prop arm)', () => {
		const { target, instance } = mountJumper({ groups: [prompt('u:1', 'hi')], open: false, container: document.createElement('div') });
		const popup = target.querySelector('[data-testid="user-message-jumper"]');
		expect(popup?.getAttribute('hidden')).not.toBeNull();
		unmount(instance);
	});
});
