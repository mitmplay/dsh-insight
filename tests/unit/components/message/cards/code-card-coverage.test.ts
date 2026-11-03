/**
 * CodeCard coverage mop (ADR-0008 family): the title fallback, plan-strip
 * arg arms, dispatchFileName's junk/empty-file_path arms, the error ring,
 * the over-cap expand/collapse toggle, the D6 output footer, and the
 * raw-JSON toggle — all through public props + DOM.
 */
import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it } from 'vitest';
import CodeCard from '$lib/components/message/cards/CodeCard.svelte';
import type { DsiCodeDispatch } from '$lib/types';

const longCode = Array.from({ length: 45 }, (_, i) => `const v${i} = ${i};`).join('\n');
const ARGS_NODES = JSON.stringify({ code: longCode });
const ARGS_DESC = JSON.stringify({ description: 'Do things', code: 'const a = 1;' });

function render(props: { argsRaw?: string; resultText?: string; dispatches?: DsiCodeDispatch[] }) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const comp = mount(CodeCard, { target, props });
	return { target, unmount: () => unmount(comp) };
}

describe('CodeCard — title + plan strip', () => {
	it('a program without a description falls back to the generic title', () => {
		const { target, unmount } = render({ argsRaw: ARGS_NODES });
		const title = target.querySelector('[data-testid="code-card-title"]') as HTMLElement;
		expect(title.textContent?.trim().length).toBeGreaterThan(0);
		expect(target.querySelector('[data-testid="code-plan"]')).toBeNull(); // empty plan arm
		unmount();
	});

	it('plan steps render the tool title; a step without an arg shows no arg span', () => {
		const { target, unmount } = render({
			argsRaw: JSON.stringify({
				description: 'd',
				code: "const a = await tools.read({ file_path: '/x/aaa.md' });\nawait tools.bash({});"
			})
		});
		const plan = target.querySelector('[data-testid="code-plan"]') as HTMLElement;
		expect(plan.textContent).toContain('→');
		const spans = plan.querySelectorAll('span.shrink-0');
		expect(spans[0].textContent).toContain('aaa.md'); // salient arg shown
		expect(spans[1].textContent).not.toContain('.md'); // no-arg call, no arg span
		unmount();
	});
});

describe('CodeCard — dispatch arms', () => {
	it('a pending dispatch with unparseable args renders no filename', () => {
		const { target, unmount } = render({
			argsRaw: ARGS_DESC,
			dispatches: [{ subCallId: 'c1', name: 'write', argsRaw: '{bad json', settled: false }]
		});
		const pending = target.querySelector('[data-testid="code-dispatch-pending"]') as HTMLElement;
		expect(pending).not.toBeNull();
		expect(pending.querySelectorAll('span.truncate').length).toBe(0); // catch arm
		unmount();
	});

	it('a pending dispatch with an empty file_path renders no filename', () => {
		const { target, unmount } = render({
			argsRaw: ARGS_DESC,
			dispatches: [{ subCallId: 'c1', name: 'write', argsRaw: JSON.stringify({ file_path: '' }), settled: false }]
		});
		const pending = target.querySelector('[data-testid="code-dispatch-pending"]') as HTMLElement;
		expect(pending.querySelectorAll('span.truncate').length).toBe(0); // empty-string arm
		unmount();
	});

	it('a settled errored file read keeps its content and paints the danger ring', () => {
		const { target, unmount } = render({
			argsRaw: ARGS_DESC,
			dispatches: [
				{
					subCallId: 'c1',
					name: 'read',
					argsRaw: JSON.stringify({ file_path: '/x/a.md' }),
					settled: true,
					isError: true,
					contentText: '<path>/x/a.md</path><type>file</type><content>boom</content>'
				}
			]
		});
		const file = target.querySelector('[data-testid="code-dispatch-file"]') as HTMLElement;
		expect(file.className).toContain('ring-danger-wash-border');
		unmount();
	});
});

describe('CodeCard — code block, footer, raw toggles', () => {
	it('an over-cap program collapses to 40 lines and expands back on toggle', () => {
		const { target, unmount } = render({ argsRaw: ARGS_NODES });
		const block = target.querySelector('[data-testid="code-block"]') as HTMLElement;
		expect(block.textContent).toContain('v39 = 39');
		expect(block.textContent).not.toContain('v40 = 40');
		const toggle = target.querySelector('[data-testid="code-block-toggle"]') as HTMLButtonElement;
		toggle.click();
		flushSync();
		expect((target.querySelector('[data-testid="code-block"]') as HTMLElement).textContent).toContain('v44 = 44');
		(target.querySelector('[data-testid="code-block-toggle"]') as HTMLButtonElement).click();
		flushSync();
		expect((target.querySelector('[data-testid="code-block"]') as HTMLElement).textContent).not.toContain('v44 = 44');
		unmount();
	});

	it('the program-output footer opens the result pane and closes it again', () => {
		const { target, unmount } = render({ argsRaw: ARGS_DESC, resultText: 'returned 42' });
		expect(target.querySelector('[data-testid="code-result-pane"]')).toBeNull();
		(target.querySelector('[data-testid="code-result-footer-toggle"]') as HTMLButtonElement).click();
		flushSync();
		expect(target.querySelector('[data-testid="code-result-pane"]')?.textContent).toContain('returned 42');
		(target.querySelector('[data-testid="code-result-footer-toggle"]') as HTMLButtonElement).click();
		flushSync();
		expect(target.querySelector('[data-testid="code-result-pane"]')).toBeNull();
		unmount();
	});

	it('the card raw-JSON toggle reveals the verbatim args', () => {
		const { target, unmount } = render({ argsRaw: ARGS_DESC });
		expect(target.querySelectorAll('[data-testid="code-raw-args"]').length).toBe(0);
		(target.querySelector('[data-testid="code-raw-toggle"]') as HTMLButtonElement).click();
		flushSync();
		expect(target.querySelector('[data-testid="code-raw-args"]')?.textContent).toContain('Do things');
		unmount();
	});

	it('junk args render the raw panes with no card chrome', () => {
		const { target, unmount } = render({ argsRaw: 'no json here', resultText: 'out' });
		expect(target.querySelector('[data-testid="code-card"]')).toBeNull();
		expect(target.querySelector('[data-testid="code-raw-args"]')?.textContent).toBe('no json here');
		expect(target.querySelector('[data-testid="code-raw-result"]')?.textContent).toBe('out');
		unmount();
	});
});
