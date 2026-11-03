/**
 * TodoCard coverage mop (ADR-0009 family): the raw-fallback arms
 * (junk args, absent halves), the tri-state glyphs, the delta accents
 * (just-completed / now-active), the rewritten-plan badge, the digest
 * footer, and the raw-JSON toggle — all through public props + DOM.
 */
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';
import TodoCard from '$lib/components/message/cards/TodoCard.svelte';

const list = (items: Array<{ content: string; status: string }>) => JSON.stringify({ todos: items });

function render(props: { argsRaw?: string; prevArgsRaw?: string; resultText?: string }) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(TodoCard, { target, props });
	return { target, unmount: () => unmount(comp) };
}
const rows = (t: HTMLElement) => t.querySelectorAll('[data-testid="todo-row"]');

describe('TodoCard — raw fallback arms', () => {
	it('junk args + result render BOTH raw panes, no card chrome', () => {
		const { target, unmount } = render({ argsRaw: '{junk', resultText: 'done 1' });
		expect(target.querySelector('[data-testid="todo-card"]')).toBeNull();
		expect(target.querySelector('[data-testid="todo-raw-args"]')?.textContent).toBe('{junk');
		expect(target.querySelector('[data-testid="todo-raw-result"]')?.textContent).toBe('done 1');
		unmount();
	});

	it('junk args without a result render ONLY the raw args pane', () => {
		const { target, unmount } = render({ argsRaw: '[not an object]' });
		expect(target.querySelector('[data-testid="todo-raw-args"]')).not.toBeNull();
		expect(target.querySelector('[data-testid="todo-raw-result"]')).toBeNull();
		unmount();
	});

	it('absent args with a result render ONLY the raw result pane', () => {
		const { target, unmount } = render({ resultText: 'wrote 2 todos' });
		expect(target.querySelector('[data-testid="todo-raw-result"]')?.textContent).toBe('wrote 2 todos');
		expect(target.querySelector('[data-testid="todo-raw-args"]')).toBeNull();
		unmount();
	});
});

describe('TodoCard — parsed card', () => {
	it('renders done/total, tri-state glyphs, and the digest footer', () => {
		const { target, unmount } = render({
			argsRaw: list([
				{ content: 'alpha', status: 'completed' },
				{ content: 'beta', status: 'pending' }
			]),
			resultText: '2 todos written'
		});
		expect(target.querySelector('[data-testid="todo-card-title"]')?.textContent?.trim()).toContain('1/2');
		const rs = rows(target);
		expect(rs[0].getAttribute('data-status')).toBe('completed');
		expect(rs[0].textContent).toContain('●');
		expect(rs[1].textContent).toContain('○');
		expect(target.querySelector('[data-testid="todo-digest"]')?.textContent).toBe('2 todos written');
		// no in_progress item → no active label; no prev → no new-plan badge
		expect(target.querySelector('[data-testid="todo-new-plan"]')).toBeNull();
		unmount();
	});

	it('marks the active item with the ◐ glyph and the in-progress label', () => {
		const { target, unmount } = render({
			argsRaw: list([{ content: 'solo', status: 'in_progress' }])
		});
		expect(rows(target)[0].textContent).toContain('◐');
		expect(target.querySelector('[data-testid="todo-card"]')?.textContent).toContain('1 in progress');
		unmount();
	});

	it('accents just-completed and now-active rows against the previous snapshot', () => {
		const { target, unmount } = render({
			prevArgsRaw: list([
				{ content: 'a', status: 'in_progress' },
				{ content: 'b', status: 'pending' }
			]),
			argsRaw: list([
				{ content: 'a', status: 'completed' },
				{ content: 'b', status: 'in_progress' }
			])
		});
		const rs = rows(target);
		expect(rs[0].getAttribute('data-delta')).toBe('just-completed');
		expect(rs[0].querySelector('span')?.className).toContain('text-status-pass');
		expect(rs[1].getAttribute('data-delta')).toBe('now-active');
		expect(rs[1].querySelectorAll('span')[1]?.className).toContain('font-medium');
		unmount();
	});

	it('a rewritten text set reads as a NEW PLAN badge, not a delta', () => {
		const { target, unmount } = render({
			prevArgsRaw: list([{ content: 'old', status: 'pending' }]),
			argsRaw: list([{ content: 'brand new', status: 'pending' }])
		});
		expect(target.querySelector('[data-testid="todo-new-plan"]')).not.toBeNull();
		expect(rows(target)[0].getAttribute('data-delta')).toBe('');
		unmount();
	});

	it('the raw-JSON toggle reveals and hides both panes inside the card', () => {
		const { target, unmount } = render({
			argsRaw: list([{ content: 'x', status: 'pending' }]),
			resultText: 'digest'
		});
		const toggle = target.querySelector('[data-testid="todo-raw-toggle"]') as HTMLButtonElement;
		expect(target.querySelectorAll('[data-testid="todo-raw-args"]').length).toBe(0);
		toggle.click();
		flushSync();
		expect(target.querySelector('[data-testid="todo-raw-args"]')?.textContent).toContain('x');
		expect(target.querySelector('[data-testid="todo-raw-result"]')?.textContent).toBe('digest');
		(toggle as HTMLElement).click();
		flushSync();
		expect(target.querySelectorAll('[data-testid="todo-raw-args"]').length).toBe(0);
		unmount();
	});

	it('omits the digest when no result arrived', () => {
		const { target, unmount } = render({ argsRaw: list([{ content: 'x', status: 'pending' }]) });
		expect(target.querySelector('[data-testid="todo-digest"]')).toBeNull();
		unmount();
	});
});
